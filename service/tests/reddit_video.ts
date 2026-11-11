import assert from 'node:assert/strict';
import app from '../src/index.ts';

function box(type: string, ...parts: Uint8Array[]): Uint8Array {
    const size = 8 + parts.reduce((total, part) => total + part.byteLength, 0);
    const out = new Uint8Array(size);
    new DataView(out.buffer).setUint32(0, size);
    out.set(new TextEncoder().encode(type), 4);
    let offset = 8;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.byteLength;
    }
    return out;
}

/** Big-endian 32-bit fields; byte length = 4 * fields. */
function fields(...values: number[]): Uint8Array {
    const out = new Uint8Array(values.length * 4);
    values.forEach((value, index) => new DataView(out.buffer).setUint32(index * 4, value));
    return out;
}

function zeros(count: number): Uint8Array {
    return new Uint8Array(count);
}

type Fragment = { time: number; fill: number };

/** Minimal single-track CMAF-style file: ftyp, moov, sidx, then moof+mdat pairs. */
function fragmentedMp4(timescale: number, fragments: Fragment[]): Uint8Array {
    const mvhd = box('mvhd', fields(0, 0, 0, timescale, timescale * 4), zeros(76), fields(2));
    const tkhd = box('tkhd', fields(7, 0, 0, 9, 0, timescale * 4), zeros(60));
    const elst = box('elst', fields(0, 1, timescale * 4, 0, 0x10000));
    const mdhd = box('mdhd', fields(0, 0, 0, timescale, 0, 0));
    const trak = box('trak', tkhd, box('edts', elst), box('mdia', mdhd));
    const trex = box('trex', fields(0, 9, 1, 0, 0, 0));
    const parts = [
        box('ftyp', new TextEncoder().encode('iso6'), fields(0)),
        box('moov', mvhd, trak, box('mvex', trex)),
        box('sidx', zeros(24)),
    ];
    fragments.forEach(({ time, fill }, index) => {
        const traf = box('traf', box('tfhd', fields(0x2000a, 9)), box('tfdt', fields(0, time)));
        parts.push(box('moof', box('mfhd', fields(0, index + 1)), traf));
        parts.push(box('mdat', new Uint8Array(16).fill(fill)));
    });
    return box('root', ...parts).slice(8);
}

type ParsedBox = { type: string; start: number; end: number };

function children(bytes: Uint8Array, start = 0, end = bytes.byteLength): ParsedBox[] {
    const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const boxes: ParsedBox[] = [];
    for (let offset = start; offset < end;) {
        const size = data.getUint32(offset);
        boxes.push({ type: new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8)), start: offset, end: offset + size });
        offset += size;
    }
    return boxes;
}

function child(bytes: Uint8Array, parent: ParsedBox, type: string): ParsedBox {
    const found = children(bytes, parent.start + 8, parent.end).find((candidate) => candidate.type === type);
    assert.ok(found, `missing ${type}`);
    return found;
}

function u32(bytes: Uint8Array, offset: number): number {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset);
}

function mockRedditMedia(files: Record<string, Uint8Array | Response>) {
    const originalFetch = globalThis.fetch;
    const requested: string[] = [];
    globalThis.fetch = async (input) => {
        const url = String(input);
        requested.push(url);
        const file = files[url];
        if (!file) throw new Error(`Unexpected request: ${url}`);
        if (file instanceof Response) return file;
        return new Response(file, {
            status: 200,
            headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(file.byteLength) },
        });
    };
    return { requested, restore: () => { globalThis.fetch = originalFetch; } };
}

type IndexedFragment = { time: number; duration: number; fill: number; samples: number };

/** Single-track DASH file whose sidx indexes every moof+mdat, like current v.redd.it media. */
function indexedMp4(timescale: number, fragments: IndexedFragment[]): Uint8Array {
    const mvhd = box('mvhd', fields(0, 0, 0, timescale, 0), zeros(76), fields(2));
    const tkhd = box('tkhd', fields(7, 0, 0, 1, 0, 0), zeros(60));
    const mdhd = box('mdhd', fields(0, 0, 0, timescale, 0, 0));
    const trak = box('trak', tkhd, box('mdia', mdhd));
    const mehd = box('mehd', fields(0, fragments.reduce((total, { duration }) => total + duration, 0)));
    const trex = box('trex', fields(0, 1, 1, 0, 0, 0));
    const subsegments = fragments.map(({ time, fill, samples }, index) => {
        const traf = box('traf', box('tfhd', fields(0x20000, 1)), box('tfdt', fields(0, time)));
        return [box('moof', box('mfhd', fields(0, index + 1)), traf), box('mdat', new Uint8Array(samples).fill(fill))];
    });
    const references = subsegments.flatMap(([moof, mdat], index) => [
        moof.byteLength + mdat.byteLength, fragments[index].duration, 0x90000000,
    ]);
    const sidx = box('sidx', fields(0, 1, timescale, fragments[0].time, 0, fragments.length), fields(...references));
    return box(
        'root',
        box('ftyp', new TextEncoder().encode('iso6'), fields(0)),
        box('moov', mvhd, trak, box('mvex', mehd, trex)),
        sidx,
        ...subsegments.flat(),
    ).slice(8);
}

