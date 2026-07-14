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
