/** Embeds routes. */

import { Hono } from 'hono';
import type { Env } from '../types.ts';
import { prepareEmbedRequest } from '../utils/embed_request.ts';
import { generateEmbedHTML, generateErrorHTML } from '../utils/embed.ts';
import {
    isCacheableEmbed,
    optionalExecutionContext,
    prepareEmbedCache,
    readEmbedCache,
    rememberEmbed,
    resolveEmbedThroughCache,
} from '../utils/embed_cache.ts';

const app = new Hono<{ Bindings: Env }>();

app.get('/embed', async (c) => {
    const url = c.req.query('url');
    const language = c.req.query('lang');
    const requestedMode = c.req.query('mode');
    const userAgent = c.req.header('User-Agent') || '';

    if (!url) {
        return c.json({ error: 'Missing url parameter' }, 400);
    }

    // Find handler for this URL
    const request = prepareEmbedRequest(url, language, requestedMode);

    if (!request) {
        // No handler found, redirect to original URL
        return c.redirect(url, 302);
    }

    try {
        const result = await resolveEmbedThroughCache(
            c.env,
            c.req.url,
            url,
            request,
            optionalExecutionContext(c),
        );

        if (!result.success) {
            // Unverified links get the same treatment as links with no handler.
            if (result.unsupported) {
                return c.redirect(url, 302);
            }
            // Handler failed, redirect if available
            if (result.redirect) {
                return c.redirect(result.redirect, 302);
            }
            return c.html(generateErrorHTML(result.error || 'Failed to fetch embed', url));
        }

        if (!result.data) {
            return c.redirect(url, 302);
        }

        // Check if this is a bot/crawler requesting embed data
        const isBotRequest = /discord|telegram|slack|facebook|twitter|linkedin|whatsapp/i.test(userAgent);

        if (isBotRequest) {
            // Return HTML with OG meta tags for embedding
            return c.html(generateEmbedHTML(result.data, userAgent));
        } else {
            // Human visitor - redirect to original
            return c.redirect(result.data.url, 302);
        }
    } catch (error) {
        console.error('Embed error:', error);
        return c.html(
            generateErrorHTML(error instanceof Error ? error.message : 'Unknown error', url)
        );
    }
});

app.get('/api/embed', async (c) => {
    const url = c.req.query('url');
    const language = c.req.query('lang');
    const requestedMode = c.req.query('mode');

    if (!url) {
        return c.json({ error: 'Missing url parameter' }, 400);
    }

    const request = prepareEmbedRequest(url, language, requestedMode);

    if (!request) {
        return c.json({ error: 'Unsupported URL', supported: false }, 404);
    }

    try {
        const cacheContext = await prepareEmbedCache(c.env, c.req.url, url, request.options);
        const cached = await readEmbedCache(cacheContext);
        if (cached) return cached;

        const result = await request.fetch(c.env);

        if (result.unsupported) {
            return c.json({ error: 'Unsupported URL', supported: false }, 404);
        }
        if (!result.success) {
            return c.json({
                error: result.error || 'Failed to fetch embed',
                redirect: result.redirect,
            }, 500);
        }

        const response = c.json({
            success: true,
            platform: request.platform,
            source: result.source,
            data: result.data,
        });
        // Missed translations and media-less cards are usually transient
        // upstream, so they are served but never pinned for the cache TTL.
        if (cacheContext && isCacheableEmbed(result)) {
            rememberEmbed(cacheContext, request.platform, result, optionalExecutionContext(c));
            response.headers.set('Cache-Control', 'no-store');
            response.headers.set('X-FixEmbed-Cache', 'MISS');
        }
        return response;
    } catch (error) {
        return c.json({
            error: error instanceof Error ? error.message : 'Unknown error'
        }, 500);
    }
});

export default app;
