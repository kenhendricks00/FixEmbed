import { fetchWithTimeout } from '../utils/fetch.ts';

const X_API_ROOT = 'https://api.x.com';
// Public bearer used by X's logged-out web client; this is not an account credential or private API key.
const GUEST_BEARER = 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
const TWEET_QUERY_ID = 'f2sagi1jweVHFkTUIHzmMQ';
const GUEST_TOKEN_TTL_MS = 60 * 60 * 1000;
let cachedGuestToken: { value: string; expiresAt: number } | null = null;

const GRAPHQL_FEATURES = {
    rweb_video_screen_enabled: false,
    profile_label_improvements_pcf_label_in_post_enabled: true,
    responsive_web_profile_redirect_enabled: false,
    rweb_tipjar_consumption_enabled: false,
    verified_phone_label_enabled: false,
    creator_subscriptions_tweet_preview_api_enabled: true,
    responsive_web_graphql_timeline_navigation_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    premium_content_api_read_enabled: false,
    communities_web_enable_tweet_community_results_fetch: true,
    c9s_tweet_anatomy_moderator_badge_enabled: true,
    responsive_web_grok_analyze_button_fetch_trends_enabled: false,
    responsive_web_grok_analyze_post_followups_enabled: true,
    responsive_web_jetfuel_frame: true,
    responsive_web_grok_share_attachment_enabled: true,
    responsive_web_grok_annotations_enabled: true,
    articles_preview_enabled: true,
    responsive_web_edit_tweet_api_enabled: true,
    graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
    view_counts_everywhere_api_enabled: true,
    longform_notetweets_consumption_enabled: true,
    responsive_web_twitter_article_tweet_consumption_enabled: true,
    content_disclosure_indicator_enabled: true,
    content_disclosure_ai_generated_indicator_enabled: true,
    responsive_web_grok_show_grok_translated_post: true,
    responsive_web_grok_analysis_button_from_backend: true,
    post_ctas_fetch_enabled: true,
    freedom_of_speech_not_reach_fetch_enabled: true,
    standardized_nudges_misinfo: true,
    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
    longform_notetweets_rich_text_read_enabled: true,
    longform_notetweets_inline_media_enabled: true,
    responsive_web_grok_image_annotation_enabled: true,
    responsive_web_grok_imagine_annotation_enabled: true,
    responsive_web_grok_community_note_auto_translation_is_enabled: true,
    responsive_web_enhance_cards_enabled: false,
    tweet_awards_web_tipping_enabled: false,
};

export interface TwitterMedia {
    type: 'photo' | 'video' | 'animated_gif';
    media_url_https: string;
    video_info?: {
        aspect_ratio?: [number, number];
        variants: Array<{ bitrate?: number; content_type: string; url: string }>;
    };
}

export interface TwitterPoll {
    choices: Array<{ label: string; count: number; percentage: number }>;
    totalVotes: number;
    endsAt?: string;
    final: boolean;
}

export interface TwitterQuote {
    id_str?: string;
    text?: string;
    user?: TwitterTweetData['user'];
    mediaDetails?: TwitterMedia[];
    unavailableReason?: string;
}

export interface TwitterTweetData {
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
    lang?: string;
    entities?: { media?: TwitterMedia[] };
    extended_entities?: { media?: TwitterMedia[] };
    mediaDetails?: TwitterMedia[];
    poll?: TwitterPoll;
    quote?: TwitterQuote;
    communityNote?: { text: string; url?: string };
    article?: { title: string; preview?: string; image?: string };
    linkCard?: { title: string; description?: string; url: string; domain?: string; image?: string };
}

function record(value: unknown): Record<string, any> {
    // X's undocumented GraphQL response drifts frequently. Keep `any` confined to this normalization boundary.
    return value && typeof value === 'object' ? value as Record<string, any> : {};
}

function unwrapTweet(value: unknown): Record<string, any> {
    let node = record(value);
    if (node.result) node = record(node.result);
    if (node.__typename === 'TweetWithVisibilityResults' && node.tweet) node = record(node.tweet);
    return node;
}

function normalizeMedia(value: unknown): TwitterMedia[] {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 4).flatMap((item) => {
        const media = record(item);
        if (!['photo', 'video', 'animated_gif'].includes(media.type) || typeof media.media_url_https !== 'string') {
            return [];
        }
        return [media as unknown as TwitterMedia];
    });
}

