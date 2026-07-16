/**
 * FixEmbed Service - Pixiv Handler
 * 
 * Fetches Pixiv artwork data directly and renders it through FixEmbed.
 * Phixiv remains an emergency fallback when Pixiv blocks Worker traffic.
 * 
 * Key features:
 * - Direct Pixiv metadata is the primary path
 * - Phixiv is used only as an emergency fallback
 * - Falls back to a branded basic embed if both sources are unavailable
 */

import type { Env, HandlerResponse, PlatformHandler } from '../types.ts';
import { formatNumber, platformColors, getBrandedSiteName } from '../utils/embed.ts';
import { extractPostTimestampFromHtml } from '../utils/timestamp.ts';
import { createTimeoutBudget, fetchWithTimeout } from '../utils/fetch.ts';

const MAX_PIXIV_OEMBED_BYTES = 64 * 1024;
const MAX_PIXIV_RELAY_BYTES = 256 * 1024;
const MAX_PHIXIV_HTML_BYTES = 256 * 1024;
const MAX_PHIXIV_ACTIVITY_BYTES = 256 * 1024;
const PHIXIV_ACTIVITY_TIMEOUT_MS = 3000;
const PHIXIV_ACTIVITY_ORIGINS = [
    'https://www.phixiv.net',
    'https://phixiv.net',
    'https://c.phixiv.net',
] as const;

interface PixivArtworkResponse {
    error?: boolean;
    body?: {
        title?: string;
        description?: string;
        userName?: string;
        userId?: string;
        userAccount?: string;
        bookmarkCount?: number;
        likeCount?: number;
        viewCount?: number;
        commentCount?: number;
        createDate?: string;
        urls?: { regular?: string; original?: string };
        profileImageUrl?: string;
        userIllusts?: Record<string, { profileImageUrl?: string } | null>;
    };
}

interface PixivArtworkPagesResponse {
    error?: boolean;
    body?: Array<{
        urls?: { regular?: string; original?: string };
    }>;
}

interface PixivUserResponse {
    error?: boolean;
    body?: {
        image?: string;
        imageBig?: string;
    };
}

interface PixivOEmbedResponse {
    title?: string;
    author_name?: string;
    author_url?: string;
    thumbnail_url?: string;
}

interface PixivRelayResponse {
    version?: number;
    id?: string;
    title?: string;
    description?: string;
    authorName?: string;
    authorHandle?: string;
    authorId?: string;
    authorAvatar?: string;
    timestamp?: string;
    stats?: {
        comments?: number;
        likes?: number;
        views?: number;
        bookmarks?: number;
    };
    images?: string[];
}

interface PhixivActivityResponse {
    id?: string;
    created_at?: string;
    content?: string;
    media_attachments?: Array<{
        type?: string;
        url?: string;
        preview_url?: string;
    }>;
    account?: {
        id?: string;
        display_name?: string;
        avatar?: string;
        avatar_static?: string;
    };
}

interface PhixivActivityReference {
    authorId?: string;
    activityId: string;
}

interface PhixivCreatorIdentity {
    name?: string;
    url?: string;
    avatar?: string;
    timestamp?: string;
    title?: string;
    description?: string;
    images?: string[];
}

function proxyPixivImage(sourceUrl: string, env: Env): string {
    const embedDomain = env.EMBED_DOMAIN || 'fixembed.app';
    return `https://${embedDomain}/proxy/pixiv?url=${encodeURIComponent(sourceUrl)}`;
}

function trustedPixivMediaUrl(rawUrl: string | undefined): string | undefined {
    if (!rawUrl) return undefined;
    try {
        const parsed = new URL(rawUrl.replace(/&amp;/gi, '&'));
        const hostname = parsed.hostname.toLowerCase();
        const trustedHost = hostname === 'embed.pixiv.net'
            || hostname === 'i.pximg.net'
            || hostname.endsWith('.pximg.net');
        return parsed.protocol === 'https:' && trustedHost ? parsed.toString() : undefined;
    } catch {
        return undefined;
    }
}

