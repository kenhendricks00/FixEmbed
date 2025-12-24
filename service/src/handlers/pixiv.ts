/**
 * FixEmbed Service - Pixiv Handler
 * 
 * Implements Pixiv embed support by scraping phixiv.net HTML.
 * Direct Pixiv API calls are blocked by Cloudflare (403), so we use
 * phixiv.net as our data source - they provide OG tags we can scrape.
 * 
 * Key features:
 * - Scrapes phixiv.net HTML for OG metadata
 * - Uses phixiv's image proxy URLs (they handle Pixiv's Referer requirement)
 * - Falls back to basic embed if phixiv is unavailable
 */

import { Env, HandlerResponse, PlatformHandler } from '../types';
import { platformColors } from '../utils/embed';

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

    async handle(url: string, _env: Env): Promise<HandlerResponse> {
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
            // Scrape phixiv.net HTML for OG tags (direct Pixiv API is blocked)
            const scrapeResult = await scrapePhixivHtml(illustId);

            if (scrapeResult.success && scrapeResult.image) {
                return {
                    success: true,
                    data: {
                        title: scrapeResult.title || 'Pixiv Artwork',
                        description: scrapeResult.description || '',
                        url: canonicalUrl,
                        siteName: 'Pixiv',
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
                data: {
                    title: 'Pixiv Artwork',
                    description: `View artwork #${illustId} on Pixiv`,
                    url: canonicalUrl,
                    siteName: 'Pixiv',
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
