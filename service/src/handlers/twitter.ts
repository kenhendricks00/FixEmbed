/**
 * FixEmbed Service - Twitter/X Handler
 * Uses Twitter's public Syndication API, with FxTwitter as an emergency fallback.
 */

import type { Env, HandlerResponse, PlatformHandler } from '../types.ts';
import { fetchWithTimeout, parseTwitterUrl, truncateText } from '../utils/fetch.ts';
import { formatStats, getBrandedSiteName, platformColors } from '../utils/embed.ts';

interface SyndicationMedia {
    type: 'photo' | 'video' | 'animated_gif';
    media_url_https: string;
    video_info?: {
        aspect_ratio?: [number, number];
        variants: Array<{
            bitrate?: number;
            content_type: string;
            url: string;
        }>;
    };
}

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
    video?: { viewCount: string };
    entities?: { media?: SyndicationMedia[] };
    extended_entities?: { media?: SyndicationMedia[] };
    mediaDetails?: SyndicationMedia[];
}

function fallbackResponse(username: string, tweetId: string, error: string): HandlerResponse {
    return {
        success: false,
        source: 'fallback',
        redirect: `https://fxtwitter.com/${username}/status/${tweetId}`,
        error,
    };
}

function bestVideoUrl(media: SyndicationMedia): string | null {
    const variants = (media.video_info?.variants || [])
        .filter((variant) => variant.content_type === 'video/mp4')
        .sort((left, right) => (right.bitrate || 0) - (left.bitrate || 0));
    return variants[0]?.url || null;
}

export const twitterHandler: PlatformHandler = {
    name: 'twitter',
    patterns: [
        /(?:twitter\.com|x\.com)\/([^\/]+)\/status\/(\d+)/i,
    ],

    async handle(url: string, _env: Env): Promise<HandlerResponse> {
        const parsed = parseTwitterUrl(url);
        if (!parsed) {
            return { success: false, error: 'Invalid Twitter URL' };
        }

        try {
            const apiUrl = `https://cdn.syndication.twimg.com/tweet-result?id=${parsed.tweetId}&lang=en&token=0`;
            const response = await fetchWithTimeout(apiUrl, {
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'FixEmbed/1.3 (+https://fixembed.app)',
                },
            }, 5000);

            if (!response.ok) {
                return fallbackResponse(parsed.username, parsed.tweetId, `Twitter API error: ${response.status}`);
            }

            const tweet = await response.json() as SyndicationTweet;
            if (!tweet?.user || tweet.__typename === 'TweetTombstone') {
                return fallbackResponse(parsed.username, parsed.tweetId, 'Tweet not found, private, or deleted');
            }

            const handle = tweet.user.screen_name;
            const description = truncateText(
                tweet.text.replace(/https?:\/\/t\.co\/\w+/g, '').trim(),
                1000,
            );
            const media = tweet.mediaDetails || tweet.extended_entities?.media || tweet.entities?.media || [];
            const firstMedia = media[0];
            let image: string | undefined;
            let video: { url: string; width: number; height: number; thumbnail?: string } | undefined;

            if (firstMedia?.type === 'photo') {
                image = firstMedia.media_url_https;
            } else if (firstMedia) {
                const videoUrl = bestVideoUrl(firstMedia);
                if (videoUrl) {
                    const [widthRatio, heightRatio] = firstMedia.video_info?.aspect_ratio || [16, 9];
                    const width = 1280;
                    video = {
                        url: videoUrl,
                        width,
                        height: Math.round(width * (heightRatio / widthRatio)),
                        thumbnail: firstMedia.media_url_https,
                    };
                    image = firstMedia.media_url_https;
                }
            }

            return {
                success: true,
                source: 'first-party',
                data: {
                    title: `@${handle}`,
                    description,
                    url: `https://x.com/${handle}/status/${parsed.tweetId}`,
                    siteName: getBrandedSiteName('twitter'),
                    authorName: tweet.user.name,
                    authorHandle: `@${handle}`,
                    authorUrl: `https://x.com/${handle}`,
                    authorAvatar: tweet.user.profile_image_url_https,
                    image,
                    video,
                    color: platformColors.twitter,
                    platform: 'twitter',
                    timestamp: tweet.created_at,
                    stats: formatStats({
                        comments: tweet.conversation_count,
                        retweets: (tweet.retweet_count || 0) + (tweet.quote_count || 0),
                        likes: tweet.favorite_count,
                        views: Number(tweet.video?.viewCount || tweet.view_count_info?.count) || undefined,
                    }),
                },
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to fetch tweet';
            return fallbackResponse(parsed.username, parsed.tweetId, message);
        }
    },
};
