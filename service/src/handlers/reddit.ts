/**
 * FixEmbed Service - Reddit Handler
 */

import type { Env, HandlerResponse, PlatformHandler } from '../types.ts';
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
            'User-Agent': 'FixEmbed/1.0 (embed service)',
        };
        if (cookie) headers.Cookie = cookie;
        const community = await fetchJSON<RedditCommunityResponse>(
            `https://www.reddit.com/r/${encodedSubreddit}/about.json?raw_json=1`,
            { headers },
        );
        return decodeRedditHtml(
            community?.data?.community_icon || community?.data?.icon_img || '',
        ) || undefined;
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

async function readArticleHtml(response: Response): Promise<string> {
    const declared = Number.parseInt(response.headers.get('Content-Length') || '', 10);
    if (Number.isFinite(declared) && declared > MAX_ARTICLE_HTML_BYTES) return '';
    if (!response.body) return '';

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let size = 0;
    let html = '';
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_ARTICLE_HTML_BYTES) {
            await reader.cancel();
            return '';
        }
        html += decoder.decode(value, { stream: true });
    }
    return html + decoder.decode();
}

function articleMetaContent(html: string, key: string): string | undefined {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
        new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i'),
        new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, 'i'),
    ];
    return patterns.map((pattern) => html.match(pattern)?.[1]).find(Boolean);
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
        const html = await readArticleHtml(response);
        const image = articleMetaContent(html, 'og:image') || articleMetaContent(html, 'twitter:image');
        return image ? publicHttpsUrl(image, articleUrl)?.toString() : undefined;
    } catch {
        return undefined;
    }
}