async function getGuestToken(headers: Record<string, string>): Promise<string | null> {
    if (cachedGuestToken && cachedGuestToken.expiresAt > Date.now()) return cachedGuestToken.value;
    const activation = await fetchWithTimeout(`${X_API_ROOT}/1.1/guest/activate.json`, {
        method: 'POST',
        headers,
    }, 4000);
    if (!activation.ok) return null;
    const guest = await activation.json() as { guest_token?: string };
    if (!guest.guest_token) return null;
    cachedGuestToken = { value: guest.guest_token, expiresAt: Date.now() + GUEST_TOKEN_TTL_MS };
    return guest.guest_token;
}

function bindingMap(card: Record<string, any>): Map<string, Record<string, any>> {
    const values = card.legacy?.binding_values ?? card.binding_values;
    if (Array.isArray(values)) {
        return new Map(values.map((entry) => [String(entry.key), record(entry.value)]));
    }
    return new Map(Object.entries(record(values)).map(([key, value]) => [key, record(value)]));
}

export function normalizeTwitterPoll(cardValue: unknown): TwitterPoll | undefined {
    const card = record(cardValue);
    const name = String(card.legacy?.name ?? card.name ?? '');
    if (!name.startsWith('poll')) return undefined;
    const bindings = bindingMap(card);
    const choices: Array<{ label: string; count: number; percentage: number }> = [];
    for (let index = 1; index <= 4; index += 1) {
        const label = bindings.get(`choice${index}_label`)?.string_value;
        if (typeof label !== 'string') continue;
        const count = Number(bindings.get(`choice${index}_count`)?.string_value ?? 0);
        choices.push({ label, count: Number.isFinite(count) ? count : 0, percentage: 0 });
    }
    if (choices.length < 2) return undefined;
    const totalVotes = choices.reduce((sum, choice) => sum + choice.count, 0);
    for (const choice of choices) {
        choice.percentage = totalVotes > 0 ? Math.round((choice.count / totalVotes) * 100) : 0;
    }
    return {
        choices,
        totalVotes,
        endsAt: bindings.get('end_datetime_utc')?.string_value,
        final: bindings.get('counts_are_final')?.boolean_value === true,
    };
}

export function normalizeTwitterWebsiteCard(cardValue: unknown): TwitterTweetData['linkCard'] {
    const card = record(cardValue);
    const cardName = String(card.legacy?.name ?? card.name ?? '');
    if (!['summary', 'summary_large_image', 'summary_photo_image', 'promo_image', 'summary_large_image_app'].includes(cardName)) {
        return undefined;
    }
    const bindings = bindingMap(card);
    const title = bindings.get('title')?.string_value;
    const url = bindings.get('card_url')?.string_value ?? card.legacy?.url ?? card.url;
    if (typeof title !== 'string' || typeof url !== 'string') return undefined;
    const imageKeys = [
        'summary_photo_image_large', 'photo_image_full_size_large', 'summary_photo_image',
        'photo_image_full_size', 'summary_photo_image_x_large', 'photo_image_full_size_x_large',
        'thumbnail_image_large', 'thumbnail_image', 'thumbnail_image_original',
        'summary_photo_image_original', 'photo_image_full_size_original',
    ];
    const image = imageKeys
        .map((key) => bindings.get(key)?.image_value?.url)
        .find((value) => typeof value === 'string');
    return {
        title,
        url,
        description: bindings.get('description')?.string_value,
        domain: bindings.get('domain')?.string_value ?? bindings.get('vanity_url')?.string_value,
        image,
    };
}

function normalizeUser(node: Record<string, any>): TwitterTweetData['user'] | null {
    const rawUser = record(node.core?.user_results?.result ?? node.core?.user_result?.result);
    const core = record(rawUser.core);
    const legacy = record(rawUser.legacy);
    const screenName = core.screen_name ?? legacy.screen_name;
    const name = core.name ?? legacy.name;
    const avatar = rawUser.avatar?.image_url ?? legacy.profile_image_url_https;
    if (typeof screenName !== 'string' || typeof name !== 'string' || typeof avatar !== 'string') return null;
    return { name, screen_name: screenName, profile_image_url_https: avatar };
}

