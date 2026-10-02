/**
 * DeviantArt deviation metadata handler.
 * Uses DeviantArt's public oEmbed endpoint for documented deviation and Sta.sh URLs.
 *
 * Cloudflare Worker egress is often blocked by DeviantArt (HTTP 403) for both
 * oEmbed and the public HTML page. When that happens, recover OG metadata through
 * Bluesky Cardyb (emergency fallback) so Worker canaries and /api/embed keep a
 * usable first-party media URL while Discord V2 cards continue to use the bot host.
 */
import type { EmbedData, Env, HandlerResponse, PlatformHandler } from '../types.ts';
import { fetchWithTimeout, truncateText } from '../utils/fetch.ts';
import { formatNumber, getBrandedSiteName, platformColors } from '../utils/embed.ts';
import { normalizePostTimestamp } from '../utils/timestamp.ts';

const OEMBED_ENDPOINT = 'https://backend.deviantart.com/oembed';
const CARDYB_EXTRACT_ENDPOINT = 'https://cardyb.bsky.app/v1/extract';
const MAX_OEMBED_BYTES = 512_000;
const MEDIA_HOST_SUFFIXES = ['wixmp.com', 'deviantart.net', 'deviantart.com'];
const SUCCESS_CACHE_TTL_MS = 5 * 60_000;
const NEGATIVE_CACHE_TTL_MS = 30_000;
const MAX_CACHE_ENTRIES = 256;

type CachedResponse = {
    expiresAt: number;
    response: HandlerResponse;
};

const responseCache = new Map<string, CachedResponse>();
const inFlightRequests = new Map<string, Promise<HandlerResponse>>();

type DeviantArtUrl = {
    canonical: string;
    artist?: string;
};

type OEmbedPayload = {
    type?: unknown;
    title?: unknown;
    description?: unknown;
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
            && path.length === 3
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

function cachedResponse(canonicalUrl: string): HandlerResponse | undefined {
    const entry = responseCache.get(canonicalUrl);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
        responseCache.delete(canonicalUrl);
        return undefined;
    }
    return entry.response;
}

function cacheResponse(canonicalUrl: string, response: HandlerResponse): void {
    const now = Date.now();
    for (const [key, entry] of responseCache) {
        if (entry.expiresAt <= now) responseCache.delete(key);
    }
    if (responseCache.size >= MAX_CACHE_ENTRIES) {
        const oldest = responseCache.keys().next().value;
        if (typeof oldest === 'string') responseCache.delete(oldest);
    }
    responseCache.set(canonicalUrl, {
        expiresAt: now + (response.success ? SUCCESS_CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS),
        response,
    });
}


function extractMetaContent(html: string, key: string): string {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
        new RegExp(
            `<meta\\b[^>]*(?:property|name)=["']${escaped}["'][^>]*\\bcontent=["']([^"']+)["']`,
            'i',
        ),
        new RegExp(
            `<meta\\b[^>]*\\bcontent=["']([^"']+)["'][^>]*(?:property|name)=["']${escaped}["']`,
            'i',
        ),
    ];
    for (const pattern of patterns) {
        const value = html.match(pattern)?.[1];
        if (value) {
            return value
                .replace(/&amp;/g, '&')
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'")
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .trim();
        }
    }
    return '';
}

function parseDeviantArtDescriptionStats(description: string): {
    timestamp?: string;
    stats?: string;
    cleanDescription: string;
} {
    const published = description.match(
        /Published:\s*(\d{4}-\d{2}-\d{2})/i,
    )?.[1];
    const likes = description.match(/Likes:\s*([\d,]+)/i)?.[1];
    const views = description.match(/Views:\s*([\d,]+)/i)?.[1];
    const comments = description.match(/Comments:\s*([\d,]+)/i)?.[1];
    const parts: string[] = [];
    const viewsCount = finiteCount(views?.replace(/,/g, ''));
    const likesCount = finiteCount(likes?.replace(/,/g, ''));
    const commentsCount = finiteCount(comments?.replace(/,/g, ''));
    if (viewsCount !== undefined) parts.push(`👁️ ${formatNumber(viewsCount)} views`);
    if (likesCount !== undefined) parts.push(`❤️ ${formatNumber(likesCount)} favorites`);
    if (commentsCount !== undefined) parts.push(`💬 ${formatNumber(commentsCount)} comments`);
    const cleanDescription = description
        .replace(/\s*[—-]\s*artwork by .+ on DeviantArt\.?/i, '')
        .replace(/\s*Published:\s*\d{4}-\d{2}-\d{2}/i, '')
        .replace(/\s*[·•]\s*Likes:\s*[\d,]+/i, '')
        .replace(/\s*[·•]\s*Views:\s*[\d,]+/i, '')
        .replace(/\s*[·•]\s*Comments:\s*[\d,]+/i, '')
        .trim();
    return {
        timestamp: published ? normalizePostTimestamp(`${published}T12:00:00Z`) : undefined,
        stats: parts.length ? parts.join('  ') : undefined,
        cleanDescription,
    };
}


