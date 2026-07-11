import assert from 'node:assert/strict';

import { findHandler } from '../src/handlers/index.ts';
import { twitterHandler } from '../src/handlers/twitter.ts';
import { instagramHandler } from '../src/handlers/instagram.ts';
import { youtubeHandler } from '../src/handlers/youtube.ts';
import { pixivHandler } from '../src/handlers/pixiv.ts';
import { bilibiliHandler } from '../src/handlers/bilibili.ts';
import { buildBlueskyContent } from '../src/handlers/bluesky.ts';
import type { Env } from '../src/types.ts';
import { assessProbeResult } from '../src/utils/status.ts';
import { statusHtml } from '../src/utils/static_site.ts';
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

const tests: TestCase[] = [
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
        name: 'instagramHandler uses Instagram embed data before external fallbacks',
        run: async () => {
            const originalFetch = globalThis.fetch;
            const requested: string[] = [];
            globalThis.fetch = async (input) => {
                requested.push(String(input));
                return new Response('<html><script>{"username":"creator","display_url":"https:\\/\\/scontent.example.com\\/photo.jpg","text":"Caption"}</script></html>', { status: 200 });
            };
            try {
                const response = await instagramHandler.handle('https://www.instagram.com/p/ABC123/', env);
                assert.equal(requested.length, 1);
                assert.match(requested[0], /^https:\/\/www\.instagram\.com\/p\/ABC123\/embed\/captioned\//);
                assert.equal(response.source, 'first-party');
                assert.equal(response.data?.image, 'https://scontent.example.com/photo.jpg');
            } finally { globalThis.fetch = originalFetch; }
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
