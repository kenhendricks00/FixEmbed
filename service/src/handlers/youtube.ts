/**
 * FixEmbed Service - YouTube Handler
 * 
 * Uses YouTube's official oEmbed endpoint first, then Invidious for richer
 * metadata and direct stream URLs when the official response is unavailable.
 * Based on koutube implementation (https://github.com/iGerman00/koutube)
 * 
 * Key features:
 * - Fetches from Invidious API instances for metadata
 * - Gets direct video stream URLs for inline playback
 * - Falls back to oEmbed if Invidious fails
 */

import type { EmbedData, Env, HandlerResponse, PlatformHandler } from '../types.ts';
import { decodeHtmlEntities, parseYouTubeUrl, truncateText } from '../utils/fetch.ts';
import { getBrandedSiteName, platformColors } from '../utils/embed.ts';

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

interface TextRuns {
    runs?: Array<{ text?: string }>;
    simpleText?: string;
}

interface CommunityPostRenderer {
    authorText?: TextRuns;
    authorEndpoint?: { browseEndpoint?: { canonicalBaseUrl?: string } };
    authorThumbnail?: { thumbnails?: Array<{ url?: string; width?: number; height?: number }> };
    contentText?: TextRuns;
    voteCount?: TextRuns;
    replyCount?: TextRuns;
    backstageAttachment?: {
        backstageImageRenderer?: {
            image?: { thumbnails?: Array<{ url?: string; width?: number; height?: number }> };
        };
    };
}

function textFromRuns(value?: TextRuns): string {
    if (value?.simpleText) return value.simpleText;
    return value?.runs?.map((run) => run.text || '').join('').trim() || '';
}

function extractJsonObjectAfterMarker(html: string, marker: string): string | null {
    const markerIndex = html.indexOf(marker);
    if (markerIndex < 0) return null;
    const start = html.indexOf('{', markerIndex + marker.length);
    if (start < 0) return null;

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < html.length; index++) {
        const character = html[index];
        if (inString) {
            if (escaped) escaped = false;
            else if (character === '\\') escaped = true;
            else if (character === '"') inString = false;
            continue;
        }
        if (character === '"') inString = true;
        else if (character === '{') depth++;
        else if (character === '}' && --depth === 0) return html.slice(start, index + 1);
    }
    return null;
}

function metadataContent(html: string, key: string): string {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
        new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${escapedKey}["'][^>]+content=["']([^"']*)["']`, 'i'),
        new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name|itemprop)=["']${escapedKey}["']`, 'i'),
    ];
    for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match) return decodeHtmlEntities(match[1]);
    }
    return '';
}

