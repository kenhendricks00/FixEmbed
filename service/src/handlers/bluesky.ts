/**
 * FixEmbed Service - Bluesky Handler
 */

import type { Env, HandlerResponse, PlatformHandler } from '../types.ts';
import { BLUESKY_POST_URL_PATTERN, parseBlueskyUrl, fetchJSON } from '../utils/fetch.ts';
import { platformColors, getBrandedSiteName, formatStats } from '../utils/embed.ts';
import {
    fetchAtprotoPostThread,
    parseAtprotoPostUrl,
    resolveAtprotoDid,
} from '../utils/atproto.ts';

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

type BlueskyThreadPost = BlueskyPost['thread']['post'];

/** Build the card for a post, linking back to the app the link was shared from. */
function blueskyCard(
    post: BlueskyThreadPost,
    postId: string,
    origin: string,
    siteName: string,
): HandlerResponse {
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
            url: `${origin}/profile/${author.handle}/post/${postId}`,
            siteName,
            authorName: author.displayName?.trim() || `@${author.handle}`,
            authorHandle: `@${author.handle}`,
            authorUrl: `${origin}/profile/${author.handle}`,
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
}

/** An AT Protocol app link that did not verify is treated like an unrecognized link. */
const UNSUPPORTED: HandlerResponse = {
    success: false,
    error: 'Unsupported URL',
    unsupported: true,
};

/**
 * Render a Bluesky-compatible app link from another host. It only renders when
 * the handle (or DID) and the post both check out on the public AppView.
 */
async function handleAtprotoAppPost(url: string): Promise<HandlerResponse> {
    const link = parseAtprotoPostUrl(url);
    if (!link) return UNSUPPORTED;
    try {
        const did = link.actor.startsWith('did:')
            ? link.actor
            : await resolveAtprotoDid(link.actor);
        if (!did) return UNSUPPORTED;
        const data = await fetchAtprotoPostThread<BlueskyPost>(did, link.rkey);
        if (!data?.thread?.post?.author?.handle || !data.thread.post.record) return UNSUPPORTED;
        return blueskyCard(
            data.thread.post,
            link.rkey,
            link.origin,
            getBrandedSiteName('atproto'),
        );
    } catch {
        return UNSUPPORTED;
    }
}

export const blueskyHandler: PlatformHandler = {
    name: 'bluesky',
    patterns: [BLUESKY_POST_URL_PATTERN],

    async handle(url: string, env: Env): Promise<HandlerResponse> {
        const parsed = parseBlueskyUrl(url);

        if (!parsed) {
            return handleAtprotoAppPost(url);
        }

        try {
            // Build the AT-URI from handle and post ID
            // First, we need to resolve the handle to a DID if it's not already one
            let did = parsed.handle;

            if (!did.startsWith('did:')) {
                // Resolve handle to DID
                const resolveUrl = `https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(parsed.handle)}`;
                const resolveData = await fetchJSON<{ did: string }>(resolveUrl);
                did = resolveData.did;
            }

            // Fetch the post thread
            const atUri = `at://${did}/app.bsky.feed.post/${parsed.postId}`;
            const threadUrl = `https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent(atUri)}`;

            const data = await fetchJSON<BlueskyPost>(threadUrl);

            if (!data?.thread?.post) {
                return { success: false, error: 'Post not found' };
            }

            return blueskyCard(
                data.thread.post,
                parsed.postId,
                parsed.origin,
                getBrandedSiteName('bluesky'),
            );
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
