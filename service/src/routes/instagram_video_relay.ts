import type { Context } from 'hono';

import type { Env } from '../types.ts';

type FixEmbedContext = Context<{ Bindings: Env }>;
type InstagramVideoProvider =
    | 'instagram'
    | 'kkinstagram'
    | 'snapsave'
    | 'vxinstagram'
    | 'other';
type UpstreamMediaType = 'video/mp4' | 'video/other' | 'image' | 'other' | 'unknown';

export function redactInstagramVideoRelayRequestLog(message: string): string {
    return message.replace(
        /\/video\/instagram\?[^ ]*/g,
        '/video/instagram?url=%5BREDACTED%5D',
    );
}

function classifyInstagramVideoProvider(rawUrl: string): InstagramVideoProvider {
    try {
        const hostname = new URL(rawUrl).hostname.toLowerCase();
        if (hostname === 'kkinstagram.com' || hostname.endsWith('.kkinstagram.com')) {
            return 'kkinstagram';
        }
        if (hostname === 'vxinstagram.com' || hostname.endsWith('.vxinstagram.com')) {
            return 'vxinstagram';
        }
        if (
            hostname === 'snapsave.app'
            || hostname.endsWith('.snapsave.app')
            || hostname === 'rapidcdn.app'
            || hostname.endsWith('.rapidcdn.app')
        ) {
            return 'snapsave';
        }
        if (
            hostname === 'cdninstagram.com'
            || hostname.endsWith('.cdninstagram.com')
            || hostname === 'fbcdn.net'
            || hostname.endsWith('.fbcdn.net')
        ) {
            return 'instagram';
        }
    } catch {
        // The existing redirect fallback remains responsible for invalid URLs.
    }
    return 'other';
}

function classifyUpstreamMediaType(contentType: string | null): UpstreamMediaType {
    const normalized = (contentType || '').split(';', 1)[0].trim().toLowerCase();
    if (normalized === 'video/mp4') return 'video/mp4';
    if (normalized.startsWith('video/')) return 'video/other';
    if (normalized.startsWith('image/')) return 'image';
    return normalized ? 'other' : 'unknown';
}

function parseContentLength(value: string | null): number | null {
    if (!value) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function redirectToSource(videoUrl: string, requestId: string): Response {
    return new Response(null, {
        status: 302,
        headers: {
            'Location': videoUrl,
            'X-FixEmbed-Request-ID': requestId,
        },
    });
}

export async function relayInstagramVideo(c: FixEmbedContext): Promise<Response> {
    const videoUrl = c.req.query('url');
    if (!videoUrl) {
        return c.json({ error: 'Missing video URL' }, 400);
    }

    const requestId = crypto.randomUUID();
    const provider = classifyInstagramVideoProvider(videoUrl);
    const requestedRange = Boolean(c.req.header('Range'));
    const startedAt = Date.now();

    try {
        const response = await fetch(videoUrl, {
            headers: {
                'User-Agent': 'TelegramBot (like TwitterBot)',
                'Accept': 'video/*,*/*',
                'Range': c.req.header('Range') || 'bytes=0-',
            },
        });
        const upstreamResponseMs = Math.max(0, Date.now() - startedAt);
        const upstreamMediaType = classifyUpstreamMediaType(
            response.headers.get('Content-Type'),
        );
        const hasContentRange = response.headers.has('Content-Range');
        const contentLength = parseContentLength(
            response.headers.get('Content-Length'),
        );

        if (!response.ok && response.status !== 206) {
            console.warn('instagram_video_relay', {
                requestId,
                provider,
                outcome: 'redirected',
                requestedRange,
                upstreamStatus: response.status,
                upstreamMediaType,
                hasContentRange,
                contentLength,
                upstreamResponseMs,
                failureStage: 'upstream_response',
            });
            return redirectToSource(videoUrl, requestId);
        }

        console.info('instagram_video_relay', {
            requestId,
            provider,
            outcome: 'stream_started',
            requestedRange,
            upstreamStatus: response.status,
            upstreamMediaType,
            hasContentRange,
            contentLength,
            upstreamResponseMs,
        });

        const headers = new Headers();
        headers.set('Content-Type', response.headers.get('Content-Type') || 'video/mp4');
        headers.set('Accept-Ranges', 'bytes');
        headers.set('Cache-Control', 'public, max-age=3600');
        headers.set('Content-Disposition', 'inline; filename="instagram-video.mp4"');
        headers.set('X-Content-Type-Options', 'nosniff');
        headers.set('X-FixEmbed-Request-ID', requestId);

        const contentRange = response.headers.get('Content-Range');
        if (contentLength !== null) {
            headers.set('Content-Length', String(contentLength));
        }
        if (contentRange) {
            headers.set('Content-Range', contentRange);
        }

        return new Response(response.body, {
            status: response.status,
            headers,
        });
    } catch (error) {
        console.warn('instagram_video_relay', {
            requestId,
            provider,
            outcome: 'redirected',
            requestedRange,
            upstreamStatus: null,
            upstreamMediaType: 'unknown',
            hasContentRange: false,
            contentLength: null,
            upstreamResponseMs: Math.max(0, Date.now() - startedAt),
            failureStage: 'upstream_fetch',
            errorType: error instanceof Error ? error.name : 'unknown',
        });
        return redirectToSource(videoUrl, requestId);
    }
}
