import assert from 'node:assert/strict';

import app, { STATUS_PROBES } from '../src/index.ts';
import { findHandler } from '../src/handlers/index.ts';
import { twitterHandler } from '../src/handlers/twitter.ts';
import { normalizeTwitterWebsiteCard } from '../src/handlers/twitter_graphql.ts';
import { instagramHandler } from '../src/handlers/instagram.ts';
import { redditHandler } from '../src/handlers/reddit.ts';
import { parseYouTubeCommunityPostHtml, youtubeHandler } from '../src/handlers/youtube.ts';
import { pixivHandler } from '../src/handlers/pixiv.ts';
import { bilibiliHandler } from '../src/handlers/bilibili.ts';
import { pinterestHandler } from '../src/handlers/pinterest.ts';
import { blueskyHandler, buildBlueskyContent } from '../src/handlers/bluesky.ts';
import { threadsHandler } from '../src/handlers/threads.ts';
import type { Env } from '../src/types.ts';
import { assessProbeResult } from '../src/utils/status.ts';
import {
    StatusProbeTimeoutError,
    StatusReportCache,
    withStatusProbeDeadline,
} from '../src/utils/status_report_cache.ts';
import { deriveMetaShortcodeTimestamp, extractPostTimestampFromHtml } from '../src/utils/timestamp.ts';
import {
    docsHtml,
    indexHtml,
    platformLandingHtml,
    privacyHtml,
    statusHtml,
    stylesCss,
    supportHtml,
    tosHtml,
} from '../src/utils/static_site.ts';
import {
    discordInstallUrl,
    parseInstallContext,
    parseInstallSource,
} from '../src/utils/install.ts';
import { handleTopGgWebhook } from '../src/webhooks/topgg.ts';
import { encodeActivitySource, formatActivityContent, generateEmbedHTML, normalizeEmbedLayout } from '../src/utils/embed.ts';
import {
    cleanUrl,
    createTimeoutBudget,
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

async function signedRelayResponse(payload: unknown, secret: string): Promise<Response> {
    const body = JSON.stringify(payload);
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
        new TextEncoder().encode(body),
    );
    const hex = [...new Uint8Array(signature)]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
    return new Response(body, {
        status: 200,
        headers: {
            'Content-Type': 'application/json',
            'X-FixEmbed-Signature': `v1=${hex}`,
        },
    });
}

