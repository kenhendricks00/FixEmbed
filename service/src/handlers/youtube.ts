/**
 * FixEmbed Service - YouTube Handler
 * 
 * Uses Invidious API to fetch video metadata AND direct stream URLs.
 * Based on koutube implementation (https://github.com/iGerman00/koutube)
 * 
 * Key features:
 * - Fetches from Invidious API instances for metadata
 * - Gets direct video stream URLs for inline playback
 * - Falls back to oEmbed if Invidious fails
 */

import { Env, HandlerResponse, PlatformHandler } from '../types';
import { parseYouTubeUrl, truncateText } from '../utils/fetch';
import { platformColors } from '../utils/embed';

// Invidious API instances
const INVIDIOUS_INSTANCES = [
    'https://invidious.io.lol',
    'https://iv.nboeck.de',
    'https://invidious.privacyredirect.com',
    'https://invidious.perennialte.ch',
];

function getRandomInstance(): string {
    return INVIDIOUS_INSTANCES[Math.floor(Math.random() * INVIDIOUS_INSTANCES.length)];
}

// Invidious video response types
interface FormatStream {
    url: string;
    itag: string;
    type: string;
    quality: string;
    container: string;
    qualityLabel: string;
    resolution: string;
}

interface InvidiousVideo {
    title: string;
    videoId: string;
    description: string;
    publishedText: string;
    viewCount: number;
    likeCount: number;
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
    formatStreams: FormatStream[];
    adaptiveFormats?: FormatStream[];
    liveNow?: boolean;
    error?: string;
}

interface YouTubeOEmbed {
    title: string;
    author_name: string;
    author_url: string;
    thumbnail_url: string;
}

// Format large numbers
function formatNumber(num: number): string {
    if (num >= 1_000_000) {
        return (num / 1_000_000).toFixed(1) + 'M';
    } else if (num >= 1_000) {
        return (num / 1_000).toFixed(1) + 'K';
    }
    return num.toLocaleString();
}

// Format duration
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

    async handle(url: string, env: Env): Promise<HandlerResponse> {
        const parsed = parseYouTubeUrl(url);

        if (!parsed) {
            return { success: false, error: 'Invalid YouTube URL' };
        }

        const videoId = parsed.videoId;
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        const embedDomain = (env as any).EMBED_DOMAIN || 'embed.ken.tools';

        // Try Invidious API for full video data
        for (let attempt = 0; attempt < 3; attempt++) {
            const instance = getRandomInstance();

            try {
                const apiUrl = `${instance}/api/v1/videos/${videoId}?fields=title,videoId,description,publishedText,viewCount,likeCount,author,authorId,authorUrl,lengthSeconds,videoThumbnails,formatStreams,liveNow`;
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

                if (data.error) {
                    console.log(`Invidious error: ${data.error}`);
                    continue;
                }

                // Get best thumbnail
                let thumbnail = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
                if (data.videoThumbnails && data.videoThumbnails.length > 0) {
                    const maxres = data.videoThumbnails.find(t => t.quality === 'maxres');
                    const hq = data.videoThumbnails.find(t => t.quality === 'high' || t.quality === 'hq720');
                    thumbnail = (maxres || hq || data.videoThumbnails[0]).url;
                }

                // Get best video stream (prefer 720p or 360p for compatibility)
                let videoStreamUrl: string | undefined;
                let videoWidth = 1280;
                let videoHeight = 720;

                if (data.formatStreams && data.formatStreams.length > 0 && !data.liveNow) {
                    // Prefer 720p (itag 22), then 360p (itag 18)
                    const hd = data.formatStreams.find(f => f.itag === '22');
                    const sd = data.formatStreams.find(f => f.itag === '18');
                    const stream = hd || sd || data.formatStreams[0];

                    if (stream && stream.url) {
                        // Proxy the video through our domain
                        videoStreamUrl = `https://${embedDomain}/proxy/youtube?url=${encodeURIComponent(stream.url)}`;

                        // Parse resolution
                        if (stream.resolution) {
                            const [w, h] = stream.resolution.split('x').map(Number);
                            if (w && h) {
                                videoWidth = w;
                                videoHeight = h;
                            }
                        }
                    }
                }

                // Build stats string
                const stats: string[] = [];
                stats.push(`👁️ ${formatNumber(data.viewCount)}`);
                if (data.likeCount) {
                    stats.push(`👍 ${formatNumber(data.likeCount)}`);
                }
                const statsStr = stats.join(' • ');

                // Format duration
                const duration = formatDuration(data.lengthSeconds);

                // Build description
                let description = data.description || '';
                if (description.length > 150) {
                    description = truncateText(description, 150);
                }
                description = description ? `${description}\n\n${statsStr}` : statsStr;

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
                        video: videoStreamUrl ? {
                            url: videoStreamUrl,
                            width: videoWidth,
                            height: videoHeight,
                            thumbnail,
                        } : undefined,
                        color: platformColors.youtube,
                        platform: 'youtube',
                    },
                };
            } catch (error) {
                console.error(`Invidious ${instance} error:`, error);
                continue;
            }
        }

        // Fallback: Use YouTube's oEmbed API
        console.log('All Invidious instances failed, falling back to oEmbed');
        try {
            const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(videoUrl)}&format=json`;
            const response = await fetch(oembedUrl);

            if (response.ok) {
                const data = await response.json() as YouTubeOEmbed;
                return {
                    success: true,
                    data: {
                        title: data.title,
                        description: `by ${data.author_name}`,
                        url: videoUrl,
                        siteName: 'YouTube',
                        authorName: data.author_name,
                        authorUrl: data.author_url,
                        image: data.thumbnail_url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
                        color: platformColors.youtube,
                        platform: 'youtube',
                    },
                };
            }
        } catch (error) {
            console.error('oEmbed fallback error:', error);
        }

        // Final fallback
        return {
            success: true,
            data: {
                title: 'YouTube Video',
                description: 'Watch on YouTube',
                url: videoUrl,
                siteName: 'YouTube',
                image: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
                color: platformColors.youtube,
                platform: 'youtube',
            },
        };
    },
};
