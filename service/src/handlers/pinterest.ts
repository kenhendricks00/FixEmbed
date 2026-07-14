/**
 * Pinterest Pin metadata handler.
 * Short links are resolved manually so redirects remain on Pinterest hosts.
 */
import type { Env, HandlerResponse, PlatformHandler } from '../types.ts';
import { normalizePostTimestamp } from '../utils/timestamp.ts';
import { getBrandedSiteName, platformColors } from '../utils/embed.ts';
import { decodeHtmlEntities, fetchWithTimeout, truncateText } from '../utils/fetch.ts';

const MAX_REDIRECTS = 4;
const MAX_HTML_BYTES = 5_000_000;

function isTrustedPinterestUrl(value: string): boolean {
    try {
        const parsed = new URL(value);
        const host = parsed.hostname.toLowerCase();
        return parsed.protocol === 'https:'
            && (!parsed.port || parsed.port === '443')
            && (host === 'pin.it' || host === 'pinterest.com' || host.endsWith('.pinterest.com'));
    } catch {
        return false;
    }
}

function trustedMediaUrl(value: string | undefined): string | undefined {
    if (!value) return undefined;
    try {
        const parsed = new URL(decodeHtmlEntities(value));
        const host = parsed.hostname.toLowerCase();
        return parsed.protocol === 'https:' && (host === 'pinimg.com' || host.endsWith('.pinimg.com'))
            ? parsed.toString()
            : undefined;
    } catch {
        return undefined;
    }
}

function originalPinterestAvatar(value: string | undefined): string | undefined {
    const trusted = trustedMediaUrl(value);
    if (!trusted) return undefined;
    const parsed = new URL(trusted);
    parsed.pathname = parsed.pathname.replace(
        /^\/(?:30x30_RS|75x75_RS|140x140_RS|280x280_RS)\//i,
        '/originals/',
    );
    return parsed.toString();
}

function embeddedObjects(html: string, key: string): Record<string, unknown>[] {
    const objects: Record<string, unknown>[] = [];
    const marker = `"${key}":`;
    let searchFrom = 0;
    while (searchFrom < html.length && objects.length < 20) {
        const markerIndex = html.indexOf(marker, searchFrom);
        if (markerIndex < 0) break;
        let start = markerIndex + marker.length;
        while (/\s/.test(html[start] || '')) start += 1;
        if (html[start] !== '{') {
            searchFrom = start;
            continue;
        }

        let depth = 0;
        let inString = false;
        let escaped = false;
        for (let index = start; index < html.length; index += 1) {
            const character = html[index];
            if (inString) {
                if (escaped) escaped = false;
                else if (character === '\\') escaped = true;
                else if (character === '"') inString = false;
                continue;
            }
            if (character === '"') inString = true;
            else if (character === '{') depth += 1;
            else if (character === '}' && --depth === 0) {
                try {
                    const parsed: unknown = JSON.parse(html.slice(start, index + 1));
                    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                        objects.push(parsed as Record<string, unknown>);
                    }
                } catch {
                    // Continue looking for another copy of this object in the page.
                }
                searchFrom = index + 1;
                break;
            }
        }
        if (searchFrom <= start) searchFrom = start + 1;
    }
    return objects;
}

function creatorMetadata(html: string, expectedUsername = ''): {
    authorName?: string;
    authorHandle?: string;
    authorUrl?: string;
    authorAvatar?: string;
} {
    const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
    let bestMatch: ReturnType<typeof creatorMetadata> = {};
    for (const key of ['nativeCreator', 'closeupUnifiedAttribution', 'originPinner', 'pinner', 'owner']) {
        for (const creator of embeddedObjects(html, key)) {
            const username = text(creator.username).replace(/^@/, '');
            if (expectedUsername && username.toLowerCase() !== expectedUsername.toLowerCase()) continue;
            const authorName = truncateText(
                text(creator.fullName) || text(creator.full_name) || text(creator.firstName) || username,
                100,
            );
            if (!authorName && !username) continue;
            const safeUsername = /^[A-Za-z0-9_.-]+$/.test(username) ? username : '';
            const candidate = {
                authorName: authorName || safeUsername,
                authorHandle: safeUsername ? `@${safeUsername}` : undefined,
                authorUrl: safeUsername
                    ? `https://www.pinterest.com/${safeUsername}/`
                    : undefined,
                authorAvatar: originalPinterestAvatar(
                    text(creator.imageLargeUrl)
                    || text(creator.imageMediumUrl)
                    || text(creator.imageSmallUrl)
                    || text(creator.image_large_url)
                    || text(creator.image_medium_url)
                    || text(creator.image_small_url),
                ),
            };
            if (!bestMatch.authorName) bestMatch = candidate;
            if (candidate.authorAvatar) return candidate;
        }
    }
    return bestMatch;
}