function normalizeQuote(value: unknown): TwitterQuote | undefined {
    const quote = unwrapTweet(value);
    if (!Object.keys(quote).length) return { unavailableReason: 'Unavailable' };
    if (quote.__typename === 'TweetUnavailable' || quote.__typename === 'TweetTombstone') {
        return { unavailableReason: String(quote.reason ?? 'Unavailable') };
    }
    const user = normalizeUser(quote);
    const legacy = record(quote.legacy);
    if (!user || typeof legacy.full_text !== 'string') return { unavailableReason: 'Unavailable' };
    return {
        id_str: String(quote.rest_id ?? legacy.id_str ?? ''),
        text: quote.note_tweet?.note_tweet_results?.result?.text ?? legacy.full_text,
        user,
        mediaDetails: normalizeMedia(legacy.extended_entities?.media ?? legacy.entities?.media),
    };
}

export function normalizeGraphQLTweet(value: unknown): TwitterTweetData | null {
    const node = unwrapTweet(value);
    if (node.__typename !== 'Tweet') return null;
    const legacy = record(node.legacy);
    const user = normalizeUser(node);
    const id = node.rest_id ?? legacy.id_str;
    if (!user || typeof id !== 'string' || typeof legacy.full_text !== 'string') return null;

    const noteText = node.note_tweet?.note_tweet_results?.result?.text;
    const article = record(node.article?.article_results?.result);
    const coverInfo = record(article.cover_media?.media_info);
    const birdwatch = record(node.birdwatch_pivot);
    const birdwatchSubtitle = record(birdwatch.subtitle);

    return {
        __typename: 'Tweet',
        id_str: id,
        text: typeof noteText === 'string' ? noteText : legacy.full_text,
        user,
        created_at: String(legacy.created_at ?? ''),
        favorite_count: Number(legacy.favorite_count) || undefined,
        retweet_count: Number(legacy.retweet_count) || undefined,
        quote_count: Number(legacy.quote_count) || undefined,
        conversation_count: Number(legacy.reply_count) || undefined,
        view_count_info: node.views?.count ? { count: String(node.views.count) } : undefined,
        lang: typeof legacy.lang === 'string' ? legacy.lang : undefined,
        mediaDetails: normalizeMedia(legacy.extended_entities?.media ?? legacy.entities?.media),
        poll: normalizeTwitterPoll(node.card),
        quote: node.quoted_status_result || node.quoted_tweet_results
            ? normalizeQuote(node.quoted_status_result ?? node.quoted_tweet_results)
            : undefined,
        communityNote: typeof birdwatchSubtitle.text === 'string'
            ? { text: birdwatchSubtitle.text, url: typeof birdwatch.destinationUrl === 'string' ? birdwatch.destinationUrl : undefined }
            : undefined,
        article: typeof article.title === 'string'
            ? {
                title: article.title,
                preview: typeof article.preview_text === 'string' ? article.preview_text : undefined,
                image: coverInfo.__typename === 'ApiImage' && typeof coverInfo.original_img_url === 'string'
                    ? coverInfo.original_img_url
                    : undefined,
            }
            : undefined,
        linkCard: normalizeTwitterWebsiteCard(node.card),
    };
}

export async function fetchTwitterGraphQL(tweetId: string): Promise<TwitterTweetData | null> {
    const baseHeaders = {
        Authorization: GUEST_BEARER,
        'User-Agent': 'Mozilla/5.0 (compatible; FixEmbed/1.4; +https://fixembed.app)',
        'x-twitter-active-user': 'yes',
        'x-twitter-client-language': 'en',
    };
    try {
        const guestToken = await getGuestToken(baseHeaders);
        if (!guestToken) return null;

        const variables = { tweetId, withCommunity: false, includePromotedContent: false, withVoice: false };
        const fieldToggles = {
            withArticleRichContentState: true,
            withArticlePlainText: false,
            withGrokAnalyze: false,
            withDisallowedReplyControls: false,
        };
        const query = new URL(`${X_API_ROOT}/graphql/${TWEET_QUERY_ID}/TweetResultByRestId`);
        query.searchParams.set('variables', JSON.stringify(variables));
        query.searchParams.set('features', JSON.stringify(GRAPHQL_FEATURES));
        query.searchParams.set('fieldToggles', JSON.stringify(fieldToggles));
        const response = await fetchWithTimeout(query.toString(), {
            headers: { ...baseHeaders, 'x-guest-token': guestToken },
        }, 5000);
        if (!response.ok) {
            if (response.status === 401 || response.status === 403 || response.status === 429) cachedGuestToken = null;
            return null;
        }
        const payload = await response.json() as Record<string, any>;
        return normalizeGraphQLTweet(payload.data?.tweetResult?.result);
    } catch (error) {
        console.error('Twitter GraphQL enrichment failed:', error);
        return null;
    }
}
