import assert from 'node:assert/strict';

import { findHandler } from '../src/handlers/index.ts';
import { twitterHandler } from '../src/handlers/twitter.ts';
import type { Env } from '../src/types.ts';
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
        name: 'twitterHandler redirects valid posts to FxTwitter',
        run: async () => {
            const response = await twitterHandler.handle('https://x.com/openai/status/1234567890', env);

            assert.equal(response.success, false);
            assert.equal(response.redirect, 'https://fxtwitter.com/openai/status/1234567890');
            assert.equal(response.error, 'Redirecting to FxTwitter');
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
