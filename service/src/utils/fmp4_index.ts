/**
 * Seekable remux of a DASH video file and audio file that each carry a `sidx`.
 *
 * Every input subsegment keeps its exact size in the output, so the whole file
 * layout is known from the two init segments. That lets the relay write one
 * combined `sidx` (full duration and seek points for browser demuxers) and
 * answer HTTP Range requests by fetching only the matching input byte spans.
 */

import { BoxStream, mergeInitSegments, retagFragment } from './fmp4_mux.ts';

const VIDEO_TRACK_ID = 1;
const AUDIO_TRACK_ID = 2;
const MAX_REFERENCED_SIZE = 0x7fffffff;
const MAX_METADATA_BOX_BYTES = 4 * 1024 * 1024;

export type SidxReference = { size: number; duration: number; sap: number };

export type IndexedInput = {
    ftyp?: Uint8Array;
    moov: Uint8Array;
    timescale: number;
    earliest: number;
    references: SidxReference[];
    /** Offset of the first moof; subsegments follow back to back from here. */
    firstMoof: number;
    byteLength: number;
};

export type MuxUnit = {
    track: 0 | 1;
    inStart: number;
    size: number;
    outStart: number;
    start: number;
    end: number;
    sequence: number;
};

export type IndexedMuxPlan = { head: Uint8Array; units: MuxUnit[]; byteLength: number };

function view(bytes: Uint8Array): DataView {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function concat(parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.byteLength;
    }
    return out;
}

/**
 * Parse ftyp, moov and a single-level sidx from the start of a file. Returns
 * undefined unless the sidx indexes every byte from the first moof to the end.
 */
export function parseIndexedInput(bytes: Uint8Array, byteLength: number): IndexedInput | undefined {
    const data = view(bytes);
    let offset = 0;
    let ftyp: Uint8Array | undefined;
    let moov: Uint8Array | undefined;
    let sidx: { start: number; end: number } | undefined;
    while (offset + 8 <= bytes.byteLength) {
        let size = data.getUint32(offset);
        let header = 8;
        if (size === 1) {
            if (offset + 16 > bytes.byteLength) return undefined;
            size = Number(data.getBigUint64(offset + 8));
            header = 16;
        }
        const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
        if (type === 'moof') {
            if (!moov || !sidx) return undefined;
            return readSidx(bytes, sidx, { ftyp, moov, firstMoof: offset, byteLength });
        }
        if (size < header || type === 'mdat' || offset + size > bytes.byteLength) return undefined;
        if (type === 'ftyp') ftyp = bytes.slice(offset, offset + size);
        else if (type === 'moov') moov = bytes.slice(offset, offset + size);
        else if (type === 'sidx') {
            if (sidx) return undefined; // Several or hierarchical indexes are not supported.
            sidx = { start: offset, end: offset + size };
        }
        offset += size;
    }
    return undefined;
}

function readSidx(
    bytes: Uint8Array,
    box: { start: number; end: number },
    init: { ftyp?: Uint8Array; moov: Uint8Array; firstMoof: number; byteLength: number },
): IndexedInput | undefined {
    const data = view(bytes);
    let offset = box.start + 8;
    const version = bytes[offset];
    offset += 8; // version, flags, reference_ID
    const timescale = data.getUint32(offset);
    offset += 4;
    let earliest: number;
    let firstOffset: number;
    if (version === 0) {
        earliest = data.getUint32(offset);
        firstOffset = data.getUint32(offset + 4);
        offset += 8;
    } else {
        earliest = Number(data.getBigUint64(offset));
        firstOffset = Number(data.getBigUint64(offset + 8));
        offset += 16;
    }
    const count = data.getUint16(offset + 2);
    offset += 4;
    if (!timescale || !count || offset + count * 12 > box.end) return undefined;
    if (box.end + firstOffset !== init.firstMoof) return undefined;

    const references: SidxReference[] = [];
    let total = 0;
    for (let index = 0; index < count; index += 1) {
        const typeAndSize = data.getUint32(offset);
        if (typeAndSize & 0x80000000) return undefined; // Nested sidx references.
        const size = typeAndSize & 0x7fffffff;
        if (!size) return undefined;
        references.push({ size, duration: data.getUint32(offset + 4), sap: data.getUint32(offset + 8) });
        total += size;
        offset += 12;
    }
    if (init.firstMoof + total !== init.byteLength) return undefined;
    return { ...init, timescale, earliest, references };
}

function writeSidx(video: IndexedInput, sizes: number[]): Uint8Array {
    const wide = video.earliest > 0xffffffff;
    const size = 8 + 4 + 8 + (wide ? 16 : 8) + 4 + 12 * sizes.length;
    const out = new Uint8Array(size);
    const data = view(out);
    data.setUint32(0, size);
    out.set([0x73, 0x69, 0x64, 0x78], 4); // 'sidx'
    out[8] = wide ? 1 : 0;
    data.setUint32(12, VIDEO_TRACK_ID);
    data.setUint32(16, video.timescale);
    let offset = 20;
    if (wide) {
        data.setBigUint64(offset, BigInt(video.earliest));
        offset += 16; // first_offset stays 0
    } else {
        data.setUint32(offset, video.earliest);
        offset += 8;
    }
    data.setUint16(offset + 2, sizes.length);
    offset += 4;
    sizes.forEach((referenced, index) => {
        data.setUint32(offset, referenced);
        data.setUint32(offset + 4, video.references[index].duration);
        data.setUint32(offset + 8, video.references[index].sap);
        offset += 12;
    });
    return out;
}

