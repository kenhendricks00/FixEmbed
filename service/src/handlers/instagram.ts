/**
 * FixEmbed Service - Instagram Handler
 * 
 * Note: Instagram has aggressive anti-scraping measures.
 * This handler uses the embed API which has limitations.
 * For production, consider proxying through a service.
 */

import { Env, HandlerResponse, PlatformHandler } from '../types';
import { parseInstagramUrl, fetchJSON, truncateText } from '../utils/fetch';
import { platformColors } from '../utils/embed';

interface InstagramOEmbed {
    title: string;
    author_name: string;
    author_url: string;
    thumbnail_url: string;
    thumbnail_width: number;
    thumbnail_height: number;
    html: string;
}

export const instagramHandler: PlatformHandler = {
    name: 'instagram',
    patterns: [
        /instagram\.com\/p\/([^\/\?]+)/i,
        /instagram\.com\/reel\/([^\/\?]+)/i,
        /instagram\.com\/stories\/([^\/]+)\/(\d+)/i,
    ],

    async handle(url: string, env: Env): Promise<HandlerResponse> {
        const parsed = parseInstagramUrl(url);

        if (!parsed) {
            return { success: false, error: 'Invalid Instagram URL' };
        }

        try {
            // Construct the proper Instagram URL
            let embedUrl: string;

            if (parsed.type === 'reel') {
                embedUrl = `https://www.instagram.com/reel/${parsed.shortcode}/`;
            } else if (parsed.type === 'story') {
                // Stories don't have oEmbed support, redirect directly
                return {
                    success: false,
                    redirect: url,
                };
            } else {
                embedUrl = `https://www.instagram.com/p/${parsed.shortcode}/`;
            }

            // Try Instagram's oEmbed API
            const oembedUrl = `https://api.instagram.com/oembed/?url=${encodeURIComponent(embedUrl)}`;

            const data = await fetchJSON<InstagramOEmbed>(oembedUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; FixEmbed/1.0)',
                },
            });

            if (!data) {
                return { success: false, error: 'Post not found' };
            }

            // Instagram oEmbed provides the thumbnail
            const image = data.thumbnail_url;

            // Extract caption from title if available
            const description = data.title
                ? truncateText(data.title, 280)
                : `${parsed.type === 'reel' ? 'Reel' : 'Post'} by ${data.author_name}`;

            return {
                success: true,
                data: {
                    title: `${data.author_name} on Instagram`,
                    description,
                    url: embedUrl,
                    siteName: 'Instagram',
                    authorName: data.author_name,
                    authorUrl: data.author_url,
                    image,
                    color: platformColors.instagram,
                    platform: 'instagram',
                },
            };
        } catch (error) {
            console.error('Instagram handler error:', error);

            // Fallback: return basic info and redirect
            return {
                success: false,
                error: 'Instagram content unavailable - redirecting',
                redirect: url,
            };
        }
    },
};
