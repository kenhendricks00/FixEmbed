/**
 * FixEmbed Service - Twitter/X Handler
 * Uses Twitter's public Syndication API, with FxTwitter as an emergency fallback.
 */

import type { Env, HandlerOptions, HandlerResponse, PlatformHandler } from '../types.ts';
import { fetchWithTimeout, parseTwitterUrl, truncateText } from '../utils/fetch.ts';
import { formatStats, getBrandedSiteName, platformColors } from '../utils/embed.ts';
import {
    fetchTwitterGraphQL,
    normalizeTwitterPoll,
    type TwitterMedia as SyndicationMedia,
    type TwitterTweetData as SyndicationTweet,
} from './twitter_graphql.ts';

function fallbackResponse(username: string, tweetId: string, error: string): HandlerResponse {
    return {
        success: false,
        source: 'fallback',
        redirect: `https://fxtwitter.com/${username}/status/${tweetId}`,
        error,
    };
}

interface FxTwitterMedia {
    type?: string;
    url?: string;
    thumbnail_url?: string;
    width?: number;
    height?: number;
}

interface FxTwitterTweet {
    text?: string;
    author?: {
        name?: string;
        screen_name?: string;
        avatar_url?: string;
    };
    replies?: number;
    retweets?: number;
    likes?: number;
    views?: number;
    created_at?: string;
    media?: {
        all?: FxTwitterMedia[];
        photos?: FxTwitterMedia[];
        videos?: FxTwitterMedia[];
    };
}

function highResolutionTwitterAvatar(avatarUrl: string): string {
    try {
        const url = new URL(avatarUrl);
        if (url.hostname.toLowerCase() !== 'pbs.twimg.com') return avatarUrl;
        url.pathname = url.pathname.replace(
            /_(?:normal|bigger|mini|200x200|400x400)(?=\.[^/.]+$)/i,
            '',
        );
        return url.toString();
    } catch {
        return avatarUrl;
    }
}

