/**
 * DeviantArt deviation metadata handler.
 * Uses DeviantArt's public oEmbed endpoint for documented deviation and Sta.sh URLs.
 */
import type { EmbedData, Env, HandlerResponse, PlatformHandler } from '../types.ts';
import { fetchWithTimeout, truncateText } from '../utils/fetch.ts';
import { formatNumber, getBrandedSiteName, platformColors } from '../utils/embed.ts';
import { normalizePostTimestamp } from '../utils/timestamp.ts';

const OEMBED_ENDPOINT = 'https://backend.deviantart.com/oembed';
const MAX_OEMBED_BYTES = 512_000;
const MEDIA_HOST_SUFFIXES = ['wixmp.com', 'deviantart.net', 'deviantart.com'];

type DeviantArtUrl = {
    canonical: string;
    artist?: string;
};

type OEmbedPayload = {
    type?: unknown;
    title?: unknown;
    url?: unknown;
    author_name?: unknown;
    author_url?: unknown;
    provider_name?: unknown;
    safety?: unknown;
    pubdate?: unknown;
    thumbnail_url?: unknown;
    community?: {
        statistics?: {
            _attributes?: Record<string, unknown>;
        };
    };
    copyright?: {
        _attributes?: Record<string, unknown>;
    };
};

function text(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function parseDeviantArtUrl(raw: string): DeviantArtUrl | null {
    try {
        const url = new URL(raw);
        if (url.protocol !== 'https:' || (url.port && url.port !== '443')) return null;
        const host = url.hostname.toLowerCase().replace(/^www\./, '');
        const path = url.pathname.split('/').filter(Boolean);
        if (
            host === 'deviantart.com'
            && path.length >= 3
            && path[1].toLowerCase() === 'art'
            && /^[A-Za-z0-9_-]+$/.test(path[0])
            && /^[A-Za-z0-9_-]+$/.test(path[2])
        ) {
            return {
                canonical: `https://www.deviantart.com/${path[0]}/art/${path[2]}`,
                artist: path[0],
            };
        }
        if (host === 'sta.sh' && path.length === 1 && /^[A-Za-z0-9_-]+$/.test(path[0])) {
            return { canonical: `https://sta.sh/${path[0]}` };
        }
    } catch {
        // Invalid user input.
    }
    return null;
}

function trustedMediaUrl(value: unknown): string | undefined {
    const raw = text(value);
    if (!raw) return undefined;
    try {
        const url = new URL(raw);
        const host = url.hostname.toLowerCase();
        if (
            url.protocol === 'https:'
            && !url.username
            && !url.password
            && MEDIA_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))
        ) {
            return url.toString();
        }
    } catch {
        // Ignore malformed upstream media.
    }
    return undefined;
}

function trustedAuthorUrl(value: unknown): string | undefined {
    const raw = text(value);
    if (!raw) return undefined;
    try {
        const url = new URL(raw);
        const host = url.hostname.toLowerCase().replace(/^www\./, '');
        if (
            url.protocol === 'https:'
            && !url.username
            && !url.password
            && (!url.port || url.port === '443')
            && host === 'deviantart.com'
        ) {
            return url.toString();
        }
    } catch {
        // Ignore malformed or untrusted upstream identity URLs.
    }
    return undefined;
}

async function readJsonLimited(response: Response): Promise<OEmbedPayload> {
    const declared = Number.parseInt(response.headers.get('Content-Length') || '', 10);
    if (Number.isFinite(declared) && declared > MAX_OEMBED_BYTES) {
        throw new Error('DeviantArt response too large');
    }
    if (!response.body) return {};

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let total = 0;
    let body = '';
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_OEMBED_BYTES) {
            await reader.cancel();
            throw new Error('DeviantArt response too large');
        }
        body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('DeviantArt metadata unavailable');
    }
    return parsed as OEmbedPayload;
}

function finiteCount(value: unknown): number | undefined {
    const count = typeof value === 'number' ? value : Number.parseInt(text(value), 10);
    return Number.isSafeInteger(count) && count >= 0 ? count : undefined;
}