function trustedPixivAuthorUrl(rawUrl: string | undefined): string | undefined {
    if (!rawUrl) return undefined;
    try {
        const parsed = new URL(rawUrl);
        const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
        const userId = parsed.pathname.match(/^\/(?:en\/)?users\/(\d+)\/?$/i)?.[1];
        return parsed.protocol === 'https:' && hostname === 'pixiv.net' && userId
            ? `https://www.pixiv.net/en/users/${userId}`
            : undefined;
    } catch {
        return undefined;
    }
}

function trustedPhixivMediaUrl(rawUrl: string | undefined): string | undefined {
    if (!rawUrl) return undefined;
    try {
        const parsed = new URL(rawUrl.replace(/&amp;/gi, '&'));
        const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
        return parsed.protocol === 'https:'
            && hostname === 'phixiv.net'
            && parsed.pathname.startsWith('/i/')
            ? parsed.toString()
            : undefined;
    } catch {
        return undefined;
    }
}

function upgradePixivAvatarUrl(rawUrl: string): string {
    const parsed = new URL(rawUrl);
    parsed.pathname = parsed.pathname.replace(/_50(\.(?:png|jpe?g|webp))$/i, '_170$1');
    return parsed.toString();
}

function boundedBodyLength(response: Response, maximumBytes: number): boolean {
    const declaredLength = Number(response.headers.get('content-length') || 0);
    return !Number.isFinite(declaredLength) || declaredLength <= maximumBytes;
}

function boundedRelayText(value: unknown, maximum: number): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed && trimmed.length <= maximum ? trimmed : undefined;
}

function relayMetric(value: unknown): number | undefined {
    return typeof value === 'number'
        && Number.isSafeInteger(value)
        && value >= 0
        ? value
        : undefined;
}

async function verifyRelaySignature(
    body: string,
    signatureHeader: string | null,
    secret: string,
): Promise<boolean> {
    const signatureHex = signatureHeader?.match(/^v1=([0-9a-f]{64})$/i)?.[1];
    if (!signatureHex || new TextEncoder().encode(secret).byteLength < 32) return false;
    const signature = new Uint8Array(
        signatureHex.match(/.{2}/g)?.map(byte => Number.parseInt(byte, 16)) || [],
    );
    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['verify'],
    );
    return crypto.subtle.verify(
        'HMAC',
        key,
        signature,
        new TextEncoder().encode(body),
    );
}

async function relayRequestAuthorization(
    illustId: string,
    secret: string,
): Promise<{ timestamp: string; authorization: string }> {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
    );
    const signature = new Uint8Array(await crypto.subtle.sign(
        'HMAC',
        key,
        new TextEncoder().encode(`${timestamp}:pixiv:${illustId}`),
    ));
    return {
        timestamp,
        authorization: `v1=${Array.from(signature)
            .map(byte => byte.toString(16).padStart(2, '0'))
            .join('')}`,
    };
}

