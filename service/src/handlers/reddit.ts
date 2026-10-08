/**
 * FixEmbed Service - Reddit Handler
 */

import type { EmbedData, Env, HandlerOptions, HandlerResponse, PlatformHandler } from '../types.ts';
import {
    createTimeoutBudget,
    parseRedditUrl,
    fetchJSON,
    fetchWithTimeout,
    truncateText,
} from '../utils/fetch.ts';
import {
    RedditFetchTrace,
    responseStatus,
    timeRedditFetch,
    type RedditCommentIds,
    type RedditCommentOutcome,
    type RedditFetchStage,
    type RedditShareIds,
} from '../utils/reddit_timing.ts';
import { platformColors, getBrandedSiteName, formatStats } from '../utils/embed.ts';
import { extractPostTimestampFromHtml } from '../utils/timestamp.ts';
import { decodeHtmlText, redditHtmlToDiscordMarkdown, stripUnsafeText } from '../utils/markdown.ts';

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
    gallery_data?: {
        items: Array<{ media_id: string }>;
    };
    media_metadata?: Record<string, {
        status?: string;
        e?: string;
        s?: {
            u?: string;
            gif?: string;
        };
    }>;
    sr_detail?: {
        icon_img?: string;
        community_icon?: string;
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
    over_18?: boolean;
    spoiler?: boolean;
}

interface RedditComment {
    id: string;
    author: string;
    body: string;
    score: number;
    ups?: number;
    permalink: string;
    created_utc: number;
    parent_id?: string;
    link_id?: string;
    edited?: boolean | number;
}

interface RedditListingChild<T> {
    kind: string;
    data: T;
}

interface RedditCommunityResponse {
    data?: {
        icon_img?: string;
        community_icon?: string;
    };
}

interface RedditOEmbedResponse {
    author_name?: string;
    title?: string;
}

const REDDIT_FALLBACK_ICON = 'https://www.redditstatic.com/desktop2x/img/favicon/android-icon-192x192.png';
const MAX_ARTICLE_HTML_BYTES = 512_000;
const MAX_REDDIT_EMBED_HTML_BYTES = 512_000;
const MAX_REDDIT_MANIFEST_BYTES = 128_000;
const MAX_REDDIT_VIDEO_HEIGHT = 720;

/**
 * Time limits for a Reddit comment permalink (#98). The bot gives /api/embed 15s
 * with no retry, and every Reddit call used to get fetchWithTimeout's default 10s,
 * so one slow call could cost ~10s. Each call now has its own cap, and all of them
 * share one budget so a retry or a later stage can never push the request past it.
 * A `/s/` share link starts the budget at its resolve probe, since it may lead to a
 * comment (#108). Posts and other platforms keep the default.
 */
export const REDDIT_COMMENT_TIMEOUTS = {
    /** Whole comment request, from the canonical-path or share-link probe to the last icon lookup. */
    budgetMs: 8_000,
    /** Canonical-path or share-link probe (`probe`). */
    probeMs: 3_000,
    /** Reddit's JSON API, headers and body (`json`). */
    jsonMs: 3_000,
    /** old.reddit page headers (`old_reddit`), and separately its body read (`old_reddit_body`). */
    oldRedditMs: 4_000,
    /** Each subreddit icon lookup, headers and body (`icon*`). */
    iconMs: 2_000,
    /** old.reddit is retried once only when at least this much budget is left. */
    minRetryMs: 1_000,
    /** Icon lookups are skipped (fallback icon) when less than this is left. */
    minIconMs: 250,
} as const;

/** Remaining time from a comment request's budget, capped at `maxMs`. */
type RedditCommentBudget = (maxMs?: number) => number;

function isRedditTimeoutError(error: unknown): boolean {
    const name = typeof error === 'object' && error !== null && 'name' in error
        ? String((error as { name?: unknown }).name)
        : '';
    return name === 'AbortError' || name === 'TimeoutError';
}

/**
 * fetchJSON for the comment path: one timeout covers the response headers and the
 * JSON body read. Non-2xx throws the same `HTTP <status>: <text>` error as fetchJSON.
 */
async function fetchRedditCommentJSON<T>(
    url: string,
    headers: Record<string, string>,
    timeoutMs: number,
): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, {
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'FixEmbed/1.0',
                ...headers,
            },
            signal: controller.signal,
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return await response.json() as T;
    } finally {
        clearTimeout(timeoutId);
    }
}

type RedditVideo = {
    url: string;
    width: number;
    height: number;
    thumbnail?: string;
};

function decodeRedditHtml(value: string): string {
    return value
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .trim();
}

/**
 * Decode HTML entities in old.reddit text exactly once, so `&amp;gt;` stays the
 * literal text `&gt;`, and drop control and bidi characters (#90). One decoder
 * for the crawler and the markdown converter (#96).
 */
export const decodeHtmlEntitiesOnce = decodeHtmlText;

function safeDecodeURIComponent(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function redditGalleryImages(post: RedditPost): string[] {
    return (post.gallery_data?.items || [])
        .map(({ media_id }) => {
            const source = post.media_metadata?.[media_id]?.s;
            return source?.u || source?.gif || '';
        })
        .filter(Boolean)
        .map(decodeRedditHtml);
}

function redditCookieHeader(response: Response): string {
    const headers = response.headers as Headers & { getSetCookie?: () => string[] };
    const values = headers.getSetCookie?.() || [headers.get('set-cookie') || ''];
    return values
        .flatMap((value) => value.split(/,(?=\s*[^=;,\s]+\s*=)/))
        .map((value) => value.split(';', 1)[0]?.trim())
        .filter((value): value is string => Boolean(value?.includes('=')))
        .join('; ');
}

async function fetchSubredditIcon(
    subreddit: string,
    fallback = '',
    initialCookie = '',
    trace?: RedditFetchTrace,
    budget?: RedditCommentBudget,
): Promise<string | undefined> {
    const fallbackIcon = decodeRedditHtml(fallback) || undefined;
    const encodedSubreddit = encodeURIComponent(safeDecodeURIComponent(subreddit));
    // Comment path (#98): too little budget left for a lookup means the fallback icon.
    const outOfTime = () => budget !== undefined && budget() < REDDIT_COMMENT_TIMEOUTS.minIconMs;
    const fetchCommunityIcon = async (
        cookie = '',
        stages: readonly RedditFetchStage[] = ['icon', 'icon_fallback'],
    ): Promise<string | undefined> => {
        const headers: Record<string, string> = {
            'Accept': 'application/json',
            'User-Agent': 'Discordbot/2.0; +https://fixembed.app',
        };
        if (cookie) headers.Cookie = cookie;
        const urls = [
            `https://api.reddit.com/r/${encodedSubreddit}/about?raw_json=1`,
            `https://www.reddit.com/r/${encodedSubreddit}/about.json?raw_json=1`,
        ];
        let lastError: unknown;
        for (const [index, url] of urls.entries()) {
            if (outOfTime()) break;
            try {
                const community = await timeRedditFetch(
                    trace,
                    stages[index],
                    () => budget
                        ? fetchRedditCommentJSON<RedditCommunityResponse>(
                            url,
                            headers,
                            budget(REDDIT_COMMENT_TIMEOUTS.iconMs),
                        )
                        : fetchJSON<RedditCommunityResponse>(url, { headers }),
                );
                const icon = decodeRedditHtml(
                    community?.data?.community_icon || community?.data?.icon_img || '',
                );
                if (icon) return icon;
            } catch (error) {
                lastError = error;
                // Try Reddit's alternate public community endpoint.
            }
        }
        if (lastError) throw lastError;
        return undefined;
    };

    try {
        return await fetchCommunityIcon(initialCookie) || fallbackIcon;
    } catch {
        if (initialCookie) return fallbackIcon;
    }

    if (outOfTime()) return fallbackIcon;
    try {
        const bootstrap = await timeRedditFetch(trace, 'icon_bootstrap', () => fetchWithTimeout(
            `https://embed.reddit.com/r/${encodedSubreddit}/`,
            {
                headers: {
                    'Accept': 'text/html',
                    'User-Agent': 'Mozilla/5.0 (compatible; FixEmbed/1.0; +https://fixembed.app)',
                },
            },
            budget?.(REDDIT_COMMENT_TIMEOUTS.iconMs),
        ), responseStatus);
        if (!bootstrap.ok) return fallbackIcon;
        const cookie = redditCookieHeader(bootstrap);
        if (!cookie) return fallbackIcon;
        return await fetchCommunityIcon(cookie, ['icon_retry', 'icon_retry_fallback']) || fallbackIcon;
    } catch {
        return fallbackIcon;
    }
}

function publicHttpsUrl(value: string, base?: string): URL | undefined {
    try {
        const parsed = new URL(decodeRedditHtml(value), base);
        const host = parsed.hostname.toLowerCase();
        if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return undefined;
        if (parsed.port && parsed.port !== '443') return undefined;
        if (!host.includes('.') || host.includes(':') || /^\d+(?:\.\d+){3}$/.test(host)) return undefined;
        if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
            return undefined;
        }
        return parsed;
    } catch {
        return undefined;
    }
}

