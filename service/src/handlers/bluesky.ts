/**
 * FixEmbed Service - Bluesky Handler
 */

import { Env, HandlerResponse, PlatformHandler } from '../types';
import { parseBlueskyUrl, fetchJSON, truncateText } from '../utils/fetch';
import { platformColors, getBrandedSiteName, formatStats } from '../utils/embed';

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

export const blueskyHandler: PlatformHandler = {
    name: 'bluesky',
    patterns: [
        /bsky\.app\/profile\/([^\/]+)\/post\/([^\/\?]+)/i,
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

            if (!did.startsWith('did:')) {
                // Resolve handle to DID
                const resolveUrl = `https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${parsed.handle}`;
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

            const post = data.thread.post;
            const author = post.author;
            const record = post.record;

            // Build description - just the post text, no stats
            const description = truncateText(record.text, 280);

            // Stats go to oEmbed row, not description
            const statsStr = formatStats({
                likes: post.likeCount,
                retweets: post.repostCount,
                comments: post.replyCount,
            });

            // Check for images
            let image: string | undefined;
            if (post.embed?.images && post.embed.images.length > 0) {
                image = post.embed.images[0].fullsize;
            } else if (post.embed?.external?.thumb) {
                image = post.embed.external.thumb;
            }

            return {
                success: true,
                data: {
                    // Title is the post content (or handle if empty)
                    title: description || `@${author.handle}`,
                    // Description shows the full post if title was truncated
                    description: '',
                    url: `https://bsky.app/profile/${author.handle}/post/${parsed.postId}`,
                    siteName: getBrandedSiteName('bluesky'),
                    // authorName shows handle - don't duplicate display name
                    authorName: `@${author.handle}`,
                    authorUrl: `https://bsky.app/profile/${author.handle}`,
                    authorAvatar: author.avatar,
                    image,
                    color: platformColors.bluesky,
                    platform: 'bluesky',
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
