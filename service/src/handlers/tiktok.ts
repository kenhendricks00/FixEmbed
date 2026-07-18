/**
 * FixEmbed Service - TikTok Handler
 * Uses bounded public TikTok page metadata first and FxTikTok only as fallback.
 */

import type { EmbedData, Env, HandlerResponse, PlatformHandler, VideoEmbed } from '../types.ts';
import { decodeHtmlEntities, fetchWithTimeout, truncateText } from '../utils/fetch.ts';
import { getBrandedSiteName, platformColors } from '../utils/embed.ts';

type TikTokOEmbed = {
    title?: unknown;
    author_name?: unknown;
    author_url?: unknown;
    author_unique_id?: unknown;
    thumbnail_url?: unknown;
};

type TikTokItem = {
    id?: unknown;
    desc?: unknown;
    createTime?: unknown;
    video?: {
        width?: unknown;
        height?: unknown;
        duration?: unknown;
        cover?: unknown;
        playAddr?: unknown;
    };
    imagePost?: {
        images?: Array<{
            imageURL?: { urlList?: unknown };
        }>;
    };
    author?: {
        uniqueId?: unknown;
        nickname?: unknown;
        avatarLarger?: unknown;
        avatarMedium?: unknown;
    };
    stats?: {
        diggCount?: unknown;
        commentCount?: unknown;
        shareCount?: unknown;
        playCount?: unknown;
    };
    warnInfo?: unknown;
    isContentClassified?: unknown;
};

type FxTikTokActivity = {
    id?: unknown;
    url?: unknown;
    created_at?: unknown;
    content?: unknown;
    spoiler_text?: unknown;
    account?: {
        username?: unknown;
        display_name?: unknown;
        url?: unknown;
        avatar?: unknown;
    };
    media_attachments?: Array<{
        type?: unknown;
        url?: unknown;
        preview_url?: unknown;
        meta?: {
            original?: {
                width?: unknown;
                height?: unknown;
            };
        };
    }>;
};

type ParsedTikTokUrl = {
    canonical: string;
    handle: string;
    postId: string;
};

const MAX_TIKTOK_HTML_BYTES = 1_000_000;
const MAX_FXTIKTOK_BYTES = 256_000;
const TIKTOK_HOSTS = new Set(['tiktok.com', 'www.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com']);
const TIKTOK_MEDIA_SUFFIXES = [
    'tiktok.com',
    'tiktokcdn.com',
    'tiktokcdn-us.com',
    'muscdn.com',
    'byteoversea.com',
    'ibytedtos.com',
    'tnktok.com',
];

function text(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function trustedTikTokUrl(raw: string): URL | null {
    try {
        const url = new URL(raw);
        const host = url.hostname.toLowerCase();
        return url.protocol === 'https:' && TIKTOK_HOSTS.has(host) ? url : null;
    } catch {
        return null;
    }
}

function trustedTikTokMedia(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    try {
        const url = new URL(value);
        const host = url.hostname.toLowerCase();
        if (
            url.protocol === 'https:'
            && TIKTOK_MEDIA_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))
        ) {
            return url.toString();
        }
    } catch {
        // Ignore malformed source and fallback media.
    }
    return undefined;
}

function standardTikTokUrl(url: URL): ParsedTikTokUrl | null {
    const match = url.pathname.match(/^\/@([\w.-]+)\/video\/(\d+)\/?$/i);
    if (!match) return null;
    return {
        canonical: `https://www.tiktok.com/@${match[1]}/video/${match[2]}`,
        handle: match[1],
        postId: match[2],
    };
}

