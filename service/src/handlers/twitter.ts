/**
 * FixEmbed Service - Twitter/X Handler
 * Uses Twitter's Syndication API (no third-party dependencies)
 */

import { Env, HandlerResponse, PlatformHandler } from '../types';
import { parseTwitterUrl, truncateText } from '../utils/fetch';
import { platformColors, getBrandedSiteName, formatStats } from '../utils/embed';

interface SyndicationTweet {
    __typename: string;
    id_str: string;
    text: string;
    user: {
        name: string;
        screen_name: string;
        profile_image_url_https: string;
    };
    created_at: string;
    favorite_count?: number;
    retweet_count?: number;
    quote_count?: number;
    conversation_count?: number;
    view_count_info?: { count: string };
    entities?: {
        media?: Array<{
            type: string;
            media_url_https: string;
            sizes?: {
                large?: { w: number; h: number };
            };
            video_info?: {
                variants: Array<{
                    bitrate?: number;
                    content_type: string;
                    url: string;
                }>;
                aspect_ratio?: [number, number];
            };
        }>;
    };
    extended_entities?: {
        media?: Array<{
            type: string;
            media_url_https: string;
            sizes?: {
                large?: { w: number; h: number };
            };
            video_info?: {
                variants: Array<{
                    bitrate?: number;
                    content_type: string;
                    url: string;
                }>;
                aspect_ratio?: [number, number];
            };
        }>;
    };
    mediaDetails?: Array<{
        type: string;
        media_url_https: string;
        video_info?: {
            variants: Array<{
                bitrate?: number;
                content_type: string;
                url: string;
            }>;
            aspect_ratio?: [number, number];
        };
    }>;
}

/**
 * Get the best quality MP4 video URL from variants
 */
function getBestVideoUrl(variants: Array<{ bitrate?: number; content_type: string; url: string }>): string | null {
    // Filter for MP4 videos and sort by bitrate (highest first)
    const mp4Videos = variants
        .filter(v => v.content_type === 'video/mp4' && v.bitrate !== undefined)
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

    return mp4Videos.length > 0 ? mp4Videos[0].url : null;
}

export const twitterHandler: PlatformHandler = {
    name: 'twitter',
    patterns: [
        /(?:twitter\.com|x\.com)\/([^\/]+)\/status\/(\d+)/i,
    ],

    async handle(url: string, env: Env): Promise<HandlerResponse> {
        const parsed = parseTwitterUrl(url);

        if (!parsed) {
            return { success: false, error: 'Invalid Twitter URL' };
        }

        try {
            // Use Twitter's Syndication API (public, no auth needed)
            const apiUrl = `https://cdn.syndication.twimg.com/tweet-result?id=${parsed.tweetId}&lang=en&token=0`;

            const response = await fetch(apiUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'application/json',
                },
            });

            if (!response.ok) {
                return { success: false, error: `Twitter API error: ${response.status}` };
            }

            const tweet = await response.json() as SyndicationTweet;

            if (!tweet || tweet.__typename === 'TweetTombstone') {
                return { success: false, error: 'Tweet not found or deleted' };
            }

            // Build embed data
            const authorName = tweet.user.name;
            const authorHandle = tweet.user.screen_name;

            // description should only be the text
            const description = truncateText(tweet.text, 500);

            // Build stats for oEmbed/ActivityPub row
            const stats = formatStats({
                comments: tweet.conversation_count,
                retweets: (tweet.retweet_count || 0) + (tweet.quote_count || 0),
                likes: tweet.favorite_count,
                views: tweet.view_count_info?.count ? parseInt(tweet.view_count_info.count) : undefined,
            });

            // Check for media - try multiple sources
            const media = tweet.mediaDetails || tweet.extended_entities?.media || tweet.entities?.media;
            let image: string | undefined;
            let video: { url: string; width: number; height: number; thumbnail?: string } | undefined;

            if (media && media.length > 0) {
                const firstMedia = media[0];

                if (firstMedia.type === 'video' || firstMedia.type === 'animated_gif') {
                    // Get best quality video
                    const variants = firstMedia.video_info?.variants || [];
                    const videoUrl = getBestVideoUrl(variants);

                    if (videoUrl) {
                        // Calculate dimensions from aspect ratio
                        const aspectRatio = firstMedia.video_info?.aspect_ratio || [16, 9];
                        const width = 1280;
                        const height = Math.round(width * (aspectRatio[1] / aspectRatio[0]));

                        video = {
                            url: videoUrl,
                            width,
                            height,
                            thumbnail: firstMedia.media_url_https,
                        };
                        // Also set image as fallback for clients that don't support video
                        image = firstMedia.media_url_https;
                    }
                } else if (firstMedia.type === 'photo') {
                    image = firstMedia.media_url_https;
                }
            }

            return {
                success: true,
                data: {
                    title: `${authorName} (@${authorHandle})`,
                    description,
                    url: `https://twitter.com/${authorHandle}/status/${parsed.tweetId}`,
                    siteName: getBrandedSiteName('twitter'),
                    authorName: authorName,
                    authorHandle: `@${authorHandle}`,
                    authorUrl: `https://twitter.com/${authorHandle}`,
                    authorAvatar: tweet.user.profile_image_url_https,
                    image,
                    video,
                    color: platformColors.twitter,
                    platform: 'twitter',
                    stats,
                },
            };
        } catch (error) {
            console.error('Twitter handler error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch tweet',
                redirect: `https://twitter.com/${parsed.username}/status/${parsed.tweetId}`,
            };
        }
    },
};
