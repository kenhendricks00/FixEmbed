/**
 * FixEmbed Service - YouTube Handler
 */

import { Env, HandlerResponse, PlatformHandler } from '../types';
import { parseYouTubeUrl, fetchJSON, truncateText } from '../utils/fetch';
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

    async handle(url: string, env: Env): Promise<HandlerResponse> {
        const parsed = parseYouTubeUrl(url);

        if (!parsed) {
            return { success: false, error: 'Invalid YouTube URL' };
        }

        try {
            // Use YouTube's oEmbed API
            const videoUrl = `https://www.youtube.com/watch?v=${parsed.videoId}`;
            const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(videoUrl)}&format=json`;

            const data = await fetchJSON<YouTubeOEmbed>(oembedUrl);

            if (!data) {
                return { success: false, error: 'Video not found' };
            }

            // Get highest quality thumbnail
            const thumbnailUrl = `https://i.ytimg.com/vi/${parsed.videoId}/maxresdefault.jpg`;

            return {
                success: true,
                data: {
                    title: data.title,
                    description: `by ${data.author_name}`,
                    url: videoUrl,
                    siteName: 'YouTube',
                    authorName: data.author_name,
                    authorUrl: data.author_url,
                    image: thumbnailUrl,
                    video: {
                        url: `https://www.youtube.com/embed/${parsed.videoId}`,
                        width: data.width || 1280,
                        height: data.height || 720,
                        thumbnail: thumbnailUrl,
                    },
                    color: platformColors.youtube,
                    platform: 'youtube',
                },
            };
        } catch (error) {
            console.error('YouTube handler error:', error);

            // Fallback: still provide basic embed even if oEmbed fails
            return {
                success: true,
                data: {
                    title: 'YouTube Video',
                    description: 'Watch on YouTube',
                    url: `https://www.youtube.com/watch?v=${parsed.videoId}`,
                    siteName: 'YouTube',
                    image: `https://i.ytimg.com/vi/${parsed.videoId}/maxresdefault.jpg`,
                    video: {
                        url: `https://www.youtube.com/embed/${parsed.videoId}`,
                        width: 1280,
                        height: 720,
                        thumbnail: `https://i.ytimg.com/vi/${parsed.videoId}/hqdefault.jpg`,
                    },
                    color: platformColors.youtube,
                    platform: 'youtube',
                },
            };
        }
    },
};