/** v.redd.it stand-in that honours single byte ranges. */
function mockRangedMedia(files: Record<string, Uint8Array>) {
    const originalFetch = globalThis.fetch;
    const requested: string[] = [];
    globalThis.fetch = async (input, init) => {
        const url = String(input);
        const file = files[url];
        if (!file) throw new Error(`Unexpected request: ${url}`);
        const range = new Headers(init?.headers).get('Range');
        requested.push(`${url} ${range || 'full'}`);
        const match = range?.match(/^bytes=(\d+)-(\d+)$/);
        if (!match) {
            return new Response(file, { status: 200, headers: { 'Content-Length': String(file.byteLength) } });
        }
        const start = Number(match[1]);
        const end = Math.min(Number(match[2]), file.byteLength - 1);
        return new Response(file.slice(start, end + 1), {
            status: 206,
            headers: { 'Content-Range': `bytes ${start}-${end}/${file.byteLength}`, 'Content-Length': String(end - start + 1) },
        });
    };
    return { requested, restore: () => { globalThis.fetch = originalFetch; } };
}

// Video: four 2 s subsegments. Audio: three 2.5 s subsegments that straddle video starts.
const indexedVideo = indexedMp4(15360, [0, 1, 2, 3].map((index) => ({
    time: index * 30720, duration: 30720, fill: 0xa0 + index, samples: 40 + index * 7,
})));
const indexedAudio = indexedMp4(48000, [0, 1, 2].map((index) => ({
    time: index * 120000, duration: 120000, fill: 0xb0 + index, samples: 31 + index * 5,
})));
// moof (8 + mfhd 16 + traf 8 + tfhd 16 + tfdt 16) + mdat header 8 + the last video fragment's 61 samples.
const lastVideoSubsegment = 8 + 16 + 8 + 16 + 16 + 8 + 61;

const videoPath = '/video/reddit?id=99iz27q26rgh1&video=CMAF_720.mp4&audio=CMAF_AUDIO_128.mp4';
const videoUrl = 'https://v.redd.it/99iz27q26rgh1/CMAF_720.mp4';
const audioUrl = 'https://v.redd.it/99iz27q26rgh1/CMAF_AUDIO_128.mp4';