function trackUnits(input: IndexedInput, track: 0 | 1): MuxUnit[] {
    let inStart = input.firstMoof;
    let time = input.earliest;
    return input.references.map(({ size, duration }) => {
        const unit = {
            track,
            inStart,
            size,
            outStart: 0,
            start: time / input.timescale,
            end: (time + duration) / input.timescale,
            sequence: 0,
        };
        inStart += size;
        time += duration;
        return unit;
    });
}

/** Lay out the merged file: head (ftyp, moov, sidx) then subsegments interleaved by start time. */
export function planIndexedMux(video: IndexedInput, audio: IndexedInput): IndexedMuxPlan {
    const merged = mergeInitSegments(video.moov.slice(), audio.moov.slice());
    const videoUnits = trackUnits(video, 0);
    const units = [...videoUnits, ...trackUnits(audio, 1)]
        .sort((left, right) => left.start - right.start || left.track - right.track);

    const sidxSize = 8 + 4 + 8 + (video.earliest > 0xffffffff ? 16 : 8) + 4 + 12 * videoUnits.length;
    const headBase = [...(video.ftyp ? [video.ftyp] : []), merged.moov];
    const headLength = headBase.reduce((total, part) => total + part.byteLength, 0) + sidxSize;
    let cursor = headLength;
    units.forEach((unit, index) => {
        unit.outStart = cursor;
        unit.sequence = index + 1;
        cursor += unit.size;
    });

    // Each seek point starts at a video subsegment, or at the audio subsegment just
    // before it when that audio is still playing at the video start, so a seek
    // never skips the audio that covers its target time.
    const boundaries = videoUnits.map((unit, index) => {
        if (index === 0) return headLength;
        const previous = units[units.indexOf(unit) - 1];
        return previous.track === 1 && previous.end > unit.start ? previous.outStart : unit.outStart;
    });
    const sizes = boundaries.map((start, index) => (boundaries[index + 1] ?? cursor) - start);
    if (sizes.some((size) => size <= 0 || size > MAX_REFERENCED_SIZE)) {
        throw new Error('Subsegment does not fit a sidx reference');
    }
    return { head: concat([...headBase, writeSidx(video, sizes)]), units, byteLength: cursor };
}

export type ByteRange = { start: number; end: number };

/**
 * Parse a single `bytes=` range. Returns undefined to serve the whole file
 * (no header, several ranges, or a malformed header) and null when unsatisfiable.
 */
export function parseByteRange(header: string | undefined, byteLength: number): ByteRange | null | undefined {
    const match = header?.trim().match(/^bytes=(\d*)-(\d*)$/i);
    if (!match || (!match[1] && !match[2])) return undefined;
    if (!match[1]) {
        const suffix = Number(match[2]);
        if (!suffix) return null;
        return { start: Math.max(0, byteLength - suffix), end: byteLength - 1 };
    }
    const start = Number(match[1]);
    const end = match[2] ? Math.min(Number(match[2]), byteLength - 1) : byteLength - 1;
    if (start >= byteLength || end < start) return null;
    return { start, end };
}

/** Input byte span per track needed to produce output bytes start..end. */
export function inputSpans(plan: IndexedMuxPlan, range: ByteRange): Array<ByteRange | undefined> {
    const spans: Array<ByteRange | undefined> = [undefined, undefined];
    for (const unit of plan.units) {
        if (unit.outStart > range.end || unit.outStart + unit.size <= range.start) continue;
        const span = spans[unit.track];
        spans[unit.track] = {
            start: span ? span.start : unit.inStart,
            end: unit.inStart + unit.size - 1,
        };
    }
    return spans;
}

/** Produce output bytes start..end from per-track streams that begin at inputSpans(). */
export async function* indexedMuxBody(
    plan: IndexedMuxPlan,
    range: ByteRange,
    inputs: Array<BoxStream | undefined>,
): AsyncGenerator<Uint8Array> {
    let position = 0;
    function* emit(chunk: Uint8Array): Generator<Uint8Array> {
        const from = Math.max(range.start - position, 0);
        const to = Math.min(range.end + 1 - position, chunk.byteLength);
        position += chunk.byteLength;
        if (to > from) yield chunk.subarray(from, to);
    }

    yield* emit(plan.head);
    for (const unit of plan.units) {
        if (position > range.end) return;
        if (unit.outStart + unit.size <= range.start) {
            position = unit.outStart + unit.size;
            continue;
        }
        const stream = inputs[unit.track];
        if (!stream) throw new Error('Missing input for subsegment');
        position = unit.outStart;
        const trackId = unit.track === 0 ? VIDEO_TRACK_ID : AUDIO_TRACK_ID;
        let remaining = unit.size;
        while (remaining > 0) {
            if (position > range.end) return;
            const header = await stream.header();
            if (!header || header.size > remaining) throw new Error('Subsegment does not match its sidx size');
            remaining -= header.size;
            if (header.type === 'moof') {
                if (header.size > MAX_METADATA_BOX_BYTES) throw new Error('MP4 moof too large');
                const moof = await stream.whole(header);
                retagFragment(moof, trackId, unit.sequence, 1);
                yield* emit(moof);
                continue;
            }
            // Keep byte offsets stable while neutralising per-input boxes (styp, sidx, prft, ...).
            if (header.type !== 'mdat') header.bytes.set([0x66, 0x72, 0x65, 0x65], 4);
            yield* emit(header.bytes);
            for await (const chunk of stream.passthrough(header.size - header.bytes.byteLength)) {
                yield* emit(chunk);
                if (position > range.end) return;
            }
        }
    }
}
