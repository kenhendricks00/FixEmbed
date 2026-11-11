import type { Context } from 'hono';

import type { Env } from '../types.ts';
import { fetchWithTimeout } from '../utils/fetch.ts';
import { BoxStream, muxFragmentedMp4 } from '../utils/fmp4_mux.ts';
import {
    type ByteRange,
    type IndexedMuxPlan,
    indexedMuxBody,
    inputSpans,
    parseByteRange,
    parseIndexedInput,
    planIndexedMux,
} from '../utils/fmp4_index.ts';

const REDDIT_VIDEO_ID = /^[A-Za-z0-9]{1,32}$/;
// Current DASH files end in .mp4; pre-2020 uploads use extensionless DASH_360 and audio.
const REDDIT_VIDEO_FILE = /^[A-Za-z0-9_]{1,64}(?:\.mp4)?$/;
const REDDIT_MEDIA_USER_AGENT = 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)';
// ftyp, moov and sidx sit in the first few KB of every v.redd.it DASH file.
const INIT_PROBE_BYTES = 64 * 1024;

/** FixEmbed URL that serves a v.redd.it DASH video and audio pair as one MP4. */
export function redditMuxedVideoUrl(embedDomain: string, id: string, video: string, audio: string): string | undefined {
    if (!REDDIT_VIDEO_ID.test(id) || !REDDIT_VIDEO_FILE.test(video) || !REDDIT_VIDEO_FILE.test(audio)) return undefined;
    const params = new URLSearchParams({ id, video, audio });
    return `https://${embedDomain}/video/reddit?${params}`;
}