async function resolveTikTokUrl(raw: string): Promise<ParsedTikTokUrl | null> {
    const initial = trustedTikTokUrl(raw);
    if (!initial) return null;
    const standard = standardTikTokUrl(initial);
    if (standard) return standard;

    let current = initial;
    for (let redirectCount = 0; redirectCount < 4; redirectCount += 1) {
        const response = await fetchWithTimeout(current.toString(), {
            redirect: 'manual',
            headers: {
                'Accept': 'text/html',
                'User-Agent': 'Mozilla/5.0 (compatible; FixEmbed/1.0; +https://fixembed.app)',
            },
        }, 5_000);
        const location = response.headers.get('Location');
        if (!location) return standardTikTokUrl(current);
        const next = trustedTikTokUrl(new URL(location, current).toString());
        if (!next) return null;
        current = next;
        const resolved = standardTikTokUrl(current);
        if (resolved) return resolved;
    }
    return null;
}

async function readTextLimited(response: Response, maxBytes: number): Promise<string> {
    const declared = Number.parseInt(response.headers.get('Content-Length') || '', 10);
    if (Number.isFinite(declared) && declared > maxBytes) throw new Error('TikTok response too large');
    if (!response.body) return '';
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let total = 0;
    let result = '';
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
            await reader.cancel();
            throw new Error('TikTok response too large');
        }
        result += decoder.decode(value, { stream: true });
    }
    return result + decoder.decode();
}

async function fetchTikTokItem(parsed: ParsedTikTokUrl): Promise<TikTokItem | undefined> {
    const response = await fetchWithTimeout(parsed.canonical, {
        redirect: 'manual',
        headers: {
            'Accept': 'text/html,application/xhtml+xml',
            'User-Agent': 'Mozilla/5.0 (compatible; FixEmbed/1.0; +https://fixembed.app)',
        },
    }, 6_000);
    if (!response.ok) return undefined;
    const html = await readTextLimited(response, MAX_TIKTOK_HTML_BYTES);
    const script = html.match(
        /<script\b[^>]*\bid=["']__UNIVERSAL_DATA_FOR_REHYDRATION__["'][^>]*>([\s\S]*?)<\/script>/i,
    )?.[1];
    if (!script) return undefined;
    const hydrated = JSON.parse(script) as {
        __DEFAULT_SCOPE__?: {
            'webapp.video-detail'?: {
                itemInfo?: { itemStruct?: TikTokItem };
            };
        };
    };
    const item = hydrated.__DEFAULT_SCOPE__?.['webapp.video-detail']?.itemInfo?.itemStruct;
    return text(item?.id) === parsed.postId ? item : undefined;
}

async function fetchTikTokOEmbed(parsed: ParsedTikTokUrl): Promise<TikTokOEmbed | undefined> {
    const response = await fetchWithTimeout(
        `https://www.tiktok.com/oembed?url=${encodeURIComponent(parsed.canonical)}`,
        {
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'FixEmbed/1.0 (+https://fixembed.app)',
            },
        },
        6_000,
    );
    return response.ok ? await response.json() as TikTokOEmbed : undefined;
}

function positiveDimension(value: unknown, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 && parsed <= 10_000 ? Math.round(parsed) : fallback;
}

function compactCount(value: unknown): string {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return '0';
    return new Intl.NumberFormat('en-US', {
        notation: 'compact',
        maximumFractionDigits: 1,
    }).format(parsed);
}

function tikTokStats(item: TikTokItem): string | undefined {
    const stats = item.stats;
    if (!stats) return undefined;
    const rendered = [
        Number(stats.diggCount) > 0 ? `❤️ ${compactCount(stats.diggCount)}` : '',
        Number(stats.commentCount) > 0 ? `💬 ${compactCount(stats.commentCount)}` : '',
        Number(stats.shareCount) > 0 ? `🔁 ${compactCount(stats.shareCount)}` : '',
    ].filter(Boolean);
    return rendered.length ? rendered.join('  ') : undefined;
}

function tikTokTimestamp(value: unknown): string | undefined {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
    return new Date(seconds * 1000).toISOString();
}

function tikTokImages(item: TikTokItem): string[] {
    const images = Array.isArray(item.imagePost?.images) ? item.imagePost.images : [];
    return [...new Set(images.flatMap((image) => {
        const urls = image.imageURL?.urlList;
        if (!Array.isArray(urls)) return [];
        const trusted = urls.map(trustedTikTokMedia).find(Boolean);
        return trusted ? [trusted] : [];
    }))].slice(0, 10);
}

