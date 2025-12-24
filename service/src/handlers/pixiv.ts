/**
 * FixEmbed Service - Pixiv Handler
 * 
 * Implements Pixiv embed support using their internal Ajax API.
 * Based on phixiv implementation (https://github.com/thelaao/phixiv)
 * 
 * Key features:
 * - Fetches artwork metadata via Pixiv's Ajax API
 * - Proxies images with proper Referer header
 * - Supports multi-page artworks (carousel)
 * - Shows engagement stats (likes, bookmarks, views)
 */

import { Env, HandlerResponse, PlatformHandler } from '../types';
import { truncateText } from '../utils/fetch';
import { platformColors } from '../utils/embed';

// Response types from Pixiv Ajax API
interface PixivAjaxResponse {
    error: boolean;
    message?: string;
    body?: PixivArtwork;
}

interface PixivArtwork {
    title: string;
    description: string;
    userId: string;
    userName: string;
    illustType: number; // 0=illust, 1=manga, 2=ugoira
    createDate: string;
    pageCount: number;
    bookmarkCount: number;
    likeCount: number;
    viewCount: number;
    commentCount: number;
    xRestrict: number; // 0=SFW, 1=R-18, 2=R-18G
    urls: {
        mini?: string;
        thumb?: string;
        small?: string;
        regular?: string;
        original?: string;
    };
    tags: {
        tags: Array<{
            tag: string;
            translation?: Record<string, string>;
        }>;
    };
}

interface PixivPagesResponse {
    error: boolean;
    body?: Array<{
        urls: {
            thumb_mini?: string;
            small?: string;
            regular?: string;
            original?: string;
        };
    }>;
}

// Fetch artwork info from Pixiv Ajax API
async function fetchPixivArtwork(illustId: string): Promise<{
    success: boolean;
    data?: PixivArtwork;
    error?: string;
}> {
    try {
        const response = await fetch(`https://www.pixiv.net/ajax/illust/${illustId}`, {
            headers: {
                'User-Agent': 'PixivIOSApp/7.13.3 (iOS 14.6; iPhone13,2)',
                'App-Os': 'iOS',
                'App-Os-Version': '14.6',
                'Accept': 'application/json',
                'Accept-Language': 'en-US,en;q=0.9',
            },
        });

        if (!response.ok) {
            return { success: false, error: `Pixiv returned ${response.status}` };
        }

        const data = await response.json() as PixivAjaxResponse;

        if (data.error || !data.body) {
            return { success: false, error: data.message || 'Unknown error' };
        }

        return { success: true, data: data.body };
    } catch (error) {
        console.error('Pixiv fetch error:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
}

// Fetch all pages for multi-page artwork
async function fetchPixivPages(illustId: string): Promise<string[]> {
    try {
        const response = await fetch(`https://www.pixiv.net/ajax/illust/${illustId}/pages`, {
            headers: {
                'User-Agent': 'PixivIOSApp/7.13.3 (iOS 14.6; iPhone13,2)',
                'App-Os': 'iOS',
                'App-Os-Version': '14.6',
                'Accept': 'application/json',
            },
        });

        if (!response.ok) return [];

        const data = await response.json() as PixivPagesResponse;

        if (data.error || !data.body) return [];

        // Return regular URLs for each page
        return data.body
            .map(page => page.urls.regular || page.urls.small || '')
            .filter(url => url.length > 0);
    } catch {
        return [];
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
            // Fetch artwork data
            const artworkResult = await fetchPixivArtwork(illustId);

            if (!artworkResult.success || !artworkResult.data) {
                // Fallback to basic redirect
                return {
                    success: true,
                    data: {
                        title: 'Pixiv Artwork',
                        description: `View artwork #${illustId} on Pixiv`,
                        url: canonicalUrl,
                        siteName: 'Pixiv',
                        color: platformColors.pixiv,
                        platform: 'pixiv',
                    },
                };
            }

            const artwork = artworkResult.data;

            // Build stats string
            const stats: string[] = [];
            if (artwork.likeCount > 0) {
                stats.push(`❤️ ${artwork.likeCount.toLocaleString()}`);
            }
            if (artwork.bookmarkCount > 0) {
                stats.push(`🔖 ${artwork.bookmarkCount.toLocaleString()}`);
            }
            if (artwork.viewCount > 0) {
                stats.push(`👁️ ${artwork.viewCount.toLocaleString()}`);
            }
            const statsStr = stats.length > 0 ? ` · ${stats.join(' ')}` : '';

            // Clean description (remove HTML tags)
            let description = artwork.description
                .replace(/<br\s*\/?>/gi, '\n')
                .replace(/<[^>]+>/g, '')
                .trim();

            // Use image proxy for the artwork image
            const embedDomain = (env as any).EMBED_DOMAIN || 'embed.ken.tools';

            // Get image URL and proxy it
            const originalImageUrl = artwork.urls.regular || artwork.urls.original || artwork.urls.small;
            let proxyImageUrl: string | undefined;

            if (originalImageUrl) {
                // Pixiv images require Referer header, so we proxy through our domain
                proxyImageUrl = `https://${embedDomain}/proxy/pixiv?url=${encodeURIComponent(originalImageUrl)}`;
            }

            // Build response
            const result: HandlerResponse = {
                success: true,
                data: {
                    title: artwork.title || 'Untitled',
                    description: description ? truncateText(description, 280) : '',
                    url: canonicalUrl,
                    siteName: `Pixiv${statsStr}`,
                    authorName: artwork.userName,
                    authorUrl: `https://www.pixiv.net/users/${artwork.userId}`,
                    color: platformColors.pixiv,
                    platform: 'pixiv',
                },
            };

            // Add NSFW warning if restricted
            if (artwork.xRestrict > 0) {
                result.data!.title = `🔞 ${result.data!.title}`;
            }

            // Handle multi-page artworks (carousel)
            if (artwork.pageCount > 1) {
                // Fetch all page URLs
                const pageUrls = await fetchPixivPages(illustId);

                if (pageUrls.length > 0) {
                    // Proxy all images
                    result.data!.images = pageUrls.map(imgUrl =>
                        `https://${embedDomain}/proxy/pixiv?url=${encodeURIComponent(imgUrl)}`
                    );
                    result.data!.image = result.data!.images[0];
                } else if (proxyImageUrl) {
                    result.data!.image = proxyImageUrl;
                }

                // Add page count to description
                result.data!.description = `[${artwork.pageCount} images] ${result.data!.description}`;
            } else if (proxyImageUrl) {
                result.data!.image = proxyImageUrl;
            }

            return result;
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
