import assert from 'node:assert/strict';

import { findHandler } from '../src/handlers/index.ts';
import { twitterHandler } from '../src/handlers/twitter.ts';
import { instagramHandler } from '../src/handlers/instagram.ts';
import { redditHandler } from '../src/handlers/reddit.ts';
import { parseYouTubeCommunityPostHtml, youtubeHandler } from '../src/handlers/youtube.ts';
import { pixivHandler } from '../src/handlers/pixiv.ts';
import { bilibiliHandler } from '../src/handlers/bilibili.ts';
import { buildBlueskyContent } from '../src/handlers/bluesky.ts';
import type { Env } from '../src/types.ts';
import { assessProbeResult } from '../src/utils/status.ts';
import { statusHtml } from '../src/utils/static_site.ts';
import { handleTopGgWebhook } from '../src/webhooks/topgg.ts';
import { normalizeEmbedLayout } from '../src/utils/embed.ts';
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
                return new Response(JSON.stringify({ error: false, body: {
                    title: 'Artwork', description: 'Description', userName: 'Artist', userId: '42',
                    urls: { regular: 'https://i.pximg.net/img-original/artwork.jpg' },
                } }), { status: 200 });
            };
            try {
                const response = await pixivHandler.handle('https://www.pixiv.net/artworks/123', env);
                assert.equal(requested.length, 1);
                assert.match(requested[0], /^https:\/\/www\.pixiv\.net\/ajax\/illust\/123/);
                assert.equal(response.source, 'first-party');
                assert.equal(response.data?.title, 'Artwork');
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
            } finally { globalThis.fetch = originalFetch; }
        },
    },
    {
        name: 'redditHandler recovers post data from Reddit embed HTML when JSON is forbidden',
        run: async () => {
            const originalFetch = globalThis.fetch;
            globalThis.fetch = async (input) => {
                const url = String(input);
                if (url.endsWith('.json')) {
                    return new Response('blocked', { status: 403, statusText: 'Forbidden' });
                }
                if (url.startsWith('https://embed.reddit.com/')) {
                    return new Response(`
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
                assert.equal(response.data?.image, 'https://preview.redd.it/example.png?width=591&format=png');
                assert.match(response.data?.stats || '', /218/);
                assert.match(response.data?.stats || '', /75/);
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