async function fetchFixEmbedPixivRelay(
    illustId: string,
    env: Env,
): Promise<HandlerResponse | null> {
    if (!env.PIXIV_RELAY_URL || !env.PIXIV_RELAY_SECRET) return null;
    if (new TextEncoder().encode(env.PIXIV_RELAY_SECRET).byteLength < 32) return null;
    let endpoint: URL;
    try {
        const base = new URL(env.PIXIV_RELAY_URL);
        const validBase = (base.protocol === 'http:' || base.protocol === 'https:')
            && !base.username
            && !base.password
            && !base.search
            && !base.hash
            && (base.pathname === '/' || base.pathname === '');
        if (!validBase) return null;
        endpoint = new URL(`/pixiv/${illustId}`, base);
    } catch {
        return null;
    }

    try {
        const requestAuthorization = await relayRequestAuthorization(
            illustId,
            env.PIXIV_RELAY_SECRET,
        );
        const response = await fetchWithTimeout(endpoint.toString(), {
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'FixEmbed-Worker/1.0 (+https://fixembed.app)',
                'X-FixEmbed-Timestamp': requestAuthorization.timestamp,
                'X-FixEmbed-Authorization': requestAuthorization.authorization,
            },
            redirect: 'manual',
        }, 3500);
        const contentType = response.headers.get('content-type')?.toLowerCase() || '';
        if (
            !response.ok
            || !contentType.includes('application/json')
            || !boundedBodyLength(response, MAX_PIXIV_RELAY_BYTES)
        ) {
            console.warn('first_party_fetch_failed', {
                platform: 'pixiv',
                stage: 'fixembed_relay',
                status: response.status,
            });
            return null;
        }
        const rawPayload = await response.text();
        if (new TextEncoder().encode(rawPayload).byteLength > MAX_PIXIV_RELAY_BYTES) {
            return null;
        }
        if (!await verifyRelaySignature(
            rawPayload,
            response.headers.get('x-fixembed-signature'),
            env.PIXIV_RELAY_SECRET,
        )) {
            console.warn('first_party_payload_rejected', {
                platform: 'pixiv',
                stage: 'fixembed_relay',
                reason: 'invalid_signature',
            });
            return null;
        }
        const payload = JSON.parse(rawPayload) as PixivRelayResponse;
        const title = boundedRelayText(payload.title, 300);
        const authorName = boundedRelayText(payload.authorName, 200);
        const authorId = boundedRelayText(payload.authorId, 24);
        const avatar = trustedPixivMediaUrl(payload.authorAvatar);
        const images = Array.isArray(payload.images)
            ? payload.images.map(image => trustedPixivMediaUrl(image))
            : [];
        const timestamp = boundedRelayText(payload.timestamp, 64);
        const authorHandle = boundedRelayText(
            payload.authorHandle?.replace(/^@/, ''),
            100,
        );
        const validTimestamp = timestamp && Number.isFinite(Date.parse(timestamp))
            ? timestamp
            : undefined;
        const identityMatches = payload.version === 1
            && payload.id === illustId
            && title
            && authorName
            && authorId
            && /^\d{1,24}$/.test(authorId)
            && avatar
            && images.length > 0
            && images.length <= 10
            && images.every((image): image is string => Boolean(image));
        if (!identityMatches) {
            console.warn('first_party_payload_rejected', {
                platform: 'pixiv',
                stage: 'fixembed_relay',
                reason: 'schema_or_identity',
            });
            return null;
        }
        const normalizedImages = (images as string[]).map(image => proxyPixivImage(image, env));
        const stats = [
            relayMetric(payload.stats?.comments) !== undefined
                ? `💬 ${formatNumber(payload.stats!.comments!)}` : '',
            relayMetric(payload.stats?.likes) !== undefined
                ? `❤️ ${formatNumber(payload.stats!.likes!)}` : '',
            relayMetric(payload.stats?.views) !== undefined
                ? `👁️ ${formatNumber(payload.stats!.views!)}` : '',
            relayMetric(payload.stats?.bookmarks) !== undefined
                ? `🔖 ${formatNumber(payload.stats!.bookmarks!)}` : '',
        ].filter(Boolean).join(' ');
        return {
            success: true,
            source: 'first-party',
            data: {
                title,
                description: cleanPixivDescription(
                    boundedRelayText(payload.description, 4000),
                ),
                url: `https://www.pixiv.net/artworks/${illustId}`,
                siteName: getBrandedSiteName('pixiv'),
                authorName,
                authorHandle: authorHandle ? `@${authorHandle}` : undefined,
                authorUrl: `https://www.pixiv.net/en/users/${authorId}`,
                authorAvatar: proxyPixivImage(avatar, env),
                image: normalizedImages.length === 1 ? normalizedImages[0] : undefined,
                images: normalizedImages.length > 1 ? normalizedImages : undefined,
                color: platformColors.pixiv,
                platform: 'pixiv',
                timestamp: validTimestamp,
                stats,
            },
        };
    } catch (error) {
        console.warn('first_party_fetch_failed', {
            platform: 'pixiv',
            stage: 'fixembed_relay',
            errorType: error instanceof Error ? error.name : 'UnknownError',
        });
        return null;
    }
}