function contentLength(response: Response): number | undefined {
    const value = Number(response.headers.get('Content-Length'));
    return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

async function fetchRedditMedia(url: string): Promise<Response | undefined> {
    try {
        const response = await fetchWithTimeout(url, {
            redirect: 'manual',
            headers: { 'User-Agent': REDDIT_MEDIA_USER_AGENT },
        }, 10_000);
        if (response.ok && response.body) return response;
        await response.body?.cancel();
    } catch {
        // The caller falls back to the silent video track.
    }
    return undefined;
}

async function fetchRedditRange(url: string, range: ByteRange): Promise<Response | undefined> {
    try {
        const response = await fetchWithTimeout(url, {
            redirect: 'manual',
            headers: { 'User-Agent': REDDIT_MEDIA_USER_AGENT, Range: `bytes=${range.start}-${range.end}` },
        }, 10_000);
        const served = response.headers.get('Content-Range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
        if (response.status === 206 && response.body && served && Number(served[1]) === range.start) return response;
        await response.body?.cancel();
    } catch {
        // The caller falls back to the streamed remux.
    }
    return undefined;
}

/** Read each input's init segment and sidx, or return undefined when either file is not indexed. */
async function loadIndexedPlan(videoUrl: string, audioUrl: string): Promise<IndexedMuxPlan | undefined> {
    const inputs = await Promise.all([videoUrl, audioUrl].map(async (url) => {
        const response = await fetchRedditRange(url, { start: 0, end: INIT_PROBE_BYTES - 1 });
        if (!response) return undefined;
        const total = Number(response.headers.get('Content-Range')?.split('/')[1]);
        const bytes = new Uint8Array(await response.arrayBuffer());
        return Number.isSafeInteger(total) && total > 0 ? parseIndexedInput(bytes, total) : undefined;
    }));
    if (!inputs[0] || !inputs[1]) return undefined;
    try {
        return planIndexedMux(inputs[0], inputs[1]);
    } catch {
        return undefined;
    }
}

const MEDIA_HEADERS = {
    'Content-Type': 'video/mp4',
    'Cache-Control': 'public, max-age=86400',
    'Accept-Ranges': 'bytes',
};

async function serveIndexed(
    c: Context<{ Bindings: Env }>,
    plan: IndexedMuxPlan,
    urls: [string, string],
): Promise<Response | undefined> {
    const requested = parseByteRange(c.req.header('Range'), plan.byteLength);
    if (requested === null) {
        return new Response(null, {
            status: 416,
            headers: { ...MEDIA_HEADERS, 'Content-Range': `bytes */${plan.byteLength}` },
        });
    }
    const range = requested ?? { start: 0, end: plan.byteLength - 1 };
    const length = range.end - range.start + 1;
    const headers = new Headers({ ...MEDIA_HEADERS, 'Content-Length': String(length) });
    if (requested) headers.set('Content-Range', `bytes ${range.start}-${range.end}/${plan.byteLength}`);
    const status = requested ? 206 : 200;
    if (c.req.method === 'HEAD') return new Response(null, { status, headers });

    const spans = inputSpans(plan, range);
    const responses = await Promise.all(spans.map((span, track) => span && fetchRedditRange(urls[track], span)));
    if (spans.some((span, track) => span && !responses[track]?.body)) {
        await Promise.all(responses.map((response) => response?.body?.cancel()));
        return undefined;
    }
    const streams = responses.map((response) => response?.body ? new BoxStream(response.body.getReader()) : undefined);
    const cancel = () => Promise.all(streams.map((stream) => stream?.cancel()));
    const chunks = indexedMuxBody(plan, range, streams);
    let body: ReadableStream<Uint8Array> = new ReadableStream<Uint8Array>({
        async pull(controller) {
            try {
                const { done, value } = await chunks.next();
                if (done) {
                    await cancel();
                    controller.close();
                } else controller.enqueue(value);
            } catch (error) {
                await cancel();
                controller.error(error);
            }
        },
        async cancel() {
            await chunks.return(undefined);
            await cancel();
        },
    });
    // Workers only emit Content-Length for streamed bodies through FixedLengthStream.
    if (typeof FixedLengthStream === 'function') body = body.pipeThrough(new FixedLengthStream(length));
    return new Response(body, { status, headers });
}

export async function relayRedditVideo(c: Context<{ Bindings: Env }>): Promise<Response> {
    const id = c.req.query('id') || '';
    const video = c.req.query('video') || '';
    const audio = c.req.query('audio') || '';
    if (!redditMuxedVideoUrl('fixembed.app', id, video, audio)) {
        return c.json({ error: 'Invalid Reddit video' }, 400);
    }

    const videoUrl = `https://v.redd.it/${id}/${video}`;
    const audioUrl = `https://v.redd.it/${id}/${audio}`;
    // Indexed inputs get a seekable file: full duration in a sidx and HTTP Range support.
    const plan = await loadIndexedPlan(videoUrl, audioUrl);
    if (plan) {
        const indexed = await serveIndexed(c, plan, [videoUrl, audioUrl]);
        if (indexed) return indexed;
        if (c.req.header('Range')) return c.json({ error: 'Reddit media unavailable' }, 502);
    }

    const [videoResponse, audioResponse] = await Promise.all([
        fetchRedditMedia(videoUrl),
        fetchRedditMedia(audioUrl),
    ]);
    if (!videoResponse?.body || !audioResponse?.body) {
        await Promise.all([videoResponse?.body?.cancel(), audioResponse?.body?.cancel()]);
        return c.redirect(videoUrl, 302);
    }

    try {
        const muxed = await muxFragmentedMp4(
            videoResponse.body,
            audioResponse.body,
            contentLength(videoResponse),
            contentLength(audioResponse),
        );
        const headers = new Headers({
            'Content-Type': 'video/mp4',
            'Cache-Control': 'public, max-age=86400',
        });
        let body = muxed.body;
        if (muxed.byteLength !== undefined) {
            headers.set('Content-Length', String(muxed.byteLength));
            // Workers only emit Content-Length for streamed bodies through FixedLengthStream.
            if (typeof FixedLengthStream === 'function') body = body.pipeThrough(new FixedLengthStream(muxed.byteLength));
        }
        return new Response(body, { status: 200, headers });
    } catch {
        return c.redirect(videoUrl, 302);
    }
}