export const redditVideoTests = [
    {
        name: 'Reddit video route serves indexed media as a seekable MP4 with a full-duration sidx',
        async run() {
            const media = mockRangedMedia({ [videoUrl]: indexedVideo, [audioUrl]: indexedAudio });
            try {
                const response = await app.request(videoPath);
                assert.equal(response.status, 200);
                assert.equal(response.headers.get('Content-Type'), 'video/mp4');
                assert.equal(response.headers.get('Accept-Ranges'), 'bytes');
                const bytes = new Uint8Array(await response.arrayBuffer());
                assert.equal(Number(response.headers.get('Content-Length')), bytes.byteLength);

                const top = children(bytes);
                assert.deepEqual(top.map(({ type }) => type), [
                    'ftyp', 'moov', 'sidx', ...Array(7).fill(['moof', 'mdat']).flat(),
                ]);
                const moofs = top.filter(({ type }) => type === 'moof');
                // Interleaved by start time: v0@0 a0@0 v1@2 a1@2.5 v2@4 a2@5 v3@6.
                assert.deepEqual(
                    moofs.map((moof) => u32(bytes, child(bytes, child(bytes, moof, 'traf'), 'tfhd').start + 12)),
                    [1, 2, 1, 2, 1, 2, 1],
                );
                assert.deepEqual(moofs.map((moof) => u32(bytes, child(bytes, moof, 'mfhd').start + 12)), [1, 2, 3, 4, 5, 6, 7]);
                assert.deepEqual(
                    top.filter(({ type }) => type === 'mdat').map(({ start }) => bytes[start + 8]),
                    [0xa0, 0xb0, 0xa1, 0xb1, 0xa2, 0xb2, 0xa3],
                );

                // One sidx on the video track that indexes every remaining byte.
                const sidx = top[2];
                assert.equal(u32(bytes, sidx.start + 12), 1, 'reference_ID is the video track');
                assert.equal(u32(bytes, sidx.start + 16), 15360);
                assert.equal(u32(bytes, sidx.start + 24), 0, 'first_offset');
                const count = new DataView(bytes.buffer).getUint16(sidx.start + 30);
                assert.equal(count, 4);
                let offset = sidx.end;
                const starts: number[] = [];
                let duration = 0;
                for (let index = 0; index < count; index += 1) {
                    const entry = sidx.start + 32 + index * 12;
                    starts.push(offset);
                    offset += u32(bytes, entry) & 0x7fffffff;
                    duration += u32(bytes, entry + 4);
                    assert.equal(u32(bytes, entry + 8), 0x90000000, 'SAP flags are copied');
                }
                assert.equal(offset, bytes.byteLength);
                assert.equal(duration, 4 * 30720, 'sidx carries the full 8 s duration');
                // Seek points start where the audio covering each video start begins.
                assert.deepEqual(starts, [moofs[0].start, moofs[1].start, moofs[3].start, moofs[5].start]);
            } finally {
                media.restore();
            }
        },
    },
    {
        name: 'Reddit video route answers byte ranges with the same bytes as the full file',
        async run() {
            const media = mockRangedMedia({ [videoUrl]: indexedVideo, [audioUrl]: indexedAudio });
            try {
                const full = new Uint8Array(await (await app.request(videoPath)).arrayBuffer());
                const length = full.byteLength;
                for (const [header, start, end] of [
                    ['bytes=0-', 0, length - 1],
                    ['bytes=0-0', 0, 0],
                    ['bytes=0-1', 0, 1],
                    ['bytes=10-700', 10, 700],
                    [`bytes=${length - 60}-${length - 20}`, length - 60, length - 20],
                    [`bytes=${length - 5}-`, length - 5, length - 1],
                    ['bytes=-37', length - 37, length - 1],
                    [`bytes=300-${length + 1000}`, 300, length - 1],
                ] as const) {
                    const response = await app.request(videoPath, { headers: { Range: header } });
                    assert.equal(response.status, 206, header);
                    assert.equal(response.headers.get('Content-Range'), `bytes ${start}-${end}/${length}`, header);
                    assert.equal(response.headers.get('Accept-Ranges'), 'bytes');
                    const body = new Uint8Array(await response.arrayBuffer());
                    assert.equal(Number(response.headers.get('Content-Length')), body.byteLength, header);
                    assert.deepEqual(body, full.slice(start, end + 1), header);
                }

                // A range inside the last subsegment fetches only that video subsegment.
                media.requested.length = 0;
                await (await app.request(videoPath, { headers: { Range: `bytes=${length - 5}-` } })).arrayBuffer();
                assert.deepEqual(media.requested.filter((request) => !request.endsWith('bytes=0-65535')), [
                    `${videoUrl} bytes=${indexedVideo.byteLength - lastVideoSubsegment}-${indexedVideo.byteLength - 1}`,
                ]);

                const unsatisfiable = await app.request(videoPath, { headers: { Range: `bytes=${length}-` } });
                assert.equal(unsatisfiable.status, 416);
                assert.equal(unsatisfiable.headers.get('Content-Range'), `bytes */${length}`);

                media.requested.length = 0;
                const head = await app.request(videoPath, { method: 'HEAD' });
                assert.equal(head.status, 200);
                assert.equal(head.headers.get('Content-Length'), String(length));
                assert.ok(media.requested.every((request) => request.endsWith('bytes=0-65535')), 'HEAD reads only init segments');
            } finally {
                media.restore();
            }
        },
    },
    {
        name: 'Reddit video route keeps the streamed remux when a sidx does not cover the file',
        async run() {
            const truncated = indexedVideo.slice(0, indexedVideo.byteLength - 1);
            const media = mockRangedMedia({ [videoUrl]: truncated, [audioUrl]: indexedAudio });
            try {
                const response = await app.request(videoPath);
                assert.equal(response.headers.get('Accept-Ranges'), null, 'no seekable claim without a complete index');
                assert.ok(media.requested.includes(`${videoUrl} full`), 'falls back to the streamed remux');
                await response.arrayBuffer().catch(() => undefined);
            } finally {
                media.restore();
            }
        },
    },
    {
        name: 'Reddit video route muxes DASH video and audio tracks into one interleaved MP4',
        async run() {
            const media = mockRedditMedia({
                [videoUrl]: fragmentedMp4(15360, [{ time: 0, fill: 0xa1 }, { time: 30720, fill: 0xa2 }]),
                [audioUrl]: fragmentedMp4(48000, [{ time: 0, fill: 0xb1 }, { time: 96000, fill: 0xb2 }]),
            });
            try {
                const response = await app.request(videoPath);
                assert.equal(response.status, 200);
                assert.equal(response.headers.get('Content-Type'), 'video/mp4');
                const bytes = new Uint8Array(await response.arrayBuffer());
                assert.equal(Number(response.headers.get('Content-Length')), bytes.byteLength);

                const top = children(bytes);
                assert.deepEqual(top.map(({ type }) => type), [
                    'ftyp', 'moov', 'moof', 'mdat', 'moof', 'mdat', 'moof', 'mdat', 'moof', 'mdat',
                ]);

                const moov = top[1];
                const traks = children(bytes, moov.start + 8, moov.end).filter(({ type }) => type === 'trak');
                assert.deepEqual(traks.map((trak) => u32(bytes, child(bytes, trak, 'tkhd').start + 20)), [1, 2]);
                const audioTkhd = child(bytes, traks[1], 'tkhd');
                assert.equal(u32(bytes, audioTkhd.start + 28), 15360 * 4, 'audio duration uses the movie timescale');
                const mvex = child(bytes, moov, 'mvex');
                assert.deepEqual(
                    children(bytes, mvex.start + 8, mvex.end).map((trex) => u32(bytes, trex.start + 12)),
                    [1, 2],
                );
                assert.equal(u32(bytes, child(bytes, moov, 'mvhd').end - 4), 3);

                const fragments = top.filter(({ type }) => type === 'moof').map((moof) => {
                    const traf = child(bytes, moof, 'traf');
                    return {
                        sequence: u32(bytes, child(bytes, moof, 'mfhd').start + 12),
                        track: u32(bytes, child(bytes, traf, 'tfhd').start + 12),
                    };
                });
                assert.deepEqual(fragments, [
                    { sequence: 1, track: 1 },
                    { sequence: 2, track: 2 },
                    { sequence: 3, track: 1 },
                    { sequence: 4, track: 2 },
                ]);
                const samples = top.filter(({ type }) => type === 'mdat').map(({ start }) => bytes[start + 8]);
                assert.deepEqual(samples, [0xa1, 0xb1, 0xa2, 0xb2]);
            } finally {
                media.restore();
            }
        },
    },
    {
        name: 'Reddit video route falls back to the silent track when audio cannot be muxed',
        async run() {
            const unfragmented = new Uint8Array([...box('ftyp', fields(0)), ...box('mdat', zeros(8))]);
            for (const audio of [new Response('missing', { status: 403 }), unfragmented]) {
                const media = mockRedditMedia({
                    [videoUrl]: fragmentedMp4(15360, [{ time: 0, fill: 1 }]),
                    [audioUrl]: audio,
                });
                try {
                    const response = await app.request(videoPath);
                    assert.equal(response.status, 302);
                    assert.equal(response.headers.get('Location'), videoUrl);
                } finally {
                    media.restore();
                }
            }
        },
    },
    {
        name: 'Reddit video route muxes legacy extensionless DASH video and audio files',
        async run() {
            const legacyVideo = 'https://v.redd.it/s93jlji745f21/DASH_360';
            const legacyAudio = 'https://v.redd.it/s93jlji745f21/audio';
            const media = mockRedditMedia({
                [legacyVideo]: fragmentedMp4(15360, [{ time: 0, fill: 0xc1 }]),
                [legacyAudio]: fragmentedMp4(48000, [{ time: 0, fill: 0xd1 }]),
            });
            try {
                const response = await app.request('/video/reddit?id=s93jlji745f21&video=DASH_360&audio=audio');
                assert.equal(response.status, 200);
                assert.equal(response.headers.get('Content-Type'), 'video/mp4');
                const bytes = new Uint8Array(await response.arrayBuffer());
                const samples = children(bytes).filter(({ type }) => type === 'mdat').map(({ start }) => bytes[start + 8]);
                assert.deepEqual(samples, [0xc1, 0xd1]);
                assert.deepEqual([...new Set(media.requested)].sort(), [legacyVideo, legacyAudio].sort());
            } finally {
                media.restore();
            }
        },
    },
    {
        name: 'Reddit video route only fetches v.redd.it media files',
        async run() {
            const media = mockRedditMedia({});
            try {
                for (const query of [
                    'id=../evil&video=CMAF_720.mp4&audio=CMAF_AUDIO_128.mp4',
                    'id=abc&video=../../x.mp4&audio=CMAF_AUDIO_128.mp4',
                    'id=abc&video=CMAF_720.mp4&audio=https://example.com/a.mp4',
                    'id=abc&video=CMAF_720.mp4',
                    'id=abc&video=DASH_360/../x&audio=audio',
                    'id=abc&video=DASH_360&audio=..',
                    'id=abc&video=DASH_360.mp4.exe&audio=audio',
                ]) {
                    const response = await app.request(`/video/reddit?${query}`);
                    assert.equal(response.status, 400, query);
                }
                assert.deepEqual(media.requested, []);
            } finally {
                media.restore();
            }
        },
    },
];