function extractHtmlAttribute(tag: string, name: string): string | undefined {
    const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'));
    return match?.[2];
}

function extractPhixivActivityReference(html: string): PhixivActivityReference | null {
    for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
        const tag = match[0];
        if (extractHtmlAttribute(tag, 'type')?.toLowerCase() !== 'application/activity+json') {
            continue;
        }
        const href = extractHtmlAttribute(tag, 'href');
        if (!href) continue;
        try {
            const parsed = new URL(href.replace(/&amp;/gi, '&'));
            const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
            const path = parsed.pathname.match(/^\/users\/(\d{1,24})\/statuses\/(\d{1,32})\/?$/);
            if (parsed.protocol === 'https:' && hostname === 'phixiv.net' && path) {
                return { authorId: path[1], activityId: path[2] };
            }
        } catch {
            continue;
        }
    }
    return null;
}

function buildPhixivActivityReference(illustId: string): PhixivActivityReference | null {
    try {
        const numericId = BigInt(illustId);
        if (numericId <= 0n || numericId > 0xFFFF_FFFFn) return null;
        return { activityId: (numericId << 16n).toString() };
    } catch {
        return null;
    }
}

function extractPhixivActivityContent(content: string | undefined): {
    title?: string;
    description?: string;
} {
    if (!content) return {};
    const titleMarkup = content.match(
        /<strong>\s*<a\b[^>]*>([\s\S]*?)<\/a>\s*<\/strong>/i,
    )?.[1] || content.match(/^\*\*\[(.+?)\]\([^\n]+\)\*\*/)?.[1];
    const title = cleanPixivDescription(titleMarkup) || undefined;
    const lines = cleanPixivDescription(content).split('\n');
    if (title && lines[0]?.includes(title)) lines.shift();
    if (/^by\s+/i.test(lines[0]?.trim() || '')) lines.shift();
    return {
        title,
        description: lines.join('\n').trim() || undefined,
    };
}

async function fetchPhixivCreatorIdentity(
    illustId: string,
    suppliedReference?: PhixivActivityReference,
): Promise<PhixivCreatorIdentity | null> {
    const reference = suppliedReference || buildPhixivActivityReference(illustId);
    if (!reference) return null;
    const remainingProviderTime = createTimeoutBudget(PHIXIV_ACTIVITY_TIMEOUT_MS);
    const providers = PHIXIV_ACTIVITY_ORIGINS.map(
        origin => `${origin}/api/v1/statuses/${reference.activityId}`,
    );
    for (const providerUrl of providers) {
        const timeoutMs = remainingProviderTime();
        if (timeoutMs <= 0) break;
        try {
            const response = await fetchWithTimeout(
                providerUrl,
                {
                    headers: {
                        'Accept': 'application/json',
                        'User-Agent': 'Mozilla/5.0 (compatible; FixEmbed/1.0; +https://fixembed.app)',
                    },
                    redirect: 'manual',
                },
                timeoutMs,
            );
            const contentType = response.headers.get('content-type')?.toLowerCase() || '';
            if (
                !response.ok
                || !contentType.includes('application/json')
                || !boundedBodyLength(response, MAX_PHIXIV_ACTIVITY_BYTES)
            ) {
                console.warn('fallback_fetch_failed', {
                    platform: 'pixiv',
                    provider: 'phixiv_activity',
                    status: response.status,
                });
                continue;
            }
            const rawPayload = await response.text();
            if (new TextEncoder().encode(rawPayload).byteLength > MAX_PHIXIV_ACTIVITY_BYTES) {
                console.warn('fallback_payload_rejected', {
                    platform: 'pixiv',
                    provider: 'phixiv_activity',
                    reason: 'actual_size',
                });
                continue;
            }
            const payload = JSON.parse(rawPayload) as PhixivActivityResponse;
            const account = payload.account;
            const accountId = account?.id;
            const identityMismatch = payload.id !== illustId
                || !account
                || !accountId
                || !/^\d{1,24}$/.test(accountId)
                || (reference.authorId !== undefined && accountId !== reference.authorId);
            if (identityMismatch) {
                console.warn('fallback_payload_rejected', {
                    platform: 'pixiv',
                    provider: 'phixiv_activity',
                    reason: 'identity_mismatch',
                });
                return null;
            }
            const rawAvatar = trustedPhixivMediaUrl(
                account.avatar_static || account.avatar,
            );
            const avatar = rawAvatar
                ? trustedPhixivMediaUrl(upgradePixivAvatarUrl(rawAvatar))
                : undefined;
            const content = extractPhixivActivityContent(payload.content);
            const images = (payload.media_attachments || [])
                .filter(attachment => attachment.type === 'image')
                .map(attachment => trustedPhixivMediaUrl(attachment.url || attachment.preview_url))
                .filter((url): url is string => Boolean(url))
                .slice(0, 10);
            return {
                name: account.display_name?.trim().slice(0, 200) || undefined,
                url: trustedPixivAuthorUrl(`https://www.pixiv.net/users/${accountId}`),
                avatar,
                timestamp: payload.created_at,
                title: content.title,
                description: content.description,
                images,
            };
        } catch (error) {
            console.warn('fallback_fetch_failed', {
                platform: 'pixiv',
                provider: 'phixiv_activity',
                errorType: error instanceof Error ? error.name : 'UnknownError',
            });
        }
    }
    return null;
}

