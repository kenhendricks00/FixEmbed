/**
 * FixEmbed Service - Reddit Handler
 */

import { Env, HandlerResponse, PlatformHandler } from '../types';
import { parseRedditUrl, fetchJSON, truncateText } from '../utils/fetch';
import { platformColors, getBrandedSiteName, formatNumber } from '../utils/embed';

interface RedditPost {
    title: string;
    selftext: string;
    author: string;
    subreddit: string;
    url: string;
    permalink: string;
    thumbnail: string;
    preview?: {
        images: Array<{
            source: {
                url: string;
                width: number;
                height: number;
            };
        }>;
    };
    is_video: boolean;
    media?: {
        reddit_video?: {
            fallback_url: string;
            width: number;
            height: number;
            duration: number;
        };
    };
    secure_media?: {
        reddit_video?: {
            fallback_url: string;
            width: number;
            height: number;
            duration: number;
        };
    };
    created_utc: number;
    score: number;
    num_comments: number;
}

export const redditHandler: PlatformHandler = {
    name: 'reddit',
    patterns: [
        /reddit\.com\/r\/([^\/]+)\/comments\/([^\/]+)/i,
        /redd\.it\/([^\/\?]+)/i,
    ],

    async handle(url: string, env: Env): Promise<HandlerResponse> {
        const parsed = parseRedditUrl(url);

        if (!parsed) {
            // Try short URL format
            const shortMatch = url.match(/redd\.it\/([^\/\?]+)/i);
            if (!shortMatch) {
                return { success: false, error: 'Invalid Reddit URL' };
            }
            // Redirect short URLs
            return {
                success: false,
                redirect: `https://reddit.com/comments/${shortMatch[1]}`
            };
        }

        try {
            // Fetch post data using Reddit's JSON API
            const apiUrl = `https://www.reddit.com/r/${parsed.subreddit}/comments/${parsed.postId}.json`;

            const response = await fetchJSON<Array<{ data: { children: Array<{ data: RedditPost }> } }>>(apiUrl, {
                headers: {
                    'User-Agent': 'FixEmbed/1.0 (embed service)',
                },
            });

            if (!response || !response[0]?.data?.children?.[0]) {
                return { success: false, error: 'Post not found' };
            }

            const post = response[0].data.children[0].data;

            // Build description
            let description = post.selftext
                ? truncateText(post.selftext, 280)
                : post.title;

            // Add stats
            description += `\n\n⬆️ ${formatNumber(post.score)} 💬 ${formatNumber(post.num_comments)}`;

            // Check for media
            let image: string | undefined;
            let video: { url: string; width: number; height: number; thumbnail?: string } | undefined;

            // Video content
            const redditVideo = post.secure_media?.reddit_video || post.media?.reddit_video;
            if (post.is_video && redditVideo) {
                video = {
                    url: redditVideo.fallback_url,
                    width: redditVideo.width,
                    height: redditVideo.height,
                    thumbnail: post.thumbnail !== 'self' ? post.thumbnail : undefined,
                };
            }
            // Image content
            else if (post.preview?.images?.[0]) {
                const imageSource = post.preview.images[0].source;
                // Reddit HTML-encodes URLs in the API response
                image = imageSource.url.replace(/&amp;/g, '&');
            }
            // External image link
            else if (post.url.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
                image = post.url;
            }

            return {
                success: true,
                data: {
                    title: `r/${post.subreddit} • ${truncateText(post.title, 100)}`,
                    description,
                    url: `https://reddit.com${post.permalink}`,
                    siteName: getBrandedSiteName('reddit'),
                    authorName: `u/${post.author}`,
                    authorUrl: `https://reddit.com/u/${post.author}`,
                    image,
                    video,
                    color: platformColors.reddit,
                    platform: 'reddit',
                },
            };
        } catch (error) {
            console.error('Reddit handler error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch post',
                redirect: url,
            };
        }
    },
};
