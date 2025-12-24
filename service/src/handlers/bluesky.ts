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

            // Build description
            let description = truncateText(record.text, 280);

            // Add engagement stats if available
            const statsStr = formatStats({
                likes: post.likeCount,
                retweets: post.repostCount,
                comments: post.replyCount,
            });
            if (statsStr) {
                description += `\n\n${statsStr}`;
            }

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
                    title: `${author.displayName || author.handle} (@${author.handle})`,
                    description,
                    url: `https://bsky.app/profile/${author.handle}/post/${parsed.postId}`,
                    siteName: getBrandedSiteName('bluesky'),
                    authorName: author.displayName || author.handle,
                    authorUrl: `https://bsky.app/profile/${author.handle}`,
                    authorAvatar: author.avatar,
                    image,
                    color: platformColors.bluesky,
                    platform: 'bluesky',
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
