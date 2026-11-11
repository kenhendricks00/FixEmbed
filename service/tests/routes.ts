import assert from 'node:assert/strict';
import app from '../src/index.ts';
import { prepareEmbedRequest } from '../src/utils/embed_request.ts';

export const routeTests = [
    {
        name: 'composed embed routes preserve distinct missing and unsupported URL responses',
        async run() {
            for (const path of ['/embed', '/api/embed']) {
                const response = await app.request(path);
                assert.equal(response.status, 400);
                assert.deepEqual(await response.json(), { error: 'Missing url parameter' });
                assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
            }
            const url = encodeURIComponent('https://example.com/post');
            const html = await app.request(`/embed?url=${url}`);
            assert.equal(html.status, 302);
            assert.equal(html.headers.get('Location'), 'https://example.com/post');
            const json = await app.request(`/api/embed?url=${url}`);
            assert.equal(json.status, 404);
            assert.deepEqual(await json.json(), { error: 'Unsupported URL', supported: false });
        },
    },
    {
        name: 'retired diagnostics remain inaccessible after route composition',
        async run() {
            for (const platform of ['instagram', 'pixiv', 'youtube', 'bilibili']) {
                const response = await app.request(`/debug/${platform}`);
                assert.equal(response.status, 404);
                assert.deepEqual(await response.json(), { error: 'Not found' });
            }
        },
    },
    {
        name: 'embed requests isolate language and mode between requests',
        run() {
            const url = 'https://x.com/jack/status/20';
            const first = prepareEmbedRequest(url, 'ja', 'gallery');
            const second = prepareEmbedRequest(url, 'es', 'invalid');
            assert.ok(first);
            assert.ok(second);
            assert.deepEqual(first.options, { language: 'ja', mode: 'gallery' });
            assert.deepEqual(second.options, { language: 'es', mode: undefined });
            assert.equal(prepareEmbedRequest('https://example.com/post'), null);
        },
    },
    {
        name: 'composed media routes still validate missing media URLs',
        async run() {
            for (const path of ['/video/threads', '/proxy/pixiv', '/proxy/bilibili']) {
                const response = await app.request(path);
                assert.equal(response.status, 400);
            }
        },
    },
];
