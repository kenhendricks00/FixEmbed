/**
 * Remux one fragmented video MP4 and one fragmented audio MP4 (e.g. DASH/CMAF
 * single-file representations) into a single two-track fragmented MP4.
 *
 * Only box headers and a few fixed-width fields are rewritten; sample data is
 * streamed through untouched, so memory stays bounded by one moof per input.
 */

const MAX_METADATA_BOX_BYTES = 4 * 1024 * 1024;
const VIDEO_TRACK_ID = 1;
const AUDIO_TRACK_ID = 2;

type Box = { type: string; start: number; end: number; payload: number };

function boxType(bytes: Uint8Array, offset: number): string {
    return String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
}

function view(bytes: Uint8Array): DataView {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function childBoxes(bytes: Uint8Array, start: number, end: number): Box[] {
    const data = view(bytes);
    const boxes: Box[] = [];
    let offset = start;
    while (offset + 8 <= end) {
        let size = data.getUint32(offset);
        let header = 8;
        if (size === 1) {
            size = Number(data.getBigUint64(offset + 8));
            header = 16;
        } else if (size === 0) {
            size = end - offset;
        }
        if (size < header || offset + size > end) throw new Error('Malformed MP4 box');
        boxes.push({ type: boxType(bytes, offset), start: offset, end: offset + size, payload: offset + header });
        offset += size;
    }
    return boxes;
}

function find(bytes: Uint8Array, parent: Box, ...path: string[]): Box | undefined {
    let current: Box | undefined = parent;
    for (const type of path) {
        current = current && childBoxes(bytes, current.payload, current.end).find((box) => box.type === type);
    }
    return current;
}

function rootBox(bytes: Uint8Array): Box {
    const [box] = childBoxes(bytes, 0, bytes.byteLength);
    if (!box) throw new Error('Empty MP4 box');
    return box;
}

function makeBox(type: string, parts: Uint8Array[]): Uint8Array {
    const size = 8 + parts.reduce((total, part) => total + part.byteLength, 0);
    const out = new Uint8Array(size);
    view(out).setUint32(0, size);
    for (let index = 0; index < 4; index += 1) out[4 + index] = type.charCodeAt(index);
    let offset = 8;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.byteLength;
    }
    return out;
}

function slice(bytes: Uint8Array, box: Box): Uint8Array {
    return bytes.slice(box.start, box.end);
}

function readTimescale(bytes: Uint8Array, box: Box): number {
    const version = bytes[box.payload];
    return view(bytes).getUint32(box.payload + (version === 1 ? 20 : 12));
}

function readUint(bytes: Uint8Array, offset: number, wide: boolean): number {
    return wide ? Number(view(bytes).getBigUint64(offset)) : view(bytes).getUint32(offset);
}

function writeUint(bytes: Uint8Array, offset: number, wide: boolean, value: number): void {
    if (wide) view(bytes).setBigUint64(offset, BigInt(value));
    else view(bytes).setUint32(offset, value);
}

function rescale(value: number, from: number, to: number): number {
    return from === to ? value : Math.round((value * to) / from);
}

/** Copy a trak with a new track ID, rescaling movie-timescale durations. */
function retrack(trak: Uint8Array, trackId: number, fromMovieScale: number, toMovieScale: number): Uint8Array {
    const root = rootBox(trak);
    const tkhd = find(trak, root, 'tkhd');
    if (!tkhd) throw new Error('Track header missing');
    const wide = trak[tkhd.payload] === 1;
    view(trak).setUint32(tkhd.payload + (wide ? 20 : 12), trackId);
    const durationOffset = tkhd.payload + (wide ? 28 : 20);
    writeUint(trak, durationOffset, wide, rescale(readUint(trak, durationOffset, wide), fromMovieScale, toMovieScale));

    const elst = find(trak, root, 'edts', 'elst');
    if (elst) {
        const elstWide = trak[elst.payload] === 1;
        const count = view(trak).getUint32(elst.payload + 4);
        const entrySize = elstWide ? 20 : 12;
        for (let index = 0; index < count; index += 1) {
            const offset = elst.payload + 8 + index * entrySize;
            writeUint(trak, offset, elstWide, rescale(readUint(trak, offset, elstWide), fromMovieScale, toMovieScale));
        }
    }
    return trak;
}

type TrackInit = { trak: Uint8Array; trex: Uint8Array; mvhd: Uint8Array; mehd?: Uint8Array; movieScale: number; mediaScale: number };