async function fetchCreatorAvatar(creator: ReturnType<typeof creatorMetadata>): Promise<string | undefined> {
    const username = creator.authorHandle?.replace(/^@/, '');
    if (!username || !/^[A-Za-z0-9_.-]+$/.test(username)) return undefined;
    const profileUrl = `https://www.pinterest.com/${username}/`;
    const response = await fetchWithTimeout(profileUrl, {
        redirect: 'error',
        headers: {
            'Accept': 'text/html,application/xhtml+xml',
            'User-Agent': 'Mozilla/5.0 (compatible; FixEmbed/1.0; +https://fixembed.app)',
        },
    }, 6_000);
    if (!response.ok) return undefined;
    return creatorMetadata(await readTextLimited(response), username).authorAvatar;
}

function pinIdFromUrl(value: string): string | undefined {
    try {
        return new URL(value).pathname.match(/\/pin\/(?:[^/]*--)?(\d+)(?:\/|$)/i)?.[1];
    } catch {
        return undefined;
    }
}

function metaContent(html: string, key: string): string | undefined {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
        new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, 'i'),
        new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, 'i'),
    ];
    for (const pattern of patterns) {
        const value = html.match(pattern)?.[1];
        if (value !== undefined) return decodeHtmlEntities(value).trim();
    }
    return undefined;
}

function dimension(value: string | undefined, fallback: number): number {
    const parsed = Number.parseInt(value || '', 10);
    return Number.isInteger(parsed) && parsed > 0 && parsed <= 10_000 ? parsed : fallback;
}

async function readTextLimited(response: Response): Promise<string> {
    const declaredLength = Number.parseInt(response.headers.get('Content-Length') || '', 10);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_HTML_BYTES) {
        throw new Error('Pinterest response too large');
    }
    if (!response.body) return '';

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let size = 0;
    let html = '';
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_HTML_BYTES) {
            await reader.cancel();
            throw new Error('Pinterest response too large');
        }
        html += decoder.decode(value, { stream: true });
    }
    return html + decoder.decode();
}

async function fetchPinterestHtml(inputUrl: string): Promise<{ html: string; canonicalUrl: string }> {
    let current = inputUrl;
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
        if (!isTrustedPinterestUrl(current)) throw new Error('Unsafe Pinterest redirect');
        const resolvedPinId = pinIdFromUrl(current);
        if (resolvedPinId) {
            current = `https://www.pinterest.com/pin/${resolvedPinId}/`;
        }
        const response = await fetchWithTimeout(current, {
            redirect: 'manual',
            headers: {
                'Accept': 'text/html,application/xhtml+xml',
                'User-Agent': 'Mozilla/5.0 (compatible; FixEmbed/1.0; +https://fixembed.app)',
            },
        }, 6_000);
        if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get('Location');
            if (!location || redirects === MAX_REDIRECTS) throw new Error('Unsafe Pinterest redirect');
            const next = new URL(location, current).toString();
            if (!isTrustedPinterestUrl(next)) throw new Error('Unsafe Pinterest redirect');
            current = next;
            continue;
        }
        if (!response.ok) throw new Error(`Pinterest returned ${response.status}`);
        const pinId = pinIdFromUrl(current);
        if (!pinId) throw new Error('Pinterest Pin ID unavailable');
        return {
            html: await readTextLimited(response),
            canonicalUrl: `https://www.pinterest.com/pin/${pinId}/`,
        };
    }
    throw new Error('Unsafe Pinterest redirect');
}

export const pinterestHandler: PlatformHandler = {
    name: 'pinterest',
    patterns: [
        /^https:\/\/pin\.it\/[A-Za-z0-9_-]+/i,
        /^https:\/\/(?:[\w-]+\.)?pinterest\.com\/pin\//i,
    ],
    async handle(url: string, _env: Env): Promise<HandlerResponse> {
        if (!isTrustedPinterestUrl(url)) return { success: false, error: 'Invalid Pinterest URL' };
        try {
            const { html, canonicalUrl } = await fetchPinterestHtml(url);
            const title = truncateText(metaContent(html, 'og:title') || 'Pinterest Pin', 300);
            const description = truncateText(metaContent(html, 'og:description') || '', 2_000);
            const image = trustedMediaUrl(metaContent(html, 'og:image'));
            const videoUrl = trustedMediaUrl(metaContent(html, 'og:video:secure_url') || metaContent(html, 'og:video'));
            const timestamp = metaContent(html, 'og:updated_time');
            const creator = creatorMetadata(html);
            if (!creator.authorAvatar) {
                try {
                    creator.authorAvatar = await fetchCreatorAvatar(creator);
                } catch {
                    // Creator identity is still useful when Pinterest blocks the profile fallback.
                }
            }
            if (!image && !videoUrl && title === 'Pinterest Pin' && !description) {
                return { success: false, error: 'Pinterest metadata unavailable', redirect: canonicalUrl };
            }
            return {
                success: true,
                source: 'first-party',
                data: {
                    title,
                    description,
                    url: canonicalUrl,
                    siteName: getBrandedSiteName('pinterest'),
                    ...creator,
                    image,
                    video: videoUrl ? {
                        url: videoUrl,
                        width: dimension(metaContent(html, 'og:video:width'), 720),
                        height: dimension(metaContent(html, 'og:video:height'), 1280),
                        thumbnail: image,
                    } : undefined,
                    timestamp: normalizePostTimestamp(timestamp),
                    color: platformColors.pinterest,
                    platform: 'pinterest',
                },
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Pinterest metadata unavailable',
            };
        }
    },
};
