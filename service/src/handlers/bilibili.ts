/**
 * FixEmbed Service - Bilibili Handler
 * 
 * Bilibili blocks direct API access from Cloudflare Workers (HTTP 412).
 * This implementation scrapes vxbilibili.com HTML for OG tags instead,
 * similar to how we use phixiv.net for Pixiv.
 * 
 * Key features:
 * - Scrapes vxbilibili.com for OG metadata
 * - Gets title, thumbnail, description from OG tags
 * - Falls back to basic redirect if scraping fails
 */

import { Env, HandlerResponse, PlatformHandler } from '../types';
import { platformColors } from '../utils/embed';

// Scrape vxbilibili.com HTML for OG tags
async function scrapeVxBilibili(bvid: string): Promise<{
    success: boolean;
    title?: string;
    image?: string;
    description?: string;
    author?: string;
    video?: string;
    error?: string;
}> {
    try {
        const vxUrl = `https://www.vxbilibili.com/video/${bvid}`;
        const response = await fetch(vxUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
                'Accept': 'text/html',
            },
        });

        if (!response.ok) {
            return { success: false, error: `vxbilibili returned ${response.status}` };
        }

        const html = await response.text();

        // Extract OG tags
        const ogTitle = html.match(/<meta property="og:title" content="([^"]+)"/)?.[1];
        const ogImage = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1];
        const ogDesc = html.match(/<meta property="og:description" content="([^"]+)"/)?.[1];
        const ogVideo = html.match(/<meta property="og:video(?::url)?" content="([^"]+)"/)?.[1];

        // Try to extract author from description or title
        // vxbilibili format: "Title - Author的bilibili视频"
        let author: string | undefined;
        const authorMatch = ogTitle?.match(/(.+?) - (.+?)的bilibili视频/);
        let title = ogTitle || 'Bilibili Video';
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
            video: ogVideo,
        };
    } catch (error) {
        console.error('vxbilibili scrape error:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
}

export const bilibiliHandler: PlatformHandler = {
    name: 'bilibili',
    patterns: [
        /bilibili\.com\/video\/(BV[a-zA-Z0-9]+)/i,
        /bilibili\.com\/video\/av(\d+)/i,
        /b23\.tv\/([a-zA-Z0-9]+)/i,
    ],

    async handle(url: string, env: Env): Promise<HandlerResponse> {
        // Parse BV or AV ID from URL
        const bvMatch = url.match(/bilibili\.com\/video\/(BV[a-zA-Z0-9]+)/i);
        const avMatch = url.match(/bilibili\.com\/video\/av(\d+)/i);
        const shortMatch = url.match(/b23\.tv\/([a-zA-Z0-9]+)/i);

        let bvid: string | null = bvMatch?.[1] || null;

        // Handle short URLs - need to resolve redirect first
        if (shortMatch && !bvid) {
            try {
                const response = await fetch(`https://b23.tv/${shortMatch[1]}`, {
                    method: 'HEAD',
                    redirect: 'follow',
                });
                const finalUrl = response.url;
                const resolvedBv = finalUrl.match(/bilibili\.com\/video\/(BV[a-zA-Z0-9]+)/i);
                if (resolvedBv) {
                    bvid = resolvedBv[1];
                }
            } catch (error) {
                console.error('Failed to resolve b23.tv URL:', error);
            }
        }

        // AV IDs would need conversion to BV, just redirect for now
        if (avMatch && !bvid) {
            return {
                success: false,
                redirect: url,
            };
        }

        if (!bvid) {
            return { success: false, error: 'Invalid Bilibili URL' };
        }

        const canonicalUrl = `https://www.bilibili.com/video/${bvid}`;
        const embedDomain = (env as any).EMBED_DOMAIN || 'embed.ken.tools';

        try {
            // Scrape vxbilibili.com for OG tags (direct Bilibili API is blocked)
            const scrapeResult = await scrapeVxBilibili(bvid);

            if (scrapeResult.success && (scrapeResult.title || scrapeResult.image)) {
                return {
                    success: true,
                    data: {
                        title: scrapeResult.title || 'Bilibili Video',
                        description: scrapeResult.description || '',
                        url: canonicalUrl,
                        siteName: 'Bilibili',
                        authorName: scrapeResult.author,
                        authorUrl: scrapeResult.author ? undefined : undefined,
                        image: scrapeResult.image,
                        video: scrapeResult.video ? {
                            url: `https://${embedDomain}/proxy/bilibili?url=${encodeURIComponent(scrapeResult.video)}`,
                            width: 1920,
                            height: 1080,
                            thumbnail: scrapeResult.image,
                        } : undefined,
                        color: platformColors.bilibili,
                        platform: 'bilibili',
                    },
                };
            }

            // Fallback to basic redirect
            return {
                success: true,
                data: {
                    title: 'Bilibili Video',
                    description: `Watch on Bilibili`,
                    url: canonicalUrl,
                    siteName: 'Bilibili',
                    color: platformColors.bilibili,
                    platform: 'bilibili',
                },
            };
        } catch (error) {
            console.error('Bilibili handler error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch video',
                redirect: canonicalUrl,
            };
        }
    },
};