function htmlAttribute(tag: string, name: string): string {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return decodeRedditHtml(
        tag.match(new RegExp(`\\b${escaped}=["']([^"']*)["']`, 'i'))?.[1] || '',
    );
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

    const html = await response.text();
    const escapedPostId = postId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const postTag = html.match(
        new RegExp(`<div\\b(?=[^>]*\\bid=["']thing_t3_${escapedPostId}["'])[^>]*>`, 'i'),
    )?.[0];
    if (!postTag) return null;
    const postStart = html.indexOf(postTag);
    const postHtml = html.slice(postStart, postStart + 20_000);
    const rawTitle = postHtml.match(
        /<a\b[^>]*\bclass=["'][^"']*\btitle\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/i,
    )?.[1];
    if (!rawTitle) return null;

    const author = htmlAttribute(postTag, 'data-author');
    const articleUrl = linkedArticleUrl(htmlAttribute(postTag, 'data-url'));
    const permalink = htmlAttribute(postTag, 'data-permalink');
    const score = Number(htmlAttribute(postTag, 'data-score')) || undefined;
    const comments = Number(htmlAttribute(postTag, 'data-comments-count')) || undefined;
    const timestampMs = Number(htmlAttribute(postTag, 'data-timestamp'));
    const iconTag = html.match(/<img\b(?=[^>]*\bid=["']header-img["'])[^>]*>/i)?.[0] || '';
    const authorAvatar = publicHttpsUrl(
        htmlAttribute(iconTag, 'src'),
        'https://old.reddit.com',
    )?.toString();
    const fallbackImage = articleMetaContent(html, 'og:image');
    const image = await fetchArticleImage(articleUrl)
        || (fallbackImage ? publicHttpsUrl(fallbackImage, pageUrl)?.toString() : undefined);
    const canonicalUrl = permalink
        ? new URL(permalink, 'https://www.reddit.com').toString()
        : `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/comments/${encodeURIComponent(postId)}/`;

    return {
        success: true,
        source: 'first-party',
        data: {
            title: `r/${subreddit} \u2022 ${truncateText(decodeRedditHtml(rawTitle.replace(/<[^>]+>/g, '')), 100)}`,
            description: '',
            url: canonicalUrl,
            siteName: getBrandedSiteName('reddit'),
            authorName: author ? `u/${author}` : undefined,
            authorUrl: author ? `https://www.reddit.com/user/${encodeURIComponent(author)}/` : undefined,
            authorAvatar,
            image,
            color: platformColors.reddit,
            platform: 'reddit',
            stats: formatStats({ comments, likes: score }),
            timestamp: Number.isFinite(timestampMs) && timestampMs > 0
                ? new Date(timestampMs).toISOString()
                : undefined,
            sections: linkedArticleSection(articleUrl),
            sensitive: htmlAttribute(postTag, 'data-nsfw') === 'true',
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
        const response = await fetchWithTimeout(`https://embed.reddit.com/r/${encodedSubreddit}/comments/${encodedPostId}/`, {
            headers: {
                'Accept': 'text/html',
                'User-Agent': 'Mozilla/5.0 (compatible; FixEmbed/1.0; +https://fixembed.app)',
            },
        });
        if (response.ok) {
            const html = await response.text();
            const title = html.match(/<shreddit-embed-title>([\s\S]*?)<\/shreddit-embed-title>/i)?.[1]
                || html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
            if (title) {
                const author = html.match(/reddit\.com\/user\/([^/"?]+)/i)?.[1];
                const subredditIcon = html.match(/<img\b[^>]*\bsrc="(https:\/\/styles\.redditmedia\.com\/[^"]+)"[^>]*>/i)?.[1];
                const embeddedImage = html.match(/<img\s+src="(https:\/\/preview\.redd\.it\/[^"]+)"/i)?.[1];
                const outboundUrl = html.match(/&quot;url&quot;:&quot;([\s\S]*?)&quot;/i)?.[1];
                const articleUrl = linkedArticleUrl(outboundUrl ? decodeRedditHtml(outboundUrl) : '');
                const score = Number(html.match(/data-testid="upvote"[\s\S]{0,1000}?<faceplate-number\s+number="(\d+)"/i)?.[1]) || undefined;
                const comments = Number(html.match(/View\s+([\d,]+)\s+comments?/i)?.[1].replace(/,/g, '')) || undefined;
                const cleanTitle = decodeRedditHtml(title.replace(/<[^>]+>/g, ''));
                const displayAuthor = author ? safeDecodeURIComponent(author) : undefined;
                const authorAvatar = await fetchSubredditIcon(
                    displaySubreddit,
                    subredditIcon ? decodeRedditHtml(subredditIcon) : '',
                    redditCookieHeader(response),
                );
                const image = embeddedImage
                    ? decodeRedditHtml(embeddedImage)
                    : await fetchArticleImage(articleUrl);

                return {
                    success: true,
                    source: 'first-party',
                    data: {
                        title: `r/${displaySubreddit} • ${truncateText(cleanTitle, 100)}`,
                        description: '',
                        url: canonicalUrl,
                        siteName: getBrandedSiteName('reddit'),
                        authorName: displayAuthor ? `u/${displayAuthor}` : undefined,
                        authorUrl: displayAuthor ? `https://www.reddit.com/user/${encodeURIComponent(displayAuthor)}/` : undefined,
                        authorAvatar,
                        image,
                        color: platformColors.reddit,
                        platform: 'reddit',
                        stats: formatStats({ comments, likes: score }),
                        timestamp: extractPostTimestampFromHtml(html),
                        sections: linkedArticleSection(articleUrl),
                    },
                };
            }
        }
    } catch {
        // Continue to the metadata-only recovery when rich embeds are blocked.
    }

    try {
        const crawlerRecovery = await recoverFromRedditCrawlerPage(
            displaySubreddit,
            safeDecodeURIComponent(postId),
        );
        if (crawlerRecovery) return crawlerRecovery;
    } catch {
        // Continue to Reddit oEmbed when the crawler-facing page is unavailable.
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
                    title: `r/${displaySubreddit} • ${truncateText(title, 100)}`,
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

            if (isShareUrl) {
                const response = await fetchWithTimeout(url, {
                    redirect: 'manual',
                    headers: {
                        'Accept': 'text/html',
                        'User-Agent': 'FixEmbed/1.0 (embed service)',
                    },
                });
                const location = response.headers.get('location');
                if (!location) {
                    return { success: false, error: 'Could not resolve Reddit share link', redirect: url };
                }

                const destination = new URL(location, url);
                const destinationHost = destination.hostname.toLowerCase().replace(/^www\./, '');
                if (destination.protocol !== 'https:' || destinationHost !== 'reddit.com') {
                    return { success: false, error: 'Invalid Reddit share redirect', redirect: url };
                }
                resolvedUrl = destination.toString();
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
            // Fetch post data using Reddit's JSON API
            const apiUrl = `https://www.reddit.com/r/${parsed.subreddit}/comments/${parsed.postId}.json?raw_json=1&sr_detail=1`;

            const response = await fetchJSON<Array<{ data: { children: Array<{ data: RedditPost }> } }>>(apiUrl, {
                headers: {
                    'User-Agent': 'FixEmbed/1.0 (embed service)',
                },
            });

            if (!response || !response[0]?.data?.children?.[0]) {
                return { success: false, error: 'Post not found' };
            }

            const post = response[0].data.children[0].data;

            // Build description (no stats here - moved to oEmbed row)
            const description = post.selftext ? truncateText(post.selftext, 1200) : '';

            // Format stats for oEmbed row (consistent with Twitter/Threads/Bluesky)
            const stats = formatStats({
                comments: post.num_comments,
                likes: post.score, // Reddit uses score/upvotes as "likes"
            });

            // Check for media
            let image: string | undefined;
            const images = redditGalleryImages(post);
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
                post.sr_detail?.icon_img || post.sr_detail?.community_icon || '',
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

            return {
                success: true,
                source: 'first-party',
                data: {
                    title: `r/${post.subreddit} • ${truncateText(post.title, 100)}`,
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
                    sensitive: post.over_18 === true,
                },
            };
        } catch (error) {
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