function formatStats(payload: OEmbedPayload): string | undefined {
    const stats = payload.community?.statistics?._attributes || {};
    const values: Array<[unknown, string, string]> = [
        [stats.views, '👁️', 'views'],
        [stats.favorites, '❤️', 'favorites'],
        [stats.comments, '💬', 'comments'],
        [stats.downloads, '⬇️', 'downloads'],
    ];
    const rendered = values.flatMap(([raw, icon, label]) => {
        const count = finiteCount(raw);
        return count === undefined ? [] : [`${icon} ${formatNumber(count)} ${label}`];
    });
    return rendered.length ? rendered.join('  ') : undefined;
}

function copyrightContext(payload: OEmbedPayload): string | undefined {
    const copyright = payload.copyright?._attributes || {};
    const year = text(copyright.year);
    const owner = text(copyright.owner);
    const value = [year, owner].filter(Boolean).join(' ');
    return value ? `© ${value}` : undefined;
}

function authorHandle(authorUrl: string, fallback?: string): string | undefined {
    try {
        const url = new URL(authorUrl);
        const artist = url.hostname.toLowerCase().endsWith('deviantart.com')
            ? url.pathname.split('/').filter(Boolean)[0]
            : '';
        const handle = artist || fallback || '';
        return /^[A-Za-z0-9_-]+$/.test(handle) ? `@${handle}` : undefined;
    } catch {
        return fallback && /^[A-Za-z0-9_-]+$/.test(fallback) ? `@${fallback}` : undefined;
    }
}

export const deviantartHandler: PlatformHandler = {
    name: 'deviantart',
    patterns: [
        /^https:\/\/(?:www\.)?deviantart\.com\/[A-Za-z0-9_-]+\/art\/[A-Za-z0-9_-]+(?:[/?#]|$)/i,
        /^https:\/\/sta\.sh\/[A-Za-z0-9_-]+(?:[/?#]|$)/i,
    ],
    async handle(rawUrl: string, _env: Env): Promise<HandlerResponse> {
        const parsedUrl = parseDeviantArtUrl(rawUrl);
        if (!parsedUrl) return { success: false, error: 'Invalid DeviantArt URL' };

        try {
            const endpoint = new URL(OEMBED_ENDPOINT);
            endpoint.searchParams.set('url', parsedUrl.canonical);
            endpoint.searchParams.set('maxwidth', '1200');
            const response = await fetchWithTimeout(endpoint.toString(), {
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'FixEmbed/1.0 (+https://fixembed.app)',
                },
            }, 6_000);
            if (response.status === 429) {
                return {
                    success: false,
                    error: 'DeviantArt rate limited the request',
                    redirect: parsedUrl.canonical,
                };
            }
            if (!response.ok) {
                return {
                    success: false,
                    error: `DeviantArt returned ${response.status}`,
                    redirect: parsedUrl.canonical,
                };
            }

            const payload = await readJsonLimited(response);
            const kind = text(payload.type).toLowerCase();
            const title = truncateText(text(payload.title) || 'DeviantArt deviation', 300);
            const authorName = truncateText(text(payload.author_name) || parsedUrl.artist || 'DeviantArt artist', 100);
            const authorUrl = trustedAuthorUrl(payload.author_url);
            const image = kind === 'photo'
                ? trustedMediaUrl(payload.url)
                : trustedMediaUrl(payload.thumbnail_url);
            if (!image && !title) {
                return {
                    success: false,
                    error: 'DeviantArt metadata unavailable',
                    redirect: parsedUrl.canonical,
                };
            }
            const safety = text(payload.safety).toLowerCase();
            const data: EmbedData = {
                title,
                description: '',
                url: parsedUrl.canonical,
                siteName: getBrandedSiteName('deviantart'),
                authorName,
                authorHandle: authorHandle(authorUrl || '', parsedUrl.artist),
                authorUrl,
                image,
                color: platformColors.deviantart,
                timestamp: normalizePostTimestamp(text(payload.pubdate)),
                platform: 'deviantart',
                stats: formatStats(payload),
                context: copyrightContext(payload),
                sensitive: Boolean(safety && !['clean', 'safe', 'nonadult'].includes(safety)),
            };
            return { success: true, source: 'first-party', data };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'DeviantArt metadata unavailable',
                redirect: parsedUrl.canonical,
            };
        }
    },
};
