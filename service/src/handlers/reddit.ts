/**
 * FixEmbed Service - Reddit Handler
 */

import type { Env, HandlerResponse, PlatformHandler } from '../types.ts';
import { parseRedditUrl, fetchJSON, fetchWithTimeout, truncateText } from '../utils/fetch.ts';
import { platformColors, getBrandedSiteName, formatStats } from '../utils/embed.ts';

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
}

interface RedditCommunityResponse {
    data?: {
        icon_img?: string;
        community_icon?: string;
    };
}

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

function linkedArticleSection(post: RedditPost, hasMedia: boolean) {
    if (hasMedia || !/^https?:\/\//i.test(post.url)) return undefined;
    try {
        const destination = new URL(post.url);
        if (/(^|\.)reddit\.com$|(^|\.)redd\.it$/i.test(destination.hostname)) return undefined;
        return [{
            kind: 'link-card' as const,
            title: 'Open linked article',
            body: destination.hostname.replace(/^www\./i, ''),
            url: post.url,
        }];
    } catch {
        return undefined;
    }
}

async function recoverFromRedditEmbed(
    subreddit: string,
    postId: string,
): Promise<HandlerResponse | null> {
    const displaySubreddit = safeDecodeURIComponent(subreddit);
    const encodedSubreddit = encodeURIComponent(displaySubreddit);
    const encodedPostId = encodeURIComponent(safeDecodeURIComponent(postId));
    const canonicalUrl = `https://www.reddit.com/r/${encodedSubreddit}/comments/${encodedPostId}/`;
    const response = await fetchWithTimeout(`https://embed.reddit.com/r/${encodedSubreddit}/comments/${encodedPostId}/`, {
        headers: {
            'Accept': 'text/html',
            'User-Agent': 'Mozilla/5.0 (compatible; FixEmbed/1.0; +https://fixembed.app)',
        },
    });
    if (!response.ok) return null;

    const html = await response.text();
    const title = html.match(/<shreddit-embed-title>([\s\S]*?)<\/shreddit-embed-title>/i)?.[1];
    if (!title) return null;

    const author = html.match(/reddit\.com\/user\/([^/"?]+)/i)?.[1];
    const subredditIcon = html.match(/<img\b[^>]*\bsrc="(https:\/\/styles\.redditmedia\.com\/[^"]+)"[^>]*>/i)?.[1];
    const image = html.match(/<img\s+src="(https:\/\/preview\.redd\.it\/[^"]+)"/i)?.[1];
    const score = Number(html.match(/data-testid="upvote"[\s\S]{0,1000}?<faceplate-number\s+number="(\d+)"/i)?.[1]) || undefined;
    const comments = Number(html.match(/View\s+([\d,]+)\s+comments?/i)?.[1].replace(/,/g, '')) || undefined;
    const cleanTitle = decodeRedditHtml(title.replace(/<[^>]+>/g, ''));
    const displayAuthor = author ? safeDecodeURIComponent(author) : undefined;
    const authorAvatar = await fetchSubredditIcon(
        displaySubreddit,
        subredditIcon ? decodeRedditHtml(subredditIcon) : '',
        redditCookieHeader(response),
    );

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
            image: image ? decodeRedditHtml(image) : undefined,
            color: platformColors.reddit,
            platform: 'reddit',
            stats: formatStats({ comments, likes: score }),
        },
    };
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
            const sections = linkedArticleSection(post, Boolean(video || image || images.length));

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
