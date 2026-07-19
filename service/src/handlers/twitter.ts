/**
 * FixEmbed Service - Twitter/X Handler
 * Uses Twitter's public Syndication API, with FxTwitter as an emergency fallback.
 */

import type {
    EmbedSection,
    Env,
    HandlerOptions,
    HandlerResponse,
    PlatformHandler,
    VideoEmbed,
    XVerificationBadge,
} from '../types.ts';
import { fetchWithTimeout, parseTwitterUrl, truncateText } from '../utils/fetch.ts';
import { formatStats, getBrandedSiteName, platformColors } from '../utils/embed.ts';
import { languageName } from '../utils/translation.ts';
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

interface FxTwitterPoll {
    choices?: Array<{ label?: string; count?: number; percentage?: number }>;
    total_votes?: number;
    ends_at?: string;
    time_left_en?: string;
}

interface FxTwitterTweet {
    id?: string;
    url?: string;
    text?: string;
    author?: {
        name?: string;
        screen_name?: string;
        avatar_url?: string;
        verification?: {
            verified?: boolean;
            type?: string;
        };
    };
    replies?: number;
    retweets?: number;
    likes?: number;
    views?: number;
    created_at?: string;
    translation?: {
        text?: string;
        source_lang?: string;
        target_lang?: string;
        provider?: string;
    };
    poll?: FxTwitterPoll;
    quote?: FxTwitterTweet;
    possibly_sensitive?: boolean;
    media?: {
        all?: FxTwitterMedia[];
        photos?: FxTwitterMedia[];
        videos?: FxTwitterMedia[];
        external?: FxTwitterMedia;
    };
}

function requestedTranslationLanguage(options: HandlerOptions): string | undefined {
    const language = options.language?.trim().toLowerCase();
    return language && /^[a-z]{2}$/.test(language) ? language : undefined;
}

async function fetchFxTwitterTweet(
    username: string,
    tweetId: string,
    language?: string,
): Promise<FxTwitterTweet | undefined> {
    const translationPath = language ? `/${language}` : '';
    const url = `https://api.fxtwitter.com/${encodeURIComponent(username)}/status/${tweetId}${translationPath}`;
    try {
        const response = await fetchWithTimeout(
            url,
            {
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'FixEmbed/1.4 (+https://fixembed.app)',
                },
            },
            5000,
        );
        if (!response.ok) return undefined;
        const body = await response.json() as { code?: number; tweet?: FxTwitterTweet | null };
        return body.code === 200 && body.tweet ? body.tweet : undefined;
    } catch {
        return undefined;
    }
}

function fxTranslation(
    tweet: FxTwitterTweet | undefined,
    requestedLanguage: string,
): { text: string; sourceLanguage: string; targetLanguage: string } | undefined {
    const text = tweet?.translation?.text?.trim();
    const sourceLanguage = tweet?.translation?.source_lang?.trim().toLowerCase();
    const targetLanguage = tweet?.translation?.target_lang?.trim().toLowerCase();
    if (
        !text
        || !sourceLanguage
        || targetLanguage !== requestedLanguage
        || sourceLanguage === targetLanguage
    ) {
        return undefined;
    }
    return { text, sourceLanguage, targetLanguage };
}

type TwitterVerificationUser = {
    verified?: boolean;
    is_blue_verified?: boolean;
    verified_type?: string;
    verification?: {
        verified?: boolean;
        type?: string;
    };
};

