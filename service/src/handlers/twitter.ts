/**
 * FixEmbed Service - Twitter/X Handler
 * Uses fxtwitter API for reliable video embeds
 */

import { Env, HandlerResponse, PlatformHandler } from '../types';
import { parseTwitterUrl, fetchJSON, truncateText } from '../utils/fetch';
import { platformColors } from '../utils/embed';

// FxTwitter API response structure
interface FxTwitterResponse {
    code: number;
    message: string;
    tweet?: {
        id: string;
        text: string;
        author: {
            name: string;
            screen_name: string;
            avatar_url: string;
        };
        created_at: string;
        replies: number;
        retweets: number;
        likes: number;
        media?: {
            photos?: Array<{
                url: string;
                width: number;
                height: number;
            }>;
            videos?: Array<{
                url: string;
                thumbnail_url: string;
                width: number;
                height: number;
                duration: number;
                type: string;
            }>;
            mosaic?: {
                formats: {
                    jpeg: string;
                    webp: string;
                };
            };
        };
    };
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
            // Use FxTwitter's API for better video support
            const apiUrl = `https://api.fxtwitter.com/status/${parsed.tweetId}`;

            const response = await fetchJSON<FxTwitterResponse>(apiUrl, {
                headers: {
                    'User-Agent': 'FixEmbed/1.0 (Discord Embed Service)',
                },
            });

            if (!response.tweet) {
                return { success: false, error: response.message || 'Tweet not found' };
            }

            const tweet = response.tweet;
            const author = tweet.author;

            // Build description with stats
            let description = truncateText(tweet.text, 280);
            description += `\n\n❤️ ${tweet.likes.toLocaleString()} • 🔁 ${tweet.retweets.toLocaleString()} • 💬 ${tweet.replies.toLocaleString()}`;

            // Check for media
            let image: string | undefined;
            let video: { url: string; width: number; height: number; thumbnail?: string } | undefined;

            if (tweet.media?.videos && tweet.media.videos.length > 0) {
                // Video content - use direct MP4 URL
                const firstVideo = tweet.media.videos[0];
                video = {
                    url: firstVideo.url,
                    width: firstVideo.width || 1280,
                    height: firstVideo.height || 720,
                    thumbnail: firstVideo.thumbnail_url,
                };
                // Also set image for fallback
                image = firstVideo.thumbnail_url;
            } else if (tweet.media?.photos && tweet.media.photos.length > 0) {
                // Photo content
                if (tweet.media.mosaic && tweet.media.photos.length > 1) {
                    // Multiple images - use mosaic
                    image = tweet.media.mosaic.formats.jpeg;
                } else {
                    image = tweet.media.photos[0].url;
                }
            }

            return {
                success: true,
                data: {
                    title: `${author.name} (@${author.screen_name})`,
                    description,
                    url: `https://twitter.com/${author.screen_name}/status/${parsed.tweetId}`,
                    siteName: 'Twitter',
                    authorName: author.name,
                    authorUrl: `https://twitter.com/${author.screen_name}`,
                    authorAvatar: author.avatar_url,
                    image,
                    video,
                    color: platformColors.twitter,
                    platform: 'twitter',
                },
            };
        } catch (error) {
            console.error('Twitter handler error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch tweet',
                redirect: `https://fxtwitter.com/${parsed.username}/status/${parsed.tweetId}`,
            };
        }
    },
};

