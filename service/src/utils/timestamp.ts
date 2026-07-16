/** Normalize an upstream publication time without substituting request time. */
export function normalizePostTimestamp(value: unknown): string | undefined {
    if (value === null || value === undefined || typeof value === 'boolean') return undefined;

    if (typeof value === 'number') {
        if (!Number.isFinite(value) || value <= 0) return undefined;
        const milliseconds = value >= 100_000_000_000 ? value : value * 1000;
        const date = new Date(milliseconds);
        return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
    }

    const raw = String(value).trim();
    if (!raw) return undefined;
    if (/^\d+$/.test(raw)) return normalizePostTimestamp(Number(raw));

    const milliseconds = Date.parse(raw);
    return Number.isNaN(milliseconds) ? undefined : new Date(milliseconds).toISOString();
}

/** Recover Meta's approximate creation time from an Instagram/Threads shortcode. */
export function deriveMetaShortcodeTimestamp(shortcode: string): string | undefined {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const clean = shortcode.split(/[/?#]/, 1)[0];
    if (!clean || clean.length > 32) return undefined;

    let mediaId = 0n;
    for (const character of clean) {
        const index = alphabet.indexOf(character);
        if (index < 0) return undefined;
        mediaId = mediaId * 64n + BigInt(index);
    }

    const milliseconds = Number(mediaId >> 23n) + 1_314_220_021_721;
    const earliest = Date.parse('2011-08-24T21:07:01.721Z');
    const latest = Date.parse('2100-01-01T00:00:00.000Z');
    if (!Number.isSafeInteger(milliseconds) || milliseconds < earliest || milliseconds > latest) {
        return undefined;
    }
    return new Date(milliseconds).toISOString();
}

/** Extract a publication time from bounded fields used by supported platform pages. */
export function extractPostTimestampFromHtml(html: string): string | undefined {
    if (!html) return undefined;
    const decoded = html
        .replace(/&quot;|&#34;/gi, '"')
        .replace(/&amp;/gi, '&');

    const numeric = decoded.match(
        /["'](?:taken_at|taken_at_timestamp|created_timestamp|created_utc|pubdate)["']\s*:\s*["']?(\d{9,13})/i,
    )?.[1];
    if (numeric) return normalizePostTimestamp(numeric);

    const serializedDate = decoded.match(
        /["'](?:datePublished|uploadDate|createDate|published_at)["']\s*:\s*["']([^"']+)["']/i,
    )?.[1];
    if (serializedDate) return normalizePostTimestamp(serializedDate);

    const allowedMetaKeys = new Set([
        'article:published_time',
        'datepublished',
        'uploaddate',
    ]);
    for (const tag of decoded.match(/<meta\b[^>]*>/gi) || []) {
        const key = tag.match(/\b(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i)?.[1];
        const content = tag.match(/\bcontent\s*=\s*["']([^"']+)["']/i)?.[1];
        if (key && content && allowedMetaKeys.has(key.toLowerCase())) {
            const timestamp = normalizePostTimestamp(content);
            if (timestamp) return timestamp;
        }
    }

    const timeElement = decoded.match(
        /<(?:time|faceplate-timeago)\b[^>]*\b(?:datetime|ts)\s*=\s*["']([^"']+)["']/i,
    )?.[1];
    if (timeElement) return normalizePostTimestamp(timeElement);

    const mediaModified = decoded.match(/[?&]mdate=(\d{9,13})(?:[&#"']|$)/i)?.[1];
    if (mediaModified) return normalizePostTimestamp(mediaModified);

    const pixivAssetDate = decoded.match(
        /\/img\/(\d{4})\/(\d{2})\/(\d{2})\/(\d{2})\/(\d{2})\/(\d{2})\//,
    );
    if (!pixivAssetDate) return undefined;
    const [, year, month, day, hour, minute, second] = pixivAssetDate;
    return normalizePostTimestamp(`${year}-${month}-${day}T${hour}:${minute}:${second}+09:00`);
}