const tests: TestCase[] = [
    {
        name: 'createTimeoutBudget caps provider time against one shared deadline',
        run: () => {
            let now = 1000;
            const remaining = createTimeoutBudget(3500, () => now);

            assert.equal(remaining(2200), 2200);
            now = 4000;
            assert.equal(remaining(2200), 500);
            now = 5000;
            assert.equal(remaining(2200), 1);
        },
    },
    {
        name: 'extractPostTimestampFromHtml recognizes bounded platform publication fields',
        run: () => {
            assert.equal(
                extractPostTimestampFromHtml('<script>{"datePublished":"2026-06-19T16:00:00-07:00"}</script>'),
                '2026-06-19T23:00:00.000Z',
            );
            assert.equal(
                extractPostTimestampFromHtml('&quot;created_timestamp&quot;:1717690529477'),
                '2024-06-06T16:15:29.477Z',
            );
            assert.equal(
                extractPostTimestampFromHtml('<script>{"pubdate":1743681148}</script>'),
                '2025-04-03T11:52:28.000Z',
            );
            assert.equal(
                extractPostTimestampFromHtml('<meta content=2025-04-03T19:52:28+08:00 name=pubdate property=article:published_time>'),
                '2025-04-03T11:52:28.000Z',
            );
            assert.equal(
                extractPostTimestampFromHtml('<meta property="og:image" content="https://i.pximg.net/img.jpg?mdate=1665435823">'),
                '2022-10-10T21:03:43.000Z',
            );
            assert.equal(
                extractPostTimestampFromHtml('https://i.pximg.net/img-original/img/2022/10/11/06/03/43/101844438_p0.png'),
                '2022-10-10T21:03:43.000Z',
            );
            assert.equal(
                deriveMetaShortcodeTimestamp('Cu8M4wXLZQx'),
                '2023-07-21T01:16:38.791Z',
            );
            assert.equal(deriveMetaShortcodeTimestamp('Resolved123'), undefined);
            assert.equal(deriveMetaShortcodeTimestamp('not valid!'), undefined);
            assert.equal(extractPostTimestampFromHtml('timestamp="1784202091997"'), undefined);
        },
    },
    {
        name: 'threadsHandler preserves full post text and creator identity metadata',
        run: async () => {
            const originalFetch = globalThis.fetch;
            globalThis.fetch = async (input) => {
                if (String(input) === 'https://www.threads.net/@creator') {
                    return new Response(`
                        <meta property="og:image" content="https://scontent.example.cdninstagram.com/avatar.jpg?stp=dst-jpg_s640x640_tt6&amp;s=signed">
                    `, { status: 200, headers: { 'Content-Type': 'text/html' } });
                }
                return new Response(JSON.stringify({
                    data: { data: { edges: [{ node: { thread_items: [{ post: {
                        code: 'ABC123',
                        user: {
                            username: 'creator',
                            profile_pic_url: 'https://scontent.example.cdninstagram.com/avatar.jpg?stp=dst-jpg_s150x150_tt6&amp;s=signed',
                        },
                        caption: { text: 'A full Threads post that should remain intact.' },
                        taken_at: 1783969200,
                        like_count: 1200,
                        text_post_app_info: { direct_reply_count: 34 },
                        image_versions2: { candidates: [{ url: 'https://cdn.example/post.jpg' }] },
                    } }] } }] } },
                }), { status: 200 });
            };

            try {
                const response = await threadsHandler.handle(
                    'https://www.threads.net/@creator/post/ABC123',
                    env,
                );
                assert.equal(response.success, true);
                assert.equal(response.data?.caption, 'A full Threads post that should remain intact.');
                assert.equal(response.data?.authorName, 'creator');
                assert.equal(response.data?.authorHandle, '@creator');
                assert.equal(response.data?.timestamp, '2026-07-13T19:00:00.000Z');
                assert.equal(
                    response.data?.authorAvatar,
                    'https://scontent.example.cdninstagram.com/avatar.jpg?stp=dst-jpg_s640x640_tt6&s=signed',
                );
            } finally {
                globalThis.fetch = originalFetch;
            }
        },
    },
    {
        name: 'threadsHandler upgrades a trusted GraphQL avatar without fetching the profile page',
        run: async () => {
            const originalFetch = globalThis.fetch;
            const requested: string[] = [];
            let graphqlSignal: AbortSignal | null | undefined;
            globalThis.fetch = async (input, init) => {
                const url = String(input);
                requested.push(url);
                if (url === 'https://www.threads.net/api/graphql') {
                    graphqlSignal = init?.signal;
                    return Response.json({
                        data: { data: { edges: [{ node: { thread_items: [{ post: {
                            code: 'DDKltrOTjJl',
                            user: {
                                username: 'threads',
                                profile_pic_url: 'https://scontent.example.cdninstagram.com/avatar.jpg?stp=dst-jpg_s150x150_tt6&ccb=1-7',
                            },
                            caption: { text: 'A current public Threads post.' },
                        } }] } }] } },
                    });
                }
                return new Response('<meta property="og:image" content="https://scontent.example.cdninstagram.com/avatar.jpg?stp=dst-jpg_s640x640_tt6">');
            };

            try {
                const response = await threadsHandler.handle(
                    'https://www.threads.com/@threads/post/DDKltrOTjJl',
                    env,
                );
                assert.equal(response.success, true);
                assert.deepEqual(requested, ['https://www.threads.net/api/graphql']);
                assert.equal(graphqlSignal instanceof AbortSignal, true);
                assert.equal(
                    response.data?.authorAvatar,
                    'https://scontent.example.cdninstagram.com/avatar.jpg?stp=dst-jpg_s640x640_tt6&ccb=1-7',
                );
            } finally { globalThis.fetch = originalFetch; }
        },
    },
    {
        name: 'threadsHandler recovers publication time from the post shortcode',
        run: async () => {
            const originalFetch = globalThis.fetch;
            globalThis.fetch = async (input) => {
                const url = String(input);
                if (url === 'https://www.threads.net/@creator') {
                    return new Response('<meta property="og:image" content="https://scontent.example.cdninstagram.com/avatar.jpg">');
                }
                return Response.json({
                    data: { data: { edges: [{ node: { thread_items: [{ post: {
                        code: 'Cu8M4wXLZQx',
                        user: { username: 'creator' },
                        caption: { text: 'A timestamp recovery post.' },
                    } }] } }] } },
                });
            };
            try {
                const response = await threadsHandler.handle(
                    'https://www.threads.net/@creator/post/Cu8M4wXLZQx',
                    env,
                );
                assert.equal(response.data?.timestamp, '2023-07-21T01:16:38.791Z');
            } finally { globalThis.fetch = originalFetch; }
        },
    },
    {
        name: 'threadsHandler keeps shortcode time when GraphQL falls back to oEmbed',
        run: async () => {
            const originalFetch = globalThis.fetch;
            globalThis.fetch = async (input) => {
                const url = String(input);
                if (url === 'https://www.threads.net/api/graphql') {
                    return Response.json({ data: { data: { edges: [] } } });
                }
                if (url.includes('threads.net/oembed/')) {
                    return Response.json({ author_name: 'zuck', title: 'An older thread' });
                }
                if (url === 'https://www.threads.net/@zuck') {
                    return new Response('<meta property="og:image" content="https://cdn.example/avatar.jpg">');
                }
                throw new Error(`Unexpected request: ${url}`);
            };
            try {
                const response = await threadsHandler.handle(
                    'https://www.threads.net/@zuck/post/Cu8M4wXLZQx',
                    env,
                );
                assert.equal(response.source, 'first-party');
                assert.equal(response.data?.timestamp, '2023-07-21T01:16:38.791Z');
            } finally { globalThis.fetch = originalFetch; }
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
            assert.equal(findHandler('https://pin.it/CjGnCP20L')?.name, 'pinterest');
            assert.equal(findHandler('https://www.pinterest.com/pin/424605071145119869/')?.name, 'pinterest');
        },
    },
    {
        name: 'pinterestHandler safely resolves short links and preserves full-size Pin metadata',
        run: async () => {
            const originalFetch = globalThis.fetch;
            const requested: string[] = [];
            globalThis.fetch = async (input, init) => {
                const url = String(input);
                requested.push(url);
                if (url === 'https://pin.it/CjGnCP20L') {
                    return new Response(null, {
                        status: 308,
                        headers: { Location: 'https://api.pinterest.com/url_shortener/CjGnCP20L/redirect/' },
                    });
                }
                if (url.includes('/url_shortener/')) {
                    return new Response(null, {
                        status: 302,
                        headers: { Location: 'https://www.pinterest.com/pin/424605071145119869/sent/?invite_code=test' },
                    });
                }
                if (url === 'https://www.pinterest.com/christinaebrautaset/') {
                    assert.equal(init?.redirect, 'manual');
                    return new Response(`<!doctype html><html><body><script>{
                        "owner":{"full_name":"christinabrautaset","username":"christinaebrautaset",
                        "image_medium_url":"https://i.pinimg.com/75x75_RS/ba/ab/af/avatar.jpg"}
                    }</script></body></html>`, { status: 200, headers: { 'Content-Type': 'text/html' } });
                }
                return new Response(`<!doctype html><html><head>
                    <meta property="og:title" content="Summer trip ideas">
                    <meta property="og:description" content="Mallorca with friends">
                    <meta property="og:image" content="https://i.pinimg.com/736x/example.jpg">
                    <meta property="og:image:width" content="736">
                    <meta property="og:image:height" content="981">
                    <meta property="og:updated_time" content="2026-05-27T21:03:02.000Z">
                    <script>{"nativeCreator":{"fullName":"christinabrautaset","username":"christinaebrautaset"}}</script>
                </head></html>`, { status: 200, headers: { 'Content-Type': 'text/html' } });
            };
            try {
                const response = await pinterestHandler.handle('https://pin.it/CjGnCP20L', env);
                assert.equal(requested.length, 4);
                assert.equal(response.success, true);
                assert.equal(response.source, 'first-party');
                assert.equal(response.data?.platform, 'pinterest');
                assert.equal(response.data?.title, 'Summer trip ideas');
                assert.equal(response.data?.description, 'Mallorca with friends');
                assert.equal(response.data?.image, 'https://i.pinimg.com/736x/example.jpg');
                assert.equal(response.data?.url, 'https://www.pinterest.com/pin/424605071145119869/');
                assert.equal(response.data?.timestamp, '2026-05-27T21:03:02.000Z');
                assert.equal(response.data?.authorName, 'christinabrautaset');
                assert.equal(response.data?.authorHandle, '@christinaebrautaset');
                assert.equal(response.data?.authorUrl, 'https://www.pinterest.com/christinaebrautaset/');
                assert.equal(
                    response.data?.authorAvatar,
                    'https://i.pinimg.com/originals/ba/ab/af/avatar.jpg',
                );
            } finally { globalThis.fetch = originalFetch; }
        },
    },
    {
        name: 'pinterestHandler rejects short-link redirects outside Pinterest',
        run: async () => {
            const originalFetch = globalThis.fetch;
            let requests = 0;
            globalThis.fetch = async () => {
                requests += 1;
                return new Response(null, {
                    status: 302,
                    headers: { Location: 'https://example.com/private-target' },
                });
            };
            try {
                const response = await pinterestHandler.handle('https://pin.it/unsafe', env);
                assert.equal(requests, 1);
                assert.equal(response.success, false);
                assert.match(response.error || '', /unsafe pinterest redirect/i);
            } finally { globalThis.fetch = originalFetch; }
        },
    },
    {
        name: 'pinterestHandler rejects oversized Pin pages before parsing them',
        run: async () => {
            const originalFetch = globalThis.fetch;
            globalThis.fetch = async () => new Response('<html></html>', {
                status: 200,
                headers: { 'Content-Length': '5000001' },
            });
            try {
                const response = await pinterestHandler.handle(
                    'https://www.pinterest.com/pin/424605071145119869/',
                    env,
                );
                assert.equal(response.success, false);
                assert.match(response.error || '', /response too large/i);
            } finally { globalThis.fetch = originalFetch; }
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
                if (String(input).includes('/ajax/user/42')) {
                    return new Response(JSON.stringify({ error: false, body: {
                        image: 'https://i.pximg.net/user-profile/avatar_50.jpg',
                        imageBig: 'https://i.pximg.net/user-profile/avatar_170.jpg',
                    } }), { status: 200 });
                }
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
                    userIllusts: {
                        '123': null,
                        '122': { profileImageUrl: 'https://i.pximg.net/user-profile/avatar.jpg' },
                    },
                } }), { status: 200 });
            };
            try {
                const response = await pixivHandler.handle('https://www.pixiv.net/artworks/123', env);
                assert.equal(requested.length, 3);
                assert.match(requested[0], /^https:\/\/www\.pixiv\.net\/ajax\/illust\/123/);
                assert.match(requested[1], /^https:\/\/www\.pixiv\.net\/ajax\/illust\/123\/pages/);
                assert.match(requested[2], /^https:\/\/www\.pixiv\.net\/ajax\/user\/42\?full=1/);
                assert.equal(response.source, 'first-party');
                assert.equal(response.data?.title, 'Artwork');
                assert.equal(response.data?.description, 'Uses , commas');
                assert.equal(response.data?.authorHandle, '@artist_account');
                assert.equal(response.data?.authorUrl, 'https://www.pixiv.net/en/users/42');
                assert.equal(
                    response.data?.authorAvatar,
                    'https://fixembed.app/proxy/pixiv?url=https%3A%2F%2Fi.pximg.net%2Fuser-profile%2Favatar_170.jpg',
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
        name: 'pixivHandler recovers blocked artwork metadata from official Pixiv oEmbed',
        run: async () => {
            const originalFetch = globalThis.fetch;
            const requested: string[] = [];
            globalThis.fetch = async (input) => {
                const url = String(input);
                requested.push(url);
                if (url.includes('/ajax/illust/789')) {
                    return new Response('blocked', { status: 403 });
                }
                if (url.startsWith('https://embed.pixiv.net/oembed.php?')) {
                    return Response.json({
                        version: '1.0',
                        type: 'rich',
                        title: 'Official artwork',
                        author_name: 'Official artist',
                        author_url: 'https://www.pixiv.net/en/users/42',
                        thumbnail_url: 'https://embed.pixiv.net/decorate.php?illust_id=789&mdate=1783900800',
                        width: 600,
                        height: 315,
                    });
                }
                throw new Error(`Unexpected request: ${url}`);
            };
            try {
                const response = await pixivHandler.handle('https://www.pixiv.net/artworks/789', env);
                assert.equal(requested.length, 2);
                assert.match(requested[1], /^https:\/\/embed\.pixiv\.net\/oembed\.php\?/);
                assert.equal(response.success, true);
                assert.equal(response.source, 'first-party');
                assert.equal(response.data?.title, 'Official artwork');
                assert.equal(response.data?.authorName, 'Official artist');
                assert.equal(response.data?.authorUrl, 'https://www.pixiv.net/en/users/42');
                assert.equal(response.data?.timestamp, '2026-07-13T00:00:00.000Z');
                assert.equal(
                    response.data?.image,
                    'https://fixembed.app/proxy/pixiv?url=https%3A%2F%2Fembed.pixiv.net%2Fdecorate.php%3Fillust_id%3D789%26mdate%3D1783900800',
                );
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
                    owner: { name: 'Creator', mid: 42, face: 'https://i0.hdslb.com/avatar.jpg' },
                    stat: { view: 98765, reply: 321, coin: 456, favorite: 1000, share: 42, like: 5000 },
                    pubdate: 1783987200,
                } }), { status: 200 });
            };
            try {
                const response = await bilibiliHandler.handle('https://www.bilibili.com/video/BV1xx411c7mD', env);
                assert.equal(requested.length, 1);
                assert.match(requested[0], /^https:\/\/api\.bilibili\.com\/x\/web-interface\/view/);
                assert.equal(response.source, 'first-party');
                assert.equal(response.data?.title, 'Video');
                assert.equal(response.data?.authorAvatar, 'https://i0.hdslb.com/avatar.jpg');
                assert.equal(response.data?.stats, '💬 321 ❤️ 5K 👁️ 98.8K 🪙 456 🔖 1K 🔁 42');
                assert.equal(response.data?.timestamp, new Date(1783987200 * 1000).toISOString());
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
            const html = `<meta itemprop="datePublished" content="2026-07-13T19:00:00Z"><script>const preloadNames = ["backstagePostRenderer"];</script><script>var ytInitialData = {
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
            assert.equal(data?.timestamp, '2026-07-13T19:00:00.000Z');
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
                return new Response('<html><script>{"username":"creator","taken_at":1783969200,"display_url":"https:\\/\\/scontent.example.com\\/photo.jpg?x=1&amp;amp;y=2","text":"Caption","edge_media_preview_like":{"count":1284},"edge_media_to_parent_comment":{"count":37}}</script></html>', { status: 200 });
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
                assert.equal(response.data?.timestamp, '2026-07-13T19:00:00.000Z');
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
                        value: 'https://www.instagram.com/p/DadSNf5EdUy/',
                    });
                    return response;
                }
                if (url.includes('/p/DadSNf5EdUy/embed/captioned/')) {
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
                assert.equal(response.data?.url, 'https://www.instagram.com/p/DadSNf5EdUy/');
                assert.equal(response.data?.timestamp, '2026-07-06T16:08:03.275Z');
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
                if (url === 'https://www.instagram.com/reel/DaneAqzR3eV/') {
                    return new Response('', { status: 429 });
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
                assert.equal(response.data?.timestamp, '2026-07-10T15:03:33.951Z');
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
            globalThis.fetch = async (input, init) => {
                const url = String(input);
                if (url.includes('/comments/') && url.includes('.json')) {
                    return new Response('blocked', { status: 403, statusText: 'Forbidden' });
                }
                if (url.includes('/about.json')) {
                    const cookie = new Headers(init?.headers).get('Cookie') || '';
                    if (!cookie.includes('loid=anonymous-session')) {
                        return new Response('blocked', { status: 403, statusText: 'Forbidden' });
                    }
                    return new Response(JSON.stringify({
                        data: {
                            community_icon: 'https://styles.redditmedia.com/t5_2t1qf/styles/communityIcon_fp81a2t5s9ch1.png?width=256&amp;s=signed',
                        },
                    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
                if (url.includes('/oembed?')) {
                    return new Response(JSON.stringify({
                        title: 'usage limits reset for the 5th time today',
                        author_name: 'Distinct_Ingenuity21',
                    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
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
                        <script>{&quot;created_timestamp&quot;:1783900800000}</script>
                    `, {
                        status: 200,
                        headers: {
                            'Content-Type': 'text/html',
                            'Set-Cookie': 'loid=anonymous-session; Domain=.reddit.com; Path=/; Secure',
                        },
                    });
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
                assert.equal(response.data?.authorAvatar, 'https://styles.redditmedia.com/t5_2t1qf/styles/communityIcon_fp81a2t5s9ch1.png?width=256&s=signed');
                assert.equal(response.data?.image, 'https://preview.redd.it/example.png?width=591&format=png');
                assert.match(response.data?.stats || '', /218/);
                assert.match(response.data?.stats || '', /75/);
                assert.equal(response.data?.timestamp, '2026-07-13T00:00:00.000Z');
            } finally {
                globalThis.fetch = originalFetch;
            }
        },
    },
    {
        name: 'bilibiliHandler recovers API rejection from official mobile page state',
        run: async () => {
            const originalFetch = globalThis.fetch;
            const requested: string[] = [];
            globalThis.fetch = async (input) => {
                const url = String(input);
                requested.push(url);
                if (url.startsWith('https://api.bilibili.com/')) {
                    return new Response('blocked', { status: 412 });
                }
                if (url === 'https://m.bilibili.com/video/BV1xx411c7mD') {
                    const state = {
                        video: {
                            viewInfo: {
                                title: 'Mobile video',
                                desc: 'Official page description',
                                pic: '//i0.hdslb.com/mobile-video.jpg',
                                pubdate: 1783987200,
                                owner: { name: 'Mobile creator', mid: 42, face: '//i0.hdslb.com/mobile-avatar.jpg' },
                                stat: { view: 98765, reply: 321, coin: 456, favorite: 1000, share: 42, like: 5000 },
                            },
                        },
                    };
                    return new Response(`<script>window.__INITIAL_STATE__=${JSON.stringify(state)};</script>`, {
                        status: 200,
                        headers: { 'Content-Type': 'text/html; charset=utf-8' },
                    });
                }
                if (url.includes('vxbilibili.com/video/')) {
                    return new Response('fallback unavailable', { status: 503 });
                }
                throw new Error(`Unexpected request: ${url}`);
            };
            try {
                const response = await bilibiliHandler.handle(
                    'https://www.bilibili.com/video/BV1xx411c7mD',
                    env,
                );
                assert.equal(requested.includes('https://m.bilibili.com/video/BV1xx411c7mD'), true);
                assert.equal(requested.some((url) => url.includes('vxbilibili.com/video/')), true);
                assert.equal(response.success, true);
                assert.equal(response.source, 'first-party');
                assert.equal(response.data?.title, 'Mobile video');
                assert.equal(response.data?.authorName, 'Mobile creator');
                assert.equal(response.data?.authorAvatar, 'https://i0.hdslb.com/mobile-avatar.jpg');
                assert.equal(response.data?.image, 'https://i0.hdslb.com/mobile-video.jpg');
                assert.equal(response.data?.stats, '💬 321 ❤️ 5K 👁️ 98.8K 🪙 456 🔖 1K 🔁 42');
                assert.equal(response.data?.timestamp, new Date(1783987200 * 1000).toISOString());
            } finally { globalThis.fetch = originalFetch; }
        },
    },
    {
        name: 'instagramHandler derives the post time without a duplicate canonical request',
        run: async () => {
            const originalFetch = globalThis.fetch;
            const requested: string[] = [];
            globalThis.fetch = async (input) => {
                requested.push(String(input));
                return new Response(
                    '<script>{"username":"creator","display_url":"https:\\/\\/scontent.example.com\\/photo.jpg","text":"Caption"}</script>',
                    { status: 200 },
                );
            };
            try {
                const response = await instagramHandler.handle(
                    'https://www.instagram.com/p/DadSNf5EdUy/',
                    env,
                );
                assert.equal(response.success, true);
                assert.equal(response.data?.timestamp, '2026-07-06T16:08:03.275Z');
                assert.deepEqual(requested, [
                    'https://www.instagram.com/p/DadSNf5EdUy/embed/captioned/',
                ]);
            } finally { globalThis.fetch = originalFetch; }
        },
    },
    {
        name: 'instagramHandler bounds the native Instagram request with an abort signal',
        run: async () => {
            const originalFetch = globalThis.fetch;
            let nativeSignal: AbortSignal | null | undefined;
            globalThis.fetch = async (input, init) => {
                if (String(input).includes('/embed/captioned/')) {
                    nativeSignal = init?.signal;
                    return new Response(
                        '<script>{"username":"creator","taken_at":1783969200,"display_url":"https:\\/\\/scontent.example.com\\/photo.jpg","text":"Caption"}</script>',
                        { status: 200 },
                    );
                }
                throw new Error(`Unexpected request: ${String(input)}`);
            };
            try {
                const response = await instagramHandler.handle(
                    'https://www.instagram.com/p/ABC123/',
                    env,
                );
                assert.equal(response.success, true);
                assert.equal(nativeSignal instanceof AbortSignal, true);
            } finally { globalThis.fetch = originalFetch; }
        },
    },
    {
        name: 'instagramHandler reuses first-party metadata for carousel recovery',
        run: async () => {
            const originalFetch = globalThis.fetch;
            const requested: string[] = [];
            globalThis.fetch = async (input) => {
                const url = String(input);
                requested.push(url);
                if (url.includes('/p/DadSNf5EdUy/embed/captioned/')) {
                    return new Response([
                        '<span class="UsernameText">creator</span>',
                        '<div class="Caption">creator<br /><br />Carousel caption</div>',
                    ].join(''), { status: 200 });
                }
                if (url.includes('vxinstagram.com/p/DadSNf5EdUy')) {
                    return new Response([
                        '<meta property="og:image" content="https://vxinstagram.com/generated/DadSNf5EdUy.jpg">',
                        '<meta property="og:description" content="Carousel caption">',
                    ].join(''), { status: 200 });
                }
                throw new Error(`Unexpected request: ${url}`);
            };
            try {
                const response = await instagramHandler.handle(
                    'https://www.instagram.com/p/DadSNf5EdUy/',
                    env,
                );
                assert.equal(response.success, true);
                assert.equal(response.source, 'fallback');
                assert.equal(response.data?.authorName, 'creator');
                assert.equal(response.data?.authorHandle, '@creator');
                assert.equal(response.data?.image, 'https://vxinstagram.com/generated/DadSNf5EdUy.jpg');
                assert.equal(
                    requested.filter((request) => request.includes('/embed/captioned/')).length,
                    1,
                );
            } finally { globalThis.fetch = originalFetch; }
        },
    },
    {
        name: 'instagramHandler preserves first-party metadata when media recovery is unavailable',
        run: async () => {
            const originalFetch = globalThis.fetch;
            const requested: string[] = [];
            globalThis.fetch = async (input) => {
                const url = String(input);
                requested.push(url);
                if (url.includes('/p/DadSNf5EdUy/embed/captioned/')) {
                    return new Response([
                        '<span class="UsernameText">creator</span>',
                        '<div class="Caption">creator<br /><br />Caption without exposed media</div>',
                    ].join(''), { status: 200 });
                }
                if (url.includes('vxinstagram.com')) {
                    return new Response('', { status: 404 });
                }
                if (url.includes('kkinstagram.com')) {
                    return new Response('', { status: 404 });
                }
                if (url.includes('snapsave.app')) {
                    return new Response('', { status: 503 });
                }
                throw new Error(`Unexpected request: ${url}`);
            };
            try {
                const response = await instagramHandler.handle(
                    'https://www.instagram.com/p/DadSNf5EdUy/',
                    env,
                );
                assert.equal(response.success, true);
                assert.equal(response.source, 'first-party');
                assert.equal(response.data?.authorName, 'creator');
                assert.equal(response.data?.caption, 'Caption without exposed media');
                assert.equal(
                    requested.filter((request) => request.includes('/embed/captioned/')).length,
                    1,
                );
            } finally { globalThis.fetch = originalFetch; }
        },
    },
    {
        name: 'bilibiliHandler recovers complete cards from minified BiliFix metadata',
        run: async () => {
            const originalFetch = globalThis.fetch;
            const requested: string[] = [];
            globalThis.fetch = async (input) => {
                const url = String(input);
                requested.push(url);
                if (url.includes('api.bilibili.com/x/web-interface/view')) {
                    return new Response('Precondition Failed', { status: 412 });
                }
                if (url.includes('vxbilibili.com/video/')) {
                    return new Response(
                        '<meta content="BiliFix / vxbilibili.com\n📺53.7萬 👍2.3萬 🪙927 ⭐6931 📤1843"property=og:site_name>'
                        + '<meta content=最棒的更新就得配上最多的bug！ property=og:title>'
                        + '<meta content=http://i1.hdslb.com/video.jpg property=og:image>'
                        + '<meta content="https://media.vxbilibili.com/video/BV1p3Nc6pEoP/1"property=og:video>'
                        + '<meta content=2026-07-14T08:00:00+08:00 name=pubdate property=article:published_time>',
                        { status: 200 },
                    );
                }
                if (url === 'https://m.bilibili.com/video/BV1p3Nc6pEoP') {
                    return new Response('<script>{"pubdate":1783987200}</script>', { status: 200 });
                }
                if (url.includes('api.bilibili.com/x/web-interface/wbi/search/type')) {
                    return Response.json({ code: 0, data: { result: [
                        { bvid: 'BV1p3Nc6pEoP', pubdate: 1783987200 },
                    ] } });
                }
                if (url.includes('vxbilibili.com/oembed/video')) {
                    return new Response(JSON.stringify({
                        title: '最棒的更新就得配上最多的bug！',
                        author_name: '这里是莱里',
                        author_url: 'https://space.bilibili.com/37093763',
                    }), { status: 200 });
                }
                throw new Error(`Unexpected request: ${url}`);
            };

            try {
                const response = await bilibiliHandler.handle(
                    'https://www.bilibili.com/video/BV1p3Nc6pEoP/',
                    env,
                );

                assert.equal(response.success, true);
                assert.equal(response.data?.title, '最棒的更新就得配上最多的bug！');
                assert.equal(response.data?.authorName, '这里是莱里');
                assert.equal(response.data?.authorUrl, 'https://space.bilibili.com/37093763');
                assert.equal(response.data?.image, 'https://i1.hdslb.com/video.jpg');
                assert.match(response.data?.video?.url || '', /^https:\/\/fixembed\.app\/proxy\/bilibili\?/);
                assert.equal(response.data?.timestamp, '2026-07-14T00:00:00.000Z');
                assert.equal(response.data?.stats, '👁️ 53.7萬 ❤️ 2.3萬 🪙 927 🔖 6931 🔁 1843');
                assert.equal(requested.some((url) => url.includes('/oembed/video')), true);
                assert.equal(requested.some((url) => url.includes('lang=zh-cn')), true);
            } finally {
                globalThis.fetch = originalFetch;
            }
        },
    },
    {
        name: 'bilibiliHandler overlaps mobile and BiliFix recovery requests',
        run: async () => {
            const originalFetch = globalThis.fetch;
            let releaseMobile: (() => void) | undefined;
            let markMobileStarted: (() => void) | undefined;
            let releaseHtml: (() => void) | undefined;
            let markHtmlStarted: (() => void) | undefined;
            let oembedStarted = false;
            const mobileGate = new Promise<void>((resolve) => { releaseMobile = resolve; });
            const mobileStarted = new Promise<void>((resolve) => { markMobileStarted = resolve; });
            const htmlGate = new Promise<void>((resolve) => { releaseHtml = resolve; });
            const htmlStarted = new Promise<void>((resolve) => { markHtmlStarted = resolve; });

            globalThis.fetch = async (input) => {
                const url = String(input);
                if (url.includes('api.bilibili.com/x/web-interface/view')) {
                    return new Response('Precondition Failed', { status: 412 });
                }
                if (url === 'https://m.bilibili.com/video/BV1p3Nc6pEoP') {
                    markMobileStarted?.();
                    await mobileGate;
                    return new Response('blocked', { status: 412 });
                }
                if (url.includes('vxbilibili.com/video/')) {
                    markHtmlStarted?.();
                    await htmlGate;
                    return new Response(
                        '<meta content="Fallback video" property=og:title>'
                        + '<meta content=https://i1.hdslb.com/video.jpg property=og:image>'
                        + '<meta content=2026-07-14T08:00:00+08:00 property=article:published_time>',
                        { status: 200 },
                    );
                }
                if (url.includes('vxbilibili.com/oembed/video')) {
                    oembedStarted = true;
                    return Response.json({
                        title: 'Fallback video',
                        author_name: 'Fallback creator',
                        author_url: 'https://space.bilibili.com/37093763',
                    });
                }
                throw new Error(`Unexpected request: ${url}`);
            };

            try {
                const responsePromise = bilibiliHandler.handle(
                    'https://www.bilibili.com/video/BV1p3Nc6pEoP/',
                    env,
                );
                await mobileStarted;
                const fallbackStartedBeforeMobileCompleted = await Promise.race([
                    htmlStarted.then(() => true),
                    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 25)),
                ]);
                releaseMobile?.();
                await htmlStarted;
                const startedBeforeHtmlCompleted = oembedStarted;
                releaseHtml?.();
                const response = await responsePromise;

                assert.equal(fallbackStartedBeforeMobileCompleted, true);
                assert.equal(startedBeforeHtmlCompleted, true);
                assert.equal(response.success, true);
                assert.equal(response.source, 'fallback');
                assert.equal(response.data?.authorName, 'Fallback creator');
                assert.equal(response.data?.timestamp, '2026-07-14T00:00:00.000Z');
            } finally {
                releaseMobile?.();
                releaseHtml?.();
                globalThis.fetch = originalFetch;
            }
        },
    },
    {
        name: 'Bilibili media proxy rejects URLs outside trusted video hosts',
        run: async () => {
            const response = await app.request(
                '/proxy/bilibili?url=' + encodeURIComponent('https://example.com/internal-target'),
                {},
                env,
            );

            assert.equal(response.status, 400);
            assert.deepEqual(await response.json(), { error: 'Invalid Bilibili video URL' });
        },
    },
    {
        name: 'Bilibili media proxy rejects redirects outside trusted video hosts',
        run: async () => {
            const originalFetch = globalThis.fetch;
            const requested: string[] = [];
            globalThis.fetch = async (input) => {
                requested.push(String(input));
                return new Response(null, {
                    status: 302,
                    headers: { Location: 'https://example.com/internal-target' },
                });
            };

            try {
                const response = await app.request(
                    '/proxy/bilibili?url=' + encodeURIComponent(
                        'https://media.vxbilibili.com/video/BV1p3Nc6pEoP/1',
                    ),
                    {},
                    env,
                );

                assert.equal(response.status, 502);
                assert.deepEqual(await response.json(), { error: 'Unsafe Bilibili video redirect' });
                assert.equal(requested.length, 1);
            } finally {
                globalThis.fetch = originalFetch;
            }
        },
    },
    {
        name: 'Pixiv media proxy rejects URLs outside trusted image hosts',
        run: async () => {
            const originalFetch = globalThis.fetch;
            let requests = 0;
            globalThis.fetch = async () => {
                requests += 1;
                return new Response('unexpected');
            };
            try {
                const response = await app.request(
                    '/proxy/pixiv?url=' + encodeURIComponent('https://example.com/internal-target'),
                    {},
                    env,
                );
                assert.equal(response.status, 400);
                assert.deepEqual(await response.json(), { error: 'Invalid Pixiv image URL' });
                assert.equal(requests, 0);
            } finally { globalThis.fetch = originalFetch; }
        },
    },
    {
        name: 'Pixiv media proxy rejects redirects outside trusted image hosts',
        run: async () => {
            const originalFetch = globalThis.fetch;
            const requested: string[] = [];
            globalThis.fetch = async (input) => {
                requested.push(String(input));
                return new Response(null, {
                    status: 302,
                    headers: { Location: 'https://example.com/internal-target' },
                });
            };
            try {
                const response = await app.request(
                    '/proxy/pixiv?url=' + encodeURIComponent(
                        'https://embed.pixiv.net/decorate.php?illust_id=789',
                    ),
                    {},
                    env,
                );
                assert.equal(response.status, 502);
                assert.deepEqual(await response.json(), { error: 'Unsafe Pixiv image redirect' });
                assert.equal(requested.length, 1);
            } finally { globalThis.fetch = originalFetch; }
        },
    },
    {
        name: 'production app does not expose internal platform diagnostics',
        run: async () => {
            const originalFetch = globalThis.fetch;
            let requests = 0;
            globalThis.fetch = async () => {
                requests += 1;
                return new Response('unexpected');
            };
            try {
                for (const platform of ['instagram', 'pixiv', 'youtube', 'bilibili']) {
                    const response = await app.request(`/debug/${platform}`, {}, env);
                    assert.equal(response.status, 404);
                }
                assert.equal(requests, 0);
            } finally { globalThis.fetch = originalFetch; }
        },
    },
    {
        name: 'redditHandler resolves Reddit share links before fetching metadata',
        run: async () => {
            const originalFetch = globalThis.fetch;
            const shareUrl = 'https://www.reddit.com/r/capybara/s/XQjKj3quL6';
            const canonicalUrl = 'https://www.reddit.com/r/capybara/comments/abc123/capybara_post/';
            const requested: string[] = [];
            globalThis.fetch = async (input) => {
                const url = String(input);
                requested.push(url);
                if (url === shareUrl) {
                    return new Response(null, {
                        status: 302,
                        headers: { Location: canonicalUrl },
                    });
                }
                if (url.includes('/comments/abc123.json')) {
                    return new Response(JSON.stringify([{
                        data: { children: [{ data: {
                            title: 'Capybara post',
                            selftext: '',
                            author: 'capybara_friend',
                            subreddit: 'capybara',
                            url: canonicalUrl,
                            permalink: '/r/capybara/comments/abc123/capybara_post/',
                            thumbnail: 'self',
                            is_video: false,
                            created_utc: 1_783_987_200,
                            score: 42,
                            num_comments: 7,
                        } }] },
                    }]));
                }
                if (url.includes('/about.json')) {
                    return new Response(JSON.stringify({ data: {} }));
                }
                throw new Error(`Unexpected request: ${url}`);
            };

            try {
                const response = await redditHandler.handle(shareUrl, env);

                assert.equal(response.success, true);
                assert.equal(response.data?.url, `https://reddit.com/r/capybara/comments/abc123/capybara_post/`);
                assert.equal(requested[0], shareUrl);
                assert.match(requested[1], /comments\/abc123\.json/);
            } finally {
                globalThis.fetch = originalFetch;
            }
        },
    },
    {
        name: 'redditHandler rejects share redirects outside Reddit',
        run: async () => {
            const originalFetch = globalThis.fetch;
            const shareUrl = 'https://www.reddit.com/r/capybara/s/XQjKj3quL6';
            globalThis.fetch = async () => new Response(null, {
                status: 302,
                headers: { Location: 'https://example.com/internal-target' },
            });

            try {
                const response = await redditHandler.handle(shareUrl, env);

                assert.equal(response.success, false);
                assert.equal(response.error, 'Invalid Reddit share redirect');
                assert.equal(response.redirect, shareUrl);
            } finally {
                globalThis.fetch = originalFetch;
            }
        },
    },
    {
        name: 'redditHandler recovers from blocked JSON API with Reddit oEmbed',
        run: async () => {
            const originalFetch = globalThis.fetch;
            const canonicalUrl = 'https://www.reddit.com/r/capybara/comments/abc123/capybara_post/';
            const requested: string[] = [];
            globalThis.fetch = async (input) => {
                const url = String(input);
                requested.push(url);
                if (url.includes('/comments/abc123.json')) {
                    return new Response('Forbidden', { status: 403 });
                }
                if (url.includes('/oembed?')) {
                    return new Response(JSON.stringify({
                        title: 'Capybara post',
                        author_name: 'capybara_friend',
                    }));
                }
                throw new Error(`Unexpected request: ${url}`);
            };

            try {
                const response = await redditHandler.handle(canonicalUrl, env);

                assert.equal(response.success, true);
                assert.equal(response.data?.title, 'r/capybara • Capybara post');
                assert.equal(response.data?.authorName, 'u/capybara_friend');
                assert.match(response.data?.authorAvatar || '', /redditstatic\.com/);
                assert.equal(requested.some((url) => url.includes('/oembed?')), true);
            } finally {
                globalThis.fetch = originalFetch;
            }
        },
    },
    {
        name: 'YouTube community posts preserve long text for Components V2',
        run: () => {
            const longText = 'Community update '.repeat(90).trim();
            const renderer = {
                contents: {
                    backstagePostRenderer: {
                        contentText: { runs: [{ text: longText }] },
                    },
                },
            };
            const html = [
                `<script>var ytInitialData = ${JSON.stringify(renderer)};</script>`,
                '<script type="application/ld+json">{"datePublished":"2026-06-19T16:00:00-07:00"}</script>',
            ].join('');

            const data = parseYouTubeCommunityPostHtml(
                html,
                'https://www.youtube.com/post/UgkxLongPost',
            );

            assert.equal(data?.description, longText);
            assert.equal(data?.timestamp, '2026-06-19T23:00:00.000Z');
        },
    },
    {
        name: 'pixivHandler uses the FixEmbed relay when official Worker requests are blocked',
        run: async () => {
            const originalFetch = globalThis.fetch;
            const requested: string[] = [];
            let relayRequestHeaders: Headers | undefined;
            globalThis.fetch = async (input, init) => {
                const requestedUrl = String(input);
                requested.push(requestedUrl);
                if (requestedUrl.includes('pixiv.net/ajax/illust/')
                    || requestedUrl.startsWith('https://embed.pixiv.net/oembed.php?')) {
                    return new Response('blocked', { status: 403 });
                }
                if (requestedUrl === 'https://relay.fixembed.test/pixiv/456') {
                    relayRequestHeaders = new Headers(init?.headers);
                    return signedRelayResponse({
                        version: 1,
                        id: '456',
                        title: 'Relay Art',
                        description: 'Recovered directly by FixEmbed.',
                        authorName: 'Artist Name',
                        authorHandle: 'artist_handle',
                        authorId: '42',
                        authorAvatar: 'https://i.pximg.net/avatar_170.jpg',
                        timestamp: '2026-07-13T00:00:00.000Z',
                        stats: { comments: 12, likes: 345, views: 6789, bookmarks: 234 },
                        images: [
                            'https://i.pximg.net/page-1.jpg',
                            'https://i.pximg.net/page-2.jpg',
                        ],
                    }, 'test-relay-secret-32-bytes-minimum');
                }
                return new Response('unexpected', { status: 500 });
            };
            try {
                const response = await pixivHandler.handle(
                    'https://www.pixiv.net/artworks/456',
                    {
                        ...env,
                        PIXIV_RELAY_URL: 'https://relay.fixembed.test',
                        PIXIV_RELAY_SECRET: 'test-relay-secret-32-bytes-minimum',
                    },
                );
                assert.equal(response.success, true);
                assert.equal(response.source, 'first-party');
                assert.equal(response.data?.title, 'Relay Art');
                assert.equal(response.data?.authorName, 'Artist Name');
                assert.equal(response.data?.authorHandle, '@artist_handle');
                assert.equal(response.data?.authorUrl, 'https://www.pixiv.net/en/users/42');
                assert.equal(
                    response.data?.authorAvatar,
                    'https://fixembed.app/proxy/pixiv?url=https%3A%2F%2Fi.pximg.net%2Favatar_170.jpg',
                );
                assert.deepEqual(response.data?.images, [
                    'https://fixembed.app/proxy/pixiv?url=https%3A%2F%2Fi.pximg.net%2Fpage-1.jpg',
                    'https://fixembed.app/proxy/pixiv?url=https%3A%2F%2Fi.pximg.net%2Fpage-2.jpg',
                ]);
                assert.equal(response.data?.timestamp, '2026-07-13T00:00:00.000Z');
                assert.equal(response.data?.stats, '💬 12 ❤️ 345 👁️ 6.8K 🔖 234');
                assert.equal(
                    requested.includes('https://relay.fixembed.test/pixiv/456'),
                    true,
                );
                assert.match(
                    relayRequestHeaders?.get('X-FixEmbed-Timestamp') || '',
                    /^\d{10}$/,
                );
                assert.match(
                    relayRequestHeaders?.get('X-FixEmbed-Authorization') || '',
                    /^v1=[0-9a-f]{64}$/,
                );
            } finally { globalThis.fetch = originalFetch; }
        },
    },
    {
        name: 'pixivHandler rejects relay payloads with mismatched identity or untrusted media',
        run: async () => {
            const originalFetch = globalThis.fetch;
            globalThis.fetch = async (input) => {
                const requestedUrl = String(input);
                if (requestedUrl.includes('pixiv.net/ajax/illust/')
                    || requestedUrl.startsWith('https://embed.pixiv.net/oembed.php?')
                    || requestedUrl.includes('phixiv.net/')) {
                    return new Response('blocked', { status: 403 });
                }
                if (requestedUrl === 'https://relay.fixembed.test/pixiv/456') {
                    return signedRelayResponse({
                        version: 1,
                        id: '999',
                        title: 'Impostor',
                        authorName: 'Impostor',
                        authorId: '42',
                        authorAvatar: 'https://evil.example/avatar.jpg',
                        images: ['https://evil.example/image.jpg'],
                    }, 'test-relay-secret-32-bytes-minimum');
                }
                return new Response('blocked', { status: 403 });
            };
            try {
                const response = await pixivHandler.handle(
                    'https://www.pixiv.net/artworks/456',
                    {
                        ...env,
                        PIXIV_RELAY_URL: 'https://relay.fixembed.test',
                        PIXIV_RELAY_SECRET: 'test-relay-secret-32-bytes-minimum',
                    },
                );
                assert.equal(response.data?.title, 'Pixiv Artwork');
                assert.equal(response.data?.authorName, undefined);
                assert.equal(response.data?.authorAvatar, undefined);
                assert.equal(response.data?.image, undefined);
                assert.equal(response.data?.images, undefined);
            } finally { globalThis.fetch = originalFetch; }
        },
    },
    {
        name: 'pixivHandler omits blank relay author handles',
        run: async () => {
            const originalFetch = globalThis.fetch;
            globalThis.fetch = async (input) => {
                const requestedUrl = String(input);
                if (requestedUrl.includes('pixiv.net/ajax/illust/')
                    || requestedUrl.startsWith('https://embed.pixiv.net/oembed.php?')) {
                    return new Response('blocked', { status: 403 });
                }
                if (requestedUrl === 'https://relay.fixembed.test/pixiv/456') {
                    return signedRelayResponse({
                        version: 1,
                        id: '456',
                        title: 'Relay Art',
                        authorName: 'Artist Name',
                        authorHandle: '   ',
                        authorId: '42',
                        authorAvatar: 'https://i.pximg.net/avatar_170.jpg',
                        images: ['https://i.pximg.net/page-1.jpg'],
                    }, 'test-relay-secret-32-bytes-minimum');
                }
                return new Response('blocked', { status: 403 });
            };
            try {
                const response = await pixivHandler.handle(
                    'https://www.pixiv.net/artworks/456',
                    {
                        ...env,
                        PIXIV_RELAY_URL: 'https://relay.fixembed.test',
                        PIXIV_RELAY_SECRET: 'test-relay-secret-32-bytes-minimum',
                    },
                );
                assert.equal(response.success, true);
                assert.equal(response.data?.authorHandle, undefined);
            } finally { globalThis.fetch = originalFetch; }
        },
    },
    {
        name: 'pixivHandler preserves creator identity in Phixiv fallback cards',
        run: async () => {
            const originalFetch = globalThis.fetch;
            const requested: string[] = [];
            globalThis.fetch = async (input, init) => {
                const requestedUrl = String(input);
                requested.push(requestedUrl);
                if (requestedUrl.includes('pixiv.net/ajax/illust/')) {
                    return new Response('blocked', { status: 403 });
                }
                if (requestedUrl.startsWith('https://embed.pixiv.net/oembed.php?')) {
                    return Response.json({
                        version: '1.0',
                        type: 'rich',
                        title: 'Pixiv Artwork',
                        thumbnail_url: 'https://embed.pixiv.net/decorate.php?illust_id=456',
                    });
                }
                if (requestedUrl.includes('/api/v1/statuses/6674477088768')) {
                    assert.equal(init?.redirect, 'manual');
                    return Response.json({
                        id: '456',
                        created_at: '2026-07-13T00:00:00.000Z',
                        account: {
                            id: '42',
                            display_name: 'Artist Name',
                            avatar: 'https://www.phixiv.net/i/user-profile/avatar_50.png',
                        },
                    });
                }
                assert.equal(init?.redirect, 'manual');
                return new Response(`
                    <meta property="og:title" content="Fallback Art by (@artist)">
                    <meta property="og:image" content="https://www.phixiv.net/i/fallback.jpg?mdate=1783900800">
                    <meta property="og:description" content="Fallback &amp;#44; caption">
                    <link rel="alternate" type="application/activity+json"
                        href="https://www.phixiv.net/users/42/statuses/6674477088768">
                `, { status: 200, headers: { 'Content-Type': 'text/html' } });
            };
            try {
                const response = await pixivHandler.handle('https://www.pixiv.net/artworks/456', env);
                assert.equal(response.source, 'fallback');
                assert.equal(response.data?.authorName, 'Artist Name');
                assert.equal(response.data?.authorHandle, undefined);
                assert.equal(response.data?.authorUrl, 'https://www.pixiv.net/en/users/42');
                assert.equal(
                    response.data?.authorAvatar,
                    'https://fixembed.app/proxy/pixiv?url=https%3A%2F%2Fwww.phixiv.net%2Fi%2Fuser-profile%2Favatar_170.png',
                );
                assert.equal(
                    response.data?.image,
                    'https://fixembed.app/proxy/pixiv?url=https%3A%2F%2Fwww.phixiv.net%2Fi%2Ffallback.jpg%3Fmdate%3D1783900800',
                );
                assert.equal(response.data?.description, 'Fallback , caption');
                assert.equal(response.data?.timestamp, '2026-07-13T00:00:00.000Z');
                assert.equal(
                    requested.some(url => url.includes('/api/v1/statuses/6674477088768')),
                    true,
                );
            } finally { globalThis.fetch = originalFetch; }
        },
    },
    {
        name: 'pixivHandler recovers a complete card when Phixiv HTML is blocked',
        run: async () => {
            const originalFetch = globalThis.fetch;
            const requested: string[] = [];
            globalThis.fetch = async (input) => {
                const requestedUrl = String(input);
                requested.push(requestedUrl);
                if (requestedUrl.includes('pixiv.net/ajax/illust/')) {
                    return new Response('blocked', { status: 403 });
                }
                if (requestedUrl.startsWith('https://embed.pixiv.net/oembed.php?')) {
                    return new Response('blocked', { status: 403 });
                }
                if (requestedUrl.startsWith('https://www.phixiv.net/api/v1/statuses/')) {
                    return new Response('blocked', { status: 403 });
                }
                if (requestedUrl.startsWith('https://phixiv.net/api/v1/statuses/29884416')) {
                    return Response.json({
                        id: '456',
                        created_at: '2026-07-13T00:00:00.000Z',
                        content: [
                            '<strong><a href="https://www.pixiv.net/en/artworks/456">Activity Art</a></strong>',
                            'by <a href="https://www.pixiv.net/users/42">Artist Name</a>',
                            'Recovered caption',
                        ].join('<br />'),
                        account: {
                            id: '42',
                            display_name: 'Artist Name',
                            avatar_static: 'https://www.phixiv.net/i/user-profile/avatar_50.png',
                        },
                        media_attachments: [{
                            type: 'image',
                            url: 'https://www.phixiv.net/i/activity-image.jpg',
                            preview_url: 'https://www.phixiv.net/i/activity-preview.jpg',
                        }],
                    });
                }
                return new Response('blocked', { status: 403 });
            };
            try {
                const response = await pixivHandler.handle('https://www.pixiv.net/artworks/456', env);
                assert.equal(response.source, 'fallback');
                assert.equal(response.data?.title, 'Activity Art');
                assert.equal(response.data?.description, 'Recovered caption');
                assert.equal(response.data?.authorName, 'Artist Name');
                assert.equal(response.data?.authorUrl, 'https://www.pixiv.net/en/users/42');
                assert.equal(
                    response.data?.authorAvatar,
                    'https://fixembed.app/proxy/pixiv?url=https%3A%2F%2Fwww.phixiv.net%2Fi%2Fuser-profile%2Favatar_170.png',
                );
                assert.equal(
                    response.data?.image,
                    'https://fixembed.app/proxy/pixiv?url=https%3A%2F%2Fwww.phixiv.net%2Fi%2Factivity-image.jpg',
                );
                assert.equal(response.data?.timestamp, '2026-07-13T00:00:00.000Z');
                assert.equal(
                    requested.some(url => url.startsWith('https://phixiv.net/api/v1/statuses/29884416')),
                    true,
                );
            } finally { globalThis.fetch = originalFetch; }
        },
    },
    {
        name: 'pixivHandler rejects mismatched Phixiv creator identity',
        run: async () => {
            const originalFetch = globalThis.fetch;
            globalThis.fetch = async (input) => {
                const requestedUrl = String(input);
                if (requestedUrl.includes('pixiv.net/ajax/illust/')) {
                    return new Response('blocked', { status: 403 });
                }
                if (requestedUrl.startsWith('https://embed.pixiv.net/oembed.php?')) {
                    return new Response('blocked', { status: 403 });
                }
                if (requestedUrl.includes('/api/v1/statuses/123456789')) {
                    return Response.json({
                        id: 'different-artwork',
                        account: {
                            id: '42',
                            display_name: 'Impostor',
                            avatar: 'https://www.phixiv.net/i/user-profile/impostor_50.png',
                        },
                    });
                }
                return new Response(`
                    <meta property="og:title" content="Fallback Art by (@artist)">
                    <meta property="og:image" content="https://www.phixiv.net/i/fallback.jpg">
                    <link rel="alternate" type="application/activity+json"
                        href="https://www.phixiv.net/users/42/statuses/123456789">
                `, { status: 200, headers: { 'Content-Type': 'text/html' } });
            };
            try {
                const response = await pixivHandler.handle('https://www.pixiv.net/artworks/456', env);
                assert.equal(response.source, 'fallback');
                assert.equal(response.data?.authorName, 'artist');
                assert.equal(response.data?.authorUrl, undefined);
                assert.equal(response.data?.authorAvatar, undefined);
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
        name: 'redditHandler upgrades low-resolution subreddit icons from community metadata',
        run: async () => {
            const originalFetch = globalThis.fetch;
            globalThis.fetch = async (input) => {
                const url = String(input);
                if (url.includes('/about.json')) {
                    return new Response(JSON.stringify({
                        data: {
                            community_icon: 'https://styles.redditmedia.com/t5_2t1qf/styles/communityIcon_hd.png?width=256&amp;s=signed',
                        },
                    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
                return new Response(JSON.stringify([{
                    data: { children: [{ data: {
                        title: 'usage limits reset for the 5th time today',
                        selftext: '',
                        author: 'Distinct_Ingenuity21',
                        subreddit: 'codex',
                        url: 'https://www.reddit.com/r/codex/comments/1utc8qv/',
                        permalink: '/r/codex/comments/1utc8qv/usage_limits_reset_for_the_5th_time_today/',
                        thumbnail: 'self',
                        is_video: false,
                        created_utc: 1783900800,
                        score: 218,
                        num_comments: 75,
                        sr_detail: {
                            community_icon: 'https://styles.redditmedia.com/t5_2t1qf/styles/communityIcon_small.png?width=64&amp;height=64&amp;s=signed',
                        },
                    } }] },
                }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
            };

            try {
                const response = await redditHandler.handle(
                    'https://www.reddit.com/r/codex/comments/1utc8qv/usage_limits_reset_for_the_5th_time_today/',
                    env,
                );

                assert.equal(response.success, true);
                assert.equal(
                    response.data?.authorAvatar,
                    'https://styles.redditmedia.com/t5_2t1qf/styles/communityIcon_hd.png?width=256&s=signed',
                );
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
                    profile_image_url_https: 'https://pbs.twimg.com/profile_images/openai_normal.jpg',
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
                assert.equal(
                    response.data?.authorAvatar,
                    'https://pbs.twimg.com/profile_images/openai.jpg',
                );
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
                                            extended_entities: { media: [{
                                                type: 'animated_gif',
                                                media_url_https: 'https://pbs.twimg.com/media/quoted-gif.jpg',
                                                video_info: {
                                                    aspect_ratio: [1, 1],
                                                    variants: [{
                                                        bitrate: 832000,
                                                        content_type: 'video/mp4',
                                                        url: 'https://video.twimg.com/quoted-gif.mp4',
                                                    }],
                                                },
                                            }] },
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
                const quote = response.data?.sections?.find((section) => section.kind === 'quote');
                assert.deepEqual(quote, {
                    kind: 'quote',
                    title: 'Quoted post',
                    body: 'Quoted post body',
                    url: 'https://x.com/quoted/status/1999999999999999999',
                    authorName: 'Quoted Author',
                    authorHandle: '@quoted',
                    authorUrl: 'https://x.com/quoted',
                    authorAvatar: 'https://pbs.twimg.com/profile_images/quoted.jpg',
                    images: undefined,
                    video: {
                        url: 'https://video.twimg.com/quoted-gif.mp4',
                        width: 1280,
                        height: 1280,
                        thumbnail: 'https://pbs.twimg.com/media/quoted-gif.jpg',
                        mediaType: 'gif',
                    },
                });
                assert.match(response.data?.stats || '', /20/);
                assert.doesNotMatch(response.data?.stats || '', /25/);

                const html = generateEmbedHTML(response.data!, 'Discordbot/2.0');
                assert.match(html, /Yes.*75%/s);
                assert.match(html, /Quoted post.*Quoted Author \(@quoted\).*Quoted post body/s);
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
        name: 'twitterHandler preserves animated GIF identity and playable media',
        run: async () => {
            const originalFetch = globalThis.fetch;
            globalThis.fetch = async () => new Response(JSON.stringify({
                __typename: 'Tweet',
                id_str: '1234567890',
                text: 'An animated reaction.',
                user: {
                    name: 'GIF Author',
                    screen_name: 'gifauthor',
                    profile_image_url_https: 'https://pbs.twimg.com/profile_images/gifauthor.jpg',
                },
                created_at: '2026-07-12T00:00:00.000Z',
                mediaDetails: [{
                    type: 'animated_gif',
                    media_url_https: 'https://pbs.twimg.com/media/reaction.jpg',
                    video_info: {
                        aspect_ratio: [16, 9],
                        variants: [{
                            bitrate: 832000,
                            content_type: 'video/mp4',
                            url: 'https://video.twimg.com/tweet_video/reaction.mp4?tag=12',
                        }],
                    },
                }],
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });

            try {
                const response = await twitterHandler.handle(
                    'https://x.com/gifauthor/status/1234567890',
                    env,
                );

                assert.equal(response.data?.video?.url, 'https://gif.fxtwitter.com/tweet_video/reaction.gif');
                assert.equal(response.data?.video?.mediaType, 'gif');
            } finally {
                globalThis.fetch = originalFetch;
            }
        },
    },
    {
        name: 'twitterHandler does not rewrite animated media from untrusted hosts',
        run: async () => {
            const originalFetch = globalThis.fetch;
            globalThis.fetch = async () => new Response(JSON.stringify({
                __typename: 'Tweet',
                id_str: '1234567890',
                text: 'Untrusted media URL.',
                user: { name: 'GIF Author', screen_name: 'gifauthor' },
                mediaDetails: [{
                    type: 'animated_gif',
                    media_url_https: 'https://pbs.twimg.com/media/reaction.jpg',
                    video_info: {
                        aspect_ratio: [1, 1],
                        variants: [{
                            content_type: 'video/mp4',
                            url: 'https://untrusted.example/tweet_video/reaction.mp4',
                        }],
                    },
                }],
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });

            try {
                const response = await twitterHandler.handle(
                    'https://x.com/gifauthor/status/1234567890',
                    env,
                );
                assert.equal(
                    response.data?.video?.url,
                    'https://untrusted.example/tweet_video/reaction.mp4',
                );
            } finally {
                globalThis.fetch = originalFetch;
            }
        },
    },
    {
        name: 'twitterHandler promotes quote media for shareable links without losing provenance',
        run: async () => {
            const originalFetch = globalThis.fetch;
            globalThis.fetch = async () => new Response(JSON.stringify({
                __typename: 'Tweet',
                id_str: '1234567890',
                text: 'Main post without media.',
                user: {
                    name: 'Primary Author',
                    screen_name: 'primary',
                    profile_image_url_https: 'https://pbs.twimg.com/profile_images/primary.jpg',
                },
                created_at: '2026-07-12T00:00:00.000Z',
                quote: {
                    id_str: '9876543210',
                    text: 'Quoted post with media.',
                    user: {
                        name: 'Quoted Author',
                        screen_name: 'quoted',
                        profile_image_url_https: 'https://pbs.twimg.com/profile_images/quoted.jpg',
                    },
                    mediaDetails: [{
                        type: 'photo',
                        media_url_https: 'https://pbs.twimg.com/media/quoted.jpg',
                    }],
                },
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });

            try {
                const response = await twitterHandler.handle(
                    'https://x.com/primary/status/1234567890',
                    env,
                );
                const quote = response.data?.sections?.find((section) => section.kind === 'quote');

                assert.equal(response.data?.image, 'https://pbs.twimg.com/media/quoted.jpg');
                assert.equal(response.data?.mediaOrigin, 'quote');
                assert.deepEqual(quote?.images, ['https://pbs.twimg.com/media/quoted.jpg']);
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
                const payload = await response.json() as { source?: string; data?: {
                    description?: string;
                    stats?: string;
                    images?: string[];
                } };

                assert.equal(response.status, 200);
                assert.equal(response.headers.get('X-FixEmbed-Cache'), null);
                assert.equal(response.headers.get('Cache-Control'), null);
                assert.equal(payload.source, 'first-party');
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
        name: '/api/embed reuses successful edge entries without mixing render options',
        run: async () => {
            const originalFetch = globalThis.fetch;
            const originalCaches = Object.getOwnPropertyDescriptor(globalThis, 'caches');
            const entries = new Map<string, Response>();
            const cacheKeys: string[] = [];
            const pendingWrites: Promise<unknown>[] = [];
            let upstreamRequests = 0;
            const cacheKey = (key: Request | string) => typeof key === 'string' ? key : key.url;
            const executionContext = {
                waitUntil(promise: Promise<unknown>) { pendingWrites.push(promise); },
                passThroughOnException() {},
            } as ExecutionContext;

            Object.defineProperty(globalThis, 'caches', {
                configurable: true,
                value: {
                    async open() {
                        return {
                            async match(key: Request | string) {
                                const response = entries.get(cacheKey(key));
                                const cached = response?.clone();
                                cached?.headers.set('Cache-Control', 'public, max-age=14400');
                                return cached;
                            },
                            async put(key: Request | string, response: Response) {
                                cacheKeys.push(cacheKey(key));
                                entries.set(cacheKey(key), response.clone());
                            },
                        };
                    },
                },
            });
            globalThis.fetch = async () => {
                upstreamRequests += 1;
                return Response.json({
                    __typename: 'Tweet',
                    id_str: '1234567890',
                    text: 'Cached card',
                    lang: 'en',
                    user: { name: 'Cache Author', screen_name: 'cache_author' },
                    created_at: '2026-07-16T00:00:00.000Z',
                });
            };

            try {
                const cacheEnv = { ...env, ENABLE_CACHE: 'true', CACHE_TTL: '300' };
                const source = encodeURIComponent('https://x.com/cache_author/status/1234567890');
                const first = await app.request(
                    `/api/embed?url=${source}&mode=gallery`, {}, cacheEnv, executionContext,
                );
                await Promise.all(pendingWrites.splice(0));
                const requestsAfterFirst = upstreamRequests;
                const second = await app.request(
                    `/api/embed?url=${source}&mode=gallery`, {}, cacheEnv, executionContext,
                );
                const requestsAfterHit = upstreamRequests;
                const differentMode = await app.request(
                    `/api/embed?url=${source}&mode=mosaic`, {}, cacheEnv, executionContext,
                );
                const translated = await app.request(
                    `/api/embed?url=${source}&mode=gallery&lang=es`, {}, cacheEnv, executionContext,
                );
                const conformance = await app.request(
                    `/api/embed?url=${source}&mode=gallery&_conformance=probe-123`,
                    {},
                    cacheEnv,
                    executionContext,
                );
                await Promise.all(pendingWrites.splice(0));

                assert.equal(first.headers.get('X-FixEmbed-Cache'), 'MISS');
                assert.equal(second.headers.get('X-FixEmbed-Cache'), 'HIT');
                assert.equal(differentMode.headers.get('X-FixEmbed-Cache'), 'MISS');
                assert.equal(translated.headers.get('X-FixEmbed-Cache'), 'MISS');
                assert.equal(conformance.headers.get('X-FixEmbed-Cache'), null);
                assert.equal(first.headers.get('Cache-Control'), 'no-store');
                assert.equal(second.headers.get('Cache-Control'), 'no-store');
                assert.equal(requestsAfterHit, requestsAfterFirst);
                assert.ok(upstreamRequests > requestsAfterHit + 1);
                assert.equal(cacheKeys.length, 3);
                assert.equal(
                    Array.from(entries.values()).every((entry) => (
                        entry.headers.get('Cache-Control') === 'public, max-age=0, s-maxage=300'
                    )),
                    true,
                );
                assert.equal(cacheKeys.some((key) => key.includes('cache_author')), false);
            } finally {
                globalThis.fetch = originalFetch;
                if (originalCaches) Object.defineProperty(globalThis, 'caches', originalCaches);
                else delete (globalThis as { caches?: unknown }).caches;
            }
        },
    },
    {
        name: '/api/embed never caches failed card builds',
        run: async () => {
            const originalFetch = globalThis.fetch;
            const originalCaches = Object.getOwnPropertyDescriptor(globalThis, 'caches');
            const entries = new Map<string, Response>();
            const pendingWrites: Promise<unknown>[] = [];
            let upstreamRequests = 0;
            const cacheKey = (key: Request | string) => typeof key === 'string' ? key : key.url;
            const executionContext = {
                waitUntil(promise: Promise<unknown>) { pendingWrites.push(promise); },
                passThroughOnException() {},
            } as ExecutionContext;

            Object.defineProperty(globalThis, 'caches', {
                configurable: true,
                value: {
                    async open() {
                        return {
                            async match(key: Request | string) {
                                return entries.get(cacheKey(key))?.clone();
                            },
                            async put(key: Request | string, response: Response) {
                                entries.set(cacheKey(key), response.clone());
                            },
                        };
                    },
                },
            });
            globalThis.fetch = async () => {
                upstreamRequests += 1;
                return new Response('unavailable', { status: 503 });
            };

            try {
                const cacheEnv = { ...env, ENABLE_CACHE: 'true', CACHE_TTL: '300' };
                const source = encodeURIComponent('https://x.com/cache_failure/status/1234567890');
                const first = await app.request(`/api/embed?url=${source}`, {}, cacheEnv, executionContext);
                await Promise.all(pendingWrites.splice(0));
                const requestsAfterFirst = upstreamRequests;
                const second = await app.request(`/api/embed?url=${source}`, {}, cacheEnv, executionContext);

                assert.equal(first.status, 500);
                assert.equal(second.status, 500);
                assert.ok(upstreamRequests > requestsAfterFirst);
                assert.equal(entries.size, 0);
            } finally {
                globalThis.fetch = originalFetch;
                if (originalCaches) Object.defineProperty(globalThis, 'caches', originalCaches);
                else delete (globalThis as { caches?: unknown }).caches;
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
        name: 'Discord X animated GIF activity exposes a real looping GIF image',
        run: async () => {
            const sourceUrl = 'https://x.com/gifauthor/status/1234567890';
            const encoded = encodeActivitySource(sourceUrl);
            const originalFetch = globalThis.fetch;
            globalThis.fetch = async () => new Response(JSON.stringify({
                __typename: 'Tweet',
                id_str: '1234567890',
                text: 'An animated reaction',
                user: { name: 'GIF Author', screen_name: 'gifauthor' },
                mediaDetails: [{
                    type: 'animated_gif',
                    media_url_https: 'https://pbs.twimg.com/reaction.jpg',
                    video_info: {
                        aspect_ratio: [1, 1],
                        variants: [{
                            content_type: 'video/mp4',
                            url: 'https://video.twimg.com/tweet_video/reaction.mp4',
                        }],
                    },
                }],
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            try {
                const response = await app.request('/api/v1/statuses/' + encoded, {}, env);
                assert.equal(response.status, 200);
                const activity = await response.json() as any;
                assert.equal(activity.media_attachments[0].type, 'image');
                assert.equal(activity.media_attachments[0].url, 'https://gif.fxtwitter.com/tweet_video/reaction.gif');
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
                            translation: {
                                text: 'Texto traducido',
                                source_lang: 'en',
                                target_lang: 'es',
                            },
                            author: {
                                name: 'Kuriimu',
                                screen_name: 'kuriimu0203',
                                avatar_url: 'https://pbs.twimg.com/profile_images/avatar_normal.jpg',
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
                                    type: 'gif',
                                    url: 'https://video.twimg.com/video.mp4',
                                    thumbnail_url: 'https://pbs.twimg.com/media/video.jpg',
                                    width: 1280,
                                    height: 720,
                                }],
                            },
                            poll: {
                                choices: [
                                    { label: 'Yes', count: 75, percentage: 75 },
                                    { label: 'No', count: 25, percentage: 25 },
                                ],
                                total_votes: 100,
                                ends_at: '2026-07-14T00:00:00Z',
                                time_left_en: 'Final results',
                            },
                            quote: {
                                id: '1999999999999999999',
                                url: 'https://x.com/quoted/status/1999999999999999999',
                                text: 'Fallback quoted post',
                                author: {
                                    name: 'Quoted Author',
                                    screen_name: 'quoted',
                                    avatar_url: 'https://pbs.twimg.com/profile_images/quoted_normal.jpg',
                                },
                                media: {
                                    photos: [{
                                        type: 'photo',
                                        url: 'https://pbs.twimg.com/media/quoted.jpg',
                                        width: 1200,
                                        height: 800,
                                    }],
                                },
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
                const response = await app.request(`/api/embed?url=${source}&lang=es`, {}, env);
                const body = await response.json() as any;

                assert.equal(response.status, 200);
                assert.equal(body.success, true);
                assert.equal(body.source, 'fallback');
                assert.equal(body.data.authorHandle, '@kuriimu0203');
                assert.equal(
                    body.data.authorAvatar,
                    'https://pbs.twimg.com/profile_images/avatar.jpg',
                );
                assert.equal(body.data.description, 'Fallback post text\n\n🌐 Translation (ES): Texto traducido');
                assert.equal(body.data.image, 'https://pbs.twimg.com/media/video.jpg');
                assert.deepEqual(body.data.images, ['https://pbs.twimg.com/media/photo.jpg?name=orig']);
                assert.equal(body.data.video.url, 'https://video.twimg.com/video.mp4');
                assert.equal(body.data.video.mediaType, 'gif');
                assert.deepEqual(body.data.sections.map((section: any) => section.kind), ['poll', 'quote']);
                assert.deepEqual(body.data.sections[1].images, ['https://pbs.twimg.com/media/quoted.jpg']);
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
        name: 'status report cache reuses a recent verified refresh',
        run: async () => {
            let now = 1_000;
            let refreshes = 0;
            const cache = new StatusReportCache<{ revision: number }>({
                freshTtlMs: 60_000,
                staleTtlMs: 900_000,
                now: () => now,
            });

            const first = await cache.get(async () => ({ revision: ++refreshes }));
            now += 59_999;
            const second = await cache.get(async () => ({ revision: ++refreshes }));

            assert.deepEqual(first, {
                value: { revision: 1 },
                state: 'miss',
                stale: false,
            });
            assert.deepEqual(second, {
                value: { revision: 1 },
                state: 'hit',
                stale: false,
            });
            assert.equal(refreshes, 1);
        },
    },
    {
        name: 'status report cache coalesces concurrent upstream refreshes',
        run: async () => {
            let finishRefresh!: (value: { revision: number }) => void;
            let refreshes = 0;
            const cache = new StatusReportCache<{ revision: number }>();
            const refresh = () => {
                refreshes += 1;
                return new Promise<{ revision: number }>((resolve) => {
                    finishRefresh = resolve;
                });
            };

            const first = cache.get(refresh);
            const second = cache.get(refresh);
            finishRefresh({ revision: 1 });

            assert.deepEqual(await first, {
                value: { revision: 1 },
                state: 'miss',
                stale: false,
            });
            assert.deepEqual(await second, {
                value: { revision: 1 },
                state: 'coalesced',
                stale: false,
            });
            assert.equal(refreshes, 1);
        },
    },
    {
        name: 'status report cache serves recent verified data after refresh failure',
        run: async () => {
            let now = 1_000;
            const cache = new StatusReportCache<{ revision: number }>({
                freshTtlMs: 60_000,
                staleTtlMs: 900_000,
                now: () => now,
            });
            await cache.get(async () => ({ revision: 1 }));
            now += 60_001;

            const recovered = await cache.get(() => {
                throw new Error('upstream unavailable');
            });

            assert.deepEqual(recovered, {
                value: { revision: 1 },
                state: 'stale',
                stale: true,
            });
            now += 900_000;
            await assert.rejects(
                cache.get(async () => { throw new Error('still unavailable'); }),
                /still unavailable/,
            );
        },
    },
    {
        name: 'status probe deadline bounds a handler that never settles',
        run: async () => {
            await assert.rejects(
                withStatusProbeDeadline(new Promise(() => {}), 5),
                StatusProbeTimeoutError,
            );
        },
    },
    {
        name: '/api/status reuses one verified probe fan-out within the refresh window',
        run: async () => {
            const originalFetch = globalThis.fetch;
            const originalProbes = STATUS_PROBES.splice(0);
            let upstreamRequests = 0;
            STATUS_PROBES.push({
                platform: 'Twitter/X',
                sampleUrl: 'https://x.com/status_cache/status/1234567890',
            });
            globalThis.fetch = async () => {
                upstreamRequests += 1;
                return Response.json({
                    __typename: 'Tweet',
                    id_str: '1234567890',
                    text: 'Status cache health sample',
                    lang: 'en',
                    user: { name: 'Status Cache', screen_name: 'status_cache' },
                    created_at: '2026-07-16T00:00:00.000Z',
                });
            };

            try {
                const first = await app.request('/api/status', {}, env);
                const requestsAfterFirst = upstreamRequests;
                const second = await app.request('/api/status', {}, env);
                const secondPayload = await second.json() as { stale?: boolean };

                assert.equal(first.status, 200);
                assert.equal(first.headers.get('X-FixEmbed-Status-Cache'), 'MISS');
                assert.equal(second.headers.get('X-FixEmbed-Status-Cache'), 'HIT');
                assert.equal(second.headers.get('Cache-Control'), 'no-store');
                assert.equal(secondPayload.stale, false);
                assert.equal(upstreamRequests, requestsAfterFirst);
            } finally {
                globalThis.fetch = originalFetch;
                STATUS_PROBES.splice(0, STATUS_PROBES.length, ...originalProbes);
            }
        },
    },
    {
        name: 'status probes cover every handler and exercise representative platform samples',
        run: () => {
            assert.equal(STATUS_PROBES.length, 9);
            assert.equal(
                new Set(STATUS_PROBES.map((probe) => probe.platform)).size,
                STATUS_PROBES.length,
            );
            for (const probe of STATUS_PROBES) {
                assert.ok(findHandler(probe.sampleUrl), probe.platform);
            }
            const youtube = STATUS_PROBES.find((probe) => probe.platform === 'YouTube');
            assert.match(youtube?.sampleUrl || '', /youtube\.com\/post\//);
            const instagram = STATUS_PROBES.find((probe) => probe.platform === 'Instagram');
            assert.equal(
                instagram?.sampleUrl,
                'https://www.instagram.com/reel/DaneAqzR3eV/',
            );
            const threads = STATUS_PROBES.find((probe) => probe.platform === 'Threads');
            assert.equal(
                threads?.sampleUrl,
                'https://www.threads.com/@threads/post/DDKltrOTjJl',
            );
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
        name: 'status probes flag successful placeholder cards as degraded',
        run: () => {
            const assessment = assessProbeResult({
                success: true,
                source: 'first-party',
                data: {
                    title: 'Thread',
                    description: '',
                },
            }, 120);

            assert.equal(assessment.status, 'degraded');
            assert.equal(assessment.mode, 'first-party');
            assert.match(assessment.notice || '', /basic link card/i);
            assert.equal(assessment.responseCode, 200);
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
        name: 'install redirects accept only bounded contexts and sources',
        run: async () => {
            assert.equal(parseInstallContext('user'), 'user');
            assert.equal(parseInstallContext('server'), 'server');
            assert.equal(parseInstallContext('admin'), null);
            assert.equal(parseInstallSource('home-hero'), 'home-hero');
            assert.equal(parseInstallSource('raw-user-input'), null);

            const userResponse = await app.request('/install/user/home-hero', {}, env);
            assert.equal(userResponse.status, 302);
            assert.equal(userResponse.headers.get('location'), discordInstallUrl('user'));

            const serverResponse = await app.request('/install/server/home-hero', {}, env);
            assert.equal(serverResponse.status, 302);
            assert.equal(serverResponse.headers.get('location'), discordInstallUrl('server'));
            assert.equal(
                new URL(serverResponse.headers.get('location') || '').searchParams.get('scope'),
                'bot applications.commands',
            );
            assert.equal(
                new URL(serverResponse.headers.get('location') || '').searchParams.get('permissions'),
                '274878295040',
            );

            assert.equal((await app.request('/install/admin/home-hero', {}, env)).status, 404);
            assert.equal((await app.request('/install/user/unbounded', {}, env)).status, 404);
        },
    },
    {
        name: 'homepage makes account install primary and server install secondary',
        run: () => {
            assert.match(indexHtml, /href="\/install\/user\/home-hero"[^>]*>Install to My Account</);
            assert.match(indexHtml, /href="\/install\/server\/home-hero"[^>]*>Add to Server</);
            assert.match(indexHtml, /Use FixEmbed anywhere/i);
            assert.match(privacyHtml, /fixed install-source label/i);
            assert.doesNotMatch(privacyHtml, /user IDs?[^<]*install-source/i);
        },
    },
    {
        name: 'platform landing pages provide focused install paths and metadata',
        run: async () => {
            const expectations = [
                ['twitter', 'X / Twitter', 'quoted posts'],
                ['instagram', 'Instagram', 'Reels'],
                ['reddit', 'Reddit', 'subreddit'],
            ] as const;

            for (const [slug, platformName, capability] of expectations) {
                const html = platformLandingHtml(slug);
                assert.match(html, new RegExp(`<title>[^<]*${platformName.replace(' / ', ' \\/ ')}[^<]*<\\/title>`, 'i'));
                assert.match(html, new RegExp(capability, 'i'));
                assert.match(html, new RegExp(`/install/user/${slug}-landing`));
                assert.match(html, new RegExp(`/install/server/${slug}-landing`));

                const response = await app.request(`/${slug}`, {}, env);
                assert.equal(response.status, 200);
                assert.match(await response.text(), new RegExp(platformName.replace(' / ', ' \\/ '), 'i'));
            }
        },
    },
    {
        name: 'public website advertises YouTube and Pinterest support',
        run: () => {
            assert.match(indexHtml, /<h3>YouTube<\/h3>/);
            assert.match(indexHtml, /YouTube community posts/i);
            assert.match(docsHtml, /YouTube Community Posts/);
            assert.match(docsHtml, /youtube\.com\/post/);
            assert.match(indexHtml, /<h3>Pinterest<\/h3>/);
            assert.match(indexHtml, /full-size images and playable video/i);
            assert.match(docsHtml, /Pinterest Pins/);
            assert.match(docsHtml, /pin\.it/);
        },
    },
    {
        name: 'every public page offers AGPL source and credits the creator',
        run: () => {
            const publicPages = [
                indexHtml,
                tosHtml,
                privacyHtml,
                docsHtml,
                supportHtml,
                statusHtml,
                platformLandingHtml('twitter'),
                platformLandingHtml('instagram'),
                platformLandingHtml('reddit'),
            ];

            for (const page of publicPages) {
                assert.match(page, /Source \(AGPL-3\.0\)/);
                assert.match(page, /Kenneth Hendricks/);
            }
        },
    },
    {
        name: 'fallback acknowledgements use a responsive accessible directory',
        run: () => {
            assert.match(indexHtml, /class="credits-intro"/);
            assert.match(indexHtml, /class="credit-name">FxTwitter/);
            assert.match(indexHtml, /class="credit-purpose">X metadata fallback/);
            assert.match(indexHtml, /class="credits-note"/);
            assert.match(indexHtml, /rel="noopener noreferrer"/);
            assert.match(stylesCss, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
            assert.match(stylesCss, /\.credit-link:focus-visible/);
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
