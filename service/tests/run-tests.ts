import assert from 'node:assert/strict';

import app from '../src/index.ts';
import { findHandler } from '../src/handlers/index.ts';
import { twitterHandler } from '../src/handlers/twitter.ts';
import { normalizeTwitterWebsiteCard } from '../src/handlers/twitter_graphql.ts';
import { instagramHandler } from '../src/handlers/instagram.ts';
import { redditHandler } from '../src/handlers/reddit.ts';
import { parseYouTubeCommunityPostHtml, youtubeHandler } from '../src/handlers/youtube.ts';
import { pixivHandler } from '../src/handlers/pixiv.ts';
import { bilibiliHandler } from '../src/handlers/bilibili.ts';
import { blueskyHandler, buildBlueskyContent } from '../src/handlers/bluesky.ts';
import { threadsHandler } from '../src/handlers/threads.ts';
import type { Env } from '../src/types.ts';
import { assessProbeResult } from '../src/utils/status.ts';
import { docsHtml, indexHtml, statusHtml } from '../src/utils/static_site.ts';
import { handleTopGgWebhook } from '../src/webhooks/topgg.ts';
import { encodeActivitySource, formatActivityContent, generateEmbedHTML, normalizeEmbedLayout } from '../src/utils/embed.ts';
import {
    cleanUrl,
    parseBlueskyUrl,
    parseInstagramUrl,
    parseRedditUrl,
    parseTwitterUrl,
    truncateText,
} from '../src/utils/fetch.ts';

type TestCase = {
    name: string;
    run: () => void | Promise<void>;
};

const env: Env = {
    SITE_NAME: 'FixEmbed',
    BRANDING_NAME: 'FixEmbed',
    EMBED_DOMAIN: 'fixembed.app',
    ENABLE_CACHE: 'false',
    CACHE_TTL: '3600',
};