function firstPartyData(
    parsed: ParsedTikTokUrl,
    item: TikTokItem,
    oEmbed?: TikTokOEmbed,
): EmbedData | undefined {
    const itemHandle = text(item.author?.uniqueId).replace(/^@/, '');
    const oEmbedHandle = text(oEmbed?.author_unique_id).replace(/^@/, '');
    const handle = [itemHandle, oEmbedHandle, parsed.handle].find((value) => /^[\w.-]+$/.test(value)) || parsed.handle;
    const description = truncateText(text(item.desc) || text(oEmbed?.title), 3_000);
    const image = trustedTikTokMedia(item.video?.cover) || trustedTikTokMedia(oEmbed?.thumbnail_url);
    const playUrl = trustedTikTokMedia(item.video?.playAddr);
    const gallery = tikTokImages(item);
    const video: VideoEmbed | undefined = playUrl && Number(item.video?.duration) > 0
        ? {
            url: playUrl,
            width: positiveDimension(item.video?.width, 576),
            height: positiveDimension(item.video?.height, 1024),
            thumbnail: image,
        }
        : undefined;
    if (!description && !video && !gallery.length && !image) return undefined;
    return {
        title: description || 'TikTok post',
        description,
        url: parsed.canonical,
        siteName: getBrandedSiteName('tiktok'),
        authorName: text(item.author?.nickname) || text(oEmbed?.author_name) || handle,
        authorHandle: `@${handle}`,
        authorUrl: `https://www.tiktok.com/@${handle}`,
        authorAvatar: trustedTikTokMedia(item.author?.avatarLarger)
            || trustedTikTokMedia(item.author?.avatarMedium),
        image: video
            ? image
            : gallery.length === 1
                ? gallery[0]
                : gallery.length > 1
                    ? undefined
                    : image,
        images: !video && gallery.length > 1 ? gallery : undefined,
        video,
        timestamp: tikTokTimestamp(item.createTime),
        stats: tikTokStats(item),
        sensitive: item.isContentClassified === true
            || (Array.isArray(item.warnInfo) && item.warnInfo.length > 0),
        color: platformColors.tiktok,
        platform: 'tiktok',
    };
}

function stripActivityMarkup(value: unknown): string {
    if (typeof value !== 'string') return '';
    return decodeHtmlEntities(value.replace(/<[^>]*>/g, ' '))
        .replace(/\s+/g, ' ')
        .trim();
}

