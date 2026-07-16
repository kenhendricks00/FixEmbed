/**
 * FixEmbed Service - Pixiv Handler
 * 
 * Fetches Pixiv artwork data directly and renders it through FixEmbed.
 * Phixiv remains an emergency fallback when Pixiv blocks Worker traffic.
 * 
 * Key features:
 * - Direct Pixiv metadata is the primary path
 * - Phixiv is used only as an emergency fallback
 * - Falls back to a branded basic embed if both sources are unavailable
 */

import type { Env, HandlerResponse, PlatformHandler } from '../types.ts';
import { formatNumber, platformColors, getBrandedSiteName } from '../utils/embed.ts';
import { extractPostTimestampFromHtml } from '../utils/timestamp.ts';
import { fetchWithTimeout } from '../utils/fetch.ts';

const MAX_PIXIV_OEMBED_BYTES = 64 * 1024;

interface PixivArtworkResponse {
    error?: boolean;
    body?: {
        title?: string;
        description?: string;
        userName?: string;
        userId?: string;
        userAccount?: string;
        bookmarkCount?: number;
        likeCount?: number;
        viewCount?: number;
        commentCount?: number;
        createDate?: string;
        urls?: { regular?: string; original?: string };
        profileImageUrl?: string;
        userIllusts?: Record<string, { profileImageUrl?: string } | null>;
    };
}

interface PixivArtworkPagesResponse {
    error?: boolean;
    body?: Array<{
        urls?: { regular?: string; original?: string };
    }>;
}

interface PixivUserResponse {
    error?: boolean;
    body?: {
        image?: string;
        imageBig?: string;
    };
}

interface PixivOEmbedResponse {
    title?: string;
    author_name?: string;
    author_url?: string;
    thumbnail_url?: string;
}

function proxyPixivImage(sourceUrl: string, env: Env): string {
    const embedDomain = env.EMBED_DOMAIN || 'fixembed.app';
    return `https://${embedDomain}/proxy/pixiv?url=${encodeURIComponent(sourceUrl)}`;
}

function trustedPixivMediaUrl(rawUrl: string | undefined): string | undefined {
    if (!rawUrl) return undefined;
    try {
        const parsed = new URL(rawUrl.replace(/&amp;/gi, '&'));
        const hostname = parsed.hostname.toLowerCase();
        const trustedHost = hostname === 'embed.pixiv.net'
            || hostname === 'i.pximg.net'
            || hostname.endsWith('.pximg.net');
        return parsed.protocol === 'https:' && trustedHost ? parsed.toString() : undefined;
    } catch {
        return undefined;
    }
}

function trustedPixivAuthorUrl(rawUrl: string | undefined): string | undefined {
    if (!rawUrl) return undefined;
    try {
        const parsed = new URL(rawUrl);
        const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
        const userId = parsed.pathname.match(/^\/(?:en\/)?users\/(\d+)\/?$/i)?.[1];
        return parsed.protocol === 'https:' && hostname === 'pixiv.net' && userId
            ? `https://www.pixiv.net/en/users/${userId}`
            : undefined;
    } catch {
        return undefined;
    }
}