async function fetchFxTwitterFallback(
    username: string,
    tweetId: string,
    options: HandlerOptions,
    firstPartyError: string,
): Promise<HandlerResponse> {
    try {
        const response = await fetchWithTimeout(
            `https://api.fxtwitter.com/${encodeURIComponent(username)}/status/${tweetId}`,
            { headers: { 'Accept': 'application/json', 'User-Agent': 'FixEmbed/1.4 (+https://fixembed.app)' } },
            5000,
        );
        if (!response.ok) return fallbackResponse(username, tweetId, firstPartyError);

        const body = await response.json() as { code?: number; tweet?: FxTwitterTweet | null };
        const tweet = body.tweet;
        const author = tweet?.author;
        if (body.code !== 200 || !tweet || !author?.screen_name || !author.name || !author.avatar_url) {
            return fallbackResponse(username, tweetId, firstPartyError);
        }

        const allMedia = tweet.media?.all || [];
        const photos = (tweet.media?.photos || allMedia.filter((item) => item.type === 'photo'))
            .map((item) => item.url)
            .filter((url): url is string => typeof url === 'string');
        const firstVideo = (tweet.media?.videos || allMedia.filter((item) => item.type === 'video'))[0];
        const canonicalUrl = `https://x.com/${author.screen_name}/status/${tweetId}`;
        const galleryMode = options.mode === 'gallery';
        let image: string | undefined;
        let images: string[] | undefined;
        if (photos.length === 1) [image] = photos;
        if (photos.length > 1) images = photos.slice(0, 4);

        return {
            success: true,
            source: 'fallback',
            data: {
                title: `@${author.screen_name}`,
                description: galleryMode ? '' : truncateText(tweet.text?.trim() || '', 3000),
                url: canonicalUrl,
                siteName: getBrandedSiteName('twitter'),
                authorName: author.name,
                authorHandle: `@${author.screen_name}`,
                authorUrl: `https://x.com/${author.screen_name}`,
                authorAvatar: highResolutionTwitterAvatar(author.avatar_url),
                image: image || firstVideo?.thumbnail_url,
                images,
                video: firstVideo?.url
                    ? {
                        url: firstVideo.url,
                        width: firstVideo.width || 1280,
                        height: firstVideo.height || 720,
                        thumbnail: firstVideo.thumbnail_url,
                    }
                    : undefined,
                color: platformColors.twitter,
                platform: 'twitter',
                timestamp: tweet.created_at,
                stats: galleryMode ? undefined : formatStats({
                    comments: Number(tweet.replies) || undefined,
                    retweets: Number(tweet.retweets) || undefined,
                    likes: Number(tweet.likes) || undefined,
                    views: Number(tweet.views) || undefined,
                }),
                sections: [],
                mode: options.mode,
            },
        };
    } catch {
        return fallbackResponse(username, tweetId, firstPartyError);
    }
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

    async handle(url: string, env: Env, options: HandlerOptions = {}): Promise<HandlerResponse> {
        const parsed = parseTwitterUrl(url);
        if (!parsed) {
            return { success: false, error: 'Invalid Twitter URL' };
        }

        try {
            let tweet = await fetchTwitterGraphQL(parsed.tweetId);
            if (!tweet) {
                const apiUrl = `https://cdn.syndication.twimg.com/tweet-result?id=${parsed.tweetId}&lang=en&token=0`;
                const response = await fetchWithTimeout(apiUrl, {
                    headers: {
                        'Accept': 'application/json',
                        'User-Agent': 'FixEmbed/1.4 (+https://fixembed.app)',
                    },
                }, 5000);
                if (!response.ok) {
                    return fetchFxTwitterFallback(
                        parsed.username,
                        parsed.tweetId,
                        options,
                        `Twitter API error: ${response.status}`,
                    );
                }
                tweet = await response.json() as SyndicationTweet;
                tweet.poll ||= normalizeTwitterPoll((tweet as unknown as { card?: unknown }).card);
            }
            if (!tweet?.user || tweet.__typename === 'TweetTombstone') {
                return fetchFxTwitterFallback(
                    parsed.username,
                    parsed.tweetId,
                    options,
                    'Tweet not found, private, or deleted',
                );
            }

            const handle = tweet.user.screen_name;
            let description = truncateText(
                tweet.text.replace(/https?:\/\/t\.co\/\w+/g, '').trim(),
                3000,
            );
            const targetLanguage = options.language?.toLowerCase();
            if (
                env.AI
                && tweet.lang
                && targetLanguage
                && /^[a-z]{2}$/.test(targetLanguage)
                && tweet.lang.toLowerCase() !== targetLanguage
                && description
            ) {
                try {
                    const translation = await env.AI.run('@cf/meta/m2m100-1.2b', {
                        text: description,
                        source_lang: tweet.lang.toLowerCase(),
                        target_lang: targetLanguage,
                    }) as { translated_text?: string };
                    if (translation.translated_text?.trim()) {
                        description = truncateText(
                            `${description}\n\n🌐 Translation (${targetLanguage.toUpperCase()}): ${translation.translated_text.trim()}`,
                            3000,
                        );
                    }
                } catch (error) {
                    console.error('Twitter translation failed:', error);
                }
            }
            const media = tweet.mediaDetails || tweet.extended_entities?.media || tweet.entities?.media || [];
            const photos = media
                .filter((item) => item.type === 'photo')
                .map((item) => item.media_url_https);
            const firstVideo = media.find((item) => item.type !== 'photo');
            let image: string | undefined;
            let images: string[] | undefined;
            let video: { url: string; width: number; height: number; thumbnail?: string } | undefined;

            if (photos.length === 1) {
                [image] = photos;
            } else if (photos.length > 1) {
                images = photos;
            }

            if (firstVideo) {
                const videoUrl = bestVideoUrl(firstVideo);
                if (videoUrl) {
                    const [widthRatio, heightRatio] = firstVideo.video_info?.aspect_ratio || [16, 9];
                    const width = 1280;
                    video = {
                        url: videoUrl,
                        width,
                        height: Math.round(width * (heightRatio / widthRatio)),
                        thumbnail: firstVideo.media_url_https,
                    };
                    image ||= firstVideo.media_url_https;
                }
            }

            const sections = [] as NonNullable<HandlerResponse['data']>['sections'];
            if (tweet.poll) {
                const choices = tweet.poll.choices.map((choice) => {
                    const bar = '█'.repeat(Math.max(1, Math.round(choice.percentage / 10)));
                    return `${bar} ${choice.label} — ${choice.percentage}% (${choice.count})`;
                });
                const state = tweet.poll.final ? 'Final results' : `Ends ${tweet.poll.endsAt || 'soon'}`;
                sections?.push({
                    kind: 'poll',
                    title: 'Poll',
                    body: `${choices.join('\n')}\n${tweet.poll.totalVotes} votes · ${state}`,
                });
            }
            if (tweet.quote) {
                if (tweet.quote.user && tweet.quote.text) {
                    sections?.push({
                        kind: 'quote',
                        title: `Quoted @${tweet.quote.user.screen_name}`,
                        body: tweet.quote.text,
                    });
                    if (!media.length && tweet.quote.mediaDetails?.length) {
                        const quotePhotos = tweet.quote.mediaDetails
                            .filter((item) => item.type === 'photo')
                            .map((item) => item.media_url_https);
                        if (quotePhotos.length === 1) [image] = quotePhotos;
                        if (quotePhotos.length > 1) images = quotePhotos;
                    }
                } else {
                    sections?.push({
                        kind: 'tombstone',
                        title: 'Quoted post unavailable',
                        body: tweet.quote.unavailableReason || 'This quoted post is unavailable.',
                    });
                }
            }
            if (tweet.communityNote) {
                sections?.push({
                    kind: 'community-note',
                    title: 'Community Note',
                    body: tweet.communityNote.text,
                    url: tweet.communityNote.url,
                });
            }
            if (tweet.article) {
                sections?.push({
                    kind: 'article',
                    title: tweet.article.title,
                    body: tweet.article.preview || 'Read the full article on X.',
                });
                if (!image && !images && !video && tweet.article.image) image = tweet.article.image;
            }
            if (tweet.linkCard) {
                sections?.push({
                    kind: 'link-card',
                    title: tweet.linkCard.title,
                    body: tweet.linkCard.description || tweet.linkCard.domain || 'Open link',
                    url: tweet.linkCard.url,
                });
                if (!image && !images && !video && tweet.linkCard.image) image = tweet.linkCard.image;
            }

            return {
                success: true,
                source: 'first-party',
                data: {
                    title: `@${handle}`,
                    description: options.mode === 'gallery' ? '' : description,
                    url: `https://x.com/${handle}/status/${parsed.tweetId}`,
                    siteName: getBrandedSiteName('twitter'),
                    authorName: tweet.user.name,
                    authorHandle: `@${handle}`,
                    authorUrl: `https://x.com/${handle}`,
                    authorAvatar: highResolutionTwitterAvatar(tweet.user.profile_image_url_https),
                    image,
                    images,
                    video,
                    color: platformColors.twitter,
                    platform: 'twitter',
                    timestamp: tweet.created_at,
                    stats: options.mode === 'gallery' ? undefined : formatStats({
                        comments: tweet.conversation_count,
                        retweets: tweet.retweet_count,
                        likes: tweet.favorite_count,
                        views: Number(tweet.video?.viewCount || tweet.view_count_info?.count) || undefined,
                    }),
                    sections: options.mode === 'gallery' ? [] : sections,
                    mode: options.mode,
                },
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to fetch tweet';
            return fetchFxTwitterFallback(parsed.username, parsed.tweetId, options, message);
        }
    },
};