function parseInit(moov: Uint8Array): TrackInit {
    const root = rootBox(moov);
    const children = childBoxes(moov, root.payload, root.end);
    const traks = children.filter((box) => box.type === 'trak');
    const mvhd = children.find((box) => box.type === 'mvhd');
    const trex = find(moov, root, 'mvex', 'trex');
    if (traks.length !== 1 || !mvhd || !trex) throw new Error('Expected one fragmented track');
    const mdhd = find(moov, traks[0], 'mdia', 'mdhd');
    if (!mdhd) throw new Error('Media header missing');
    const mehd = find(moov, root, 'mvex', 'mehd');
    return {
        trak: slice(moov, traks[0]),
        trex: slice(moov, trex),
        mvhd: slice(moov, mvhd),
        mehd: mehd && slice(moov, mehd),
        movieScale: readTimescale(moov, mvhd),
        mediaScale: readTimescale(moov, mdhd),
    };
}

export function mergeInitSegments(videoMoov: Uint8Array, audioMoov: Uint8Array): { moov: Uint8Array; videoScale: number; audioScale: number } {
    const video = parseInit(videoMoov);
    const audio = parseInit(audioMoov);
    const mvhd = video.mvhd;
    view(mvhd).setUint32(mvhd.byteLength - 4, AUDIO_TRACK_ID + 1);
    for (const [trex, id] of [[video.trex, VIDEO_TRACK_ID], [audio.trex, AUDIO_TRACK_ID]] as const) {
        view(trex).setUint32(rootBox(trex).payload + 4, id);
    }
    const moov = makeBox('moov', [
        mvhd,
        retrack(video.trak, VIDEO_TRACK_ID, video.movieScale, video.movieScale),
        retrack(audio.trak, AUDIO_TRACK_ID, audio.movieScale, video.movieScale),
        makeBox('mvex', [...(video.mehd ? [video.mehd] : []), video.trex, audio.trex]),
    ]);
    return { moov, videoScale: video.mediaScale, audioScale: audio.mediaScale };
}

/** Rewrite a moof in place for the merged file; returns its decode time in seconds. */
export function retagFragment(moof: Uint8Array, trackId: number, sequence: number, timescale: number): number {
    const root = rootBox(moof);
    let decodeTime = 0;
    for (const box of childBoxes(moof, root.payload, root.end)) {
        if (box.type === 'mfhd') view(moof).setUint32(box.payload + 4, sequence);
        if (box.type !== 'traf') continue;
        for (const child of childBoxes(moof, box.payload, box.end)) {
            if (child.type === 'tfhd') view(moof).setUint32(child.payload + 4, trackId);
            if (child.type === 'tfdt') decodeTime = readUint(moof, child.payload + 4, moof[child.payload] === 1);
        }
    }
    return decodeTime / timescale;
}

export class BoxStream {
    private chunks: Uint8Array[] = [];
    private buffered = 0;
    private finished = false;
    consumed = 0;
    private readonly reader: ReadableStreamDefaultReader<Uint8Array>;

    constructor(reader: ReadableStreamDefaultReader<Uint8Array>) {
        this.reader = reader;
    }

    private async fill(bytes: number): Promise<boolean> {
        while (this.buffered < bytes && !this.finished) {
            const { done, value } = await this.reader.read();
            if (done) this.finished = true;
            else if (value.byteLength) {
                this.chunks.push(value);
                this.buffered += value.byteLength;
            }
        }
        return this.buffered >= bytes;
    }

    private take(bytes: number): Uint8Array {
        const first = this.chunks[0];
        let out: Uint8Array;
        if (first.byteLength >= bytes) {
            out = first.subarray(0, bytes);
            if (first.byteLength === bytes) this.chunks.shift();
            else this.chunks[0] = first.subarray(bytes);
        } else {
            out = new Uint8Array(bytes);
            let offset = 0;
            while (offset < bytes) {
                const chunk = this.chunks[0];
                const count = Math.min(chunk.byteLength, bytes - offset);
                out.set(chunk.subarray(0, count), offset);
                offset += count;
                if (count === chunk.byteLength) this.chunks.shift();
                else this.chunks[0] = chunk.subarray(count);
            }
        }
        this.buffered -= bytes;
        this.consumed += bytes;
        return out;
    }

    async read(bytes: number): Promise<Uint8Array> {
        if (!await this.fill(bytes)) throw new Error('Unexpected end of MP4 stream');
        return this.take(bytes);
    }

    /** Next box header, or undefined at a clean end of stream. */
    async header(): Promise<{ type: string; size: number; bytes: Uint8Array } | undefined> {
        if (!await this.fill(1)) return undefined;
        let bytes = await this.read(8);
        let size = view(bytes).getUint32(0);
        if (size === 1) {
            const large = await this.read(8);
            const joined = new Uint8Array(16);
            joined.set(bytes);
            joined.set(large, 8);
            bytes = joined;
            size = Number(view(large).getBigUint64(0));
        }
        if (size < bytes.byteLength) throw new Error('Unsupported MP4 box size');
        return { type: boxType(bytes, 0), size, bytes };
    }

    async whole(header: { size: number; bytes: Uint8Array }): Promise<Uint8Array> {
        if (header.size > MAX_METADATA_BOX_BYTES) throw new Error('MP4 metadata box too large');
        const out = new Uint8Array(header.size);
        out.set(header.bytes);
        out.set(await this.read(header.size - header.bytes.byteLength), header.bytes.byteLength);
        return out;
    }

