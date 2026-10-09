/**
 * FixEmbed Service - Bluesky Handler
 */

import type { Env, HandlerResponse, PlatformHandler } from '../types.ts';
import { parseBlueskyUrl, fetchWithTimeout } from '../utils/fetch.ts';
import { platformColors, getBrandedSiteName, formatStats } from '../utils/embed.ts';

/**
 * A Bluesky XRPC call. A 400 carries Bluesky's own error name (`NotFound`,
 * `InvalidRequest`), which says something about the post; any other failure
 * (5xx, timeout) is an outage and throws, so the caller keeps its fallback.
 */
async function fetchBluesky<T>(url: string): Promise<{ data?: T; error?: string; message?: string }> {
    const response = await fetchWithTimeout(url, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'FixEmbed/1.0' },
    });
    if (response.ok) return { data: await response.json() as T };
    if (response.status === 400) {
        const body = await response.json().catch(() => ({})) as { error?: string; message?: string };
        return { error: String(body.error || ''), message: String(body.message || '') };
    }
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
}

/**
 * A FixEmbed-owned "Post unavailable" card when Bluesky says the post or its
 * account is gone, instead of falling back to the raw link (same idea as X's
 * and Reddit's unavailable cards).
 */
function unavailableBlueskyResponse(url: string, reason: 'post' | 'account'): HandlerResponse {
    const description = reason === 'account'
        ? 'The account for this post no longer exists or changed its handle.'
        : 'This post was deleted or is no longer available.';
    return {
        success: true,
        source: 'first-party',
        data: {
            title: 'Post unavailable',
            description,
            url,
            siteName: getBrandedSiteName('bluesky'),
            color: platformColors.bluesky,
            platform: 'bluesky',
            sections: [{ kind: 'tombstone', title: 'Post unavailable', body: description }],
        },
    };
}

interface BlueskyPost {
    thread: {
        post: {
            uri: string;
            cid: string;
            author: {
                did: string;
                handle: string;
                displayName?: string;
                avatar?: string;
            };
            record: {
                text: string;
                createdAt: string;
                embed?: {
                    $type: string;
                    images?: Array<{
                        alt: string;
                        image: { ref: { $link: string }; mimeType: string };
                    }>;
                    external?: {
                        uri: string;
                        title: string;
                        description: string;
                        thumb?: { ref: { $link: string } };
                    };
                };
            };
            embed?: {
                $type: string;
                cid?: string;
                playlist?: string;
                thumbnail?: string;
                aspectRatio?: {
                    width?: number;
                    height?: number;
                };
                images?: Array<{
                    alt: string;
                    fullsize: string;
                    thumb: string;
                }>;
                external?: {
                    uri: string;
                    title: string;
                    description: string;
                    thumb?: string;
                };
            };
            likeCount?: number;
            repostCount?: number;
            replyCount?: number;
        };
    };
}

export function buildBlueskyContent(text: string, handle: string): { title: string; description: string } {
    return {
        title: `@${handle}`,
        description: text,
    };
}

export const blueskyHandler: PlatformHandler = {
    name: 'bluesky',
    patterns: [
        /bskyx?\.app\/profile\/([^\/]+)\/post\/([^\/\?]+)/i,
    ],

    async handle(url: string, env: Env): Promise<HandlerResponse> {
        const parsed = parseBlueskyUrl(url);

        if (!parsed) {
            return { success: false, error: 'Invalid Bluesky URL' };
        }

        try {
            // Build the AT-URI from handle and post ID
            // First, we need to resolve the handle to a DID if it's not already one
            let did = parsed.handle;

            const canonicalUrl = `https://bsky.app/profile/${parsed.handle}/post/${parsed.postId}`;
            if (!did.startsWith('did:')) {
                // Resolve handle to DID
                const resolveUrl = `https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${parsed.handle}`;
                const resolved = await fetchBluesky<{ did: string }>(resolveUrl);
                if (!resolved.data?.did) {
                    if (/unable to resolve handle/i.test(resolved.message || '')) {
                        return unavailableBlueskyResponse(canonicalUrl, 'account');
                    }
                    throw new Error(`Bluesky handle lookup failed: ${resolved.error || 'no DID'}`);
                }
                did = resolved.data.did;
            }

            // Fetch the post thread
            const atUri = `at://${did}/app.bsky.feed.post/${parsed.postId}`;
            const threadUrl = `https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent(atUri)}`;

            const thread = await fetchBluesky<BlueskyPost & { thread?: { $type?: string } }>(threadUrl);
            // Bluesky says the post is gone: a NotFound error, or a notFoundPost thread.
            if (
                thread.error === 'NotFound'
                || thread.data?.thread?.$type === 'app.bsky.feed.defs#notFoundPost'
            ) {
                return unavailableBlueskyResponse(canonicalUrl, 'post');
            }
            const data = thread.data;

            if (!data?.thread?.post) {
                throw new Error(`Bluesky thread lookup failed: ${thread.error || 'no post'}`);
            }

            const post = data.thread.post;
            const author = post.author;
            const record = post.record;

            const content = buildBlueskyContent(record.text, author.handle);

            // Stats go to oEmbed row, not description
            const statsStr = formatStats({
                likes: post.likeCount,
                retweets: post.repostCount,
                comments: post.replyCount,
            });

            // Preserve the complete Bluesky carousel for Components V2.
            let image: string | undefined;
            let images: string[] | undefined;
            if (post.embed?.images && post.embed.images.length > 0) {
                const imageUrls = post.embed.images
                    .map((item) => item.fullsize)
                    .filter(Boolean)
                    .slice(0, 4);
                if (imageUrls.length === 1) [image] = imageUrls;
                if (imageUrls.length > 1) images = imageUrls;
            } else if (post.embed?.external?.thumb) {
                image = post.embed.external.thumb;
            }

            const videoView = post.embed?.$type === 'app.bsky.embed.video#view'
                ? post.embed
                : undefined;
            const videoCid = videoView?.cid?.trim();
            const video = videoCid ? {
                url: `https://bsky.social/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(author.did)}&cid=${encodeURIComponent(videoCid)}`,
                width: positiveDimension(videoView?.aspectRatio?.width, 1280),
                height: positiveDimension(videoView?.aspectRatio?.height, 720),
                thumbnail: videoView?.thumbnail,
            } : undefined;

            return {
                success: true,
                source: 'first-party',
                data: {
                    title: content.title,
                    description: content.description,
                    url: `https://bsky.app/profile/${author.handle}/post/${parsed.postId}`,
                    siteName: getBrandedSiteName('bluesky'),
                    authorName: author.displayName?.trim() || `@${author.handle}`,
                    authorHandle: `@${author.handle}`,
                    authorUrl: `https://bsky.app/profile/${author.handle}`,
                    authorAvatar: author.avatar,
                    image,
                    images,
                    video,
                    color: platformColors.bluesky,
                    platform: 'bluesky',
                    timestamp: record.createdAt,
                    stats: statsStr, // Stats shown via oEmbed author_name row
                },
            };
        } catch (error) {
            console.error('Bluesky handler error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch post',
                redirect: url,
            };
        }
    },
};

function positiveDimension(value: number | undefined, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? Math.round(value)
        : fallback;
}
