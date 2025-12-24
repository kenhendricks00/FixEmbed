/**
 * FixEmbed Service - YouTube Handler
 * 
 * Uses YouTube's oEmbed API since it works reliably from Cloudflare Workers.
 * 
 * Key features:
 * - Fetches title, author, thumbnail from oEmbed
 * - Uses high-quality thumbnail (maxresdefault)
 * - Provides embed URL for video player
 */

import { Env, HandlerResponse, PlatformHandler } from '../types';
import { parseYouTubeUrl } from '../utils/fetch';
import { platformColors } from '../utils/embed';

interface YouTubeOEmbed {
    title: string;
    author_name: string;
    author_url: string;
    thumbnail_url: string;
    thumbnail_width: number;
    thumbnail_height: number;
    html: string;
    width: number;
    height: number;
}

export const youtubeHandler: PlatformHandler = {
    name: 'youtube',
    patterns: [
        /youtube\.com\/watch\?v=([^&]+)/i,
        /youtu\.be\/([^?]+)/i,
        /youtube\.com\/shorts\/([^?]+)/i,
        /youtube\.com\/embed\/([^?]+)/i,
    ],

    async handle(url: string, _env: Env): Promise<HandlerResponse> {
        const parsed = parseYouTubeUrl(url);

        if (!parsed) {
            return { success: false, error: 'Invalid YouTube URL' };
        }

        const videoId = parsed.videoId;
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

        try {
            // Use YouTube's oEmbed API (works reliably)
            const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(videoUrl)}&format=json`;

            const response = await fetch(oembedUrl, {
                headers: {
                    'Accept': 'application/json',
                },
            });

            if (!response.ok) {
                throw new Error(`oEmbed returned ${response.status}`);
            }

            const data = await response.json() as YouTubeOEmbed;

            // Use maxresdefault for best quality thumbnail
            const thumbnail = `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;

            return {
                success: true,
                data: {
                    title: data.title,
                    description: `by ${data.author_name}`,
                    url: videoUrl,
                    siteName: 'YouTube',
                    authorName: data.author_name,
                    authorUrl: data.author_url,
                    image: thumbnail,
                    video: {
                        url: `https://www.youtube.com/embed/${videoId}`,
                        width: 1280,
                        height: 720,
                        thumbnail,
                    },
                    color: platformColors.youtube,
                    platform: 'youtube',
                },
            };
        } catch (error) {
            console.error('YouTube handler error:', error);

            // Fallback: still provide basic embed with thumbnail
            return {
                success: true,
                data: {
                    title: 'YouTube Video',
                    description: 'Watch on YouTube',
                    url: videoUrl,
                    siteName: 'YouTube',
                    image: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
                    video: {
                        url: `https://www.youtube.com/embed/${videoId}`,
                        width: 1280,
                        height: 720,
                        thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
                    },
                    color: platformColors.youtube,
                    platform: 'youtube',
                },
            };
        }
    },
};
