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
    };
}

interface PixivArtworkPagesResponse {
    error?: boolean;
    body?: Array<{
        urls?: { regular?: string; original?: string };
    }>;
}

function proxyPixivImage(sourceUrl: string, env: Env): string {
    const embedDomain = env.EMBED_DOMAIN || 'fixembed.app';
    return `https://${embedDomain}/proxy/pixiv?url=${encodeURIComponent(sourceUrl)}`;
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

async function fetchPixivArtwork(illustId: string, env: Env): Promise<HandlerResponse | null> {
    try {
        const response = await fetch(`https://www.pixiv.net/ajax/illust/${illustId}`, {
            headers: {
                'Accept': 'application/json',
                'Referer': `https://www.pixiv.net/artworks/${illustId}`,
                'User-Agent': 'Mozilla/5.0 (compatible; FixEmbed/1.0; +https://fixembed.app)',
            },
        });
        if (!response.ok) return null;
        const payload = await response.json() as PixivArtworkResponse;
        const artwork = payload?.body;
        if (payload?.error || !artwork?.title) return null;
        const sourceImage = artwork.urls?.regular || artwork.urls?.original;
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
                authorUrl: artwork.userId ? `https://www.pixiv.net/users/${artwork.userId}` : undefined,
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

// Scrape phixiv.net HTML for OG tags
async function scrapePhixivHtml(illustId: string): Promise<{
    success: boolean;
    title?: string;
    image?: string;
    description?: string;
    author?: string;
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
                        authorUrl: scrapeResult.author ? `https://www.pixiv.net/users/${scrapeResult.author}` : undefined,
                        image: scrapeResult.image,
                        color: platformColors.pixiv,
                        platform: 'pixiv',
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