function cleanPixivDescription(value: string | undefined): string {
    let description = (value || '').replace(/<[^>]+>/g, '');
    const decodeCodePoint = (match: string, code: string, radix: number): string => {
        const parsed = Number.parseInt(code, radix);
        return Number.isInteger(parsed) && parsed >= 0 && parsed <= 0x10FFFF
            ? String.fromCodePoint(parsed)
            : match;
    };
    for (let pass = 0; pass < 2; pass += 1) {
        description = description
            .replace(/&#x([0-9a-f]+);/gi, (match, code: string) => decodeCodePoint(match, code, 16))
            .replace(/&#(\d+);/g, (match, code: string) => decodeCodePoint(match, code, 10))
            .replace(/&quot;/gi, '"')
            .replace(/&apos;|&#39;/gi, "'")
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&amp;/gi, '&');
    }
    return description.trim();
}

function findPixivProfileImage(
    artwork: NonNullable<PixivArtworkResponse['body']>,
    illustId: string,
): string | undefined {
    return artwork.profileImageUrl
        || artwork.userIllusts?.[illustId]?.profileImageUrl
        || Object.values(artwork.userIllusts || {}).find(work => work?.profileImageUrl)?.profileImageUrl;
}

async function fetchPixivArtwork(illustId: string, env: Env): Promise<HandlerResponse | null> {
    try {
        const response = await fetch(`https://www.pixiv.net/ajax/illust/${illustId}`, {
            headers: {
                'Accept': 'application/json',
                'Referer': `https://www.pixiv.net/artworks/${illustId}`,
                'User-Agent': 'Mozilla/5.0 (compatible; FixEmbed/1.0; +https://fixembed.app)',
            },
        });
        if (!response.ok) {
            console.warn('first_party_fetch_failed', {
                platform: 'pixiv',
                stage: 'artwork',
                status: response.status,
            });
            return null;
        }
        const payload = await response.json() as PixivArtworkResponse;
        const artwork = payload?.body;
        if (payload?.error || !artwork?.title) {
            console.warn('first_party_payload_rejected', {
                platform: 'pixiv',
                stage: 'artwork',
                upstreamError: payload?.error === true,
                hasTitle: Boolean(artwork?.title),
            });
            return null;
        }
        const sourceImage = artwork.urls?.regular || artwork.urls?.original;
        let profileImage = findPixivProfileImage(artwork, illustId);
        let image = sourceImage ? proxyPixivImage(sourceImage, env) : undefined;
        let images: string[] | undefined;
        try {
            const pagesResponse = await fetch(`https://www.pixiv.net/ajax/illust/${illustId}/pages`, {
                headers: {
                    'Accept': 'application/json',
                    'Referer': `https://www.pixiv.net/artworks/${illustId}`,
                    'User-Agent': 'Mozilla/5.0 (compatible; FixEmbed/1.0; +https://fixembed.app)',
                },
            });
            if (pagesResponse.ok) {
                const pagesPayload = await pagesResponse.json() as PixivArtworkPagesResponse;
                const pageImages = (pagesPayload.body || [])
                    .map(page => page.urls?.regular || page.urls?.original)
                    .filter((url): url is string => Boolean(url))
                    .map(url => proxyPixivImage(url, env))
                    .slice(0, 10);
                if (pageImages.length === 1) [image] = pageImages;
                if (pageImages.length > 1) {
                    images = pageImages;
                    image = undefined;
                }
            }
        } catch (error) {
            console.warn('Pixiv pages request failed:', error);
        }

        if (artwork.userId && /^\d+$/.test(artwork.userId)) {
            try {
                const profileResponse = await fetch(
                    `https://www.pixiv.net/ajax/user/${artwork.userId}?full=1&lang=en`,
                    {
                        headers: {
                            'Accept': 'application/json',
                            'Referer': `https://www.pixiv.net/en/users/${artwork.userId}`,
                            'User-Agent': 'Mozilla/5.0 (compatible; FixEmbed/1.0; +https://fixembed.app)',
                        },
                    },
                );
                if (profileResponse.ok) {
                    const profilePayload = await profileResponse.json() as PixivUserResponse;
                    if (!profilePayload.error) {
                        profileImage = profilePayload.body?.imageBig
                            || profilePayload.body?.image
                            || profileImage;
                    }
                }
            } catch (error) {
                console.warn('Pixiv profile request failed:', error);
            }
        }

        const stats = [
            artwork.commentCount !== undefined ? `💬 ${formatNumber(artwork.commentCount)}` : '',
            artwork.likeCount !== undefined ? `❤️ ${formatNumber(artwork.likeCount)}` : '',
            artwork.viewCount !== undefined ? `👁️ ${formatNumber(artwork.viewCount)}` : '',
            artwork.bookmarkCount !== undefined ? `🔖 ${formatNumber(artwork.bookmarkCount)}` : '',
        ].filter(Boolean).join(' ');
        return {
            success: true,
            source: 'first-party',
            data: {
                title: artwork.title,
                description: cleanPixivDescription(artwork.description),
                url: `https://www.pixiv.net/artworks/${illustId}`,
                siteName: getBrandedSiteName('pixiv'),
                authorName: artwork.userName,
                authorHandle: artwork.userAccount ? `@${artwork.userAccount}` : undefined,
                authorUrl: artwork.userId ? `https://www.pixiv.net/en/users/${artwork.userId}` : undefined,
                authorAvatar: profileImage ? proxyPixivImage(profileImage, env) : undefined,
                image,
                images,
                color: platformColors.pixiv,
                platform: 'pixiv',
                timestamp: artwork.createDate,
                stats,
            },
        };
    } catch (error) {
        console.warn('Pixiv direct request failed:', error);
        return null;
    }
}

async function fetchPixivOEmbed(illustId: string, env: Env): Promise<HandlerResponse | null> {
    try {
        const canonicalUrl = `https://www.pixiv.net/artworks/${illustId}`;
        const endpoint = `https://embed.pixiv.net/oembed.php?url=${encodeURIComponent(canonicalUrl)}`;
        const response = await fetchWithTimeout(endpoint, {
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (compatible; FixEmbed/1.0; +https://fixembed.app)',
            },
        }, 5000);
        if (!response.ok) {
            console.warn('first_party_fetch_failed', {
                platform: 'pixiv',
                stage: 'oembed',
                status: response.status,
            });
            return null;
        }

        const declaredLength = Number(response.headers.get('content-length') || 0);
        if (Number.isFinite(declaredLength) && declaredLength > MAX_PIXIV_OEMBED_BYTES) {
            console.warn('first_party_payload_rejected', {
                platform: 'pixiv',
                stage: 'oembed',
                reason: 'declared_size',
            });
            return null;
        }
        const rawPayload = await response.text();
        if (new TextEncoder().encode(rawPayload).byteLength > MAX_PIXIV_OEMBED_BYTES) {
            console.warn('first_party_payload_rejected', {
                platform: 'pixiv',
                stage: 'oembed',
                reason: 'actual_size',
            });
            return null;
        }

        const payload = JSON.parse(rawPayload) as PixivOEmbedResponse;
        const image = trustedPixivMediaUrl(payload.thumbnail_url);
        if (!payload.title || !image) {
            console.warn('first_party_payload_rejected', {
                platform: 'pixiv',
                stage: 'oembed',
                hasTitle: Boolean(payload.title),
                hasImage: Boolean(image),
            });
            return null;
        }

        return {
            success: true,
            source: 'first-party',
            data: {
                title: payload.title,
                description: '',
                url: canonicalUrl,
                siteName: getBrandedSiteName('pixiv'),
                authorName: payload.author_name,
                authorUrl: trustedPixivAuthorUrl(payload.author_url),
                image: proxyPixivImage(image, env),
                color: platformColors.pixiv,
                platform: 'pixiv',
                timestamp: extractPostTimestampFromHtml(image),
            },
        };
    } catch (error) {
        console.warn('Pixiv official oEmbed request failed:', error);
        return null;
    }
}

// Scrape phixiv.net HTML for OG tags
async function scrapePhixivHtml(illustId: string): Promise<{
    success: boolean;
    title?: string;
    image?: string;
    description?: string;
    author?: string;
    timestamp?: string;
    error?: string;
}> {
    try {
        const phixivUrl = `https://www.phixiv.net/artworks/${illustId}`;
        const response = await fetch(phixivUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
                'Accept': 'text/html',
            },
        });

        if (!response.ok) {
            return { success: false, error: `Phixiv returned ${response.status}` };
        }

        const html = await response.text();

        // Extract OG tags
        const ogTitle = html.match(/<meta property="og:title" content="([^"]+)"/)?.[1];
        const ogImage = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1];
        const ogDesc = html.match(/<meta property="og:description" content="([^"]+)"/)?.[1];

        // Parse title to extract author: "Title by (@Author)"
        let title = ogTitle || 'Pixiv Artwork';
        let author: string | undefined;

        const authorMatch = ogTitle?.match(/(.+?) by \(@([^)]+)\)/);
        if (authorMatch) {
            title = authorMatch[1];
            author = authorMatch[2];
        }

        return {
            success: true,
            title,
            image: ogImage,
            description: ogDesc,
            author,
            timestamp: extractPostTimestampFromHtml(html),
        };
    } catch (error) {
        console.error('Phixiv scrape error:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
}

export const pixivHandler: PlatformHandler = {
    name: 'pixiv',
    patterns: [
        /pixiv\.net\/(?:\w+\/)?artworks\/(\d+)/i,
        /pixiv\.net\/member_illust\.php\?.*illust_id=(\d+)/i,
        /pixiv\.net\/i\/(\d+)/i,
    ],

    async handle(url: string, env: Env): Promise<HandlerResponse> {
        // Parse artwork ID from URL
        let illustId: string | null = null;

        const artworkMatch = url.match(/pixiv\.net\/(?:\w+\/)?artworks\/(\d+)/i);
        const legacyMatch = url.match(/pixiv\.net\/member_illust\.php\?.*illust_id=(\d+)/i);
        const shortMatch = url.match(/pixiv\.net\/i\/(\d+)/i);

        illustId = artworkMatch?.[1] || legacyMatch?.[1] || shortMatch?.[1] || null;

        if (!illustId) {
            return { success: false, error: 'Invalid Pixiv URL' };
        }

        const canonicalUrl = `https://www.pixiv.net/artworks/${illustId}`;

        try {
            const directResult = await fetchPixivArtwork(illustId, env);
            if (directResult) return directResult;

            const officialEmbedResult = await fetchPixivOEmbed(illustId, env);
            if (officialEmbedResult) return officialEmbedResult;

            // Emergency fallback when Pixiv rejects the direct Worker request.
            const scrapeResult = await scrapePhixivHtml(illustId);

            if (scrapeResult.success && scrapeResult.image) {
                return {
                    success: true,
                    source: 'fallback',
                    data: {
                        title: scrapeResult.title || 'Pixiv Artwork',
                        description: cleanPixivDescription(scrapeResult.description),
                        url: canonicalUrl,
                        siteName: getBrandedSiteName('pixiv'),
                        authorName: scrapeResult.author,
                        image: proxyPixivImage(scrapeResult.image, env),
                        color: platformColors.pixiv,
                        platform: 'pixiv',
                        timestamp: scrapeResult.timestamp,
                    },
                };
            }

            // Fallback to basic redirect
            return {
                success: true,
                source: 'first-party',
                data: {
                    title: 'Pixiv Artwork',
                    description: `View artwork #${illustId} on Pixiv`,
                    url: canonicalUrl,
                    siteName: getBrandedSiteName('pixiv'),
                    color: platformColors.pixiv,
                    platform: 'pixiv',
                },
            };
        } catch (error) {
            console.error('Pixiv handler error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch artwork',
                redirect: canonicalUrl,
            };
        }
    },
};