function cleanPixivDescription(value: string | undefined): string {
    let description = (value || '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(?:div|p)>/gi, '\n')
        .replace(/<[^>]+>/g, '');
    const decodeCodePoint = (match: string, code: string, radix: number): string => {
        const parsed = Number.parseInt(code, radix);
        return Number.isInteger(parsed) && parsed >= 0 && parsed <= 0x10FFFF
            ? String.fromCodePoint(parsed)
            : match;
    };
    for (let pass = 0; pass < 2; pass += 1) {
        description = description
            .replace(/&#x([0-9a-f]+);/gi, (match, code: string) => decodeCodePoint(match, code, 16))
            .replace(/&#(\d+);/g, (match, code: string) => decodeCodePoint(match, code, 10))
            .replace(/&quot;/gi, '"')
            .replace(/&apos;|&#39;/gi, "'")
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&amp;/gi, '&');
    }
    return description
        .replace(/\r\n?/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function findPixivProfileImage(
    artwork: NonNullable<PixivArtworkResponse['body']>,
    illustId: string,
): string | undefined {
    return artwork.profileImageUrl
        || artwork.userIllusts?.[illustId]?.profileImageUrl
        || Object.values(artwork.userIllusts || {}).find(work => work?.profileImageUrl)?.profileImageUrl;
}

async function fetchPixivArtwork(illustId: string, env: Env): Promise<HandlerResponse | null> {
    try {
        const response = await fetch(`https://www.pixiv.net/ajax/illust/${illustId}`, {
            headers: {
                'Accept': 'application/json',
                'Referer': `https://www.pixiv.net/artworks/${illustId}`,
                'User-Agent': 'Mozilla/5.0 (compatible; FixEmbed/1.0; +https://fixembed.app)',
            },
        });
        if (!response.ok) {
            console.warn('first_party_fetch_failed', {
                platform: 'pixiv',
                stage: 'artwork',
                status: response.status,
            });
            return null;
        }
        const payload = await response.json() as PixivArtworkResponse;
        const artwork = payload?.body;
        if (payload?.error || !artwork?.title) {
            console.warn('first_party_payload_rejected', {
                platform: 'pixiv',
                stage: 'artwork',
                upstreamError: payload?.error === true,
                hasTitle: Boolean(artwork?.title),
            });
            return null;
        }
        const sourceImage = artwork.urls?.regular || artwork.urls?.original;
        let profileImage = findPixivProfileImage(artwork, illustId);
        let image = sourceImage ? proxyPixivImage(sourceImage, env) : undefined;
        let images: string[] | undefined;
        try {
            const pagesResponse = await fetch(`https://www.pixiv.net/ajax/illust/${illustId}/pages`, {
                headers: {
                    'Accept': 'application/json',
                    'Referer': `https://www.pixiv.net/artworks/${illustId}`,
                    'User-Agent': 'Mozilla/5.0 (compatible; FixEmbed/1.0; +https://fixembed.app)',
                },
            });
            if (pagesResponse.ok) {
                const pagesPayload = await pagesResponse.json() as PixivArtworkPagesResponse;
                const pageImages = (pagesPayload.body || [])
                    .map(page => page.urls?.regular || page.urls?.original)
                    .filter((url): url is string => Boolean(url))
                    .map(url => proxyPixivImage(url, env))
                    .slice(0, 10);
                if (pageImages.length === 1) [image] = pageImages;
                if (pageImages.length > 1) {
                    images = pageImages;
                    image = undefined;
                }
            }
        } catch (error) {
            console.warn('Pixiv pages request failed:', error);
        }

        if (artwork.userId && /^\d+$/.test(artwork.userId)) {
            try {
                const profileResponse = await fetch(
                    `https://www.pixiv.net/ajax/user/${artwork.userId}?full=1&lang=en`,
                    {
                        headers: {
                            'Accept': 'application/json',
                            'Referer': `https://www.pixiv.net/en/users/${artwork.userId}`,
                            'User-Agent': 'Mozilla/5.0 (compatible; FixEmbed/1.0; +https://fixembed.app)',
                        },
                    },
                );
                if (profileResponse.ok) {
                    const profilePayload = await profileResponse.json() as PixivUserResponse;
                    if (!profilePayload.error) {
                        profileImage = profilePayload.body?.imageBig
                            || profilePayload.body?.image
                            || profileImage;
                    }
                }
            } catch (error) {
                console.warn('Pixiv profile request failed:', error);
            }
        }

        const stats = [
            artwork.commentCount !== undefined ? `💬 ${formatNumber(artwork.commentCount)}` : '',
            artwork.likeCount !== undefined ? `❤️ ${formatNumber(artwork.likeCount)}` : '',
            artwork.viewCount !== undefined ? `👁️ ${formatNumber(artwork.viewCount)}` : '',
            artwork.bookmarkCount !== undefined ? `🔖 ${formatNumber(artwork.bookmarkCount)}` : '',
        ].filter(Boolean).join(' ');
        return {
            success: true,
            source: 'first-party',
            data: {
                title: artwork.title,
                description: cleanPixivDescription(artwork.description),
                url: `https://www.pixiv.net/artworks/${illustId}`,
                siteName: getBrandedSiteName('pixiv'),
                authorName: artwork.userName,
                authorHandle: artwork.userAccount ? `@${artwork.userAccount}` : undefined,
                authorUrl: artwork.userId ? `https://www.pixiv.net/en/users/${artwork.userId}` : undefined,
                authorAvatar: profileImage ? proxyPixivImage(profileImage, env) : undefined,
                image,
                images,
                color: platformColors.pixiv,
                platform: 'pixiv',
                timestamp: artwork.createDate,
                stats,
            },
        };
    } catch (error) {
        console.warn('Pixiv direct request failed:', error);
        return null;
    }
}

async function fetchPixivOEmbed(illustId: string, env: Env): Promise<HandlerResponse | null> {
    try {
        const canonicalUrl = `https://www.pixiv.net/artworks/${illustId}`;
        const endpoint = `https://embed.pixiv.net/oembed.php?url=${encodeURIComponent(canonicalUrl)}`;
        const response = await fetchWithTimeout(endpoint, {
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (compatible; FixEmbed/1.0; +https://fixembed.app)',
            },
        }, 5000);
        if (!response.ok) {
            console.warn('first_party_fetch_failed', {
                platform: 'pixiv',
                stage: 'oembed',
                status: response.status,
            });
            return null;
        }

        const declaredLength = Number(response.headers.get('content-length') || 0);
        if (Number.isFinite(declaredLength) && declaredLength > MAX_PIXIV_OEMBED_BYTES) {
            console.warn('first_party_payload_rejected', {
                platform: 'pixiv',
                stage: 'oembed',
                reason: 'declared_size',
            });
            return null;
        }
        const rawPayload = await response.text();
        if (new TextEncoder().encode(rawPayload).byteLength > MAX_PIXIV_OEMBED_BYTES) {
            console.warn('first_party_payload_rejected', {
                platform: 'pixiv',
                stage: 'oembed',
                reason: 'actual_size',
            });
            return null;
        }

        const payload = JSON.parse(rawPayload) as PixivOEmbedResponse;
        const image = trustedPixivMediaUrl(payload.thumbnail_url);
        if (!payload.title || !image) {
            console.warn('first_party_payload_rejected', {
                platform: 'pixiv',
                stage: 'oembed',
                hasTitle: Boolean(payload.title),
                hasImage: Boolean(image),
            });
            return null;
        }

        return {
            success: true,
            source: 'first-party',
            data: {
                title: payload.title,
                description: '',
                url: canonicalUrl,
                siteName: getBrandedSiteName('pixiv'),
                authorName: payload.author_name,
                authorUrl: trustedPixivAuthorUrl(payload.author_url),
                image: proxyPixivImage(image, env),
                color: platformColors.pixiv,
                platform: 'pixiv',
                timestamp: extractPostTimestampFromHtml(image),
            },
        };
    } catch (error) {
        console.warn('Pixiv official oEmbed request failed:', error);
        return null;
    }
}

function hasCompletePixivIdentity(response: HandlerResponse | null): boolean {
    const data = response?.data;
    return Boolean(
        response?.success
        && data
        && data.title
        && data.title.trim().toLowerCase() !== 'pixiv artwork'
        && data.authorName
        && data.authorUrl
        && data.timestamp
        && (data.image || data.images?.length),
    );
}

// Scrape phixiv.net HTML for OG tags
async function scrapePhixivHtml(illustId: string): Promise<{
    success: boolean;
    title?: string;
    image?: string;
    images?: string[];
    description?: string;
    author?: string;
    authorUrl?: string;
    authorAvatar?: string;
    timestamp?: string;
    error?: string;
}> {
    let html = '';
    try {
        const phixivUrl = `https://www.phixiv.net/artworks/${illustId}`;
        const response = await fetchWithTimeout(phixivUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
                'Accept': 'text/html',
            },
            redirect: 'manual',
        }, 5000);

        const contentType = response.headers.get('content-type')?.toLowerCase() || '';
        if (
            response.ok
            && contentType.includes('text/html')
            && boundedBodyLength(response, MAX_PHIXIV_HTML_BYTES)
        ) {
            const responseHtml = await response.text();
            if (new TextEncoder().encode(responseHtml).byteLength <= MAX_PHIXIV_HTML_BYTES) {
                html = responseHtml;
            }
        }
        if (!html) {
            console.warn('fallback_fetch_failed', {
                platform: 'pixiv',
                provider: 'phixiv_html',
                status: response.status,
            });
        }
    } catch (error) {
        console.warn('fallback_fetch_failed', {
            platform: 'pixiv',
            provider: 'phixiv_html',
            errorType: error instanceof Error ? error.name : 'UnknownError',
        });
    }

    const ogTitle = html.match(/<meta property="og:title" content="([^"]+)"/)?.[1];
    const ogImage = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1];
    const ogDesc = html.match(/<meta property="og:description" content="([^"]+)"/)?.[1];
    let title = ogTitle;
    let author: string | undefined;
    const authorMatch = ogTitle?.match(/(.+?) by \(@([^)]+)\)/);
    if (authorMatch) {
        title = authorMatch[1];
        author = authorMatch[2];
    }

    const activityReference = html ? extractPhixivActivityReference(html) : null;
    const creator = await fetchPhixivCreatorIdentity(
        illustId,
        activityReference || undefined,
    );
    const activityImages = creator?.images || [];
    const image = ogImage || (activityImages.length === 1 ? activityImages[0] : undefined);
    const images = !ogImage && activityImages.length > 1 ? activityImages : undefined;
    return {
        success: Boolean(image || images?.length),
        title: title || creator?.title || 'Pixiv Artwork',
        image,
        images,
        description: ogDesc || creator?.description,
        author: creator?.name || author,
        authorUrl: creator?.url,
        authorAvatar: creator?.avatar,
        timestamp: extractPostTimestampFromHtml(html) || creator?.timestamp,
        error: image || images?.length ? undefined : 'Phixiv metadata request failed',
    };
}

