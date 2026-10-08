/**
 * FixEmbed Service - TikTok Handler
 * Uses bounded public TikTok page metadata first and FxTikTok only as fallback.
 */

import type { EmbedData, Env, HandlerResponse, PlatformHandler, VideoEmbed } from '../types.ts';
import { createTimeoutBudget, decodeHtmlEntities, fetchWithTimeout, truncateText } from '../utils/fetch.ts';
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

type TikTokProfile = {
    uniqueId?: unknown;
    avatarLarger?: unknown;
    avatarMedium?: unknown;
};

type FxTikTokAttachment = {
    type?: unknown;
    url?: unknown;
    preview_url?: unknown;
    description?: unknown;
    meta?: {
        original?: {
            width?: unknown;
            height?: unknown;
        };
    };
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
    media_attachments?: FxTikTokAttachment[];
};

type ParsedTikTokUrl = {
    canonical: string;
    handle: string;
    postId: string;
};

const MAX_TIKTOK_HTML_BYTES = 1_000_000;
const MAX_FXTIKTOK_BYTES = 256_000;
const MAX_FXTIKTOK_GALLERY_IMAGES = 35;
const MAX_FXTIKTOK_GALLERY_PAGES = 9;
const TIKTOK_HOSTS = new Set([
    'tiktok.com',
    'www.tiktok.com',
    'm.tiktok.com',
    'vm.tiktok.com',
    'vt.tiktok.com',
]);
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

