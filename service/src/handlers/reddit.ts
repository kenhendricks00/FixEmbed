/**
 * FixEmbed Service - Reddit Handler
 */

import type { EmbedData, Env, HandlerResponse, PlatformHandler } from '../types.ts';
import { parseRedditUrl, fetchJSON, fetchWithTimeout, truncateText } from '../utils/fetch.ts';
import { platformColors, getBrandedSiteName, formatStats } from '../utils/embed.ts';
import { extractPostTimestampFromHtml } from '../utils/timestamp.ts';

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
): Promise<string | undefined> {
    const fallbackIcon = decodeRedditHtml(fallback) || undefined;
    const encodedSubreddit = encodeURIComponent(safeDecodeURIComponent(subreddit));
    const fetchCommunityIcon = async (cookie = ''): Promise<string | undefined> => {
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
        for (const url of urls) {
            try {
                const community = await fetchJSON<RedditCommunityResponse>(url, { headers });
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

    try {
        const bootstrap = await fetchWithTimeout(
            `https://embed.reddit.com/r/${encodedSubreddit}/`,
            {
                headers: {
                    'Accept': 'text/html',
                    'User-Agent': 'Mozilla/5.0 (compatible; FixEmbed/1.0; +https://fixembed.app)',
                },
            },
        );
        if (!bootstrap.ok) return fallbackIcon;
        const cookie = redditCookieHeader(bootstrap);
        if (!cookie) return fallbackIcon;
        return await fetchCommunityIcon(cookie) || fallbackIcon;
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

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
    const declared = Number.parseInt(response.headers.get('Content-Length') || '', 10);
    if (Number.isFinite(declared) && declared > maxBytes) return '';
    if (!response.body) return '';

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let size = 0;
    let html = '';
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
            await reader.cancel();
            return '';
        }
        html += decoder.decode(value, { stream: true });
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

    return decodeRedditHtml(
        body
            .replace(/<h([1-6])\b[^>]*>/gi, (_, level: string) => `${'#'.repeat(Number(level))} `)
            .replace(/<\/(?:h[1-6]|p|blockquote|pre)>/gi, '\n\n')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<li\b[^>]*>/gi, '- ')
            .replace(/<\/li>/gi, '\n')
            .replace(/<[^>]+>/g, ''),
    )
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n[ \t]+/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
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

function isUnavailableRedditComment(comment: RedditComment | undefined): boolean {
    if (!comment) return true;
    const author = String(comment.author || '').trim().toLowerCase();
    const body = String(comment.body || '').trim().toLowerCase();
    if (!body || body === '[deleted]' || body === '[removed]') return true;
    if (!author || author === '[deleted]' || author === '[removed]') return true;
    return false;
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
    authorAvatar?: string;
}): EmbedData {
    const commentAuthor = options.commentAuthor.replace(/^u\//i, '');
    const parentAuthor = options.parentAuthor?.replace(/^u\//i, '').trim();
    const displayTitle = options.parentTitle.trim() || 'Reddit post';
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

    return {
        title: `r/${options.subreddit} \u2022 ${displayTitle}`,
        description: '',
        url: commentUrl,
        siteName: getBrandedSiteName('reddit'),
        authorName: parentAuthor ? `u/${parentAuthor}` : undefined,
        authorUrl: parentAuthor
            ? `https://www.reddit.com/user/${encodeURIComponent(parentAuthor)}/`
            : undefined,
        authorAvatar: options.authorAvatar,
        timestamp: options.commentTimestamp,
        color: platformColors.reddit,
        platform: 'reddit',
        stats,
        image: options.parentImage,
        sections: [
            {
                kind: 'quote' as const,
                title: `Comment by u/${commentAuthor}`,
                body: truncateText(options.commentBody, 3000),
                authorName: `u/${commentAuthor}`,
                authorUrl: `https://www.reddit.com/user/${encodeURIComponent(commentAuthor)}/`,
                url: commentUrl,
            },
            {
                kind: 'quote' as const,
                title: displayTitle,
                body: 'Parent post',
                url: options.parentUrl,
                authorName: parentAuthor ? `u/${parentAuthor}` : undefined,
                authorUrl: parentAuthor
                    ? `https://www.reddit.com/user/${encodeURIComponent(parentAuthor)}/`
                    : undefined,
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

async function recoverRedditCommentFromCrawlerPage(
    subreddit: string,
    postId: string,
    commentId: string,
): Promise<HandlerResponse | null> {
    const pageUrl = `https://old.reddit.com/r/${encodeURIComponent(subreddit)}/comments/${encodeURIComponent(postId)}/_/${encodeURIComponent(commentId)}/`;
    const response = await fetchWithTimeout(pageUrl, {
        headers: {
            'Accept': 'text/html',
            'User-Agent': 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
        },
    });
    if (!response.ok) return null;

    const html = await readBoundedText(response, MAX_ARTICLE_HTML_BYTES);
    if (!html) return null;

    const escapedCommentId = commentId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const commentTag = html.match(
        new RegExp(`<div\\b(?=[^>]*\\bid=["']thing_t1_${escapedCommentId}["'])[^>]*>`, 'i'),
    )?.[0];
    if (!commentTag) return null;

    const author = htmlAttribute(commentTag, 'data-author');
    const permalink = htmlAttribute(commentTag, 'data-permalink');
    const timestampMs = Number(htmlAttribute(commentTag, 'data-timestamp'));
    const commentStart = html.indexOf(commentTag);
    const commentHtml = html.slice(commentStart, commentStart + 12_000);
    const score = commentScoreFromCrawlerHtml(commentTag, commentHtml);
    const rawBody = commentHtml.match(
        /<div\b(?=[^>]*\bclass=["'][^"']*\bmd\b[^"']*["'])[^>]*>([\s\S]*?)<\/div>/i,
    )?.[1];
    const body = rawBody
        ? decodeRedditHtml(
            rawBody
                .replace(/<br\s*\/?>/gi, '\n')
                .replace(/<\/p>/gi, '\n\n')
                .replace(/<[^>]+>/g, ''),
        )
            .replace(/\u00a0/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .trim()
        : '';

    if (isUnavailableRedditComment({
        id: commentId,
        author: author || '[deleted]',
        body: body || '[deleted]',
        score: score ?? 0,
        permalink: permalink || '',
        created_utc: 0,
    })) {
        return null;
    }

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
    );

    return {
        success: true,
        source: 'first-party',
        data: buildRedditCommentCard({
            subreddit,
            postId,
            commentId,
            commentAuthor: author,
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

    async handle(url: string, env: Env): Promise<HandlerResponse> {
        let resolvedUrl = url;
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

            if (isShareUrl || isCommentsUrl) {
                try {
                    const response = await fetchWithTimeout(url, {
                        redirect: 'manual',
                        headers: {
                            'Accept': 'text/html',
                            'User-Agent': 'FixEmbed/1.0 (embed service)',
                        },
                    });
                    const location = response.headers.get('location');
                    if (!location) {
                        if (isShareUrl) {
                            return { success: false, error: 'Could not resolve Reddit share link', redirect: url };
                        }
                    } else {
                        const destination = new URL(location, url);
                        const destinationHost = destination.hostname.toLowerCase().replace(/^www\./, '');
                        if (destination.protocol !== 'https:' || destinationHost !== 'reddit.com') {
                            return {
                                success: false,
                                error: isShareUrl ? 'Invalid Reddit share redirect' : 'Invalid Reddit comment redirect',
                                redirect: url,
                            };
                        }
                        resolvedUrl = destination.toString();
                    }
                } catch (resolveError) {
                    if (isShareUrl) {
                        return {
                            success: false,
                            error: resolveError instanceof Error
                                ? resolveError.message
                                : 'Could not resolve Reddit share link',
                            redirect: url,
                        };
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

        try {
            const commentId = parsed.commentId;
            const apiUrl = commentId
                ? `https://www.reddit.com/r/${parsed.subreddit}/comments/${parsed.postId}/_/${commentId}.json?raw_json=1&sr_detail=1&limit=1`
                : `https://www.reddit.com/r/${parsed.subreddit}/comments/${parsed.postId}.json?raw_json=1&sr_detail=1`;

            const response = await fetchJSON<Array<{
                data: {
                    children: Array<RedditListingChild<RedditPost | (RedditComment & { replies?: unknown })>>;
                };
            }>>(apiUrl, {
                headers: {
                    'User-Agent': 'FixEmbed/1.0 (embed service)',
                },
            });

            if (!response || !response[0]?.data?.children?.[0]) {
                if (commentId) {
                    return unavailableRedditCommentResponse(
                        safeDecodeURIComponent(parsed.subreddit),
                        safeDecodeURIComponent(parsed.postId),
                        safeDecodeURIComponent(commentId),
                    );
                }
                return {
                    success: false,
                    error: 'Post not found',
                };
                return {
                    success: false,
                    error: 'Post not found',
                };
            }

            const postChild = response[0].data.children[0];
            // Listing[0] is the link/post; older fixtures omit kind, so only reject explicit non-posts.
            if (postChild.kind && postChild.kind !== 't3') {
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
                try {
                    const recoveredComment = await recoverRedditCommentFromCrawlerPage(
                        safeDecodeURIComponent(parsed.subreddit),
                        safeDecodeURIComponent(parsed.postId),
                        safeDecodeURIComponent(parsed.commentId),
                    );
                    if (recoveredComment) return recoveredComment;
                } catch (recoveryError) {
                    console.error('Reddit comment recovery error:', recoveryError);
                }
                console.error('Reddit comment handler error:', error);
                return unavailableRedditCommentResponse(
                    safeDecodeURIComponent(parsed.subreddit),
                    safeDecodeURIComponent(parsed.postId),
                    safeDecodeURIComponent(parsed.commentId),
                );
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
    },
};