function linkedArticleUrl(value: string): string | undefined {
    const destination = publicHttpsUrl(value);
    if (!destination) return undefined;
    if (/(^|\.)reddit\.com$|(^|\.)redd\.it$/i.test(destination.hostname)) return undefined;
    return destination.toString();
}

function directRedditImageUrl(value: string): string | undefined {
    const destination = publicHttpsUrl(value);
    if (!destination || destination.hostname.toLowerCase() !== 'i.redd.it') return undefined;
    if (!/\.(?:jpe?g|png|gif|webp)$/i.test(destination.pathname)) return undefined;
    return destination.toString();
}

function redditCrawlerPreviewUrl(value: string, base: string): string | undefined {
    const destination = publicHttpsUrl(value, base);
    if (!destination) return undefined;

    const hostname = destination.hostname.toLowerCase().replace(/^www\./, '');
    const pathname = destination.pathname.toLowerCase();
    const genericRedditArtwork = hostname === 'redditstatic.com'
        && (pathname === '/new-icon.png'
            || pathname === '/desktop2x/img/favicon/android-icon-192x192.png');
    return genericRedditArtwork ? undefined : destination.toString();
}

function linkedArticleSection(value: string | undefined) {
    if (!value) return undefined;
    const destination = new URL(value);
    return [{
        kind: 'link-card' as const,
        title: 'Open linked article',
        body: destination.hostname.replace(/^www\./i, ''),
        url: destination.toString(),
    }];
}

/**
 * Read up to `maxBytes` of a response body as text. With `timeoutMs`, a read that
 * is still going after that long cancels the body and throws a `TimeoutError`.
 */
async function readBoundedText(response: Response, maxBytes: number, timeoutMs?: number): Promise<string> {
    const declared = Number.parseInt(response.headers.get('Content-Length') || '', 10);
    if (Number.isFinite(declared) && declared > maxBytes) return '';
    if (!response.body) return '';

    const reader = response.body.getReader();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const deadline = timeoutMs === undefined
        ? undefined
        : new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => {
                reject(new DOMException('Response body read timed out', 'TimeoutError'));
                reader.cancel().catch(() => {});
            }, timeoutMs);
        });
    const decoder = new TextDecoder();
    let size = 0;
    let html = '';
    try {
        while (true) {
            const { done, value } = await (deadline ? Promise.race([reader.read(), deadline]) : reader.read());
            if (done) break;
            size += value.byteLength;
            if (size > maxBytes) {
                await reader.cancel();
                return '';
            }
            html += decoder.decode(value, { stream: true });
        }
    } finally {
        clearTimeout(timeoutId);
    }
    return html + decoder.decode();
}

function articleMetaContent(html: string, key: string): string | undefined {
    for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
        const tag = match[0];
        const metaKey = htmlAttribute(tag, 'property') || htmlAttribute(tag, 'name');
        if (metaKey.toLowerCase() === key.toLowerCase()) {
            return htmlAttribute(tag, 'content') || undefined;
        }
    }
    return undefined;
}

async function fetchArticleImage(articleUrl: string | undefined): Promise<string | undefined> {
    if (!articleUrl) return undefined;
    try {
        const response = await fetchWithTimeout(articleUrl, {
            redirect: 'manual',
            headers: {
                'Accept': 'text/html,application/xhtml+xml',
                'User-Agent': 'Mozilla/5.0 (compatible; FixEmbed/1.0; +https://fixembed.app)',
            },
        }, 5_000);
        const contentType = response.headers.get('Content-Type') || '';
        if (!response.ok || !/^text\/html\b/i.test(contentType)) return undefined;
        const html = await readBoundedText(response, MAX_ARTICLE_HTML_BYTES);
        const image = articleMetaContent(html, 'og:image') || articleMetaContent(html, 'twitter:image');
        return image ? publicHttpsUrl(image, articleUrl)?.toString() : undefined;
    } catch {
        return undefined;
    }
}