function mobileTikTokUrl(url: URL): ParsedTikTokUrl | null {
    if (url.hostname.toLowerCase() !== 'm.tiktok.com') return null;
    const match = url.pathname.match(/^\/v\/(\d+)\.html\/?$/i);
    if (!match) return null;
    return {
        canonical: `https://www.tiktok.com/@/video/${match[1]}`,
        handle: '',
        postId: match[1],
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
        const resolved = standardTikTokUrl(current) || mobileTikTokUrl(current);
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

async function fetchTikTokProfileAvatar(handle: string): Promise<string | undefined> {
    if (!/^[\w.-]+$/.test(handle)) return undefined;
    const response = await fetchWithTimeout(`https://www.tiktok.com/@${handle}`, {
        redirect: 'manual',
        headers: {
            'Accept': 'text/html,application/xhtml+xml',
            'User-Agent': 'Mozilla/5.0 (compatible; FixEmbed/1.0; +https://fixembed.app)',
        },
    }, 4_000);
    if (!response.ok) return undefined;
    const html = await readTextLimited(response, MAX_TIKTOK_HTML_BYTES);
    const script = html.match(
        /<script\b[^>]*\bid=["']__UNIVERSAL_DATA_FOR_REHYDRATION__["'][^>]*>([\s\S]*?)<\/script>/i,
    )?.[1];
    if (!script) return undefined;
    const hydrated = JSON.parse(script) as {
        __DEFAULT_SCOPE__?: {
            'webapp.user-detail'?: {
                userInfo?: { user?: TikTokProfile };
            };
        };
    };
    const profile = hydrated.__DEFAULT_SCOPE__?.['webapp.user-detail']?.userInfo?.user;
    if (text(profile?.uniqueId).toLowerCase() !== handle.toLowerCase()) return undefined;
    return trustedTikTokMedia(profile?.avatarLarger)
        || trustedTikTokMedia(profile?.avatarMedium);
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_AVATAR_REDIRECTS = 3;
// One wall-clock budget for the whole redirect chain, not per hop.
const RELAY_AVATAR_BUDGET_MS = 2_500;

function isRelayAvatar(value: string | undefined): value is string {
    if (!value) return false;
    try {
        const host = new URL(value).hostname.toLowerCase();
        return host === 'tnktok.com' || host.endsWith('.tnktok.com');
    } catch {
        return false;
    }
}

/**
 * The FxTikTok relay answers profile pictures with a redirect to a signed TikTok
 * CDN URL. When the relay serves a stale signature the final image is a 403, so
 * Discord renders a broken thumbnail. Walk the trusted redirect chain once and
 * keep the relay avatar only when it ends in a real image.
 */
async function relayAvatarReachable(url: string): Promise<boolean> {
    let current = url;
    const deadline = Date.now() + RELAY_AVATAR_BUDGET_MS;
    const remaining = createTimeoutBudget(RELAY_AVATAR_BUDGET_MS);
    for (let hop = 0; hop <= MAX_AVATAR_REDIRECTS; hop += 1) {
        if (!trustedTikTokMedia(current)) return false;
        if (Date.now() >= deadline) return false;
        let response: Response;
        try {
            response = await fetchWithTimeout(current, {
                redirect: 'manual',
                headers: {
                    'Accept': 'image/*',
                    'Range': 'bytes=0-0',
                    'User-Agent': 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
                },
            }, remaining());
        } catch {
            return false;
        }
        const location = response.headers.get('Location');
        const contentType = (response.headers.get('Content-Type') || '').toLowerCase();
        try {
            await response.body?.cancel();
        } catch {
            // The probe only needs headers.
        }
        if (REDIRECT_STATUSES.has(response.status)) {
            if (!location) return false;
            try {
                current = new URL(location, current).toString();
            } catch {
                return false;
            }
            continue;
        }
        return (response.status === 200 || response.status === 206) && contentType.startsWith('image/');
    }
    return false;
}

async function keepReachableAvatar(data: EmbedData, tryProfile: boolean): Promise<void> {
    if (!isRelayAvatar(data.authorAvatar)) return;
    if (await relayAvatarReachable(data.authorAvatar)) return;
    data.authorAvatar = undefined;
    if (!tryProfile) return;
    try {
        data.authorAvatar = await fetchTikTokProfileAvatar(text(data.authorHandle).replace(/^@/, ''));
    } catch {
        // A card without an avatar beats a broken thumbnail.
    }
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
    const canonical = handle
        ? `https://www.tiktok.com/@${handle}/video/${parsed.postId}`
        : parsed.canonical;
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
    const sensitive = item.isContentClassified === true
        || (Array.isArray(item.warnInfo) && item.warnInfo.length > 0);
    return {
        title: description || 'TikTok post',
        description,
        url: canonical,
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
        sensitive,
        sensitivityTypes: sensitive ? ['nsfw'] : undefined,
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

async function fetchFxTikTokActivity(postId: string, page = 1): Promise<FxTikTokActivity | undefined> {
    const pageQuery = page > 1 ? `?page=${page}` : '';
    const response = await fetchWithTimeout(
        `https://www.tnktok.com/api/v1/statuses/${postId}${pageQuery}`,
        {
            headers: {
                'Accept': 'application/activity+json',
                'User-Agent': 'FixEmbed/1.0 (+https://fixembed.app)',
            },
        },
        6_000,
    );
    if (!response.ok) return undefined;
    return JSON.parse(
        await readTextLimited(response, MAX_FXTIKTOK_BYTES),
    ) as FxTikTokActivity;
}

function declaredFxTikTokImageTotal(attachments: FxTikTokAttachment[]): number {
    return attachments.reduce((largest, attachment) => {
        const total = Number.parseInt(
            text(attachment.description).match(/^Image \(\d+ of (\d+)\)$/i)?.[1] || '',
            10,
        );
        return Number.isInteger(total) && total > largest ? total : largest;
    }, 0);
}

async function fetchFxTikTokFallback(
    parsed: ParsedTikTokUrl,
    oEmbed?: TikTokOEmbed,
): Promise<HandlerResponse | undefined> {
    const activity = await fetchFxTikTokActivity(parsed.postId);
    if (!activity) return undefined;
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

    let attachments = Array.isArray(activity.media_attachments)
        ? activity.media_attachments.slice(0, 10)
        : [];
    const initialImageCount = attachments.filter((attachment) => attachment.type === 'image').length;
    const declaredImageTotal = declaredFxTikTokImageTotal(attachments);
    if (
        initialImageCount === attachments.length
        && initialImageCount > 0
        && declaredImageTotal > initialImageCount
    ) {
        const targetImageCount = Math.min(
            declaredImageTotal,
            MAX_FXTIKTOK_GALLERY_IMAGES,
        );
        const pageCount = Math.min(
            MAX_FXTIKTOK_GALLERY_PAGES,
            Math.ceil(targetImageCount / initialImageCount),
        );
        const pageResults = await Promise.allSettled(
            Array.from(
                { length: Math.max(0, pageCount - 1) },
                async (_, index) => {
                    const page = index + 2;
                    return {
                        page,
                        activity: await fetchFxTikTokActivity(parsed.postId, page),
                    };
                },
            ),
        );
        for (const result of pageResults) {
            if (result.status !== 'fulfilled' || !result.value.activity) continue;
            const { page, activity: pageActivity } = result.value;
            const pageUrl = trustedTikTokUrl(text(pageActivity.url));
            const pageIdentity = pageUrl ? standardTikTokUrl(pageUrl) : null;
            const pageHandle = text(pageActivity.account?.username).replace(/^@/, '');
            const pageId = text(pageActivity.id);
            if (
                ![parsed.postId, `${parsed.postId}page${page}`].includes(pageId)
                || pageIdentity?.postId !== parsed.postId
                || pageIdentity.handle.toLowerCase() !== activityHandle.toLowerCase()
                || pageHandle.toLowerCase() !== activityHandle.toLowerCase()
            ) {
                continue;
            }
            attachments.push(
                ...(Array.isArray(pageActivity.media_attachments)
                    ? pageActivity.media_attachments.filter((attachment) => attachment.type === 'image')
                    : []),
            );
        }
        attachments = attachments.slice(0, targetImageCount);
    }
    const videoAttachment = attachments.find((attachment) => attachment.type === 'video');
    const videoUrl = trustedTikTokMedia(videoAttachment?.url);
    const video: VideoEmbed | undefined = videoUrl ? {
        url: videoUrl,
        width: positiveDimension(videoAttachment?.meta?.original?.width, 576),
        height: positiveDimension(videoAttachment?.meta?.original?.height, 1024),
        thumbnail: trustedTikTokMedia(videoAttachment?.preview_url),
    } : undefined;
    const images = [...new Set(attachments
        .filter((attachment) => attachment.type === 'image')
        .map((attachment) => trustedTikTokMedia(attachment.url))
        .filter((url): url is string => Boolean(url)))];
    if (!video && !images.length) return undefined;

    const description = truncateText(text(oEmbed?.title), 3_000);
    const spoilerText = text(activity.spoiler_text);
    return {
        success: true,
        source: 'fallback',
        data: {
            title: description || 'TikTok post',
            description,
            url: identity.canonical,
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
            sensitive: Boolean(spoilerText),
            sensitivityTypes: spoilerText ? ['spoiler'] : undefined,
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
                if (data) {
                    if (!data.authorAvatar) {
                        const handle = text(data.authorHandle).replace(/^@/, '');
                        data.authorAvatar = await fetchTikTokProfileAvatar(handle);
                    }
                    let stableMedia: HandlerResponse | undefined;
                    try {
                        stableMedia = await fetchFxTikTokFallback(parsed, oEmbed);
                    } catch {
                        // Keep the first-party card when the optional media relay is unavailable.
                    }
                    if (stableMedia?.success && stableMedia.data) {
                        const fallbackData = stableMedia.data;
                        data.authorAvatar ||= fallbackData.authorAvatar;
                        if (fallbackData.video) {
                            data.video = fallbackData.video;
                            data.image = fallbackData.image;
                            data.images = undefined;
                        } else if (fallbackData.images?.length) {
                            data.video = undefined;
                            data.image = fallbackData.image;
                            data.images = fallbackData.images;
                        } else if (fallbackData.image) {
                            data.video = undefined;
                            data.image = fallbackData.image;
                            data.images = undefined;
                        }
                        // The profile page was already tried when the post had no avatar.
                        await keepReachableAvatar(data, false);
                        return { success: true, source: 'fallback', data };
                    }
                    return { success: true, source: 'first-party', data };
                }
            }

            const fallback = await fetchFxTikTokFallback(parsed, oEmbed);
            if (fallback) {
                if (fallback.data) await keepReachableAvatar(fallback.data, true);
                return fallback;
            }

            const description = truncateText(text(oEmbed?.title), 3_000);
            const image = trustedTikTokMedia(oEmbed?.thumbnail_url);
            if (description || image) {
                const responseHandle = text(oEmbed?.author_unique_id).replace(/^@/, '');
                const handle = /^[\w.-]+$/.test(responseHandle) ? responseHandle : parsed.handle;
                const canonical = handle
                    ? `https://www.tiktok.com/@${handle}/video/${parsed.postId}`
                    : parsed.canonical;
                return {
                    success: true,
                    source: 'first-party',
                    data: {
                        title: description || 'TikTok post',
                        description,
                        url: canonical,
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