function unwrapCardybImageUrl(value: unknown): string | undefined {
    const raw = text(value);
    if (!raw) return undefined;
    try {
        const url = new URL(raw);
        const host = url.hostname.toLowerCase();
        if (
            url.protocol === 'https:'
            && !url.username
            && !url.password
            && (!url.port || url.port === '443')
            && host === 'cardyb.bsky.app'
            && url.pathname === '/v1/image'
        ) {
            const nested = url.searchParams.get('url');
            return nested ? trustedMediaUrl(nested) : undefined;
        }
    } catch {
        // Ignore malformed cardyb wrappers.
    }
    return trustedMediaUrl(raw);
}

type CardybExtractPayload = {
    error?: unknown;
    title?: unknown;
    description?: unknown;
    image?: unknown;
    url?: unknown;
};

async function recoverViaCardyb(
    parsedUrl: DeviantArtUrl,
    timeoutMs: number,
): Promise<HandlerResponse> {
    try {
        const endpoint = new URL(CARDYB_EXTRACT_ENDPOINT);
        endpoint.searchParams.set('url', parsedUrl.canonical);
        const response = await fetchWithTimeout(endpoint.toString(), {
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'FixEmbed/1.0 (+https://fixembed.app)',
            },
        }, timeoutMs);
        if (!response.ok) {
            return {
                success: false,
                error: `DeviantArt metadata fallback returned ${response.status}`,
                redirect: parsedUrl.canonical,
            };
        }

        const payload = await response.json() as CardybExtractPayload;
        if (text(payload.error)) {
            return {
                success: false,
                error: 'DeviantArt metadata unavailable',
                redirect: parsedUrl.canonical,
            };
        }

        const ogTitle = text(payload.title);
        const ogImage = unwrapCardybImageUrl(payload.image);
        const ogDescription = text(payload.description);
        if (!ogTitle && !ogImage) {
            return {
                success: false,
                error: 'DeviantArt metadata unavailable',
                redirect: parsedUrl.canonical,
            };
        }

        const titleMatch = ogTitle.match(/^(.*?)\s+by\s+(.+?)\s+on DeviantArt$/i);
        const title = truncateText(
            (titleMatch?.[1] || ogTitle || 'DeviantArt deviation').trim(),
            300,
        );
        const authorFromTitle = titleMatch?.[2]?.trim();
        const authorName = truncateText(
            authorFromTitle || parsedUrl.artist || 'DeviantArt artist',
            100,
        );
        const authorUrl = parsedUrl.artist
            ? trustedAuthorUrl(`https://www.deviantart.com/${parsedUrl.artist}`)
            : undefined;
        const parsedDescription = parseDeviantArtDescriptionStats(ogDescription);
        const data: EmbedData = {
            title,
            description: truncateText(parsedDescription.cleanDescription, 4000),
            url: parsedUrl.canonical,
            siteName: getBrandedSiteName('deviantart'),
            authorName,
            authorHandle: authorHandle(authorUrl || '', parsedUrl.artist),
            authorUrl,
            image: ogImage,
            color: platformColors.deviantart,
            timestamp: parsedDescription.timestamp,
            platform: 'deviantart',
            stats: parsedDescription.stats,
        };
        return { success: true, source: 'fallback', data };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'DeviantArt metadata unavailable',
            redirect: parsedUrl.canonical,
        };
    }
}