async function fetchFxTikTokFallback(
    parsed: ParsedTikTokUrl,
    oEmbed?: TikTokOEmbed,
): Promise<HandlerResponse | undefined> {
    const response = await fetchWithTimeout(
        `https://www.tnktok.com/api/v1/statuses/${parsed.postId}`,
        {
            headers: {
                'Accept': 'application/activity+json',
                'User-Agent': 'FixEmbed/1.0 (+https://fixembed.app)',
            },
        },
        6_000,
    );
    if (!response.ok) return undefined;
    const activity = JSON.parse(
        await readTextLimited(response, MAX_FXTIKTOK_BYTES),
    ) as FxTikTokActivity;
    const activityUrl = trustedTikTokUrl(text(activity.url));
    const identity = activityUrl ? standardTikTokUrl(activityUrl) : null;
    if (text(activity.id) !== parsed.postId || identity?.postId !== parsed.postId) return undefined;
    const activityHandle = text(activity.account?.username).replace(/^@/, '');
    if (
        !/^[\w.-]+$/.test(activityHandle)
        || activityHandle.toLowerCase() !== identity.handle.toLowerCase()
    ) {
        return undefined;
    }

    const attachments = Array.isArray(activity.media_attachments)
        ? activity.media_attachments.slice(0, 10)
        : [];
    const videoAttachment = attachments.find((attachment) => attachment.type === 'video');
    const videoUrl = trustedTikTokMedia(videoAttachment?.url);
    const video: VideoEmbed | undefined = videoUrl ? {
        url: videoUrl,
        width: positiveDimension(videoAttachment?.meta?.original?.width, 576),
        height: positiveDimension(videoAttachment?.meta?.original?.height, 1024),
        thumbnail: trustedTikTokMedia(videoAttachment?.preview_url),
    } : undefined;
    const images = attachments
        .filter((attachment) => attachment.type === 'image')
        .map((attachment) => trustedTikTokMedia(attachment.url))
        .filter((url): url is string => Boolean(url));
    if (!video && !images.length) return undefined;

    const description = truncateText(text(oEmbed?.title), 3_000);
    return {
        success: true,
        source: 'fallback',
        data: {
            title: description || 'TikTok post',
            description,
            url: parsed.canonical,
            siteName: getBrandedSiteName('tiktok'),
            authorName: text(activity.account?.display_name) || text(oEmbed?.author_name) || activityHandle,
            authorHandle: `@${activityHandle}`,
            authorUrl: `https://www.tiktok.com/@${activityHandle}`,
            authorAvatar: trustedTikTokMedia(activity.account?.avatar),
            image: video
                ? trustedTikTokMedia(videoAttachment?.preview_url)
                : images.length === 1 ? images[0] : undefined,
            images: !video && images.length > 1 ? images : undefined,
            video,
            timestamp: text(activity.created_at) || undefined,
            stats: stripActivityMarkup(activity.content) || undefined,
            sensitive: Boolean(text(activity.spoiler_text)),
            color: platformColors.tiktok,
            platform: 'tiktok',
        },
    };
}

export const tiktokHandler: PlatformHandler = {
    name: 'tiktok',
    patterns: [
        /^https:\/\/(?:www\.)?tiktok\.com\/@[\w.-]+\/video\/\d+/i,
        /^https:\/\/(?:vm|vt)\.tiktok\.com\/[A-Za-z0-9_-]+/i,
        /^https:\/\/(?:www\.)?tiktok\.com\/t\/[A-Za-z0-9_-]+/i,
    ],

    async handle(url: string, _env: Env): Promise<HandlerResponse> {
        try {
            const parsed = await resolveTikTokUrl(url);
            if (!parsed) return { success: false, error: 'Invalid TikTok URL', redirect: url };
            const [itemResult, oEmbedResult] = await Promise.allSettled([
                fetchTikTokItem(parsed),
                fetchTikTokOEmbed(parsed),
            ]);
            const item = itemResult.status === 'fulfilled' ? itemResult.value : undefined;
            const oEmbed = oEmbedResult.status === 'fulfilled' ? oEmbedResult.value : undefined;
            if (item) {
                const data = firstPartyData(parsed, item, oEmbed);
                if (data) return { success: true, source: 'first-party', data };
            }

            const fallback = await fetchFxTikTokFallback(parsed, oEmbed);
            if (fallback) return fallback;

            const description = truncateText(text(oEmbed?.title), 3_000);
            const image = trustedTikTokMedia(oEmbed?.thumbnail_url);
            if (description || image) {
                const responseHandle = text(oEmbed?.author_unique_id).replace(/^@/, '');
                const handle = /^[\w.-]+$/.test(responseHandle) ? responseHandle : parsed.handle;
                return {
                    success: true,
                    source: 'first-party',
                    data: {
                        title: description || 'TikTok post',
                        description,
                        url: parsed.canonical,
                        siteName: getBrandedSiteName('tiktok'),
                        authorName: text(oEmbed?.author_name) || handle,
                        authorHandle: `@${handle}`,
                        authorUrl: `https://www.tiktok.com/@${handle}`,
                        image,
                        color: platformColors.tiktok,
                        platform: 'tiktok',
                    },
                };
            }
            return {
                success: false,
                error: 'TikTok metadata unavailable',
                redirect: parsed.canonical,
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'TikTok metadata unavailable',
                redirect: url,
            };
        }
    },
};
