/**
 * FixEmbed Service - YouTube Handler
 * 
 * Uses Invidious API instances to fetch YouTube video metadata.
 * Based on koutube implementation (https://github.com/iGerman00/koutube)
 * 
 * Key features:
 * - Fetches from Invidious API instances (rotates for reliability)
 * - Gets title, description, views, likes, author info
 * - High quality thumbnails
 */

import { Env, HandlerResponse, PlatformHandler } from '../types';
import { parseYouTubeUrl, truncateText } from '../utils/fetch';
import { platformColors } from '../utils/embed';

// Invidious API instances (from koutube)
const INVIDIOUS_INSTANCES = [
    'https://invidious.io.lol',
    'https://iv.nboeck.de',
    'https://invidious.einfachzocken.eu',
];

function getRandomInstance(): string {
    return INVIDIOUS_INSTANCES[Math.floor(Math.random() * INVIDIOUS_INSTANCES.length)];
}

// Invidious video response type
interface InvidiousVideo {
    title: string;
    videoId: string;
    description: string;
    descriptionHtml: string;
    published: number;
    publishedText: string;
    viewCount: number;
    likeCount: number;
    dislikeCount: number;
    author: string;
    authorId: string;
    authorUrl: string;
    lengthSeconds: number;
    videoThumbnails: Array<{
        quality: string;
        url: string;
        width: number;
        height: number;
    }>;
}

// Format large numbers with K/M suffix
function formatNumber(num: number): string {
    if (num >= 1_000_000) {
        return (num / 1_000_000).toFixed(1) + 'M';
    } else if (num >= 1_000) {
        return (num / 1_000).toFixed(1) + 'K';
    }
    return num.toLocaleString();
}

// Format duration from seconds to MM:SS or HH:MM:SS
function formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
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

        // Try Invidious API instances
        for (let attempt = 0; attempt < 3; attempt++) {
            const instance = getRandomInstance();

            try {
                const apiUrl = `${instance}/api/v1/videos/${videoId}`;
                const response = await fetch(apiUrl, {
                    headers: {
                        'Accept': 'application/json',
                    },
                });

                if (!response.ok) {
                    console.log(`Invidious ${instance} returned ${response.status}`);
                    continue;
                }

                const data = await response.json() as InvidiousVideo;

                // Get best thumbnail (prefer maxres, fallback to lower quality)
                let thumbnail = `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;
                if (data.videoThumbnails && data.videoThumbnails.length > 0) {
                    // Find maxres or highest quality
                    const maxres = data.videoThumbnails.find(t => t.quality === 'maxres');
                    const hq = data.videoThumbnails.find(t => t.quality === 'hq720');
                    const sd = data.videoThumbnails.find(t => t.quality === 'sddefault');
                    thumbnail = (maxres || hq || sd || data.videoThumbnails[0]).url;
                }

                // Build stats string
                const stats: string[] = [];
                stats.push(`👁️ ${formatNumber(data.viewCount)}`);
                if (data.likeCount) {
                    stats.push(`👍 ${formatNumber(data.likeCount)}`);
                }
                const statsStr = stats.join(' • ');

                // Build description
                let description = data.description || '';
                if (description.length > 200) {
                    description = truncateText(description, 200);
                }
                description = `${description}\n\n${statsStr}`;

                // Format duration
                const duration = formatDuration(data.lengthSeconds);

                return {
                    success: true,
                    data: {
                        title: data.title,
                        description,
                        url: videoUrl,
                        siteName: `YouTube • ${duration}`,
                        authorName: data.author,
                        authorUrl: `https://www.youtube.com${data.authorUrl}`,
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
                console.error(`Invidious ${instance} error:`, error);
                continue;
            }
        }

        // Fallback: Use YouTube's direct thumbnail
        console.log('All Invidious instances failed, using fallback');
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
    },
};
