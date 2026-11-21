/**
 * FixEmbed Service - Bluesky Handler
 */

import type { Env, HandlerResponse, PlatformHandler, VideoEmbed } from '../types.ts';
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
            embed?: BlueskyEmbedView;
            likeCount?: number;
            repostCount?: number;
            replyCount?: number;
        };
    };
}

/**
 * A post's hydrated embed view. Media views (images, video, external) carry
 * their fields at the top level. app.bsky.embed.record#view carries a quoted
 * post in `record`; app.bsky.embed.recordWithMedia#view carries the post's own
 * media view in `media` and the quote in `record` (a record#view).
 */
interface BlueskyEmbedView {
    $type?: string;
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
    media?: BlueskyEmbedView;
    record?: BlueskyQuotedRecordView | { record?: BlueskyQuotedRecordView };
}

/** app.bsky.embed.record#viewRecord (or a not-found/blocked/other record view). */
interface BlueskyQuotedRecordView {
    $type?: string;
    uri?: string;
    author?: { did?: string; handle?: string };
    embeds?: BlueskyEmbedView[];
}

interface BlueskyMedia {
    image?: string;
    images?: string[];
    video?: VideoEmbed;
}

const RECORD_VIEW = 'app.bsky.embed.record#view';
const RECORD_WITH_MEDIA_VIEW = 'app.bsky.embed.recordWithMedia#view';
const VIEW_RECORD = 'app.bsky.embed.record#viewRecord';

/** The media part of an embed view: a quote-with-media's `media`, nothing for a bare quote. */
function blueskyMediaView(embed: BlueskyEmbedView | undefined): BlueskyEmbedView | undefined {
    if (!embed || typeof embed !== 'object') return undefined;
    if (embed.$type === RECORD_WITH_MEDIA_VIEW || (embed.media && typeof embed.media === 'object')) {
        return embed.media && typeof embed.media === 'object' ? embed.media : undefined;
    }
    if (embed.$type === RECORD_VIEW) return undefined;
    return embed;
}

/** The quoted post of a quote (with or without media), if it is a visible post. */
function blueskyQuotedPost(embed: BlueskyEmbedView | undefined): BlueskyQuotedRecordView | undefined {
    if (!embed || typeof embed !== 'object') return undefined;
    let quoted: BlueskyQuotedRecordView | undefined;
    if (embed.$type === RECORD_WITH_MEDIA_VIEW) {
        const recordView = embed.record as { record?: BlueskyQuotedRecordView } | undefined;
        quoted = recordView?.record;
    } else if (embed.$type === RECORD_VIEW) {
        quoted = embed.record as BlueskyQuotedRecordView | undefined;
    }
    // Not-found, blocked and detached views have no author DID or embeds;
    // feed, list and starter-pack views use `creator`, not `author`.
    if (!quoted || typeof quoted !== 'object') return undefined;
    if (quoted.$type && quoted.$type !== VIEW_RECORD) return undefined;
    if (!quoted.author?.did?.trim()) return undefined;
    return quoted;
}

/** Card media for one embed view (images, video, or an external link thumbnail). */
function blueskyMedia(view: BlueskyEmbedView | undefined, did: string): BlueskyMedia {
    const media: BlueskyMedia = {};
    if (!view) return media;

    // Preserve the complete Bluesky carousel for Components V2.
    if (Array.isArray(view.images) && view.images.length > 0) {
        const imageUrls = view.images
            .map((item) => item?.fullsize)
            .filter((url): url is string => Boolean(url))
            .slice(0, 4);
        if (imageUrls.length === 1) [media.image] = imageUrls;
        if (imageUrls.length > 1) media.images = imageUrls;
    } else if (view.external?.thumb) {
        media.image = view.external.thumb;
    }

    const videoCid = view.$type === 'app.bsky.embed.video#view' ? view.cid?.trim() : undefined;
    if (videoCid) {
        media.video = {
            url: `https://bsky.social/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(videoCid)}`,
            width: positiveDimension(view.aspectRatio?.width, 1280),
            height: positiveDimension(view.aspectRatio?.height, 720),
            thumbnail: view.thumbnail,
        };
    }
    return media;
}

function hasMedia(media: BlueskyMedia): boolean {
    return Boolean(media.image || media.images || media.video);
}

/**
 * The post's own media, or, when it has none, the media of the post it quotes.
 * A quote-with-media uses its own media exactly as a plain post would.
 */
export function blueskyPostMedia(
    embed: BlueskyEmbedView | undefined,
    did: string,
): BlueskyMedia & { mediaOrigin?: 'quote' } {
    const own = blueskyMedia(blueskyMediaView(embed), did);
    if (hasMedia(own)) return own;

    const quoted = blueskyQuotedPost(embed);
    const quotedDid = quoted?.author?.did?.trim();
    if (!quoted || !quotedDid || !Array.isArray(quoted.embeds)) return own;
    // A quoted post's own quote is not followed further.
    const fromQuote = blueskyMedia(blueskyMediaView(quoted.embeds[0]), quotedDid);
    return hasMedia(fromQuote) ? { ...fromQuote, mediaOrigin: 'quote' } : own;
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

    const { image, images, video, mediaOrigin } = blueskyPostMedia(post.embed, author.did);

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
            ...(mediaOrigin ? { mediaOrigin } : {}),
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