    async *passthrough(bytes: number): AsyncGenerator<Uint8Array> {
        let remaining = bytes;
        while (remaining > 0) {
            if (!await this.fill(1)) throw new Error('Unexpected end of MP4 stream');
            const chunk = this.take(Math.min(remaining, this.chunks[0].byteLength));
            remaining -= chunk.byteLength;
            yield chunk;
        }
    }

    cancel(): Promise<void> {
        return this.reader.cancel().catch(() => undefined);
    }
}

type Input = {
    stream: BoxStream;
    trackId: number;
    timescale: number;
    headBytes: number;
    next?: { moof: Uint8Array; time: number };
};

async function readInit(stream: BoxStream): Promise<{ ftyp?: Uint8Array; moov: Uint8Array; firstMoof: Uint8Array; headBytes: number }> {
    let ftyp: Uint8Array | undefined;
    let moov: Uint8Array | undefined;
    while (true) {
        const start = stream.consumed;
        const header = await stream.header();
        if (!header) throw new Error('MP4 has no fragments');
        if (header.type === 'mdat') throw new Error('MP4 is not fragmented');
        const box = await stream.whole(header);
        if (header.type === 'ftyp') ftyp = box;
        else if (header.type === 'moov') moov = box;
        else if (header.type === 'moof') {
            if (!moov) throw new Error('MP4 moov missing');
            return { ftyp, moov, firstMoof: box, headBytes: start };
        }
    }
}

export type MuxedMp4 = { body: ReadableStream<Uint8Array>; byteLength?: number };

/**
 * Read both init segments, then return a stream that interleaves fragments by
 * decode time. Throws before returning if either input is not fragmented.
 */
export async function muxFragmentedMp4(
    videoBody: ReadableStream<Uint8Array>,
    audioBody: ReadableStream<Uint8Array>,
    videoLength?: number,
    audioLength?: number,
): Promise<MuxedMp4> {
    const videoStream = new BoxStream(videoBody.getReader());
    const audioStream = new BoxStream(audioBody.getReader());
    const cancel = () => Promise.all([videoStream.cancel(), audioStream.cancel()]);

    let video: Awaited<ReturnType<typeof readInit>>;
    let audio: Awaited<ReturnType<typeof readInit>>;
    let merged: ReturnType<typeof mergeInitSegments>;
    try {
        [video, audio] = await Promise.all([readInit(videoStream), readInit(audioStream)]);
        merged = mergeInitSegments(video.moov, audio.moov);
    } catch (error) {
        await cancel();
        throw error;
    }

    const head = [...(video.ftyp ? [video.ftyp] : []), merged.moov];
    const headLength = head.reduce((total, part) => total + part.byteLength, 0);
    const byteLength = videoLength !== undefined && audioLength !== undefined
        ? headLength + (videoLength - video.headBytes) + (audioLength - audio.headBytes)
        : undefined;

    let sequence = 0;
    const inputs: Input[] = [
        { stream: videoStream, trackId: VIDEO_TRACK_ID, timescale: merged.videoScale, headBytes: video.headBytes },
        { stream: audioStream, trackId: AUDIO_TRACK_ID, timescale: merged.audioScale, headBytes: audio.headBytes },
    ];
    const queue = (input: Input, moof: Uint8Array) => {
        input.next = { moof, time: retagFragment(moof, input.trackId, 0, input.timescale) };
    };
    queue(inputs[0], video.firstMoof);
    queue(inputs[1], audio.firstMoof);

    async function* fragments(): AsyncGenerator<Uint8Array> {
        yield* head;
        while (true) {
            const ready = inputs.filter((input) => input.next);
            if (!ready.length) return;
            const input = ready.reduce((left, right) => (right.next!.time < left.next!.time ? right : left));
            const { moof } = input.next!;
            input.next = undefined;
            sequence += 1;
            retagFragment(moof, input.trackId, sequence, input.timescale);
            yield moof;

            while (true) {
                const header = await input.stream.header();
                if (!header) break;
                if (header.type === 'moof') {
                    queue(input, await input.stream.whole(header));
                    break;
                }
                if (header.type !== 'mdat') {
                    // Keep byte length stable while neutralising per-input indexes (sidx, mfra, ...).
                    header.bytes.set([0x66, 0x72, 0x65, 0x65], 4);
                }
                yield header.bytes;
                yield* input.stream.passthrough(header.size - header.bytes.byteLength);
            }
        }
    }

    const iterator = fragments();
    const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
            try {
                const { done, value } = await iterator.next();
                if (done) controller.close();
                else controller.enqueue(value);
            } catch (error) {
                await cancel();
                controller.error(error);
            }
        },
        async cancel() {
            await cancel();
        },
    });
    return { body, byteLength };
}