async function scrapeDeviantArtPage(
    parsedUrl: DeviantArtUrl,
    timeoutMs: number,
): Promise<HandlerResponse> {
    try {
        const response = await fetchWithTimeout(parsedUrl.canonical, {
            headers: {
                'Accept': 'text/html,application/xhtml+xml',
                'User-Agent': 'Mozilla/5.0 (compatible; FixEmbed/1.0; +https://fixembed.app)',
            },
        }, timeoutMs);
        if (!response.ok) {
            return {
                success: false,
                error: `DeviantArt returned ${response.status}`,
                redirect: parsedUrl.canonical,
            };
        }

        const html = await response.text();
        const ogTitle = extractMetaContent(html, 'og:title')
            || extractMetaContent(html, 'twitter:title');
        const ogImage = trustedMediaUrl(
            extractMetaContent(html, 'og:image')
            || extractMetaContent(html, 'twitter:image'),
        );
        const ogDescription = extractMetaContent(html, 'og:description')
            || extractMetaContent(html, 'twitter:description');
        if (!ogTitle && !ogImage) {
            return {
                success: false,
                error: 'DeviantArt metadata unavailable',
                redirect: parsedUrl.canonical,
            };
        }

        const titleMatch = ogTitle.match(/^(.*?)\s+by\s+(.+?)\s+on DeviantArt$/i);
        const title = truncateText(
            (titleMatch?.[1] || ogTitle || 'DeviantArt deviation').trim(),
            300,
        );
        const authorFromTitle = titleMatch?.[2]?.trim();
        const authorName = truncateText(
            authorFromTitle || parsedUrl.artist || 'DeviantArt artist',
            100,
        );
        const authorUrl = parsedUrl.artist
            ? trustedAuthorUrl(`https://www.deviantart.com/${parsedUrl.artist}`)
            : undefined;
        const parsedDescription = parseDeviantArtDescriptionStats(ogDescription);
        const data: EmbedData = {
            title,
            description: truncateText(parsedDescription.cleanDescription, 4000),
            url: parsedUrl.canonical,
            siteName: getBrandedSiteName('deviantart'),
            authorName,
            authorHandle: authorHandle(authorUrl || '', parsedUrl.artist),
            authorUrl,
            image: ogImage,
            color: platformColors.deviantart,
            timestamp: parsedDescription.timestamp,
            platform: 'deviantart',
            stats: parsedDescription.stats,
        };
        return { success: true, source: 'first-party', data };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'DeviantArt metadata unavailable',
            redirect: parsedUrl.canonical,
        };
    }
}

export const deviantartHandler: PlatformHandler = {
    name: 'deviantart',
    patterns: [
        /^https:\/\/(?:www\.)?deviantart\.com\/[A-Za-z0-9_-]+\/art\/[A-Za-z0-9_-]+\/?(?:[?#].*)?$/i,
        /^https:\/\/sta\.sh\/[A-Za-z0-9_-]+\/?(?:[?#].*)?$/i,
    ],
    async handle(rawUrl: string, _env: Env): Promise<HandlerResponse> {
        const parsedUrl = parseDeviantArtUrl(rawUrl);
        if (!parsedUrl) return { success: false, error: 'Invalid DeviantArt URL' };

        const cached = cachedResponse(parsedUrl.canonical);
        if (cached) return cached;
        const inFlight = inFlightRequests.get(parsedUrl.canonical);
        if (inFlight) return inFlight;

        const request = (async (): Promise<HandlerResponse> => {
            try {
                const endpoint = new URL(OEMBED_ENDPOINT);
                endpoint.searchParams.set('url', parsedUrl.canonical);
                endpoint.searchParams.set('maxwidth', '1200');
                const response = await fetchWithTimeout(endpoint.toString(), {
                    headers: {
                        'Accept': 'application/json',
                        'Accept-Encoding': 'gzip',
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
                    // Cloudflare Worker egress is often blocked by DeviantArt for
                    // both oEmbed and the public HTML page (HTTP 403). Prefer a
                    // direct page scrape when it works, then recover through
                    // Cardyb so Worker /api/embed canaries stay useful.
                    if (response.status === 403) {
                        const pageResult = await scrapeDeviantArtPage(parsedUrl, 5_000);
                        if (pageResult.success) return pageResult;
                        const cardybResult = await recoverViaCardyb(parsedUrl, 5_000);
                        if (cardybResult.success) return cardybResult;
                        return {
                            success: false,
                            error: pageResult.error || cardybResult.error
                                || `DeviantArt returned ${response.status}`,
                            redirect: parsedUrl.canonical,
                        };
                    }
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
                    description: truncateText(text(payload.description), 4000),
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
        })();
        inFlightRequests.set(parsedUrl.canonical, request);
        try {
            const response = await request;
            cacheResponse(parsedUrl.canonical, response);
            return response;
        } finally {
            inFlightRequests.delete(parsedUrl.canonical);
        }
    },
};
