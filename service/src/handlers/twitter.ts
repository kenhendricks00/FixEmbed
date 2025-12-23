/**
 * FixEmbed Service - Twitter/X Handler
 */

import { Env, HandlerResponse, PlatformHandler } from '../types';
import { parseTwitterUrl, fetchJSON, truncateText, getBestVideoUrl } from '../utils/fetch';
import { platformColors } from '../utils/embed';

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
    entities?: {
        media?: Array<{
            type: string;
            media_url_https: string;
            video_info?: {
                variants: Array<{
                    bitrate?: number;
                    content_type: string;
                    url: string;
                }>;
            };
        }>;
    };
    extended_entities?: {
        media?: Array<{
            type: string;
            media_url_https: string;
            video_info?: {
                variants: Array<{
                    bitrate?: number;
                    content_type: string;
                    url: string;
                }>;
            };
        }>;
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
            // Use Twitter's syndication API (public, no auth needed)
            const apiUrl = `https://cdn.syndication.twimg.com/tweet-result?id=${parsed.tweetId}&lang=en&token=0`;

            const tweet = await fetchJSON<SyndicationTweet>(apiUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; FixEmbed/1.0)',
                },
            });

            if (!tweet || tweet.__typename === 'TweetTombstone') {
                return { success: false, error: 'Tweet not found or deleted' };
            }

            // Build embed data
            const authorName = tweet.user.name;
            const authorHandle = tweet.user.screen_name;
            const text = truncateText(tweet.text, 300);

            // Check for media
            const media = tweet.extended_entities?.media || tweet.entities?.media;
            let image: string | undefined;
            let video: { url: string; width: number; height: number; thumbnail?: string } | undefined;

            if (media && media.length > 0) {
                const firstMedia = media[0];

                if (firstMedia.type === 'video' || firstMedia.type === 'animated_gif') {
                    // Get best quality video
                    const variants = firstMedia.video_info?.variants || [];
                    const videoUrl = getBestVideoUrl(variants.map(v => ({
                        bit_rate: v.bitrate,
                        content_type: v.content_type,
                        url: v.url,
                    })));

                    if (videoUrl) {
                        video = {
                            url: videoUrl,
                            width: 1280,
                            height: 720,
                            thumbnail: firstMedia.media_url_https,
                        };
                    }
                } else {
                    image = firstMedia.media_url_https;
                }
            }

            return {
                success: true,
                data: {
                    title: `${authorName} (@${authorHandle})`,
                    description: text,
                    url: `https://twitter.com/${authorHandle}/status/${parsed.tweetId}`,
                    siteName: 'Twitter',
                    authorName: authorName,
                    authorUrl: `https://twitter.com/${authorHandle}`,
                    authorAvatar: tweet.user.profile_image_url_https,
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
                redirect: `https://twitter.com/${parsed.username}/status/${parsed.tweetId}`,
            };
        }
    },
};