export const pixivHandler: PlatformHandler = {
    name: 'pixiv',
    patterns: [
        /pixiv\.net\/(?:\w+\/)?artworks\/(\d+)/i,
        /pixiv\.net\/member_illust\.php\?.*illust_id=(\d+)/i,
        /pixiv\.net\/i\/(\d+)/i,
    ],

    async handle(url: string, env: Env): Promise<HandlerResponse> {
        // Parse artwork ID from URL
        let illustId: string | null = null;

        const artworkMatch = url.match(/pixiv\.net\/(?:\w+\/)?artworks\/(\d+)/i);
        const legacyMatch = url.match(/pixiv\.net\/member_illust\.php\?.*illust_id=(\d+)/i);
        const shortMatch = url.match(/pixiv\.net\/i\/(\d+)/i);

        illustId = artworkMatch?.[1] || legacyMatch?.[1] || shortMatch?.[1] || null;

        if (!illustId) {
            return { success: false, error: 'Invalid Pixiv URL' };
        }

        const canonicalUrl = `https://www.pixiv.net/artworks/${illustId}`;

        try {
            const directResult = await fetchPixivArtwork(illustId, env);
            if (directResult) return directResult;

            const officialEmbedResult = await fetchPixivOEmbed(illustId, env);
            if (hasCompletePixivIdentity(officialEmbedResult)) return officialEmbedResult!;

            const relayResult = await fetchFixEmbedPixivRelay(illustId, env);
            if (relayResult) return relayResult;

            // Emergency fallback when Pixiv rejects the direct Worker request.
            const scrapeResult = await scrapePhixivHtml(illustId);
            const fallbackImage = trustedPhixivMediaUrl(scrapeResult.image);
            const fallbackImages = (scrapeResult.images || [])
                .map(image => trustedPhixivMediaUrl(image))
                .filter((image): image is string => Boolean(image));

            if (scrapeResult.success && (fallbackImage || fallbackImages.length)) {
                return {
                    success: true,
                    source: 'fallback',
                    data: {
                        title: scrapeResult.title || 'Pixiv Artwork',
                        description: cleanPixivDescription(scrapeResult.description),
                        url: canonicalUrl,
                        siteName: getBrandedSiteName('pixiv'),
                        authorName: scrapeResult.author,
                        authorUrl: scrapeResult.authorUrl,
                        authorAvatar: scrapeResult.authorAvatar
                            ? proxyPixivImage(scrapeResult.authorAvatar, env)
                            : undefined,
                        image: fallbackImage ? proxyPixivImage(fallbackImage, env) : undefined,
                        images: fallbackImages.length
                            ? fallbackImages.map(image => proxyPixivImage(image, env))
                            : undefined,
                        color: platformColors.pixiv,
                        platform: 'pixiv',
                        timestamp: scrapeResult.timestamp,
                    },
                };
            }

            // Pixiv's oEmbed endpoint can return a generic media-only card. Keep
            // that useful result, but only after richer identity recovery paths.
            if (officialEmbedResult) return officialEmbedResult;

            // Fallback to basic redirect
            return {
                success: true,
                source: 'first-party',
                data: {
                    title: 'Pixiv Artwork',
                    description: `View artwork #${illustId} on Pixiv`,
                    url: canonicalUrl,
                    siteName: getBrandedSiteName('pixiv'),
                    color: platformColors.pixiv,
                    platform: 'pixiv',
                },
            };
        } catch (error) {
            console.error('Pixiv handler error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch artwork',
                redirect: canonicalUrl,
            };
        }
    },
};