function twitterVerificationBadge(user?: TwitterVerificationUser): XVerificationBadge | undefined {
    const type = String(user?.verified_type ?? user?.verification?.type ?? '').toLowerCase();
    if (type === 'government') return 'government';
    if (type === 'business' || type === 'organization') return 'organization';
    if (
        type === 'individual'
        || type === 'blue'
        || type === 'premium'
        || user?.is_blue_verified === true
        || user?.verified === true
        || user?.verification?.verified === true
    ) {
        return 'premium';
    }
    return undefined;
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

function animatedGifUrl(mediaUrl: string): string {
    try {
        const url = new URL(mediaUrl);
        if (
            url.protocol !== 'https:'
            || url.hostname.toLowerCase() !== 'video.twimg.com'
            || !/^\/tweet_video\/[^/]+\.mp4$/i.test(url.pathname)
        ) {
            return mediaUrl;
        }
        return `https://gif.fxtwitter.com${url.pathname.replace(/\.mp4$/i, '.gif')}`;
    } catch {
        return mediaUrl;
    }
}

function fxTwitterMedia(tweet: FxTwitterTweet): {
    image?: string;
    images?: string[];
    video?: VideoEmbed;
} {
    const allMedia = tweet.media?.all || [];
    const photos = (tweet.media?.photos || allMedia.filter((item) => item.type === 'photo'))
        .map((item) => item.url)
        .filter((url): url is string => typeof url === 'string' && Boolean(url));
    const firstVideo = (
        tweet.media?.videos
        || allMedia.filter((item) => ['video', 'gif', 'animated_gif'].includes(item.type || ''))
    )[0] || tweet.media?.external;
    const isGif = ['gif', 'animated_gif'].includes(firstVideo?.type || '');
    const video = firstVideo?.url
        ? {
            url: isGif ? animatedGifUrl(firstVideo.url) : firstVideo.url,
            width: firstVideo.width || 1280,
            height: firstVideo.height || 720,
            thumbnail: firstVideo.thumbnail_url,
            mediaType: isGif ? 'gif' as const : 'video' as const,
        }
        : undefined;

    return {
        image: photos.length === 1 && !video ? photos[0] : undefined,
        images: photos.length > 1 || (photos.length === 1 && video) ? photos.slice(0, 4) : undefined,
        video,
    };
}

function fxTwitterQuoteSection(tweet: FxTwitterTweet): EmbedSection | undefined {
    const quote = tweet.quote;
    const author = quote?.author;
    if (!quote || !author?.screen_name || !author.name) return undefined;
    const quoteMedia = fxTwitterMedia(quote);
    const quoteUrl = quote.url || (quote.id
        ? `https://x.com/${author.screen_name}/status/${quote.id}`
        : `https://x.com/${author.screen_name}`);
    return {
        kind: 'quote',
        title: 'Quoted post',
        body: truncateText(
            quote.translation?.text?.trim()
            || quote.text?.replace(/https?:\/\/t\.co\/\w+/g, '').trim()
            || '',
            900,
        ),
        url: quoteUrl,
        authorName: author.name,
        authorHandle: `@${author.screen_name}`,
        authorUrl: `https://x.com/${author.screen_name}`,
        authorAvatar: author.avatar_url ? highResolutionTwitterAvatar(author.avatar_url) : undefined,
        authorVerification: twitterVerificationBadge(author),
        images: quoteMedia.images || (quoteMedia.image ? [quoteMedia.image] : undefined),
        video: quoteMedia.video,
    };
}

function fxTwitterPollSection(poll?: FxTwitterPoll): EmbedSection | undefined {
    const choices = (poll?.choices || []).filter((choice) => typeof choice.label === 'string');
    if (choices.length < 2) return undefined;
    const body = choices.map((choice) => {
        const percentage = Number(choice.percentage) || 0;
        const bar = '█'.repeat(Math.max(1, Math.round(percentage / 10)));
        return `${bar} ${choice.label} — ${percentage}% (${Number(choice.count) || 0})`;
    });
    const state = poll?.time_left_en || (poll?.ends_at ? `Ends ${poll.ends_at}` : 'Results');
    return {
        kind: 'poll',
        title: 'Poll',
        body: `${body.join('\n')}\n${Number(poll?.total_votes) || 0} votes · ${state}`,
    };
}

async function fetchFxTwitterFallback(
    username: string,
    tweetId: string,
    options: HandlerOptions,
    firstPartyError: string,
): Promise<HandlerResponse> {
    try {
        const language = requestedTranslationLanguage(options);
        const tweet = await fetchFxTwitterTweet(username, tweetId, language)
            || (language ? await fetchFxTwitterTweet(username, tweetId) : undefined);
        const author = tweet?.author;
        if (!tweet || !author?.screen_name || !author.name || !author.avatar_url) {
            return fallbackResponse(username, tweetId, firstPartyError);
        }

        const media = fxTwitterMedia(tweet);
        const canonicalUrl = `https://x.com/${author.screen_name}/status/${tweetId}`;
        const galleryMode = options.mode === 'gallery';
        const originalText = truncateText(tweet.text?.trim() || '', 3000);
        const platformTranslation = language ? fxTranslation(tweet, language) : undefined;
        const translation = platformTranslation
            ? {
                sourceLanguage: platformTranslation.sourceLanguage,
                sourceLanguageName: languageName(platformTranslation.sourceLanguage),
                targetLanguage: platformTranslation.targetLanguage,
                originalUrl: canonicalUrl,
            }
            : undefined;
        const description = platformTranslation
            ? truncateText(platformTranslation.text, 3000)
            : originalText;
        const sections = [
            fxTwitterPollSection(tweet.poll),
            fxTwitterQuoteSection(tweet),
        ].filter((section): section is EmbedSection => Boolean(section));
        const quoteSection = sections.find((section) => section.kind === 'quote');
        let image = media.image;
        let images = media.images;
        let video = media.video;
        let mediaOrigin: 'quote' | undefined;
        if (!image && !images && !video && quoteSection) {
            video = quoteSection.video;
            if (quoteSection.images?.length === 1 && !video) [image] = quoteSection.images;
            else if (quoteSection.images?.length) images = quoteSection.images;
            if (image || images || video) mediaOrigin = 'quote';
        }

        return {
            success: true,
            source: 'fallback',
            data: {
                title: `@${author.screen_name}`,
                description: galleryMode ? '' : description,
                url: canonicalUrl,
                siteName: getBrandedSiteName('twitter'),
                authorName: author.name,
                authorHandle: `@${author.screen_name}`,
                authorUrl: `https://x.com/${author.screen_name}`,
                authorAvatar: highResolutionTwitterAvatar(author.avatar_url),
                authorVerification: twitterVerificationBadge(author),
                image: image || video?.thumbnail,
                images,
                video,
                color: platformColors.twitter,
                platform: 'twitter',
                sourceLanguage: platformTranslation?.sourceLanguage,
                translation,
                timestamp: tweet.created_at,
                stats: galleryMode ? undefined : formatStats({
                    comments: Number(tweet.replies) || undefined,
                    retweets: Number(tweet.retweets) || undefined,
                    likes: Number(tweet.likes) || undefined,
                    views: Number(tweet.views) || undefined,
                }),
                sections: galleryMode ? [] : sections,
                mode: options.mode,
                mediaOrigin,
                sensitive: tweet.possibly_sensitive === true,
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

function twitterVideoEmbed(media?: SyndicationMedia): VideoEmbed | undefined {
    if (!media || media.type === 'photo') return undefined;
    const sourceUrl = bestVideoUrl(media);
    const isGif = media.type === 'animated_gif';
    const url = sourceUrl && isGif ? animatedGifUrl(sourceUrl) : sourceUrl;
    if (!url) return undefined;
    const [widthRatio, heightRatio] = media.video_info?.aspect_ratio || [16, 9];
    const width = 1280;
    return {
        url,
        width,
        height: Math.round(width * (heightRatio / widthRatio)),
        thumbnail: media.media_url_https,
        mediaType: isGif ? 'gif' : 'video',
    };
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
            const description = truncateText(
                tweet.text.replace(/https?:\/\/t\.co\/\w+/g, '').trim(),
                3000,
            );
            const media = tweet.mediaDetails || tweet.extended_entities?.media || tweet.entities?.media || [];
            const photos = media
                .filter((item) => item.type === 'photo')
                .map((item) => item.media_url_https);
            const firstVideo = media.find((item) => item.type !== 'photo');
            let image: string | undefined;
            let images: string[] | undefined;
            let video: VideoEmbed | undefined;
            let mediaOrigin: 'quote' | undefined;

            if (photos.length === 1 && !firstVideo) {
                [image] = photos;
            } else if (photos.length > 1 || (photos.length === 1 && firstVideo)) {
                images = photos;
            }

            if (firstVideo) {
                video = twitterVideoEmbed(firstVideo);
                if (video) {
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
                    const quoteHandle = tweet.quote.user.screen_name;
                    const quoteMedia = tweet.quote.mediaDetails || [];
                    const quotePhotos = quoteMedia
                        .filter((item) => item.type === 'photo')
                        .map((item) => item.media_url_https);
                    const quoteVideo = twitterVideoEmbed(
                        quoteMedia.find((item) => item.type !== 'photo'),
                    );
                    sections?.push({
                        kind: 'quote',
                        title: 'Quoted post',
                        body: truncateText(
                            tweet.quote.text.replace(/https?:\/\/t\.co\/\w+/g, '').trim(),
                            900,
                        ),
                        url: tweet.quote.id_str
                            ? `https://x.com/${quoteHandle}/status/${tweet.quote.id_str}`
                            : `https://x.com/${quoteHandle}`,
                        authorName: tweet.quote.user.name,
                        authorHandle: `@${quoteHandle}`,
                        authorUrl: `https://x.com/${quoteHandle}`,
                        authorAvatar: highResolutionTwitterAvatar(
                            tweet.quote.user.profile_image_url_https,
                        ),
                        authorVerification: twitterVerificationBadge(tweet.quote.user),
                        images: quotePhotos.length ? quotePhotos : undefined,
                        video: quoteVideo,
                    });
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
            const canonicalUrl = `https://x.com/${handle}/status/${parsed.tweetId}`;
            const requestedLanguage = requestedTranslationLanguage(options);
            const translatedTweet = requestedLanguage
                && requestedLanguage !== tweet.lang?.toLowerCase()
                && options.mode !== 'gallery'
                ? await fetchFxTwitterTweet(parsed.username, parsed.tweetId, requestedLanguage)
                : undefined;
            const primaryTranslation = requestedLanguage
                ? fxTranslation(translatedTweet, requestedLanguage)
                : undefined;
            const quoteIdsMatch = !translatedTweet?.quote?.id
                || !tweet.quote?.id_str
                || translatedTweet.quote.id === tweet.quote.id_str;
            const quoteTranslation = requestedLanguage && quoteIdsMatch
                ? fxTranslation(translatedTweet?.quote, requestedLanguage)
                : undefined;
            const quoteSection = sections?.find((section) => section.kind === 'quote');
            if (quoteSection && quoteTranslation) {
                quoteSection.body = truncateText(quoteTranslation.text, 900);
            }
            if (!image && !images && !video && quoteSection) {
                video = quoteSection.video;
                if (quoteSection.images?.length === 1 && !video) [image] = quoteSection.images;
                else if (quoteSection.images?.length) images = quoteSection.images;
                if (image || images || video) mediaOrigin = 'quote';
            }
            const translationSource = primaryTranslation || quoteTranslation;
            const translation = requestedLanguage && translationSource
                ? {
                    sourceLanguage: translationSource.sourceLanguage,
                    sourceLanguageName: languageName(translationSource.sourceLanguage),
                    targetLanguage: requestedLanguage,
                    originalUrl: canonicalUrl,
                }
                : undefined;

            return {
                success: true,
                source: 'first-party',
                data: {
                    title: `@${handle}`,
                    description: options.mode === 'gallery'
                        ? ''
                        : truncateText(primaryTranslation?.text || description, 3000),
                    url: canonicalUrl,
                    siteName: getBrandedSiteName('twitter'),
                    authorName: tweet.user.name,
                    authorHandle: `@${handle}`,
                    authorUrl: `https://x.com/${handle}`,
                    authorAvatar: highResolutionTwitterAvatar(tweet.user.profile_image_url_https),
                    authorVerification: twitterVerificationBadge(tweet.user),
                    image,
                    images,
                    video,
                    color: platformColors.twitter,
                    platform: 'twitter',
                    sourceLanguage: translationSource?.sourceLanguage || tweet.lang?.toLowerCase(),
                    translation,
                    timestamp: tweet.created_at,
                    stats: options.mode === 'gallery' ? undefined : formatStats({
                        comments: tweet.conversation_count,
                        retweets: tweet.retweet_count,
                        likes: tweet.favorite_count,
                        views: Number(tweet.video?.viewCount || tweet.view_count_info?.count) || undefined,
                    }),
                    sections: options.mode === 'gallery' ? [] : sections,
                    mode: options.mode,
                    mediaOrigin,
                    sensitive: tweet.possibly_sensitive === true,
                },
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to fetch tweet';
            return fetchFxTwitterFallback(parsed.username, parsed.tweetId, options, message);
        }
    },
};