function htmlAttribute(tag: string, name: string): string {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = tag.match(
        new RegExp(`\\b${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'),
    );
    return decodeRedditHtml(
        match?.[1] ?? match?.[2] ?? '',
    );
}

function redditPostBodyFromHtml(html: string, postId?: string): string {
    const escapedPostId = postId?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const body = escapedPostId
        ? html.match(
            new RegExp(
                `<div\\b(?=[^>]*\\bid=["']t3_${escapedPostId}-post-rtjson-content["'])[^>]*>([\\s\\S]*?)<\\/div>`,
                'i',
            ),
        )?.[1]
        : html.match(
            /<div\b(?=[^>]*\bclass=["'][^"']*\bmd\b[^"']*["'])[^>]*>([\s\S]*?)<\/div>/i,
        )?.[1];
    if (!body) return '';

    return redditHtmlToDiscordMarkdown(body);
}

async function redditVideoFromHtml(
    html: string,
    thumbnail?: string,
): Promise<RedditVideo | undefined> {
    const playerTag = html.match(/<div\b(?=[^>]*\bdata-mpd-url=["'])[^>]*>/i)?.[0];
    if (!playerTag) return undefined;

    const manifestUrl = publicHttpsUrl(htmlAttribute(playerTag, 'data-mpd-url'));
    if (
        !manifestUrl
        || manifestUrl.hostname.toLowerCase() !== 'v.redd.it'
        || !/\/DASHPlaylist\.mpd$/i.test(manifestUrl.pathname)
    ) {
        return undefined;
    }

    try {
        const response = await fetchWithTimeout(manifestUrl.toString(), {
            redirect: 'manual',
            headers: {
                'Accept': 'application/dash+xml,application/xml;q=0.9',
                'User-Agent': 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
            },
        }, 5_000);
        const contentType = response.headers.get('Content-Type') || '';
        if (
            !response.ok
            || !/^(?:application\/(?:dash\+xml|xml)|text\/xml)\b/i.test(contentType)
        ) {
            return undefined;
        }

        const manifest = await readBoundedText(response, MAX_REDDIT_MANIFEST_BYTES);
        if (!manifest) return undefined;

        const candidates: Array<{
            url: string;
            width: number;
            height: number;
            bandwidth: number;
        }> = [];
        for (const match of manifest.matchAll(/<Representation\b[^>]*>[\s\S]*?<\/Representation>/gi)) {
            const representation = match[0];
            const tag = representation.match(/<Representation\b[^>]*>/i)?.[0] || '';
            if (htmlAttribute(tag, 'mimeType').toLowerCase() !== 'video/mp4') continue;

            const rawBaseUrl = representation.match(/<BaseURL\b[^>]*>([^<]+)<\/BaseURL>/i)?.[1] || '';
            const mediaUrl = publicHttpsUrl(rawBaseUrl, manifestUrl.toString());
            if (
                !mediaUrl
                || mediaUrl.hostname.toLowerCase() !== manifestUrl.hostname.toLowerCase()
                || !/\.mp4$/i.test(mediaUrl.pathname)
            ) {
                continue;
            }

            const width = Number(htmlAttribute(tag, 'width'));
            const height = Number(htmlAttribute(tag, 'height'));
            const bandwidth = Number(htmlAttribute(tag, 'bandwidth'));
            if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) continue;
            candidates.push({
                url: mediaUrl.toString(),
                width,
                height,
                bandwidth: Number.isFinite(bandwidth) ? bandwidth : 0,
            });
        }

        candidates.sort(
            (left, right) => right.height - left.height
                || right.width - left.width
                || right.bandwidth - left.bandwidth,
        );
        const best = candidates[0];
        if (!best) return undefined;

        return {
            url: best.url,
            width: best.width,
            height: best.height,
            thumbnail,
        };
    } catch {
        return undefined;
    }
}

function redditMuxedVideoFromHtml(html: string, thumbnail?: string): RedditVideo | undefined {
    const decoded = decodeRedditHtml(html);
    const candidates: RedditVideo[] = [];
    const sourcePattern = /"source"\s*:\s*\{\s*"url"\s*:\s*"([^"]+)"\s*,\s*"dimensions"\s*:\s*\{\s*"width"\s*:\s*(\d+)\s*,\s*"height"\s*:\s*(\d+)\s*\}[\s\S]{0,200}?\}/gi;

    for (const match of decoded.matchAll(sourcePattern)) {
        let rawUrl = match[1];
        try {
            rawUrl = JSON.parse(`"${rawUrl}"`) as string;
        } catch {
            rawUrl = rawUrl.replace(/\\u0026/gi, '&').replace(/\\\//g, '/');
        }

        const mediaUrl = publicHttpsUrl(rawUrl);
        const width = Number(match[2]);
        const height = Number(match[3]);
        if (
            !mediaUrl
            || mediaUrl.hostname.toLowerCase() !== 'packaged-media.redd.it'
            || !/\.mp4$/i.test(mediaUrl.pathname)
            || !Number.isFinite(width)
            || width <= 0
            || !Number.isFinite(height)
            || height <= 0
        ) {
            continue;
        }

        candidates.push({
            url: mediaUrl.toString(),
            width,
            height,
            thumbnail,
        });
    }

    candidates.sort((left, right) => right.height - left.height || right.width - left.width);
    return candidates.find(({ height }) => height <= MAX_REDDIT_VIDEO_HEIGHT) || candidates[0];
}

async function fetchRedditMuxedVideo(
    subreddit: string,
    postId: string,
    thumbnail?: string,
): Promise<RedditVideo | undefined> {
    const embedUrl = `https://embed.reddit.com/r/${encodeURIComponent(safeDecodeURIComponent(subreddit))}/comments/${encodeURIComponent(safeDecodeURIComponent(postId))}/`;
    try {
        const response = await fetchWithTimeout(embedUrl, {
            redirect: 'manual',
            headers: {
                'Accept': 'text/html',
                'User-Agent': 'Mozilla/5.0 (compatible; FixEmbed/1.0; +https://fixembed.app)',
            },
        }, 5_000);
        const contentType = response.headers.get('Content-Type') || '';
        if (!response.ok || !/^text\/html\b/i.test(contentType)) return undefined;

        const html = await readBoundedText(response, MAX_REDDIT_EMBED_HTML_BYTES);
        return html ? redditMuxedVideoFromHtml(html, thumbnail) : undefined;
    } catch {
        return undefined;
    }
}

function redditGalleryImagesFromHtml(html: string): string[] {
    const candidates: Array<{ index: number; position?: number; url: string }> = [];
    const seen = new Set<string>();

    for (const [index, match] of Array.from(html.matchAll(/<a\b[^>]*>/gi)).entries()) {
        const tag = match[0];
        const classes = htmlAttribute(tag, 'class').split(/\s+/);
        if (!classes.includes('gallery-item-thumbnail-link')) continue;

        const media = publicHttpsUrl(htmlAttribute(tag, 'href'));
        if (!media || !/(^|\.)preview\.redd\.it$/i.test(media.hostname)) continue;
        if (!/\.(?:jpe?g|png|gif|webp)$/i.test(media.pathname)) continue;
        if (seen.has(media.toString())) continue;

        seen.add(media.toString());
        const rawPosition = htmlAttribute(tag, 'data-position');
        const parsedPosition = rawPosition ? Number(rawPosition) : Number.NaN;
        candidates.push({
            index,
            position: Number.isFinite(parsedPosition) && parsedPosition >= 0
                ? parsedPosition
                : undefined,
            url: media.toString(),
        });
    }

    if (candidates.every(({ position }) => position !== undefined)) {
        candidates.sort(
            (left, right) => left.position! - right.position! || left.index - right.index,
        );
    }
    return candidates.map(({ url }) => url);
}

function redditEmbedGalleryImagesFromHtml(html: string): string[] {
    const gallery = html.match(
        /<gallery-carousel\b[^>]*>([\s\S]*?)<\/gallery-carousel>/i,
    )?.[1];
    if (!gallery) return [];

    const images: string[] = [];
    const seen = new Set<string>();
    for (const match of gallery.matchAll(/<img\b[^>]*>/gi)) {
        const media = publicHttpsUrl(htmlAttribute(match[0], 'src'));
        if (!media || !/(^|\.)preview\.redd\.it$/i.test(media.hostname)) continue;
        if (!/\.(?:jpe?g|png|gif|webp)$/i.test(media.pathname)) continue;

        const url = media.toString();
        if (seen.has(url)) continue;
        seen.add(url);
        images.push(url);
    }
    return images;
}


function findRedditComment(
    children: Array<RedditListingChild<RedditComment & { replies?: unknown }>> | undefined,
    commentId: string,
): RedditComment | undefined {
    if (!children?.length) return undefined;
    const needle = commentId.toLowerCase();
    for (const child of children) {
        if (child?.kind !== 't1' || !child.data) continue;
        if (String(child.data.id || '').toLowerCase() === needle) {
            return child.data;
        }
        const replies = child.data.replies;
        if (replies && typeof replies === 'object' && replies !== null && 'data' in replies) {
            const nested = (replies as { data?: { children?: Array<RedditListingChild<RedditComment & { replies?: unknown }>> } })
                .data?.children;
            const found = findRedditComment(nested, commentId);
            if (found) return found;
        }
    }
    return undefined;
}

/** Reddit's author placeholder for a deleted account, or no author at all. */
function isRedditDeletedAuthor(author: string | undefined): boolean {
    const normalized = String(author || '').trim().replace(/^u\//i, '');
    return !normalized || /^\[(?:deleted|removed)\]$/i.test(normalized);
}

/**
 * Whether Reddit says a comment is gone (#106). A body of exactly `[deleted]` or
 * `[removed]` counts only when the author is gone too, because a live user can
 * type that text. A deleted account alone keeps its body, so the author by itself
 * is not a deletion signal either. Reddit never serves an empty body for a live
 * comment, so an empty body stays gone as before.
 */
function isRedditGoneComment(author: string | undefined, body: string | undefined): boolean {
    const normalized = String(body || '').trim();
    if (!normalized) return true;
    return (normalized === '[deleted]' || normalized === '[removed]') && isRedditDeletedAuthor(author);
}

function isUnavailableRedditComment(comment: RedditComment | undefined): boolean {
    if (!comment) return true;
    return isRedditGoneComment(comment.author, comment.body);
}

/** Reddit user identity for cards. Deleted accounts get a plain `[deleted]` label and no profile link. */
function redditUserIdentity(author: string | undefined): { name: string; url?: string } | undefined {
    const username = String(author || '').trim().replace(/^u\//i, '');
    if (!username) return undefined;
    if (/^\[(?:deleted|removed)\]$/i.test(username)) return { name: '[deleted]' };
    return {
        name: `u/${username}`,
        url: `https://www.reddit.com/user/${encodeURIComponent(username)}/`,
    };
}

function commentPermalink(
    subreddit: string,
    postId: string,
    commentId: string,
    permalink?: string,
): string {
    if (permalink) {
        try {
            return new URL(permalink, 'https://www.reddit.com').toString();
        } catch {
            // Fall through to a constructed permalink.
        }
    }
    return `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/comments/${encodeURIComponent(postId)}/_/${encodeURIComponent(commentId)}/`;
}


function buildRedditCommentCard(options: {
    subreddit: string;
    postId: string;
    commentId: string;
    commentAuthor: string;
    commentBody: string;
    commentPermalinkPath?: string;
    commentScore?: number;
    commentTimestamp?: string;
    parentTitle: string;
    parentUrl: string;
    parentAuthor?: string;
    parentCommentCount?: number;
    parentImage?: string;
    /** Parent post `over_18`. Same NSFW classification post cards already use. */
    parentOver18?: boolean;
    /** Parent post `spoiler`. Same spoiler classification post cards already use. */
    parentSpoiler?: boolean;
    authorAvatar?: string;
}): EmbedData {
    const commentAuthor = redditUserIdentity(options.commentAuthor) || { name: '[deleted]' };
    const parentAuthor = redditUserIdentity(options.parentAuthor);
    // The JSON API's raw text can carry the same control and bidi characters
    // the crawler's entities do (#90).
    const displayTitle = stripUnsafeText(options.parentTitle).trim() || 'Reddit post';
    const commentUrl = commentPermalink(
        options.subreddit,
        options.postId,
        options.commentId,
        options.commentPermalinkPath,
    );
    const commentScore = options.commentScore;
    const likes = Number.isFinite(commentScore as number) && (commentScore as number) > 0
        ? commentScore
        : undefined;
    const comments = Number.isFinite(options.parentCommentCount as number)
        && (options.parentCommentCount as number) > 0
        ? options.parentCommentCount
        : undefined;
    const stats = likes === undefined && comments === undefined
        ? undefined
        : formatStats({ likes, comments });
    const sensitivityTypes = [
        ...(options.parentOver18 === true ? ['nsfw' as const] : []),
        ...(options.parentSpoiler === true ? ['spoiler' as const] : []),
    ];

    return {
        title: `r/${options.subreddit} \u2022 ${displayTitle}`,
        description: '',
        url: commentUrl,
        siteName: getBrandedSiteName('reddit'),
        authorName: parentAuthor?.name,
        authorUrl: parentAuthor?.url,
        authorAvatar: options.authorAvatar,
        timestamp: options.commentTimestamp,
        color: platformColors.reddit,
        platform: 'reddit',
        stats,
        image: options.parentImage,
        sensitive: sensitivityTypes.length > 0,
        sensitivityTypes: sensitivityTypes.length ? sensitivityTypes : undefined,
        sections: [
            {
                kind: 'quote' as const,
                title: `Comment by ${commentAuthor.name}`,
                body: truncateText(stripUnsafeText(options.commentBody), 3000),
                authorName: commentAuthor.name,
                authorUrl: commentAuthor.url,
                url: commentUrl,
            },
            {
                kind: 'quote' as const,
                title: displayTitle,
                body: 'Parent post',
                url: options.parentUrl,
                authorName: parentAuthor?.name,
                authorUrl: parentAuthor?.url,
            },
        ],
    };
}



function unavailableRedditCommentResponse(
    subreddit: string,
    postId: string,
    commentId: string,
    permalink?: string,
): HandlerResponse {
    const displaySubreddit = safeDecodeURIComponent(subreddit);
    const description = 'This Reddit comment was deleted or is no longer available.';
    return {
        success: true,
        source: 'first-party',
        data: {
            // FixEmbed-owned tombstone so Discord scrapers never fall through to Reddit OG.
            title: `r/${displaySubreddit} \u2022 Comment unavailable`,
            description,
            url: commentPermalink(displaySubreddit, postId, commentId, permalink),
            siteName: getBrandedSiteName('reddit'),
            color: platformColors.reddit,
            platform: 'reddit',
            sections: [{
                kind: 'tombstone',
                title: 'Comment unavailable',
                body: description,
            }],
        },
    };
}

function commentScoreFromCrawlerHtml(commentTag: string, commentHtml: string): number | undefined {
    const fromAttr = Number(htmlAttribute(commentTag, 'data-score'));
    if (Number.isFinite(fromAttr) && htmlAttribute(commentTag, 'data-score') !== '') {
        return fromAttr;
    }

    // Archived old.reddit comments often omit data-score; fall back to the visible score title.
    const fromSpan = Number(
        commentHtml.match(
            /<span\b(?=[^>]*\bclass=["'][^"']*\bscore\s+unvoted\b[^"']*["'])[^>]*\btitle=["'](-?\d+)["']/i,
        )?.[1]
        || commentHtml.match(
            /<span\b(?=[^>]*\btitle=["'](-?\d+)["'])[^>]*\bclass=["'][^"']*\bscore\s+unvoted\b[^"']*["']/i,
        )?.[1],
    );
    if (Number.isFinite(fromSpan)) return fromSpan;
    return undefined;
}

/**
 * Outcome of the old.reddit crawler fallback for a comment permalink.
 * - `card`: the comment is live and rendered.
 * - `gone`: Reddit itself says the comment is gone (404, or a deleted/removed tag).
 * - `unknown`: Reddit did not answer clearly (non-404 error, missing tag, empty page),
 *   so the caller must not claim the comment was deleted.
 */
type RedditCommentCrawlerResult =
    | { kind: 'card'; response: HandlerResponse }
    | { kind: 'gone'; permalink?: string }
    | { kind: 'unknown'; reason: string };

const REDDIT_TRANSIENT_ERROR = 'Reddit is temporarily unavailable';

/** Read the HTTP status from fetchJSON's `HTTP <status>: ...` error, if present. */
export function redditHttpStatusFromError(error: unknown): number | undefined {
    const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
    const match = message.match(/^HTTP (\d{3})\b/);
    return match ? Number(match[1]) : undefined;
}

/**
 * Reddit could not tell us whether the comment exists (rate limit, 5xx, block,
 * timeout, bad payload). Fail without a tombstone so Discord keeps Reddit's OG.
 */
function transientRedditCommentFailure(url: string): HandlerResponse {
    return {
        success: false,
        error: REDDIT_TRANSIENT_ERROR,
        redirect: url,
    };
}

/** Last path segment of an old.reddit comment permalink (the comment id). */
function redditCommentIdFromPermalink(permalink: string): string | undefined {
    if (!permalink) return undefined;
    try {
        const segments = new URL(permalink, 'https://www.reddit.com').pathname
            .split('/')
            .filter(Boolean);
        return segments[segments.length - 1]?.toLowerCase();
    } catch {
        return undefined;
    }
}

/**
 * Find the target comment's opening tag in an old.reddit page.
 * Live comments carry `id="thing_t1_<id>"`. Deleted or removed comments have no
 * id at all, only a `deleted comment` class and a data-permalink, so they are
 * matched by the permalink's own comment id. Another deleted comment on the same
 * page never matches.
 */
function findRedditCrawlerCommentTag(
    html: string,
    commentId: string,
): { tag: string; index: number; deleted: boolean } | undefined {
    const needle = commentId.toLowerCase();
    const escapedCommentId = commentId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const byId = html.match(
        new RegExp(`<div\\b(?=[^>]*\\bid=["']thing_t1_${escapedCommentId}["'])[^>]*>`, 'i'),
    );
    if (byId?.index !== undefined) {
        const classes = htmlAttribute(byId[0], 'class').toLowerCase().split(/\s+/);
        return {
            tag: byId[0],
            index: byId.index,
            deleted: classes.includes('deleted') && classes.includes('comment'),
        };
    }

    for (const match of html.matchAll(/<div\b[^>]*\bdata-permalink=["'][^"']*["'][^>]*>/gi)) {
        const tag = match[0];
        const classes = htmlAttribute(tag, 'class').toLowerCase().split(/\s+/);
        if (!classes.includes('thing') || !classes.includes('comment') || !classes.includes('deleted')) {
            continue;
        }
        if (redditCommentIdFromPermalink(htmlAttribute(tag, 'data-permalink')) !== needle) continue;
        return { tag, index: match.index ?? html.indexOf(tag), deleted: true };
    }
    return undefined;
}

/**
 * The comment's own markup: from its tag up to its replies (`<div class="child">`),
 * so a reply's body is never read as the target's body.
 */
function redditCrawlerCommentOwnHtml(html: string, index: number, commentTag: string): string {
    const scope = html.slice(index, index + 12_000);
    for (const match of scope.slice(commentTag.length).matchAll(/<div\b[^>]*>/gi)) {
        const classes = htmlAttribute(match[0], 'class').split(/\s+/);
        if (classes.includes('child')) {
            return scope.slice(0, commentTag.length + (match.index ?? 0));
        }
    }
    return scope;
}

/**
 * old.reddit's page for a deleted or removed comment that has no replies (#106):
 * HTTP 200, Reddit resolves the comment id (the page's `event_target` is
 * `t1_<id>`; an id that is not under this post is a 404 instead), but the
 * single-comment thread under the post is empty (`noresults`). The page names no
 * author or body, so this alone never means gone. It only says to look the
 * comment up.
 */
function isRedditCrawlerEmptyCommentThread(html: string, postId: string, commentId: string): boolean {
    const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const targetsComment = new RegExp(
        `"target_fullname":\\s*"t1_${escape(commentId)}"`,
        'i',
    ).test(html);
    if (!targetsComment) return false;
    return new RegExp(
        `<div\\b(?=[^>]*\\bid=["']siteTable_t3_${escape(postId)}["'])[^>]*>\\s*<p\\b[^>]*\\bid=["']noresults["']`,
        'i',
    ).test(html);
}

type RedditInfoListing = {
    data?: { children?: Array<RedditListingChild<Partial<RedditComment>>> };
};

/**
 * Look a comment up on old.reddit's `api/info.json` (#106), the same host and
 * user agent as the crawler page. Gone only when the comment is under this post
 * and passes isRedditGoneComment. Any error, timeout, or mismatch is unknown, so
 * an outage never turns into a tombstone. No retry: this runs only on the rare
 * empty-thread page, inside the request's remaining budget.
 */
async function lookUpRedditCommentFromInfo(
    postId: string,
    commentId: string,
    trace: RedditFetchTrace | undefined,
    budget: RedditCommentBudget,
): Promise<RedditCommentCrawlerResult> {
    const infoUrl = `https://old.reddit.com/api/info.json?id=t1_${encodeURIComponent(commentId)}&raw_json=1`;
    let listing: RedditInfoListing;
    try {
        listing = await timeRedditFetch(trace, 'old_reddit_info', () => fetchRedditCommentJSON<RedditInfoListing>(
            infoUrl,
            { 'User-Agent': 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)' },
            budget(REDDIT_COMMENT_TIMEOUTS.jsonMs),
        ));
    } catch (error) {
        return {
            kind: 'unknown',
            reason: `crawler empty thread, info ${redditHttpStatusFromError(error) ?? 'error'}`,
        };
    }
    const child = listing?.data?.children?.[0];
    const comment = child?.kind === 't1' ? child.data : undefined;
    if (!comment || String(comment.id || '').toLowerCase() !== commentId.toLowerCase()) {
        return { kind: 'unknown', reason: 'crawler empty thread, info has no comment' };
    }
    if (String(comment.link_id || '').toLowerCase() !== `t3_${postId}`.toLowerCase()) {
        return { kind: 'unknown', reason: 'crawler empty thread, info comment is on another post' };
    }
    if (typeof comment.body !== 'string' || !isRedditGoneComment(comment.author, comment.body)) {
        return { kind: 'unknown', reason: 'crawler empty thread, info comment is live' };
    }
    return { kind: 'gone', permalink: comment.permalink || undefined };
}

async function recoverRedditCommentFromCrawlerPage(
    subreddit: string,
    postId: string,
    commentId: string,
    trace?: RedditFetchTrace,
    budget: RedditCommentBudget = createTimeoutBudget(REDDIT_COMMENT_TIMEOUTS.budgetMs),
): Promise<RedditCommentCrawlerResult> {
    const pageUrl = `https://old.reddit.com/r/${encodeURIComponent(subreddit)}/comments/${encodeURIComponent(postId)}/_/${encodeURIComponent(commentId)}/`;
    const fetchPage = (attempt: number) => timeRedditFetch(trace, 'old_reddit', () => fetchWithTimeout(pageUrl, {
        headers: {
            'Accept': 'text/html',
            'User-Agent': 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
        },
    }, budget(REDDIT_COMMENT_TIMEOUTS.oldRedditMs)), responseStatus, { attempt });
    const canRetry = () => budget() >= REDDIT_COMMENT_TIMEOUTS.minRetryMs;

    // One retry (#98), only for a timeout or a 5xx, and only with budget left.
    // 403/404/429 and other errors are Reddit's answer and are never retried.
    // A timeout retry and a 5xx retry share one `retried` flag so old.reddit
    // never gets a third request when a timeout is followed by a 503.
    let response: Response;
    let retried = false;
    try {
        response = await fetchPage(1);
    } catch (error) {
        if (!isRedditTimeoutError(error) || !canRetry()) throw error;
        retried = true;
        response = await fetchPage(2);
    }
    if (!retried && response.status >= 500 && response.status <= 599 && canRetry()) {
        response.body?.cancel().catch(() => {});
        response = await fetchPage(2);
    }
    if (response.status === 404) return { kind: 'gone' };
    if (!response.ok) return { kind: 'unknown', reason: `crawler HTTP ${response.status}` };

    // fetchWithTimeout stops at the headers, so the body read has its own cap and stage.
    const html = await timeRedditFetch(
        trace,
        'old_reddit_body',
        () => readBoundedText(
            response,
            MAX_ARTICLE_HTML_BYTES,
            budget(REDDIT_COMMENT_TIMEOUTS.oldRedditMs),
        ),
    );
    if (!html) return { kind: 'unknown', reason: 'crawler empty html' };

    const located = findRedditCrawlerCommentTag(html, commentId);
    if (!located) {
        if (isRedditCrawlerEmptyCommentThread(html, postId, commentId)) {
            return lookUpRedditCommentFromInfo(postId, commentId, trace, budget);
        }
        return { kind: 'unknown', reason: 'crawler comment tag not found' };
    }
    const { tag: commentTag, deleted: markedDeleted } = located;

    const author = htmlAttribute(commentTag, 'data-author');
    const permalink = htmlAttribute(commentTag, 'data-permalink');
    const timestampMs = Number(htmlAttribute(commentTag, 'data-timestamp'));
    const commentHtml = redditCrawlerCommentOwnHtml(html, located.index, commentTag);
    const score = commentScoreFromCrawlerHtml(commentTag, commentHtml);
    const rawBody = commentHtml.match(
        /<div\b(?=[^>]*\bclass=["'][^"']*\bmd\b[^"']*["'])[^>]*>([\s\S]*?)<\/div>/i,
    )?.[1];
    const body = rawBody ? redditHtmlToDiscordMarkdown(rawBody) : '';

    // Gone only when Reddit says so: the comment is rendered with old.reddit's
    // `deleted` class, or its body is [deleted]/[removed] and its author is gone
    // too (#106). A missing data-author alone is a deleted account whose comment
    // is still readable, and a live author's literal `[deleted]` is a real comment.
    if (markedDeleted || (body && isRedditGoneComment(author, body))) {
        return { kind: 'gone', permalink: permalink || undefined };
    }
    // No parseable body on a comment Reddit did not mark deleted is a markup problem.
    if (!body) return { kind: 'unknown', reason: 'crawler comment body not found' };

    const escapedPostId = postId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const postTag = html.match(
        new RegExp(`<div\\b(?=[^>]*\\bid=["']thing_t3_${escapedPostId}["'])[^>]*>`, 'i'),
    )?.[0];
    const postTitle = postTag
        ? decodeRedditHtml(
            (html.slice(html.indexOf(postTag), html.indexOf(postTag) + 8_000).match(
                /<a\b[^>]*\bclass=["'][^"']*\btitle\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/i,
            )?.[1] || '').replace(/<[^>]+>/g, ''),
        )
        : '';
    const postPermalink = postTag ? htmlAttribute(postTag, 'data-permalink') : '';
    const parentUrl = postPermalink
        ? new URL(postPermalink, 'https://www.reddit.com').toString()
        : `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/comments/${encodeURIComponent(postId)}/`;
    const displayTitle = postTitle || 'Reddit post';
    const parentAuthor = postTag ? htmlAttribute(postTag, 'data-author') : '';
    const parentCommentCount = postTag
        ? Number(htmlAttribute(postTag, 'data-comments-count')) || undefined
        : undefined;
    const authorAvatar = await fetchSubredditIcon(
        subreddit,
        REDDIT_FALLBACK_ICON,
        redditCookieHeader(response),
        trace,
        budget,
    );

    return {
        kind: 'card',
        response: {
            success: true,
            source: 'first-party',
            data: buildRedditCommentCard({
                subreddit,
                postId,
                commentId,
                commentAuthor: author || '[deleted]',
                commentBody: body,
                commentPermalinkPath: permalink,
                commentScore: score,
                commentTimestamp: Number.isFinite(timestampMs) && timestampMs > 0
                    ? new Date(timestampMs).toISOString()
                    : undefined,
                parentTitle: displayTitle,
                parentUrl,
                parentAuthor: parentAuthor || undefined,
                parentCommentCount,
                authorAvatar,
            }),
        },
    };
}

async function recoverFromRedditCrawlerPage(
    subreddit: string,
    postId: string,
): Promise<HandlerResponse | null> {
    const pageUrl = `https://old.reddit.com/r/${encodeURIComponent(subreddit)}/comments/${encodeURIComponent(postId)}/`;
    const response = await fetchWithTimeout(pageUrl, {
        headers: {
            'Accept': 'text/html',
            'User-Agent': 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
        },
    });
    if (!response.ok) return null;

    const html = await readBoundedText(response, MAX_ARTICLE_HTML_BYTES);
    if (!html) return null;
    const escapedPostId = postId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const postTag = html.match(
        new RegExp(`<div\\b(?=[^>]*\\bid=["']thing_t3_${escapedPostId}["'])[^>]*>`, 'i'),
    )?.[0];
    if (!postTag) return null;
    const postStart = html.indexOf(postTag);
    const postTail = html.slice(postStart);
    let postBoundary = -1;
    for (const match of postTail.matchAll(/<div\b[^>]*>/gi)) {
        const classes = htmlAttribute(match[0], 'class').split(/\s+/);
        if (classes.includes('child') || classes.includes('commentarea')) {
            postBoundary = match.index;
            break;
        }
    }
    const hasPostBoundary = postBoundary >= 0;
    const postHtml = hasPostBoundary
        ? postTail.slice(0, postBoundary)
        : postTail.slice(0, 20_000);
    const rawTitle = postHtml.match(
        /<a\b[^>]*\bclass=["'][^"']*\btitle\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/i,
    )?.[1];
    if (!rawTitle) return null;

    const author = htmlAttribute(postTag, 'data-author');
    const postUrl = htmlAttribute(postTag, 'data-url');
    const directImageUrl = directRedditImageUrl(postUrl);
    const articleUrl = linkedArticleUrl(postUrl);
    const permalink = htmlAttribute(postTag, 'data-permalink');
    const score = Number(htmlAttribute(postTag, 'data-score')) || undefined;
    const comments = Number(htmlAttribute(postTag, 'data-comments-count')) || undefined;
    const timestampMs = Number(htmlAttribute(postTag, 'data-timestamp'));
    const authorAvatar = await fetchSubredditIcon(
        subreddit,
        REDDIT_FALLBACK_ICON,
        redditCookieHeader(response),
    );
    const images = hasPostBoundary ? redditGalleryImagesFromHtml(postHtml) : [];
    const description = truncateText(
        redditPostBodyFromHtml(postHtml)
            || decodeRedditHtml(articleMetaContent(html, 'description') || ''),
        3000,
    );
    const fallbackImage = articleMetaContent(html, 'og:image');
    const thumbnail = fallbackImage
        ? redditCrawlerPreviewUrl(fallbackImage, pageUrl)
        : undefined;
    const hasVideoPlayer = /<div\b(?=[^>]*\bdata-mpd-url=["'])[^>]*>/i.test(postHtml);
    const video = hasVideoPlayer
        ? await fetchRedditMuxedVideo(subreddit, postId, thumbnail)
            || await redditVideoFromHtml(postHtml, thumbnail)
        : undefined;
    const image = video
        ? undefined
        : directImageUrl
        || (images.length ? undefined : await fetchArticleImage(articleUrl))
        || (images.length || !thumbnail
            ? undefined
            : thumbnail);
    const canonicalUrl = permalink
        ? new URL(permalink, 'https://www.reddit.com').toString()
        : `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/comments/${encodeURIComponent(postId)}/`;

    const nsfw = htmlAttribute(postTag, 'data-nsfw') === 'true';
    const spoiler = htmlAttribute(postTag, 'data-spoiler') === 'true';
    const sensitivityTypes = [
        ...(nsfw ? ['nsfw' as const] : []),
        ...(spoiler ? ['spoiler' as const] : []),
    ];
    return {
        success: true,
        source: 'first-party',
        data: {
            title: `r/${subreddit} \u2022 ${decodeRedditHtml(rawTitle.replace(/<[^>]+>/g, ''))}`,
            description,
            url: canonicalUrl,
            siteName: getBrandedSiteName('reddit'),
            authorName: author ? `u/${author}` : undefined,
            authorUrl: author ? `https://www.reddit.com/user/${encodeURIComponent(author)}/` : undefined,
            authorAvatar,
            image,
            images: images.length ? images : undefined,
            video,
            color: platformColors.reddit,
            platform: 'reddit',
            stats: formatStats({ comments, likes: score }),
            timestamp: Number.isFinite(timestampMs) && timestampMs > 0
                ? new Date(timestampMs).toISOString()
                : undefined,
            sections: linkedArticleSection(articleUrl),
            sensitive: nsfw || spoiler,
            sensitivityTypes: sensitivityTypes.length
                ? sensitivityTypes
                : undefined,
        },
    };
}

async function recoverFromRedditEmbed(
    subreddit: string,
    postId: string,
): Promise<HandlerResponse | null> {
    const displaySubreddit = safeDecodeURIComponent(subreddit);
    const encodedSubreddit = encodeURIComponent(displaySubreddit);
    const encodedPostId = encodeURIComponent(safeDecodeURIComponent(postId));
    const canonicalUrl = `https://www.reddit.com/r/${encodedSubreddit}/comments/${encodedPostId}/`;
    try {
        const crawlerRecovery = await recoverFromRedditCrawlerPage(
            displaySubreddit,
            safeDecodeURIComponent(postId),
        );
        if (crawlerRecovery) return crawlerRecovery;
    } catch {
        // Continue to Reddit's compact embed when the crawler-facing page is unavailable.
    }

    try {
        const response = await fetchWithTimeout(`https://embed.reddit.com/r/${encodedSubreddit}/comments/${encodedPostId}/`, {
            headers: {
                'Accept': 'text/html',
                'User-Agent': 'Mozilla/5.0 (compatible; FixEmbed/1.0; +https://fixembed.app)',
            },
        });
        if (response.ok) {
            const html = await readBoundedText(response, MAX_REDDIT_EMBED_HTML_BYTES);
            const title = html.match(/<shreddit-embed-title>([\s\S]*?)<\/shreddit-embed-title>/i)?.[1]
                || html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
            if (title) {
                const author = html.match(/reddit\.com\/user\/([^/"?]+)/i)?.[1];
                const subredditIcon = html.match(/<img\b[^>]*\bsrc="(https:\/\/styles\.redditmedia\.com\/[^"]+)"[^>]*>/i)?.[1];
                const images = redditEmbedGalleryImagesFromHtml(html);
                const embeddedImage = html.match(/<img\s+src="(https:\/\/preview\.redd\.it\/[^"]+)"/i)?.[1];
                const outboundUrl = html.match(/&quot;url&quot;:&quot;([\s\S]*?)&quot;/i)?.[1];
                const articleUrl = linkedArticleUrl(outboundUrl ? decodeRedditHtml(outboundUrl) : '');
                const score = Number(html.match(/data-testid="upvote"[\s\S]{0,1000}?<faceplate-number\s+number="(\d+)"/i)?.[1]) || undefined;
                const comments = Number(html.match(/View\s+([\d,]+)\s+comments?/i)?.[1].replace(/,/g, '')) || undefined;
                const cleanTitle = decodeRedditHtml(title.replace(/<[^>]+>/g, ''));
                const description = truncateText(
                    redditPostBodyFromHtml(html, safeDecodeURIComponent(postId)),
                    3000,
                );
                const displayAuthor = author ? safeDecodeURIComponent(author) : undefined;
                const authorAvatar = await fetchSubredditIcon(
                    displaySubreddit,
                    subredditIcon ? decodeRedditHtml(subredditIcon) : '',
                    redditCookieHeader(response),
                );
                const thumbnail = embeddedImage ? decodeRedditHtml(embeddedImage) : undefined;
                const video = redditMuxedVideoFromHtml(html, thumbnail);
                const image = video
                    ? undefined
                    : images.length
                        ? undefined
                        : thumbnail || await fetchArticleImage(articleUrl);
                const nsfw = /<shreddit-aspect-ratio\b(?=[^>]*\bis-nsfw-blocked(?:\s|=|>))[^>]*>/i.test(html);
                const sensitivityTypes = nsfw ? ['nsfw' as const] : undefined;

                return {
                    success: true,
                    source: 'first-party',
                    data: {
                        title: `r/${displaySubreddit} • ${cleanTitle}`,
                        description,
                        url: canonicalUrl,
                        siteName: getBrandedSiteName('reddit'),
                        authorName: displayAuthor ? `u/${displayAuthor}` : undefined,
                        authorUrl: displayAuthor ? `https://www.reddit.com/user/${encodeURIComponent(displayAuthor)}/` : undefined,
                        authorAvatar,
                        image,
                        images: images.length ? images : undefined,
                        video,
                        color: platformColors.reddit,
                        platform: 'reddit',
                        stats: formatStats({ comments, likes: score }),
                        timestamp: extractPostTimestampFromHtml(html),
                        sections: linkedArticleSection(articleUrl),
                        sensitive: nsfw,
                        sensitivityTypes,
                    },
                };
            }
        }
    } catch {
        // Continue to the metadata-only recovery when rich embeds are blocked.
    }

    try {
        const oembed = await fetchJSON<RedditOEmbedResponse>(
            `https://www.reddit.com/oembed?url=${encodeURIComponent(canonicalUrl)}`,
            {
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'FixEmbed/1.0 (embed service)',
                },
            },
        );
        const title = decodeRedditHtml(oembed?.title || '');
        if (title) {
            const displayAuthor = oembed?.author_name
                ? safeDecodeURIComponent(oembed.author_name)
                : undefined;
            return {
                success: true,
                source: 'first-party',
                data: {
                    title: `r/${displaySubreddit} • ${title}`,
                    description: '',
                    url: canonicalUrl,
                    siteName: getBrandedSiteName('reddit'),
                    authorName: displayAuthor ? `u/${displayAuthor}` : undefined,
                    authorUrl: displayAuthor ? `https://www.reddit.com/user/${encodeURIComponent(displayAuthor)}/` : undefined,
                    authorAvatar: REDDIT_FALLBACK_ICON,
                    color: platformColors.reddit,
                    platform: 'reddit',
                },
            };
        }
    } catch {
        // Reddit frequently blocks JSON traffic from data-center networks.
    }
    return null;
}

export const redditHandler: PlatformHandler = {
    name: 'reddit',
    patterns: [
        /reddit\.com\/r\/([^\/]+)\/comments\/([^\/]+)/i,
        /reddit\.com\/r\/[^\/]+\/s\/[^\/\?]+/i,
        /redd\.it\/([^\/\?]+)/i,
    ],

    async handle(url: string, env: Env, options?: HandlerOptions): Promise<HandlerResponse> {
        const trace = new RedditFetchTrace();
        const timing: RedditTimingIds = {};
        let result: HandlerResponse | undefined;
        try {
            result = await handleReddit(url, env, trace, timing);
            return result;
        } finally {
            const ids = timing.ids ?? timing.share;
            if (ids) {
                try {
                    trace.flush(ids, redditCommentOutcome(result), options?.embedCache ?? 'none');
                } catch {
                    // Timing logs (#98) must never change what the handler returns.
                }
            }
        }
    },
};

/**
 * Which ids the #98 timing lines carry: the comment once a link resolves to one,
 * or the share link itself when its resolve fails (#108).
 */
type RedditTimingIds = { ids?: RedditCommentIds; share?: RedditShareIds };

/** Classify a comment-path result for the #98 timing summary. */
function redditCommentOutcome(result: HandlerResponse | undefined): RedditCommentOutcome {
    if (!result) return 'error';
    if (result.success) {
        return result.data?.sections?.[0]?.kind === 'tombstone' ? 'gone' : 'card';
    }
    return result.error === REDDIT_TRANSIENT_ERROR ? 'temporary' : 'error';
}

async function handleReddit(
    url: string,
    env: Env,
    trace: RedditFetchTrace,
    timing: RedditTimingIds,
): Promise<HandlerResponse> {
    let resolvedUrl = url;
    // Comment permalinks run on one shared time budget (#98). A share link starts
    // it at the resolve probe, so the resolve counts against the comment it leads
    // to (#108). Posts never read the budget and keep the default timeouts.
    let commentBudget: RedditCommentBudget | undefined = parseRedditUrl(url)?.commentId
        ? createTimeoutBudget(REDDIT_COMMENT_TIMEOUTS.budgetMs)
        : undefined;
    try {
        const candidate = new URL(url);
        const hostname = candidate.hostname.toLowerCase().replace(/^www\./, '');
        const isShareUrl = candidate.protocol === 'https:'
            && hostname === 'reddit.com'
            && /^\/r\/[^/]+\/s\/[^/]+\/?$/i.test(candidate.pathname);
        // Wrong-subreddit comment/post permalinks 301 to the canonical /r/{real}/comments/... path.
        const isCommentsUrl = candidate.protocol === 'https:'
            && hostname === 'reddit.com'
            && /^\/r\/[^/]+\/comments\/[^/]+/i.test(candidate.pathname);

        if (isShareUrl) {
            commentBudget ??= createTimeoutBudget(REDDIT_COMMENT_TIMEOUTS.budgetMs);
        }
        // A share link that fails to resolve still gets its timing lines (#108).
        const shareFailed = (response: HandlerResponse): HandlerResponse => {
            const [, subreddit = '', shareId = ''] = candidate.pathname.match(/^\/r\/([^/]+)\/s\/([^/]+)/i) ?? [];
            timing.share = {
                subreddit: safeDecodeURIComponent(subreddit),
                shareId: safeDecodeURIComponent(shareId),
            };
            return response;
        };

        if (isShareUrl || isCommentsUrl) {
            try {
                const response = await trace.time('probe', () => fetchWithTimeout(url, {
                    redirect: 'manual',
                    headers: {
                        'Accept': 'text/html',
                        'User-Agent': 'FixEmbed/1.0 (embed service)',
                    },
                }, commentBudget?.(REDDIT_COMMENT_TIMEOUTS.probeMs)), responseStatus);
                const location = response.headers.get('location');
                if (!location) {
                    if (isShareUrl) {
                        return shareFailed({ success: false, error: 'Could not resolve Reddit share link', redirect: url });
                    }
                } else {
                    const destination = new URL(location, url);
                    const destinationHost = destination.hostname.toLowerCase().replace(/^www\./, '');
                    if (destination.protocol !== 'https:' || destinationHost !== 'reddit.com') {
                        const invalid: HandlerResponse = {
                            success: false,
                            error: isShareUrl ? 'Invalid Reddit share redirect' : 'Invalid Reddit comment redirect',
                            redirect: url,
                        };
                        return isShareUrl ? shareFailed(invalid) : invalid;
                    }
                    resolvedUrl = destination.toString();
                }
            } catch (resolveError) {
                if (isShareUrl) {
                    // A resolve timeout says nothing about the target, so it is
                    // temporary like the comment path's timeouts (#108).
                    if (isRedditTimeoutError(resolveError)) {
                        return shareFailed(transientRedditCommentFailure(url));
                    }
                    return shareFailed({
                        success: false,
                        error: resolveError instanceof Error
                            ? resolveError.message
                            : 'Could not resolve Reddit share link',
                        redirect: url,
                    });
                }
                // Comment/post permalinks can still be fetched from the original URL if
                // the canonical redirect probe is blocked or unavailable.
            }
        }
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Could not resolve Reddit share link',
            redirect: url,
        };
    }

    const parsed = parseRedditUrl(resolvedUrl);

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

    if (parsed.commentId) {
        commentBudget ??= createTimeoutBudget(REDDIT_COMMENT_TIMEOUTS.budgetMs);
        timing.ids = {
            subreddit: safeDecodeURIComponent(parsed.subreddit),
            postId: safeDecodeURIComponent(parsed.postId),
            commentId: safeDecodeURIComponent(parsed.commentId),
        };
    }

    try {
        const commentId = parsed.commentId;
        const apiUrl = commentId
            ? `https://www.reddit.com/r/${parsed.subreddit}/comments/${parsed.postId}/_/${commentId}.json?raw_json=1&sr_detail=1&limit=1`
            : `https://www.reddit.com/r/${parsed.subreddit}/comments/${parsed.postId}.json?raw_json=1&sr_detail=1`;

        type RedditListing = Array<{
            data: {
                children: Array<RedditListingChild<RedditPost | (RedditComment & { replies?: unknown })>>;
            };
        }>;
        const listingHeaders = {
            'User-Agent': 'FixEmbed/1.0 (embed service)',
        };
        const fetchListing = () => commentId && commentBudget
            ? fetchRedditCommentJSON<RedditListing>(
                apiUrl,
                listingHeaders,
                commentBudget(REDDIT_COMMENT_TIMEOUTS.jsonMs),
            )
            : fetchJSON<RedditListing>(apiUrl, { headers: listingHeaders });
        const response = await (commentId ? trace.time('json', fetchListing) : fetchListing());

        if (!response || !response[0]?.data?.children?.[0]) {
            if (commentId) {
                // An empty or malformed listing is a shape problem, not proof the
                // comment is gone. Let the catch try the crawler page instead.
                throw new Error('Reddit returned an empty comment listing');
            }
            return {
                success: false,
                error: 'Post not found',
            };
        }

        const postChild = response[0].data.children[0];
        // Listing[0] is the link/post; older fixtures omit kind, so only reject explicit non-posts.
        if (postChild.kind && postChild.kind !== 't3') {
            if (commentId) {
                throw new Error('Reddit returned an unexpected comment listing shape');
            }
            return { success: false, error: 'Post not found' };
        }
        const post = postChild.data as RedditPost;

        if (commentId) {
            const commentChildren = (response[1]?.data?.children || []) as Array<
                RedditListingChild<RedditComment & { replies?: unknown }>
            >;
            const comment = findRedditComment(commentChildren, commentId);
            if (!comment || isUnavailableRedditComment(comment)) {
                return unavailableRedditCommentResponse(
                    post.subreddit || safeDecodeURIComponent(parsed.subreddit),
                    safeDecodeURIComponent(parsed.postId),
                    safeDecodeURIComponent(commentId),
                    comment?.permalink,
                );
            }

            const fallbackSubredditIcon = decodeRedditHtml(
                post.sr_detail?.community_icon || post.sr_detail?.icon_img || '',
            );
            const subredditIcon = await fetchSubredditIcon(
                post.subreddit,
                fallbackSubredditIcon,
                '',
                trace,
                commentBudget,
            );
            const parentUrl = post.permalink
                ? `https://www.reddit.com${post.permalink}`
                : `https://www.reddit.com/r/${encodeURIComponent(post.subreddit)}/comments/${encodeURIComponent(parsed.postId)}/`;
            const timestamp = Number.isFinite(comment.created_utc) && comment.created_utc > 0
                ? new Date(comment.created_utc * 1000).toISOString()
                : undefined;
            const parentImage = (() => {
                const gallery = redditGalleryImages(post);
                if (gallery.length) return gallery[0];
                const direct = directRedditImageUrl(post.url);
                if (direct) return direct;
                const thumb = decodeRedditHtml(post.thumbnail || '');
                if (thumb && !['self', 'default', 'nsfw', 'spoiler', 'image'].includes(thumb)) {
                    return thumb;
                }
                return undefined;
            })();

            return {
                success: true,
                source: 'first-party',
                data: buildRedditCommentCard({
                    subreddit: post.subreddit,
                    postId: parsed.postId,
                    commentId,
                    commentAuthor: comment.author,
                    commentBody: comment.body,
                    commentPermalinkPath: comment.permalink,
                    commentScore: Number(comment.score ?? comment.ups),
                    commentTimestamp: timestamp,
                    parentTitle: post.title,
                    parentUrl,
                    parentAuthor: post.author,
                    parentCommentCount: post.num_comments,
                    parentImage,
                    parentOver18: post.over_18 === true,
                    parentSpoiler: post.spoiler === true,
                    authorAvatar: subredditIcon,
                }),
            };
        }

        // Build description (no stats here - moved to oEmbed row)
        const description = post.selftext ? truncateText(post.selftext, 3000) : '';

        // Format stats for oEmbed row (consistent with Twitter/Threads/Bluesky)
        const stats = formatStats({
            comments: post.num_comments,
            likes: post.score, // Reddit uses score/upvotes as "likes"
        });

        // Check for media
        let image: string | undefined;
        const images = redditGalleryImages(post);
        const directImageUrl = directRedditImageUrl(post.url);
        let video: RedditVideo | undefined;

        // Video content
        const redditVideo = post.secure_media?.reddit_video || post.media?.reddit_video;
        if (post.is_video && redditVideo) {
            const thumbnail = post.thumbnail !== 'self'
                ? decodeRedditHtml(post.thumbnail)
                : undefined;
            video = await fetchRedditMuxedVideo(post.subreddit, parsed.postId, thumbnail)
                || {
                    url: redditVideo.fallback_url,
                    width: redditVideo.width,
                    height: redditVideo.height,
                    thumbnail,
                };
        }
        // Image content
        else if (!images.length && directImageUrl) {
            image = directImageUrl;
        }
        else if (!images.length && post.preview?.images?.[0]) {
            const imageSource = post.preview.images[0].source;
            // Reddit HTML-encodes URLs in the API response
            image = imageSource.url.replace(/&amp;/g, '&');
        }
        // External image link
        else if (!images.length && post.url.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
            image = post.url;
        }

        const fallbackSubredditIcon = decodeRedditHtml(
            post.sr_detail?.community_icon || post.sr_detail?.icon_img || '',
        );
        const subredditIcon = await fetchSubredditIcon(
            post.subreddit,
            fallbackSubredditIcon,
        );
        const timestamp = Number.isFinite(post.created_utc) && post.created_utc > 0
            ? new Date(post.created_utc * 1000).toISOString()
            : undefined;
        const articleUrl = linkedArticleUrl(post.url);
        if (!video && !image && !images.length) {
            image = await fetchArticleImage(articleUrl);
        }
        const sections = linkedArticleSection(articleUrl);
        const sensitivityTypes = [
            ...(post.over_18 === true ? ['nsfw' as const] : []),
            ...(post.spoiler === true ? ['spoiler' as const] : []),
        ];

        return {
            success: true,
            source: 'first-party',
            data: {
                title: `r/${post.subreddit} • ${post.title}`,
                description,
                url: `https://reddit.com${post.permalink}`,
                siteName: getBrandedSiteName('reddit'),
                authorName: `u/${post.author}`,
                authorUrl: `https://reddit.com/u/${post.author}`,
                authorAvatar: subredditIcon,
                image,
                images: images.length ? images : undefined,
                video,
                timestamp,
                color: platformColors.reddit,
                platform: 'reddit',
                stats, // Consistent stats via oEmbed like other platforms
                sections,
                sensitive: sensitivityTypes.length > 0,
                sensitivityTypes: sensitivityTypes.length
                    ? sensitivityTypes
                    : undefined,
            },
        };
    } catch (error) {
        if (parsed.commentId) {
            const subreddit = safeDecodeURIComponent(parsed.subreddit);
            const postId = safeDecodeURIComponent(parsed.postId);
            const commentId = safeDecodeURIComponent(parsed.commentId);
            // Only a 404 from the JSON API is Reddit saying the comment is gone.
            if (redditHttpStatusFromError(error) === 404) {
                return unavailableRedditCommentResponse(subreddit, postId, commentId);
            }
            console.error('Reddit comment handler error:', error);
            try {
                const recovered = await recoverRedditCommentFromCrawlerPage(
                    subreddit,
                    postId,
                    commentId,
                    trace,
                    commentBudget,
                );
                if (recovered.kind === 'card') return recovered.response;
                if (recovered.kind === 'gone') {
                    return unavailableRedditCommentResponse(
                        subreddit,
                        postId,
                        commentId,
                        recovered.permalink,
                    );
                }
                console.warn('Reddit comment status unknown:', recovered.reason);
            } catch (recoveryError) {
                console.error('Reddit comment recovery error:', recoveryError);
            }
            // 429/5xx/403/timeouts/bad payloads: do not claim the comment was deleted.
            return transientRedditCommentFailure(url);
        }

        try {
            const recovered = await recoverFromRedditEmbed(parsed.subreddit, parsed.postId);
            if (recovered) return recovered;
        } catch (recoveryError) {
            console.error('Reddit embed recovery error:', recoveryError);
        }
        console.error('Reddit handler error:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to fetch post',
            redirect: url,
        };
    }
}