export function parseYouTubeCommunityPostHtml(html: string, canonicalUrl: string): EmbedData | null {
    let renderer: CommunityPostRenderer | null = null;
    const rendererJson = extractJsonObjectAfterMarker(html, '"backstagePostRenderer":');
    if (rendererJson) {
        try {
            renderer = JSON.parse(rendererJson) as CommunityPostRenderer;
        } catch {
            renderer = null;
        }
    }

    const description = textFromRuns(renderer?.contentText) || metadataContent(html, 'og:description');
    const openGraphTitle = metadataContent(html, 'og:title');
    const authorName = textFromRuns(renderer?.authorText)
        || metadataContent(html, 'author')
        || openGraphTitle.replace(/^Post from\s+/i, '');
    const authorPath = renderer?.authorEndpoint?.browseEndpoint?.canonicalBaseUrl;
    const images = renderer?.backstageAttachment?.backstageImageRenderer?.image?.thumbnails || [];
    const image = [...images]
        .sort((left, right) => (right.width || 0) * (right.height || 0) - (left.width || 0) * (left.height || 0))[0]?.url
        || metadataContent(html, 'og:image');
    const rawAvatar = renderer?.authorThumbnail?.thumbnails?.at(-1)?.url;
    const avatar = rawAvatar?.startsWith('//') ? `https:${rawAvatar}` : rawAvatar;
    const likes = textFromRuns(renderer?.voteCount);
    const replies = textFromRuns(renderer?.replyCount);
    const stats = [likes && `👍 ${likes}`, replies && `💬 ${replies}`].filter(Boolean).join('  ');

    if (!description && !image) return null;
    return {
        title: 'Community post',
        description: truncateText(description, 2500),
        url: canonicalUrl,
        siteName: getBrandedSiteName('youtube'),
        authorName: authorName || undefined,
        authorUrl: authorPath ? `https://www.youtube.com${authorPath}` : undefined,
        authorAvatar: avatar,
        image: image || undefined,
        color: platformColors.youtube,
        platform: 'youtube',
        stats: stats || undefined,
    };
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
        /youtube\.com\/post\/([^?]+)/i,
    ],

    async handle(url: string, env: Env): Promise<HandlerResponse> {
        const communityPostMatch = url.match(/youtube\.com\/post\/([^?&#/]+)/i);
        if (communityPostMatch) {
            const canonicalUrl = `https://www.youtube.com/post/${communityPostMatch[1]}`;
            const officialUrls = [
                canonicalUrl,
                `https://m.youtube.com/post/${communityPostMatch[1]}`,
            ];
            for (const officialUrl of officialUrls) {
                try {
                    const response = await fetch(officialUrl, {
                        headers: {
                            'Accept': 'text/html,application/xhtml+xml',
                            'Accept-Language': 'en-US,en;q=0.9',
                            'User-Agent': 'Mozilla/5.0 (compatible; FixEmbed/1.0; +https://fixembed.app)',
                        },
                    });
                    if (response.status < 500) {
                        const html = (await response.text()).slice(0, 5_000_000);
                        const data = parseYouTubeCommunityPostHtml(html, canonicalUrl);
                        if (data) return { success: true, source: 'first-party', data };
                    }
                } catch (error) {
                    console.warn(`YouTube community post request failed for ${officialUrl}:`, error);
                }
            }
            return { success: false, redirect: canonicalUrl, error: 'Community post metadata unavailable' };
        }

        const parsed = parseYouTubeUrl(url);

        if (!parsed) {
            return { success: false, error: 'Invalid YouTube URL' };
        }

        const videoId = parsed.videoId;
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        const embedDomain = env.EMBED_DOMAIN || 'fixembed.app';

        // First-party FixEmbed path: fetch metadata directly from YouTube and
        // render the card ourselves. External frontends are fallbacks only.
        try {
            const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(videoUrl)}&format=json`;
            const response = await fetch(oembedUrl, { headers: { 'Accept': 'application/json' } });
            if (response.ok) {
                const data = await response.json() as YouTubeOEmbed;
                return {
                    success: true,
                    source: 'first-party',
                    data: {
                        title: data.title,
                        description: `by ${data.author_name}`,
                        url: videoUrl,
                        siteName: getBrandedSiteName('youtube'),
                        authorName: data.author_name,
                        authorUrl: data.author_url,
                        image: data.thumbnail_url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
                        color: platformColors.youtube,
                        platform: 'youtube',
                    },
                };
            }
        } catch (error) {
            console.warn('YouTube official oEmbed request failed:', error);
        }

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
                    source: 'fallback',
                    data: {
                        title: data.title,
                        description,
                        url: videoUrl,
                        siteName: getBrandedSiteName('youtube', duration),
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
                    source: 'first-party',
                    data: {
                        title: data.title,
                        description: `by ${data.author_name}`,
                        url: videoUrl,
                        siteName: getBrandedSiteName('youtube'),
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
            source: 'first-party',
            data: {
                title: 'YouTube Video',
                description: 'Watch on YouTube',
                url: videoUrl,
                siteName: getBrandedSiteName('youtube'),
                image: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
                color: platformColors.youtube,
                platform: 'youtube',
            },
        };
    },
};