async function topGgSignature(body: string, secret: string, timestamp: number): Promise<string> {
    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
    );
    const signature = await crypto.subtle.sign(
        'HMAC',
        key,
        new TextEncoder().encode(`${timestamp}.${body}`),
    );
    return `t=${timestamp},v1=${[...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

const tests: TestCase[] = [
    {
        name: 'threadsHandler preserves full post text and creator identity metadata',
        run: async () => {
            const originalFetch = globalThis.fetch;
            globalThis.fetch = async () => new Response(JSON.stringify({
                data: { data: { edges: [{ node: { thread_items: [{ post: {
                    code: 'ABC123',
                    user: {
                        username: 'creator',
                        profile_pic_url: 'https://cdn.example/avatar.jpg',
                    },
                    caption: { text: 'A full Threads post that should remain intact.' },
                    like_count: 1200,
                    text_post_app_info: { direct_reply_count: 34 },
                    image_versions2: { candidates: [{ url: 'https://cdn.example/post.jpg' }] },
                } }] } }] } },
            }), { status: 200 });

            try {
                const response = await threadsHandler.handle(
                    'https://www.threads.net/@creator/post/ABC123',
                    env,
                );
                assert.equal(response.success, true);
                assert.equal(response.data?.caption, 'A full Threads post that should remain intact.');
                assert.equal(response.data?.authorName, 'creator');
                assert.equal(response.data?.authorHandle, '@creator');
                assert.equal(response.data?.authorAvatar, 'https://cdn.example/avatar.jpg');
            } finally {
                globalThis.fetch = originalFetch;
            }
        },
    },
    {
        name: 'normalizeTwitterWebsiteCard preserves link preview metadata',
        run: () => {
            const websiteCard = normalizeTwitterWebsiteCard({
                legacy: {
                    name: 'summary_large_image',
                    binding_values: [
                        { key: 'title', value: { string_value: 'Linked story' } },
                        { key: 'description', value: { string_value: 'Story description' } },
                        { key: 'domain', value: { string_value: 'example.com' } },
                        { key: 'card_url', value: { string_value: 'https://example.com/story' } },
                        { key: 'summary_photo_image_large', value: { image_value: { url: 'https://example.com/story.jpg' } } },
                    ],
                },
            });
            assert.deepEqual(websiteCard, {
                title: 'Linked story',
                description: 'Story description',
                domain: 'example.com',
                url: 'https://example.com/story',
                image: 'https://example.com/story.jpg',
            });
        },
    },
    {
        name: 'normalizeEmbedLayout promotes post text when the title repeats the creator',
        run: () => {
            const normalized = normalizeEmbedLayout({
                title: 'brooke_annm',
                description: 'Your annual reminder that Costco is an F1 ticket plug',
                url: 'https://www.instagram.com/reel/example/',
                siteName: 'FixEmbed • Instagram',
                authorName: '@brooke_annm',
                platform: 'instagram',
            });

            assert.equal(normalized.authorName, '@brooke_annm');
            assert.equal(normalized.title, 'Your annual reminder that Costco is an F1 ticket plug');
            assert.equal(normalized.description, '');
        },
    },
    {
        name: 'normalizeEmbedLayout preserves distinct titles and descriptions',
        run: () => {
            const normalized = normalizeEmbedLayout({
                title: 'A useful video',
                description: 'A separate summary of the video.',
                url: 'https://www.youtube.com/watch?v=example',
                siteName: 'FixEmbed • YouTube',
                authorName: 'Creator',
                platform: 'youtube',
            });

            assert.equal(normalized.title, 'A useful video');
            assert.equal(normalized.description, 'A separate summary of the video.');
        },
    },
    {
        name: 'normalizeEmbedLayout preserves the classic X handle and body layout',
        run: () => {
            const normalized = normalizeEmbedLayout({
                title: '@BerntBornich',
                description: 'Introducing NEO\'s 25 Degrees of Freedom.',
                url: 'https://x.com/BerntBornich/status/example',
                siteName: 'FixEmbed • Twitter',
                authorName: 'Bernt Bornich',
                authorHandle: '@BerntBornich',
                platform: 'twitter',
            });

            assert.equal(normalized.title, '@BerntBornich');
            assert.equal(normalized.description, 'Introducing NEO\'s 25 Degrees of Freedom.');
        },
    },
    {
        name: 'cleanUrl removes tracking params but preserves the canonical path',
        run: () => {
            const cleaned = cleanUrl('https://x.com/example/status/1234567890?s=20&t=abc&utm_source=discord&keep=1');
            assert.equal(cleaned, 'https://x.com/example/status/1234567890?keep=1');
        },
    },
    {
        name: 'parseTwitterUrl supports both native and alternative Twitter domains',
        run: () => {
            assert.deepEqual(
                parseTwitterUrl('https://x.com/openai/status/1234567890'),
                { username: 'openai', tweetId: '1234567890' },
            );

            assert.deepEqual(
                parseTwitterUrl('https://vxtwitter.com/openai/status/1234567890'),
                { username: 'openai', tweetId: '1234567890' },
            );
        },
    },
    {
        name: 'parseInstagramUrl detects posts, reels, and stories',
        run: () => {
            assert.deepEqual(
                parseInstagramUrl('https://www.instagram.com/p/CuE2WN4oKyR/?img_index=1'),
                { shortcode: 'CuE2WN4oKyR', type: 'post' },
            );

            assert.deepEqual(
                parseInstagramUrl('https://instagram.com/reel/C7abc123xyz/?utm_source=ig_web_copy_link'),
                { shortcode: 'C7abc123xyz', type: 'reel' },
            );

            assert.deepEqual(
                parseInstagramUrl('https://instagram.com/reels/C7abc123xyz/'),
                { shortcode: 'C7abc123xyz', type: 'reel' },
            );

            assert.deepEqual(
                parseInstagramUrl('https://www.instagram.com/stories/exampleuser/31415926535/'),
                { shortcode: '31415926535', type: 'story' },
            );
        },
    },
    {
        name: 'parseRedditUrl and parseBlueskyUrl extract identifiers',
        run: () => {
            assert.deepEqual(
                parseRedditUrl('https://www.reddit.com/r/programming/comments/abc123/example_post/'),
                { subreddit: 'programming', postId: 'abc123' },
            );

            assert.deepEqual(
                parseBlueskyUrl('https://bsky.app/profile/bsky.app/post/3lb5u6adjs22t'),
                { handle: 'bsky.app', postId: '3lb5u6adjs22t' },
            );

            assert.deepEqual(
                parseBlueskyUrl('https://bskyx.app/profile/example.bsky.social/post/3lask667wfj2b'),
                { handle: 'example.bsky.social', postId: '3lask667wfj2b' },
            );
        },
    },
    {
        name: 'Bluesky embeds preserve the full post text',
        run: () => {
            const text = 'a'.repeat(300);
            assert.deepEqual(buildBlueskyContent(text, 'example.bsky.social'), {
                title: '@example.bsky.social',
                description: text,
            });
        },
    },
    {
        name: 'truncateText only adds an ellipsis when text exceeds the limit',
        run: () => {
            assert.equal(truncateText('short text', 20), 'short text');
            assert.equal(truncateText('abcdefghijklmnopqrstuvwxyz', 10), 'abcdefg...');
        },
    },
    {
        name: 'findHandler resolves each supported platform route',
        run: () => {
            assert.equal(findHandler('https://x.com/openai/status/123')?.name, 'twitter');
            assert.equal(findHandler('https://www.instagram.com/p/CuE2WN4oKyR/')?.name, 'instagram');
            assert.equal(findHandler('https://www.reddit.com/r/programming/comments/abc123/example/')?.name, 'reddit');
            assert.equal(findHandler('https://www.threads.net/@zuck/post/Cu8M4wXLZQx')?.name, 'threads');
            assert.equal(findHandler('https://www.threads.net/t/Cu8M4wXLZQx')?.name, 'threads');
            assert.equal(findHandler('https://bsky.app/profile/bsky.app/post/3lb5u6adjs22t')?.name, 'bluesky');
            assert.equal(findHandler('https://bskyx.app/profile/example.bsky.social/post/3lask667wfj2b')?.name, 'bluesky');
            assert.equal(findHandler('https://www.pixiv.net/en/artworks/101844438')?.name, 'pixiv');
            assert.equal(findHandler('https://www.bilibili.com/video/BV1xx411c7mD')?.name, 'bilibili');
            assert.equal(findHandler('https://www.youtube.com/watch?v=dQw4w9WgXcQ')?.name, 'youtube');
        },
    },
    {
        name: 'findHandler returns null for unsupported URLs',
        run: () => {
            assert.equal(findHandler('https://example.com/not-supported'), null);
        },
    },
    {
        name: 'pixivHandler uses Pixiv artwork data before Phixiv fallback',
        run: async () => {
            const originalFetch = globalThis.fetch;
            const requested: string[] = [];
            globalThis.fetch = async (input) => {
                requested.push(String(input));
                if (String(input).endsWith('/pages')) {
                    return new Response(JSON.stringify({ error: false, body: [
                        { urls: { regular: 'https://i.pximg.net/page-1.jpg' } },
                        { urls: { regular: 'https://i.pximg.net/page-2.jpg' } },
                    ] }), { status: 200 });
                }
                return new Response(JSON.stringify({ error: false, body: {
                    title: 'Artwork', description: 'Uses &amp;#44; commas', userName: 'Artist', userId: '42',
                    userAccount: 'artist_account', bookmarkCount: 40, likeCount: 30,
                    viewCount: 500, commentCount: 2, createDate: '2026-07-13T19:00:00.000Z',
                    urls: { regular: 'https://i.pximg.net/img-original/artwork.jpg' },
                    userIllusts: { '123': { profileImageUrl: 'https://i.pximg.net/user-profile/avatar.jpg' } },
                } }), { status: 200 });
            };
            try {
                const response = await pixivHandler.handle('https://www.pixiv.net/artworks/123', env);
                assert.equal(requested.length, 2);
                assert.match(requested[0], /^https:\/\/www\.pixiv\.net\/ajax\/illust\/123/);
                assert.match(requested[1], /^https:\/\/www\.pixiv\.net\/ajax\/illust\/123\/pages/);
                assert.equal(response.source, 'first-party');
                assert.equal(response.data?.title, 'Artwork');
                assert.equal(response.data?.description, 'Uses , commas');
                assert.equal(response.data?.authorHandle, '@artist_account');
                assert.equal(
                    response.data?.authorAvatar,
                    'https://fixembed.app/proxy/pixiv?url=https%3A%2F%2Fi.pximg.net%2Fuser-profile%2Favatar.jpg',
                );
                assert.deepEqual(response.data?.images, [
                    'https://fixembed.app/proxy/pixiv?url=https%3A%2F%2Fi.pximg.net%2Fpage-1.jpg',
                    'https://fixembed.app/proxy/pixiv?url=https%3A%2F%2Fi.pximg.net%2Fpage-2.jpg',
                ]);
                assert.equal(response.data?.stats, '💬 2 ❤️ 30 👁️ 500 🔖 40');
                assert.equal(response.data?.timestamp, '2026-07-13T19:00:00.000Z');
            } finally { globalThis.fetch = originalFetch; }
        },
    },
    {
        name: 'bilibiliHandler uses Bilibili API data before VxBilibili fallback',
        run: async () => {
            const originalFetch = globalThis.fetch;
            const requested: string[] = [];
            globalThis.fetch = async (input) => {
                requested.push(String(input));
                return new Response(JSON.stringify({ code: 0, data: {
                    title: 'Video', desc: 'Description', pic: '//i0.hdslb.com/video.jpg',
                    owner: { name: 'Creator', mid: 42 },
                } }), { status: 200 });
            };
            try {
                const response = await bilibiliHandler.handle('https://www.bilibili.com/video/BV1xx411c7mD', env);
                assert.equal(requested.length, 1);
                assert.match(requested[0], /^https:\/\/api\.bilibili\.com\/x\/web-interface\/view/);
                assert.equal(response.source, 'first-party');
                assert.equal(response.data?.title, 'Video');
            } finally { globalThis.fetch = originalFetch; }
        },
    },
    {
        name: 'youtubeHandler uses official YouTube oEmbed before external fallbacks',
        run: async () => {
            const originalFetch = globalThis.fetch;
            const requested: string[] = [];
            globalThis.fetch = async (input) => {
                requested.push(String(input));
                return new Response(JSON.stringify({
                    title: 'Official video', author_name: 'Creator',
                    author_url: 'https://www.youtube.com/@creator',
                    thumbnail_url: 'https://i.ytimg.com/vi/abc123/hqdefault.jpg',
                }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            };
            try {
                const response = await youtubeHandler.handle('https://youtu.be/abc123', env);
                assert.equal(requested.length, 1);
                assert.match(requested[0], /^https:\/\/www\.youtube\.com\/oembed/);
                assert.equal(response.source, 'first-party');
                assert.equal(response.data?.title, 'Official video');
            } finally { globalThis.fetch = originalFetch; }
        },
    },
    {
        name: 'YouTube community posts render creator text stats and full-size media',
        run: () => {
            const html = `<script>const preloadNames = ["backstagePostRenderer"];</script><script>var ytInitialData = {
                "contents": {"backstagePostRenderer": {
                    "postId": "UgkxExample123",
                    "authorText": {"runs": [{"text": "Creator Name"}]},
                    "authorEndpoint": {"browseEndpoint": {"canonicalBaseUrl": "/@creator"}},
                    "authorThumbnail": {"thumbnails": [{"url": "//yt3.example/avatar.jpg", "width": 88}]},
                    "contentText": {"runs": [{"text": "A detailed community update with an image."}]},
                    "voteCount": {"simpleText": "1.2K"},
                    "replyCount": {"runs": [{"text": "34"}]},
                    "backstageAttachment": {"backstageImageRenderer": {"image": {"thumbnails": [
                        {"url": "https://yt3.example/small.jpg", "width": 320, "height": 180},
                        {"url": "https://yt3.example/full.jpg", "width": 1280, "height": 720}
                    ]}}}
                }}
            };</script>`;

            const data = parseYouTubeCommunityPostHtml(
                html,
                'https://www.youtube.com/post/UgkxExample123',
            );

            assert.equal(data?.authorName, 'Creator Name');
            assert.equal(data?.description, 'A detailed community update with an image.');
            assert.equal(data?.image, 'https://yt3.example/full.jpg');
            assert.equal(data?.stats, '👍 1.2K  💬 34');
            assert.equal(data?.authorUrl, 'https://www.youtube.com/@creator');
            assert.equal(data?.authorAvatar, 'https://yt3.example/avatar.jpg');
            assert.equal(data?.siteName, 'FixEmbed • ▶️ YouTube');
        },
    },
    {
        name: 'youtubeHandler fetches community posts directly from YouTube',
        run: async () => {
            const originalFetch = globalThis.fetch;
            const requested: string[] = [];
            globalThis.fetch = async (input) => {
                requested.push(String(input));
                return new Response(
                    '<meta property="og:description" content="Official community update"><meta property="og:image" content="https://yt3.example/post.jpg"><meta itemprop="author" content="Creator">',
                    { status: 200 },
                );
            };
            try {
                const response = await youtubeHandler.handle(
                    'https://www.youtube.com/post/UgkxExample123',
                    env,
                );
                assert.equal(requested.length, 1);
                assert.equal(requested[0], 'https://www.youtube.com/post/UgkxExample123');
                assert.equal(response.success, true);
                assert.equal(response.source, 'first-party');
                assert.equal(response.data?.image, 'https://yt3.example/post.jpg');
            } finally { globalThis.fetch = originalFetch; }
        },
    },
    {
        name: 'youtubeHandler retries the official mobile page when desktop metadata is unavailable',
        run: async () => {
            const originalFetch = globalThis.fetch;
            const requested: string[] = [];
            globalThis.fetch = async (input) => {
                const url = String(input);
                requested.push(url);
                if (url.startsWith('https://www.youtube.com/')) {
                    return new Response('<html>No post metadata</html>', { status: 200 });
                }
                return new Response(
                    '<meta property="og:description" content="Mobile community update"><meta property="og:image" content="https://yt3.example/mobile-post.jpg">',
                    { status: 200 },
                );
            };
            try {
                const response = await youtubeHandler.handle(
                    'https://www.youtube.com/post/UgkxExample123',
                    env,
                );
                assert.deepEqual(requested, [
                    'https://www.youtube.com/post/UgkxExample123',
                    'https://m.youtube.com/post/UgkxExample123',
                ]);
                assert.equal(response.success, true);
                assert.equal(response.data?.image, 'https://yt3.example/mobile-post.jpg');
            } finally { globalThis.fetch = originalFetch; }
        },
    },
    {
        name: 'youtubeHandler uses public metadata included with a YouTube access-denied response',
        run: async () => {
            const originalFetch = globalThis.fetch;
            globalThis.fetch = async () => new Response(
                '<meta property="og:description" content="Public post text"><meta property="og:image" content="https://yt3.example/public-post.jpg">',
                { status: 403 },
            );
            try {
                const response = await youtubeHandler.handle(
                    'https://www.youtube.com/post/UgkxExample123',
                    env,
                );
                assert.equal(response.success, true);
                assert.equal(response.source, 'first-party');
                assert.equal(response.data?.image, 'https://yt3.example/public-post.jpg');
            } finally { globalThis.fetch = originalFetch; }
        },
    },
    {
        name: 'instagramHandler uses Instagram embed data before external fallbacks',
        run: async () => {
            const originalFetch = globalThis.fetch;
            const requested: string[] = [];
            globalThis.fetch = async (input) => {
                requested.push(String(input));
                return new Response('<html><script>{"username":"creator","display_url":"https:\\/\\/scontent.example.com\\/photo.jpg?x=1&amp;amp;y=2","text":"Caption","edge_media_preview_like":{"count":1284},"edge_media_to_parent_comment":{"count":37}}</script></html>', { status: 200 });
            };
            try {
                const response = await instagramHandler.handle('https://www.instagram.com/p/ABC123/', env);
                assert.equal(requested.length, 1);
                assert.match(requested[0], /^https:\/\/www\.instagram\.com\/p\/ABC123\/embed\/captioned\//);
                assert.equal(response.source, 'first-party');
                assert.equal(response.data?.image, 'https://scontent.example.com/photo.jpg?x=1&y=2');
                assert.equal(response.data?.title, 'Caption');
                assert.equal(response.data?.description, '');
                assert.match(response.data?.stats || '', /1\.3K/);
                assert.match(response.data?.stats || '', /37/);
            } finally { globalThis.fetch = originalFetch; }
        },
    },
    {
        name: 'instagramHandler keeps media when Instagram embed metadata has no media URL',
        run: async () => {
            const originalFetch = globalThis.fetch;
            globalThis.fetch = async (input) => {
                const url = String(input);
                if (url.includes('instagram.com/p/DadSNf5EdUy/embed/captioned')) {
                    return new Response('<div class="Caption">A post caption</div>', { status: 200 });
                }
                if (url.includes('vxinstagram.com')) {
                    return new Response('', { status: 404 });
                }
                if (url.includes('kkinstagram.com')) {
                    return new Response(new Uint8Array([0xff, 0xd8, 0xff]), {
                        status: 200,
                        headers: { 'Content-Type': 'image/jpeg' },
                    });
                }
                throw new Error(`Unexpected request: ${url}`);
            };
            try {
                const response = await instagramHandler.handle('https://www.instagram.com/p/DadSNf5EdUy/', env);
                assert.equal(response.success, true);
                assert.equal(response.source, 'fallback');
                assert.equal(response.data?.image, 'https://kkinstagram.com/p/DadSNf5EdUy/');
            } finally { globalThis.fetch = originalFetch; }
        },
    },
    {
        name: 'instagramHandler resolves share URLs through Instagram before rendering',
        run: async () => {
            const originalFetch = globalThis.fetch;
            const requested: string[] = [];
            globalThis.fetch = async (input) => {
                const url = String(input);
                requested.push(url);
                if (url.includes('/share/p/')) {
                    const response = new Response('', { status: 200 });
                    Object.defineProperty(response, 'url', {
                        value: 'https://www.instagram.com/p/Resolved123/',
                    });
                    return response;
                }
                if (url.includes('/p/Resolved123/embed/captioned/')) {
                    return new Response(
                        '<script>{"username":"creator","display_url":"https:\\/\\/scontent.example.com\\/photo.jpg","text":"Resolved post"}</script>',
                        { status: 200 },
                    );
                }
                throw new Error(`Unexpected request: ${url}`);
            };
            try {
                const response = await instagramHandler.handle(
                    'https://www.instagram.com/share/p/BAAAAExample/',
                    env,
                );
                assert.equal(response.success, true);
                assert.equal(response.source, 'first-party');
                assert.equal(response.data?.url, 'https://www.instagram.com/p/Resolved123/');
                assert.equal(requested.length, 2);
            } finally { globalThis.fetch = originalFetch; }
        },
    },
    {
        name: 'instagramHandler rejects share URLs on lookalike hosts without fetching them',
        run: async () => {
            const originalFetch = globalThis.fetch;
            let fetched = false;
            globalThis.fetch = async () => {
                fetched = true;
                return new Response('', { status: 200 });
            };
            try {
                const response = await instagramHandler.handle(
                    'https://attacker.example/instagram.com/share/p/BAAAAExample/',
                    env,
                );
                assert.equal(response.success, false);
                assert.equal(fetched, false);
            } finally { globalThis.fetch = originalFetch; }
        },
    },
    {
        name: 'instagramHandler exposes reel video from the VxInstagram recovery response',
        run: async () => {
            const originalFetch = globalThis.fetch;
            globalThis.fetch = async (input) => {
                const url = String(input);
                if (url.includes('instagram.com/p/DaneAqzR3eV/embed/captioned')) {
                    return new Response('<div class="Caption">A reel caption</div><script>{"display_url":"https:\\/\\/scontent.example.com\\/poster.jpg"}</script>', { status: 200 });
                }
                if (url.includes('vxinstagram.com/reel/DaneAqzR3eV')) {
                    return new Response('<meta property="og:video" content="https://vxinstagram.com/offload/DaneAqzR3eV/0.mp4">', { status: 200 });
                }
                throw new Error(`Unexpected request: ${url}`);
            };
            try {
                const response = await instagramHandler.handle('https://www.instagram.com/reel/DaneAqzR3eV/', env);
                assert.equal(response.success, true);
                assert.equal(response.source, 'fallback');
                assert.match(response.data?.video?.url || '', /^https:\/\/fixembed\.app\/video\/instagram\?url=/);
                assert.equal(response.data?.video?.thumbnail, 'https://scontent.example.com/poster.jpg');
                assert.equal(response.data?.image, 'https://scontent.example.com/poster.jpg');
            } finally { globalThis.fetch = originalFetch; }
        },
    },
    {
        name: 'instagramHandler keeps the native reel poster with its video',
        run: async () => {
            const originalFetch = globalThis.fetch;
            const fullCaption = 'Actual reel caption @cota_official with the complete event details, context, and creator notes that must survive beyond the compact title. #f1 #formula1 #motorsports #usgp';
            globalThis.fetch = async (input) => {
                const url = String(input);
                if (url.includes('instagram.com/p/PreviewReel/embed/captioned')) {
                    return new Response([
                        '<a class="Avatar"><img src="https://scontent.example/avatar.jpg?x=1&amp;y=2" alt="creator" /></a>',
                        '<span class="UsernameText">creator</span>',
                        `<div class="Caption">creator<br /><br />${fullCaption}View all 133 comments</div>`,
                        '<script>',
                        'window.__data={"username":"creator","video_url":"https://scontent.example/reel.mp4",',
                        '"thumbnail_src":"https://scontent.example/reel.jpg","comment_count":12};',
                        '</script>',
                    ].join(''), { status: 200 });
                }
                return new Response('', { status: 404 });
            };

            try {
                const response = await instagramHandler.handle(
                    'https://www.instagram.com/reel/PreviewReel/',
                    env,
                );
                assert.equal(response.success, true);
                assert.equal(response.data?.video?.url, 'https://scontent.example/reel.mp4');
                assert.equal(response.data?.video?.thumbnail, 'https://scontent.example/reel.jpg');
                assert.equal(response.data?.image, 'https://scontent.example/reel.jpg');
                assert.equal(response.data?.authorName, 'creator');
                assert.equal(response.data?.authorHandle, '@creator');
                assert.equal(response.data?.authorUrl, 'https://www.instagram.com/creator/');
                assert.equal(response.data?.authorAvatar, 'https://scontent.example/avatar.jpg?x=1&y=2');
                assert.notEqual(response.data?.title, fullCaption);
                assert.match(response.data?.title || '', /\.\.\.$/);
                assert.equal(response.data?.caption, fullCaption);
                assert.doesNotMatch(response.data?.title || '', /^creator\b/i);
            } finally {
                globalThis.fetch = originalFetch;
            }
        },
    },
    {
        name: 'redditHandler recovers post data from Reddit embed HTML when JSON is forbidden',
        run: async () => {
            const originalFetch = globalThis.fetch;
            globalThis.fetch = async (input) => {
                const url = String(input);
                if (url.includes('.json')) {
                    return new Response('blocked', { status: 403, statusText: 'Forbidden' });
                }
                if (url.startsWith('https://embed.reddit.com/')) {
                    return new Response(`
                        <a href="https://www.reddit.com/r/codex/">
                            <img alt="subreddit icon" src="https://styles.redditmedia.com/t5_2t1qf/styles/communityIcon_fp81a2t5s9ch1.png?width=64&amp;height=64&amp;frame=1">
                        </a>
                        <a href="https://www.reddit.com/user/Distinct_Ingenuity21/">author</a>
                        <shreddit-embed-title>usage limits reset for the 5th time today</shreddit-embed-title>
                        <img src="https://preview.redd.it/example.png?width=591&amp;format=png">
                        <div data-testid="upvote"><faceplate-number number="218" pretty></faceplate-number></div>
                        <span>View 75 comments</span>
                    `, { status: 200, headers: { 'Content-Type': 'text/html' } });
                }
                throw new Error(`Unexpected request: ${url}`);
            };

            try {
                const response = await redditHandler.handle(
                    'https://reddit.com/r/codex/comments/1utc8qv/usage_limits_reset_for_the_5th_time_today/',
                    env,
                );

                assert.equal(response.success, true);
                assert.equal(response.source, 'first-party');
                assert.equal(response.data?.title, 'r/codex • usage limits reset for the 5th time today');
                assert.equal(response.data?.authorName, 'u/Distinct_Ingenuity21');
                assert.equal(response.data?.authorAvatar, 'https://styles.redditmedia.com/t5_2t1qf/styles/communityIcon_fp81a2t5s9ch1.png?width=64&height=64&frame=1');
                assert.equal(response.data?.image, 'https://preview.redd.it/example.png?width=591&format=png');
                assert.match(response.data?.stats || '', /218/);
                assert.match(response.data?.stats || '', /75/);
            } finally {
                globalThis.fetch = originalFetch;
            }
        },
    },
    {
        name: 'pixivHandler proxies Phixiv fallback artwork for Discord media components',
        run: async () => {
            const originalFetch = globalThis.fetch;
            globalThis.fetch = async (input) => {
                const requestedUrl = String(input);
                if (requestedUrl.includes('pixiv.net/ajax/illust/')) {
                    return new Response('blocked', { status: 403 });
                }
                return new Response(`
                    <meta property="og:title" content="Fallback Art by (@artist)">
                    <meta property="og:image" content="https://www.phixiv.net/i/fallback.jpg">
                    <meta property="og:description" content="Fallback &amp;#44; caption">
                `, { status: 200, headers: { 'Content-Type': 'text/html' } });
            };
            try {
                const response = await pixivHandler.handle('https://www.pixiv.net/artworks/456', env);
                assert.equal(response.source, 'fallback');
                assert.equal(
                    response.data?.image,
                    'https://fixembed.app/proxy/pixiv?url=https%3A%2F%2Fwww.phixiv.net%2Fi%2Ffallback.jpg',
                );
                assert.equal(response.data?.description, 'Fallback , caption');
            } finally { globalThis.fetch = originalFetch; }
        },
    },
    {
        name: 'blueskyHandler preserves creator identity and every carousel image',
        run: async () => {
            const originalFetch = globalThis.fetch;
            globalThis.fetch = async (input) => {
                const url = String(input);
                if (url.includes('resolveHandle')) {
                    return Response.json({ did: 'did:plc:creator' });
                }
                if (url.includes('getPostThread')) {
                    return Response.json({
                        thread: {
                            post: {
                                author: {
                                    did: 'did:plc:creator',
                                    handle: 'creator.bsky.social',
                                    displayName: 'Creator Name',
                                    avatar: 'https://cdn.bsky.app/avatar.jpg',
                                },
                                record: {
                                    text: 'A Bluesky carousel.',
                                    createdAt: '2026-07-13T19:00:00.000Z',
                                },
                                embed: {
                                    images: [
                                        { fullsize: 'https://cdn.bsky.app/one.jpg', thumb: 'https://cdn.bsky.app/one-thumb.jpg', alt: 'One' },
                                        { fullsize: 'https://cdn.bsky.app/two.jpg', thumb: 'https://cdn.bsky.app/two-thumb.jpg', alt: 'Two' },
                                    ],
                                },
                                likeCount: 34,
                                repostCount: 5,
                                replyCount: 12,
                            },
                        },
                    });
                }
                throw new Error('Unexpected request: ' + url);
            };

            try {
                const response = await blueskyHandler.handle(
                    'https://bsky.app/profile/creator.bsky.social/post/abc123',
                    env,
                );

                assert.equal(response.success, true);
                assert.equal(response.data?.authorName, 'Creator Name');
                assert.equal(response.data?.authorHandle, '@creator.bsky.social');
                assert.deepEqual(response.data?.images, [
                    'https://cdn.bsky.app/one.jpg',
                    'https://cdn.bsky.app/two.jpg',
                ]);
            } finally {
                globalThis.fetch = originalFetch;
            }
        },
    },
    {
        name: 'redditHandler preserves subreddit identity gallery order and timestamp',
        run: async () => {
            const originalFetch = globalThis.fetch;
            globalThis.fetch = async () => new Response(JSON.stringify([{
                data: { children: [{ data: {
                    title: 'A two-image gallery',
                    selftext: '',
                    author: 'gallery_author',
                    subreddit: 'pics',
                    url: 'https://www.reddit.com/gallery/abc123',
                    permalink: '/r/pics/comments/abc123/a_twoimage_gallery/',
                    thumbnail: 'https://preview.redd.it/thumb.jpg',
                    is_video: false,
                    created_utc: 1783900800,
                    score: 50,
                    num_comments: 8,
                    sr_detail: {
                        icon_img: 'https://styles.redditmedia.com/subreddit-icon.png?width=256&amp;height=256',
                    },
                    gallery_data: {
                        items: [{ media_id: 'second' }, { media_id: 'first' }],
                    },
                    media_metadata: {
                        first: { status: 'valid', e: 'Image', s: { u: 'https://preview.redd.it/first.png?x=1&amp;y=2' } },
                        second: { status: 'valid', e: 'Image', s: { u: 'https://preview.redd.it/second.png?x=1&amp;y=2' } },
                    },
                } }] },
            }]), { status: 200, headers: { 'Content-Type': 'application/json' } });

            try {
                const response = await redditHandler.handle(
                    'https://www.reddit.com/r/pics/comments/abc123/a_twoimage_gallery/',
                    env,
                );

                assert.equal(response.success, true);
                assert.equal(response.data?.description, '');
                assert.equal(response.data?.authorAvatar, 'https://styles.redditmedia.com/subreddit-icon.png?width=256&height=256');
                assert.equal(response.data?.timestamp, '2026-07-13T00:00:00.000Z');
                assert.deepEqual(response.data?.images, [
                    'https://preview.redd.it/second.png?x=1&y=2',
                    'https://preview.redd.it/first.png?x=1&y=2',
                ]);
            } finally {
                globalThis.fetch = originalFetch;
            }
        },
    },
    {
        name: 'twitterHandler renders valid posts with first-party tweet data',
        run: async () => {
            const originalFetch = globalThis.fetch;
            globalThis.fetch = async () => new Response(JSON.stringify({
                __typename: 'Tweet',
                id_str: '1234567890',
                text: 'A complete first-party FixEmbed tweet',
                user: {
                    name: 'OpenAI',
                    screen_name: 'openai',
                    profile_image_url_https: 'https://pbs.twimg.com/profile_images/openai.jpg',
                },
                created_at: '2026-07-11T00:00:00.000Z',
                favorite_count: 42,
                retweet_count: 5,
                conversation_count: 3,
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });

            try {
                const response = await twitterHandler.handle('https://x.com/openai/status/1234567890', env);

                assert.equal(response.success, true);
                assert.equal(response.source, 'first-party');
                assert.equal(response.data?.title, '@openai');
                assert.equal(response.data?.description, 'A complete first-party FixEmbed tweet');
                assert.equal(response.data?.platform, 'twitter');
                assert.equal(response.redirect, undefined);
            } finally {
                globalThis.fetch = originalFetch;
            }
        },
    },
    {
        name: 'twitterHandler preserves every photo in a carousel',
        run: async () => {
            const originalFetch = globalThis.fetch;
            globalThis.fetch = async () => new Response(JSON.stringify({
                __typename: 'Tweet',
                id_str: '1848831595014459513',
                text: 'Three photos',
                user: {
                    name: 'SpaceX',
                    screen_name: 'SpaceX',
                    profile_image_url_https: 'https://pbs.twimg.com/profile_images/spacex.jpg',
                },
                created_at: '2024-10-22T00:00:00.000Z',
                mediaDetails: [
                    { type: 'photo', media_url_https: 'https://pbs.twimg.com/media/one.jpg' },
                    { type: 'photo', media_url_https: 'https://pbs.twimg.com/media/two.jpg' },
                    { type: 'photo', media_url_https: 'https://pbs.twimg.com/media/three.jpg' },
                ],
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });

            try {
                const response = await twitterHandler.handle(
                    'https://x.com/SpaceX/status/1848831595014459513',
                    env,
                );

                assert.deepEqual(response.data?.images, [
                    'https://pbs.twimg.com/media/one.jpg',
                    'https://pbs.twimg.com/media/two.jpg',
                    'https://pbs.twimg.com/media/three.jpg',
                ]);
                assert.equal(response.data?.image, undefined);
            } finally {
                globalThis.fetch = originalFetch;
            }
        },
    },
    {
        name: 'twitterHandler appends an explicitly requested first-party translation',
        run: async () => {
            const originalFetch = globalThis.fetch;
            globalThis.fetch = async () => new Response(JSON.stringify({
                __typename: 'Tweet',
                id_str: '1234567890',
                text: 'こんにちは世界',
                lang: 'ja',
                user: {
                    name: 'Example',
                    screen_name: 'example',
                    profile_image_url_https: 'https://pbs.twimg.com/profile_images/example.jpg',
                },
                created_at: '2026-07-12T00:00:00.000Z',
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            const translationEnv: Env = {
                ...env,
                AI: {
                    run: async (model: string, input: unknown) => {
                        assert.equal(model, '@cf/meta/m2m100-1.2b');
                        assert.deepEqual(input, {
                            text: 'こんにちは世界',
                            source_lang: 'ja',
                            target_lang: 'en',
                        });
                        return { translated_text: 'Hello world' };
                    },
                } as unknown as Ai,
            };

            try {
                const response = await twitterHandler.handle(
                    'https://x.com/example/status/1234567890',
                    translationEnv,
                    { language: 'en' },
                );

                assert.equal(response.data?.description, 'こんにちは世界\n\n🌐 Translation (EN): Hello world');
            } finally {
                globalThis.fetch = originalFetch;
            }
        },
    },
    {
        name: 'twitterHandler renders GraphQL polls quotes notes articles and Community Notes',
        run: async () => {
            const originalFetch = globalThis.fetch;
            globalThis.fetch = async (input) => {
                const url = String(input);
                if (url.endsWith('/1.1/guest/activate.json')) {
                    return new Response(JSON.stringify({ guest_token: 'guest-123' }), { status: 200 });
                }
                if (url.includes('/graphql/') && url.includes('/TweetResultByRestId')) {
                    return new Response(JSON.stringify({
                        data: {
                            tweetResult: {
                                result: {
                                    __typename: 'Tweet',
                                    rest_id: '2000000000000000000',
                                    core: { user_results: { result: {
                                        core: { name: 'Primary Author', screen_name: 'primary' },
                                        avatar: { image_url: 'https://pbs.twimg.com/profile_images/primary.jpg' },
                                    } } },
                                    legacy: {
                                        id_str: '2000000000000000000',
                                        full_text: 'Truncated note…',
                                        created_at: 'Sun Jul 12 00:00:00 +0000 2026',
                                        favorite_count: 100,
                                        retweet_count: 20,
                                        quote_count: 5,
                                        reply_count: 4,
                                        lang: 'en',
                                        entities: { urls: [], media: [] },
                                        extended_entities: { media: [
                                            { type: 'photo', media_url_https: 'https://pbs.twimg.com/media/root-one.jpg' },
                                            { type: 'photo', media_url_https: 'https://pbs.twimg.com/media/root-two.jpg' },
                                        ] },
                                    },
                                    note_tweet: { note_tweet_results: { result: {
                                        text: 'The complete long-form note text.',
                                        entity_set: { urls: [], media: [] },
                                    } } },
                                    card: { legacy: { name: 'poll2choice_text_only', binding_values: [
                                        { key: 'choice1_label', value: { string_value: 'Yes' } },
                                        { key: 'choice1_count', value: { string_value: '75' } },
                                        { key: 'choice2_label', value: { string_value: 'No' } },
                                        { key: 'choice2_count', value: { string_value: '25' } },
                                        { key: 'end_datetime_utc', value: { string_value: '2026-07-11T00:00:00Z' } },
                                        { key: 'counts_are_final', value: { boolean_value: true } },
                                    ] } },
                                    quoted_status_result: { result: {
                                        __typename: 'Tweet',
                                        rest_id: '1999999999999999999',
                                        core: { user_results: { result: {
                                            core: { name: 'Quoted Author', screen_name: 'quoted' },
                                            avatar: { image_url: 'https://pbs.twimg.com/profile_images/quoted.jpg' },
                                        } } },
                                        legacy: {
                                            id_str: '1999999999999999999',
                                            full_text: 'Quoted post body',
                                            created_at: 'Sat Jul 11 00:00:00 +0000 2026',
                                            entities: { urls: [], media: [] },
                                        },
                                    } },
                                    birdwatch_pivot: {
                                        destinationUrl: 'https://x.com/i/birdwatch/n/123',
                                        subtitle: { text: 'Readers added important context.' },
                                    },
                                    article: { article_results: { result: {
                                        title: 'A full X Article',
                                        preview_text: 'Article preview text',
                                        cover_media: { media_info: {
                                            __typename: 'ApiImage',
                                            original_img_url: 'https://pbs.twimg.com/media/article-cover.jpg',
                                        } },
                                    } } },
                                    views: { count: '1000' },
                                },
                            },
                        },
                    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
                throw new Error(`Unexpected request: ${url}`);
            };

            try {
                const response = await twitterHandler.handle(
                    'https://x.com/primary/status/2000000000000000000',
                    env,
                );
                assert.equal(response.success, true);
                assert.equal(response.source, 'first-party');
                assert.equal(response.data?.description, 'The complete long-form note text.');
                assert.deepEqual(response.data?.images, [
                    'https://pbs.twimg.com/media/root-one.jpg',
                    'https://pbs.twimg.com/media/root-two.jpg',
                ]);
                assert.deepEqual(response.data?.sections?.map((section) => section.kind), [
                    'poll', 'quote', 'community-note', 'article',
                ]);
                assert.match(response.data?.stats || '', /20/);
                assert.doesNotMatch(response.data?.stats || '', /25/);

                const html = generateEmbedHTML(response.data!, 'Discordbot/2.0');
                assert.match(html, /Yes.*75%/s);
                assert.match(html, /Quoted @quoted.*Quoted post body/s);
                assert.match(html, /Readers added important context/);
                assert.match(html, /A full X Article.*Article preview text/s);
            } finally {
                globalThis.fetch = originalFetch;
            }
        },
    },
    {
        name: 'twitterHandler gallery mode keeps media while hiding post text and stats',
        run: async () => {
            const originalFetch = globalThis.fetch;
            globalThis.fetch = async () => new Response(JSON.stringify({
                __typename: 'Tweet',
                id_str: '1234567890',
                text: 'Text hidden in gallery mode',
                user: {
                    name: 'Gallery Author',
                    screen_name: 'gallery',
                    profile_image_url_https: 'https://pbs.twimg.com/profile_images/gallery.jpg',
                },
                created_at: '2026-07-12T00:00:00.000Z',
                favorite_count: 10,
                mediaDetails: [
                    { type: 'photo', media_url_https: 'https://pbs.twimg.com/media/gallery-one.jpg' },
                    { type: 'photo', media_url_https: 'https://pbs.twimg.com/media/gallery-two.jpg' },
                ],
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });

            try {
                const response = await twitterHandler.handle(
                    'https://x.com/gallery/status/1234567890',
                    env,
                    { mode: 'gallery' },
                );
                assert.equal(response.data?.description, '');
                assert.equal(response.data?.stats, undefined);
                assert.deepEqual(response.data?.images, [
                    'https://pbs.twimg.com/media/gallery-one.jpg',
                    'https://pbs.twimg.com/media/gallery-two.jpg',
                ]);
            } finally {
                globalThis.fetch = originalFetch;
            }
        },
    },
    {
        name: '/api/embed forwards X translation and display options to the handler',
        run: async () => {
            const originalFetch = globalThis.fetch;
            globalThis.fetch = async () => new Response(JSON.stringify({
                __typename: 'Tweet',
                id_str: '1234567890',
                text: 'Text hidden in gallery mode',
                lang: 'en',
                user: {
                    name: 'Gallery Author',
                    screen_name: 'gallery',
                    profile_image_url_https: 'https://pbs.twimg.com/profile_images/gallery.jpg',
                },
                created_at: '2026-07-12T00:00:00.000Z',
                favorite_count: 10,
                mediaDetails: [
                    { type: 'photo', media_url_https: 'https://pbs.twimg.com/media/gallery-one.jpg' },
                    { type: 'photo', media_url_https: 'https://pbs.twimg.com/media/gallery-two.jpg' },
                ],
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });

            try {
                const source = encodeURIComponent('https://x.com/gallery/status/1234567890');
                const response = await app.request(
                    `/api/embed?url=${source}&lang=es&mode=gallery`,
                    {},
                    env,
                );
                const payload = await response.json() as { data?: {
                    description?: string;
                    stats?: string;
                    images?: string[];
                } };

                assert.equal(response.status, 200);
                assert.equal(payload.data?.description, '');
                assert.equal(payload.data?.stats, undefined);
                assert.deepEqual(payload.data?.images, [
                    'https://pbs.twimg.com/media/gallery-one.jpg',
                    'https://pbs.twimg.com/media/gallery-two.jpg',
                ]);
            } finally {
                globalThis.fetch = originalFetch;
            }
        },
    },
    {
        name: 'generateEmbedHTML advertises a compact numeric X activity status',
        run: () => {
            const html = generateEmbedHTML({
                title: '@gallery',
                description: 'A gallery',
                url: 'https://x.com/gallery/status/123',
                siteName: 'FixEmbed • X',
                authorName: 'Gallery Author',
                authorHandle: '@gallery',
                images: [
                    'https://pbs.twimg.com/media/one.jpg',
                    'https://pbs.twimg.com/media/two.jpg',
                ],
                platform: 'twitter',
                mode: 'mosaic',
            }, 'Discordbot/2.0');

            assert.match(html, /href='https:\/\/fixembed\.app\/users\/gallery\/statuses\/\d+' rel='alternate' type='application\/activity\+json'/);
            const encoded = html.match(/\/users\/gallery\/statuses\/(\d+)/)?.[1];
            assert.ok(encoded);
            assert.match(encoded, /^\d+$/);
            assert.ok(encoded.length < 100);
        },
    },
    {
        name: 'ActivityPub preserves multiline X formatting without HTML injection',
        run: () => {
            assert.equal(
                formatActivityContent('Opening paragraph\n\n1. First item\n2. Second & <unsafe>'),
                '<p>Opening paragraph<br><br>1. First item<br>2. Second &amp; &lt;unsafe&gt;</p>',
            );
            assert.equal(
                formatActivityContent('Post body', '💬 12 & counting'),
                '<p>Post body<br><br><strong>💬 12 &amp; counting</strong></p>',
            );
        },
    },
    {
        name: 'Discord X videos use the author-first ActivityPub card hierarchy',
        run: async () => {
            const html = generateEmbedHTML({
                title: '@author',
                description: 'Opening paragraph\n\nClosing paragraph',
                url: 'https://x.com/author/status/123',
                siteName: 'FixEmbed • 𝕏 Twitter',
                authorName: 'Author Name',
                authorHandle: '@author',
                authorUrl: 'https://x.com/author',
                authorAvatar: 'https://pbs.twimg.com/profile_images/author.jpg',
                timestamp: 'Thu Jul 09 16:20:00 +0000 2026',
                stats: '💬 12 🔁 34 ❤️ 56 👁 789',
                video: {
                    url: 'https://video.twimg.com/post.mp4',
                    thumbnail: 'https://pbs.twimg.com/post.jpg',
                    width: 1280,
                    height: 720,
                },
                platform: 'twitter',
            }, 'Discordbot/2.0');

            assert.match(html, /<meta name="twitter:card" content="player">/);
            assert.doesNotMatch(html, /property="og:video/);
            assert.match(html, /<meta property="og:title" content="Author Name \(@author\)">/);
            assert.match(
                html,
                /<link rel="apple-touch-icon" href="https:\/\/raw\.githubusercontent\.com\/kenhendricks00\/FixEmbed\/main\/assets\/logo\.png">/,
            );
            assert.match(html, /href='https:\/\/fixembed\.app\/users\/author\/statuses\/\d+' rel='alternate' type='application\/activity\+json'/);

            const encoded = html.match(/\/users\/author\/statuses\/(\d+)/)?.[1];
            assert.ok(encoded);
            assert.match(encoded, /^\d+$/);
            assert.ok(encoded.length < 100);

            const originalFetch = globalThis.fetch;
            globalThis.fetch = async () => new Response(JSON.stringify({
                __typename: 'Tweet',
                id_str: '123',
                text: 'Opening paragraph\n\nClosing paragraph',
                user: {
                    name: 'Author Name',
                    screen_name: 'author',
                    profile_image_url_https: 'https://pbs.twimg.com/profile_images/author.jpg',
                },
                created_at: 'Thu Jul 09 16:20:00 +0000 2026',
                conversation_count: 12,
                retweet_count: 34,
                favorite_count: 56,
                view_count_info: { count: '789' },
                mediaDetails: [{
                    type: 'video',
                    media_url_https: 'https://pbs.twimg.com/post.jpg',
                    video_info: {
                        aspect_ratio: [16, 9],
                        variants: [{
                            bitrate: 2176000,
                            content_type: 'video/mp4',
                            url: 'https://video.twimg.com/post.mp4',
                        }],
                    },
                }],
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });

            try {
            const activityResponse = await app.request('/api/v1/statuses/' + encoded, {}, env);
            assert.equal(activityResponse.status, 200);
            assert.match(activityResponse.headers.get('content-type') || '', /^application\/json/);
            const activity = await activityResponse.json() as any;
            assert.equal(activity.summary, undefined);
            assert.equal(
                activity.content,
                '<p>Opening paragraph<br><br>Closing paragraph<br><br><strong>💬 12 🔁 34 ❤️ 56 👁 789</strong></p>',
            );
            assert.equal(activity.created_at, '2026-07-09T16:20:00.000Z');
            assert.equal(activity.application.name, 'FixEmbed • 𝕏 Twitter');
            assert.equal(activity.account.display_name, 'Author Name');
            assert.equal(activity.account.username, 'author');
            assert.equal(activity.account.url, 'https://x.com/author');
            assert.equal(activity.account.avatar, 'https://pbs.twimg.com/profile_images/author.jpg');
            assert.equal(activity.media_attachments[0].type, 'video');
            assert.equal(activity.media_attachments[0].url, 'https://video.twimg.com/post.mp4');
            assert.equal(activity.media_attachments[0].preview_url, 'https://pbs.twimg.com/post.jpg');
            assert.equal(activity.media_attachments[0].meta.original.width, 1280);
            assert.equal(activity.media_attachments[0].meta.original.height, 720);
            } finally {
                globalThis.fetch = originalFetch;
            }
        },
    },
    {
        name: 'generateEmbedHTML keeps long X activity discovery URLs compact',
        run: () => {
            const description = `Paragraph one\n\n${'Long post content. '.repeat(90)}\n\n1. Final item`;
            assert.ok(description.length > 1000);

            const html = generateEmbedHTML({
                title: '@author',
                description,
                url: 'https://x.com/author/status/123',
                siteName: 'FixEmbed • X',
                platform: 'twitter',
            }, 'Discordbot/2.0');
            const encoded = html.match(/\/users\/twitter\/statuses\/(\d+)/)?.[1];
            assert.ok(encoded);
            assert.match(encoded, /^\d+$/);
            assert.ok(encoded.length < 100);
        },
    },
    {
        name: 'Discord uses the branded creator-first activity card where Activity media is reliable',
        run: () => {
            const samples = [
                ['twitter', 'https://x.com/creator/status/123'],
                ['reddit', 'https://www.reddit.com/r/example/comments/abc123/example/'],
                ['threads', 'https://www.threads.net/@creator/post/example'],
                ['pixiv', 'https://www.pixiv.net/artworks/123'],
                ['bluesky', 'https://bsky.app/profile/creator.test/post/example'],
                ['youtube', 'https://www.youtube.com/watch?v=example'],
                ['bilibili', 'https://www.bilibili.com/video/BV1example'],
            ] as const;

            for (const [platform, url] of samples) {
                const html = generateEmbedHTML({
                    title: 'A polished post',
                    description: 'Platform content',
                    url,
                    siteName: 'FixEmbed • ' + platform,
                    authorName: 'Creator',
                    authorHandle: '@creator',
                    authorUrl: 'https://example.com/creator',
                    authorAvatar: 'https://example.com/avatar.jpg',
                    stats: '💬 12 ❤️ 34',
                    image: 'https://example.com/media.jpg',
                    platform,
                }, 'Discordbot/2.0');

                assert.match(
                    html,
                    /href='https:\/\/fixembed\.app\/users\/creator\/statuses\/\d+' rel='alternate' type='application\/activity\+json'/,
                    platform,
                );
                assert.match(
                    html,
                    /<link rel="apple-touch-icon" href="https:\/\/raw\.githubusercontent\.com\/kenhendricks00\/FixEmbed\/main\/assets\/logo\.png">/,
                    platform,
                );
                if (platform !== 'twitter') {
                    assert.doesNotMatch(html, /property="og:image"/, platform);
                    assert.doesNotMatch(html, /property="og:video"/, platform);
                }
            }
        },
    },
    {
        name: 'Discord Instagram reels without a poster keep the native Open Graph video card',
        run: () => {
            const html = generateEmbedHTML({
                title: 'A reel caption',
                description: 'Creator caption',
                url: 'https://www.instagram.com/reel/DaneAqzR3eV/',
                siteName: 'FixEmbed • Instagram',
                authorName: 'Creator',
                authorHandle: '@creator',
                stats: '💬 133',
                video: {
                    url: 'https://fixembed.app/video/instagram?url=https%3A%2F%2Fexample.com%2Freel.mp4',
                    width: 720,
                    height: 1280,
                },
                platform: 'instagram',
            }, 'Discordbot/2.0');

            assert.match(html, /property="og:type" content="video\.other"/);
            assert.match(html, /property="og:video"/);
            assert.doesNotMatch(html, /application\/activity\+json/);
        },
    },
    {
        name: 'Discord Instagram reels with a poster use the author-first Activity card',
        run: () => {
            const sourceUrl = 'https://www.instagram.com/reel/PreviewReel/';
            const html = generateEmbedHTML({
                title: 'A reel caption',
                description: '',
                url: sourceUrl,
                siteName: 'FixEmbed • Instagram',
                authorName: 'Creator',
                authorHandle: '@creator',
                authorAvatar: 'https://scontent.example/avatar.jpg',
                stats: '💬 12 ❤️ 34',
                video: {
                    url: 'https://fixembed.app/video/instagram?url=https%3A%2F%2Fexample.com%2Freel.mp4',
                    thumbnail: 'https://example.com/reel.jpg',
                    width: 720,
                    height: 1280,
                },
                platform: 'instagram',
            }, 'Discordbot/2.0');

            assert.match(
                html,
                /href='https:\/\/fixembed\.app\/users\/creator\/statuses\/\d+' rel='alternate' type='application\/activity\+json'/,
            );
            assert.doesNotMatch(html, /property="og:video"/);
            assert.doesNotMatch(html, /property="og:image"/);
            assert.match(html, /provider=FixEmbed\+%E2%80%A2\+Instagram/);
            assert.match(
                html,
                /<link rel="apple-touch-icon" href="https:\/\/raw\.githubusercontent\.com\/kenhendricks00\/FixEmbed\/main\/assets\/logo\.png">/,
            );
        },
    },
    {
        name: 'Instagram Activity cards use the plain username as the display name',
        run: async () => {
            const sourceUrl = 'https://www.instagram.com/reel/PreviewReel/';
            const html = generateEmbedHTML({
                title: 'Actual reel caption @cota',
                description: '',
                url: sourceUrl,
                siteName: 'FixEmbed • Instagram',
                authorName: 'creator',
                authorHandle: '@creator',
                authorUrl: 'https://www.instagram.com/creator/',
                authorAvatar: 'https://scontent.example/avatar.jpg',
                stats: '💬 12',
                image: 'https://scontent.example/reel.jpg',
                video: {
                    url: 'https://scontent.example/reel.mp4',
                    thumbnail: 'https://scontent.example/reel.jpg',
                    width: 720,
                    height: 1280,
                },
                platform: 'instagram',
            }, 'Discordbot/2.0');
            const encoded = html.match(/\/users\/creator\/statuses\/(\d+)/)?.[1];
            assert.ok(encoded);

            const originalFetch = globalThis.fetch;
            globalThis.fetch = async (input) => {
                const url = String(input);
                if (url.includes('instagram.com/p/PreviewReel/embed/captioned')) {
                    return new Response([
                        '<a class="Avatar"><img src="https://scontent.example/avatar.jpg" alt="creator" /></a>',
                        '<span class="UsernameText">creator</span>',
                        '<div class="Caption">creator<br /><br />Actual reel caption</div>',
                        '<script>window.__data={"username":"creator","video_url":"https://scontent.example/reel.mp4",',
                        '"thumbnail_src":"https://scontent.example/reel.jpg","comment_count":12};</script>',
                    ].join(''), { status: 200 });
                }
                return new Response('', { status: 404 });
            };

            try {
                const response = await app.request('/api/v1/statuses/' + encoded, {}, env);
                assert.equal(response.status, 200);
                const activity = await response.json() as any;
                assert.equal(activity.account.display_name, 'creator');
                assert.equal(activity.account.username, 'creator');
                assert.equal(activity.account.acct, 'creator');
            } finally {
                globalThis.fetch = originalFetch;
            }
        },
    },
    {
        name: 'Mastodon activity API rebuilds a branded non-X image card',
        run: async () => {
            const html = generateEmbedHTML({
                title: '@creator.test',
                description: 'A Bluesky post',
                url: 'https://bsky.app/profile/creator.test/post/abc123',
                siteName: 'FixEmbed • Bluesky',
                authorName: '@creator.test',
                authorAvatar: 'https://cdn.bsky.app/avatar.jpg',
                image: 'https://cdn.bsky.app/image.jpg',
                platform: 'bluesky',
            }, 'Discordbot/2.0');
            const encoded = html.match(/\/users\/creator_test\/statuses\/(\d+)/)?.[1];
            assert.ok(encoded);

            const originalFetch = globalThis.fetch;
            globalThis.fetch = async (input) => {
                const url = String(input);
                if (url.includes('resolveHandle')) {
                    return new Response(JSON.stringify({ did: 'did:plc:creator' }), { status: 200 });
                }
                if (url.includes('getPostThread')) {
                    return new Response(JSON.stringify({
                        thread: {
                            post: {
                                author: {
                                    did: 'did:plc:creator',
                                    handle: 'creator.test',
                                    avatar: 'https://cdn.bsky.app/avatar.jpg',
                                },
                                record: {
                                    text: 'A Bluesky post',
                                    createdAt: '2026-07-12T20:00:00.000Z',
                                },
                                embed: {
                                    images: [{
                                        fullsize: 'https://cdn.bsky.app/image.jpg',
                                        thumb: 'https://cdn.bsky.app/thumb.jpg',
                                    }],
                                },
                                likeCount: 34,
                                repostCount: 5,
                                replyCount: 12,
                            },
                        },
                    }), { status: 200 });
                }
                throw new Error('Unexpected request: ' + url);
            };

            try {
                const response = await app.request('/api/v1/statuses/' + encoded, {}, env);
                assert.equal(response.status, 200);
                const activity = await response.json() as any;
                assert.equal(activity.account.display_name, '@creator.test');
                assert.equal(activity.account.avatar, 'https://cdn.bsky.app/avatar.jpg');
                assert.equal(activity.content, '<p><strong>💬 12 🔁 5 ❤️ 34</strong><br><br>A Bluesky post</p>');
                assert.equal(activity.created_at, '2026-07-12T20:00:00.000Z');
                assert.equal(activity.application.name, 'FixEmbed • 🦋 Bluesky');
                assert.equal(activity.media_attachments[0].type, 'image');
                assert.equal(activity.media_attachments[0].url, 'https://cdn.bsky.app/image.jpg');
            } finally {
                globalThis.fetch = originalFetch;
            }
        },
    },
    {
        name: 'Mastodon activity API rejects malformed and oversized status tokens',
        run: async () => {
            const malformed = await app.request('/api/v1/statuses/99abc', {}, env);
            assert.equal(malformed.status, 400);

            const oversized = await app.request('/api/v1/statuses/99' + '001'.repeat(1400), {}, env);
            assert.equal(oversized.status, 400);
        },
    },
    {
        name: 'Mastodon activity API uses branded identity when a creator is unavailable',
        run: async () => {
            const html = generateEmbedHTML({
                title: 'Bilibili Video',
                description: '',
                url: 'https://www.bilibili.com/video/BV1example',
                siteName: 'FixEmbed • 📺 Bilibili',
                image: 'https://i.example.com/cover.jpg',
                platform: 'bilibili',
            }, 'Discordbot/2.0');
            const encoded = html.match(/\/users\/bilibili\/statuses\/(\d+)/)?.[1];
            assert.ok(encoded);

            const originalFetch = globalThis.fetch;
            globalThis.fetch = async () => new Response(JSON.stringify({
                code: 0,
                data: {
                    title: 'Bilibili Video',
                    desc: '',
                    pic: '//i.example.com/cover.jpg',
                    owner: { name: 'fixembed' },
                },
            }), { status: 200 });

            try {
                const response = await app.request('/api/v1/statuses/' + encoded, {}, env);
                assert.equal(response.status, 200);
                const activity = await response.json() as any;
                assert.equal(activity.account.display_name, 'FixEmbed • 📺 Bilibili');
                assert.equal(activity.account.username, 'bilibili');
                assert.equal(
                    activity.account.avatar,
                    'https://raw.githubusercontent.com/kenhendricks00/FixEmbed/main/assets/logo.png',
                );
                assert.equal(activity.media_attachments[0].url, 'https://i.example.com/cover.jpg');
            } finally {
                globalThis.fetch = originalFetch;
            }
        },
    },
    {
        name: 'twitterHandler builds a FixEmbed payload from FxTwitter when first-party sources fail',
        run: async () => {
            const originalFetch = globalThis.fetch;
            globalThis.fetch = async (input) => {
                const url = String(input);
                if (url.startsWith('https://api.fxtwitter.com/')) {
                    return Response.json({
                        code: 200,
                        message: 'OK',
                        tweet: {
                            url: 'https://x.com/kuriimu0203/status/2022261416439525543',
                            id: '2022261416439525543',
                            text: 'Fallback post text',
                            author: {
                                name: 'Kuriimu',
                                screen_name: 'kuriimu0203',
                                avatar_url: 'https://pbs.twimg.com/profile_images/avatar.jpg',
                            },
                            replies: 12,
                            retweets: 34,
                            likes: 56,
                            views: 789,
                            created_at: 'Fri Feb 13 10:47:48 +0000 2026',
                            media: {
                                photos: [{
                                    type: 'photo',
                                    url: 'https://pbs.twimg.com/media/photo.jpg?name=orig',
                                    width: 1511,
                                    height: 2048,
                                }],
                                videos: [{
                                    type: 'video',
                                    url: 'https://video.twimg.com/video.mp4',
                                    thumbnail_url: 'https://pbs.twimg.com/media/video.jpg',
                                    width: 1280,
                                    height: 720,
                                }],
                            },
                        },
                    });
                }
                return new Response('upstream unavailable', { status: 503 });
            };

            try {
                const source = encodeURIComponent(
                    'https://x.com/kuriimu0203/status/2022261416439525543',
                );
                const response = await app.request(`/api/embed?url=${source}`, {}, env);
                const body = await response.json() as any;

                assert.equal(response.status, 200);
                assert.equal(body.success, true);
                assert.equal(body.data.authorHandle, '@kuriimu0203');
                assert.equal(body.data.description, 'Fallback post text');
                assert.equal(body.data.image, 'https://pbs.twimg.com/media/photo.jpg?name=orig');
                assert.equal(body.data.video.url, 'https://video.twimg.com/video.mp4');
                assert.match(body.data.stats, /56/);
            } finally {
                globalThis.fetch = originalFetch;
            }
        },
    },
    {
        name: 'twitterHandler uses FxTwitter only when the first-party request fails',
        run: async () => {
            const originalFetch = globalThis.fetch;
            globalThis.fetch = async () => new Response('upstream unavailable', { status: 503 });

            try {
                const response = await twitterHandler.handle('https://x.com/openai/status/1234567890', env);

                assert.equal(response.success, false);
                assert.equal(response.source, 'fallback');
                assert.equal(response.redirect, 'https://fxtwitter.com/openai/status/1234567890');
                assert.match(response.error || '', /Twitter API error: 503/);
            } finally {
                globalThis.fetch = originalFetch;
            }
        },
    },
    {
        name: 'twitterHandler reports invalid URLs cleanly',
        run: async () => {
            const response = await twitterHandler.handle('https://x.com/openai/likes', env);

            assert.equal(response.success, false);
            assert.equal(response.error, 'Invalid Twitter URL');
            assert.equal(response.redirect, undefined);
        },
    },
    {
        name: 'status probes mark successful external recovery as degraded fallback operation',
        run: () => {
            const assessment = assessProbeResult({ success: true, source: 'fallback' }, 120);
            assert.equal(assessment.status, 'degraded');
            assert.equal(assessment.mode, 'fallback');
            assert.match(assessment.notice || '', /emergency fallback/i);
        },
    },
    {
        name: 'Top.gg webhook rejects an invalid signature without calling Discord',
        run: async () => {
            const originalFetch = globalThis.fetch;
            let discordCalled = false;
            globalThis.fetch = async () => {
                discordCalled = true;
                return new Response(null, { status: 204 });
            };
            try {
                const response = await handleTopGgWebhook(new Request('https://fixembed.app/webhooks/topgg', {
                    method: 'POST',
                    headers: { 'x-topgg-signature': 't=1,v1=bad' },
                    body: '{}',
                }), {
                    ...env,
                    TOPGG_WEBHOOK_SECRET: 'whs_test',
                    DISCORD_BOT_TOKEN: 'discord-test-token',
                    FIXEMBED_GUILD_ID: '1195810157112852540',
                    FIXEMBED_VOTER_ROLE_ID: '123456789012345678',
                    TOPGG_BOT_ID: '1173820242305224764',
                });
                assert.equal(response.status, 401);
                assert.equal(discordCalled, false);
            } finally { globalThis.fetch = originalFetch; }
        },
    },
    {
        name: 'Top.gg vote webhook grants the configured Discord voter role',
        run: async () => {
            const payload = JSON.stringify({
                type: 'vote.create',
                data: {
                    id: '123456789012345678',
                    project: { type: 'bot', platform: 'discord', platform_id: '1173820242305224764' },
                    user: { platform_id: '222222222222222222', name: 'Voter' },
                },
            });
            const timestamp = Math.floor(Date.now() / 1000);
            const signature = await topGgSignature(payload, 'whs_test', timestamp);
            const originalFetch = globalThis.fetch;
            globalThis.fetch = async (input, init) => {
                assert.equal(String(input), 'https://discord.com/api/v10/guilds/1195810157112852540/members/222222222222222222/roles/123456789012345678');
                assert.equal(init?.method, 'PUT');
                assert.equal(new Headers(init?.headers).get('Authorization'), 'Bot discord-test-token');
                return new Response(null, { status: 204 });
            };
            try {
                const response = await handleTopGgWebhook(new Request('https://fixembed.app/webhooks/topgg', {
                    method: 'POST',
                    headers: { 'x-topgg-signature': signature },
                    body: payload,
                }), {
                    ...env,
                    TOPGG_WEBHOOK_SECRET: 'whs_test',
                    DISCORD_BOT_TOKEN: 'discord-test-token',
                    FIXEMBED_GUILD_ID: '1195810157112852540',
                    FIXEMBED_VOTER_ROLE_ID: '123456789012345678',
                    TOPGG_BOT_ID: '1173820242305224764',
                });
                assert.equal(response.status, 204);
            } finally { globalThis.fetch = originalFetch; }
        },
    },
    {
        name: 'Top.gg test webhook validates without granting a Discord role',
        run: async () => {
            const payload = JSON.stringify({
                type: 'webhook.test',
                data: {
                    project: { type: 'bot', platform: 'discord', platform_id: '1173820242305224764' },
                    user: { platform_id: '222222222222222222', name: 'Tester' },
                },
            });
            const timestamp = Math.floor(Date.now() / 1000);
            const signature = await topGgSignature(payload, 'whs_test', timestamp);
            const originalFetch = globalThis.fetch;
            let discordCalled = false;
            globalThis.fetch = async () => {
                discordCalled = true;
                return new Response(null, { status: 204 });
            };
            try {
                const response = await handleTopGgWebhook(new Request('https://fixembed.app/webhooks/topgg', {
                    method: 'POST',
                    headers: { 'x-topgg-signature': signature },
                    body: payload,
                }), {
                    ...env,
                    TOPGG_WEBHOOK_SECRET: 'whs_test',
                    DISCORD_BOT_TOKEN: 'discord-test-token',
                    FIXEMBED_GUILD_ID: '1195810157112852540',
                    FIXEMBED_VOTER_ROLE_ID: '123456789012345678',
                    TOPGG_BOT_ID: '1173820242305224764',
                });
                assert.equal(response.status, 204);
                assert.equal(discordCalled, false);
            } finally { globalThis.fetch = originalFetch; }
        },
    },
    {
        name: 'status probes identify emergency redirects as degraded fallback operation',
        run: () => {
            const assessment = assessProbeResult({
                success: false,
                source: 'fallback',
                redirect: 'https://fxtwitter.com/openai/status/1234567890',
                error: 'Twitter API error: 503',
            }, 120);

            assert.equal(assessment.status, 'degraded');
            assert.equal(assessment.mode, 'fallback');
            assert.match(assessment.notice || '', /emergency fallback/i);
            assert.equal(assessment.responseCode, 302);
        },
    },
    {
        name: 'status probes identify successful native handlers as first-party',
        run: () => {
            const assessment = assessProbeResult({
                success: true,
                source: 'first-party',
            }, 120);

            assert.equal(assessment.status, 'operational');
            assert.equal(assessment.mode, 'first-party');
            assert.equal(assessment.notice, null);
        },
    },
    {
        name: 'status probes downgrade stale sample content errors to degraded',
        run: () => {
            const assessment = assessProbeResult({
                success: false,
                error: 'HTTP 404: Not Found',
            }, 180);

            assert.equal(assessment.status, 'degraded');
            assert.equal(assessment.mode, 'unavailable');
            assert.equal(assessment.notice, 'HTTP 404: Not Found');
            assert.equal(assessment.responseCode, 424);
        },
    },
    {
        name: 'public website advertises YouTube community post support',
        run: () => {
            assert.match(indexHtml, /<h3>YouTube<\/h3>/);
            assert.match(indexHtml, /YouTube community posts/i);
            assert.match(docsHtml, /YouTube Community Posts/);
            assert.match(docsHtml, /youtube\.com\/post/);
        },
    },
    {
        name: 'status dashboard labels live checks without claiming synthetic uptime history',
        run: () => {
            assert.match(statusHtml, /Current latency/);
            assert.match(statusHtml, /first-party rendering checks/i);
            assert.doesNotMatch(statusHtml, /Uptime 24h|Uptime 7d|Uptime 30d/);
        },
    },
];

async function main() {
    let passed = 0;

    for (const testCase of tests) {
        try {
            await testCase.run();
            passed += 1;
            console.log(`PASS ${testCase.name}`);
        } catch (error) {
            console.error(`FAIL ${testCase.name}`);
            console.error(error);
            process.exitCode = 1;
        }
    }

    console.log(`\n${passed}/${tests.length} tests passed`);

    if (passed !== tests.length) {
        process.exitCode = 1;
    }
}

await main();
