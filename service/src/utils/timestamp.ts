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
    return normalizePostTimestamp(mediaModified);
}
