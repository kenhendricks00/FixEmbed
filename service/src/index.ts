/**
 * FixEmbed Service - Main Entry Point
 * 
 * A unified embed service for Discord supporting:
 * Twitter/X, Reddit, YouTube, Bluesky, Instagram, Threads, Pixiv, Bilibili
 * 
 * Built with Hono + Cloudflare Workers
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { Env } from './types';
import { findHandler } from './handlers';
import { generateEmbedHTML, generateErrorHTML } from './utils/embed';

const app = new Hono<{ Bindings: Env }>();

// Middleware
app.use('*', cors());
app.use('*', logger());

// Health check
app.get('/', (c) => {
    return c.json({
        name: 'FixEmbed Service',
        version: '1.0.0',
        status: 'running',
        platforms: [
            'twitter', 'reddit', 'youtube', 'bluesky',
            'instagram', 'threads', 'pixiv', 'bilibili'
        ],
        usage: {
            'Discord bot': 'Use this service as a proxy to fix embeds',
            'Direct': 'GET /embed?url=<social-media-url>',
        },
    });
});

// Main embed endpoint
app.get('/embed', async (c) => {
    const url = c.req.query('url');
    const userAgent = c.req.header('User-Agent') || '';

    if (!url) {
        return c.json({ error: 'Missing url parameter' }, 400);
    }

    // Find handler for this URL
    const handler = findHandler(url);

    if (!handler) {
        // No handler found, redirect to original URL
        return c.redirect(url, 302);
    }

    try {
        const result = await handler.handle(url, c.env);

        if (!result.success) {
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

// API endpoint for embed data (JSON)
app.get('/api/embed', async (c) => {
    const url = c.req.query('url');

    if (!url) {
        return c.json({ error: 'Missing url parameter' }, 400);
    }

    const handler = findHandler(url);

    if (!handler) {
        return c.json({ error: 'Unsupported URL', supported: false }, 404);
    }

    try {
        const result = await handler.handle(url, c.env);

        if (!result.success) {
            return c.json({
                error: result.error || 'Failed to fetch embed',
                redirect: result.redirect,
            }, 500);
        }

        return c.json({
            success: true,
            platform: handler.name,
            data: result.data,
        });
    } catch (error) {
        return c.json({
            error: error instanceof Error ? error.message : 'Unknown error'
        }, 500);
    }
});

// Platform-specific routes (optional, for direct access)
// Example: /twitter/elonmusk/status/123456 or /instagram/https://instagram.com/reel/xxx
app.get('/:platform/*', async (c) => {
    const platform = c.req.param('platform');
    let path = c.req.path.slice(platform.length + 2); // Remove /:platform/

    // Check if path is a full URL (user passed full URL after platform)
    if (path.startsWith('http://') || path.startsWith('https://')) {
        // Redirect to embed endpoint with the full URL
        return c.redirect(`/embed?url=${encodeURIComponent(path)}`, 302);
    }

    // Map platform names to domains
    const platformDomains: Record<string, string> = {
        twitter: 'twitter.com',
        x: 'x.com',
        reddit: 'reddit.com',
        youtube: 'youtube.com',
        yt: 'youtube.com',
        bluesky: 'bsky.app',
        bsky: 'bsky.app',
        instagram: 'instagram.com',
        ig: 'instagram.com',
        threads: 'threads.net',
        pixiv: 'pixiv.net',
        bilibili: 'bilibili.com',
        b23: 'bilibili.com',
    };

    const domain = platformDomains[platform.toLowerCase()];

    if (!domain) {
        return c.json({ error: 'Unknown platform' }, 404);
    }

    // Reconstruct URL
    const originalUrl = `https://${domain}/${path}`;

    // Redirect to embed endpoint
    return c.redirect(`/embed?url=${encodeURIComponent(originalUrl)}`, 302);
});

// 404 handler
app.notFound((c) => {
    return c.json({ error: 'Not found' }, 404);
});

// Error handler
app.onError((err, c) => {
    console.error('Server error:', err);
    return c.json({ error: 'Internal server error' }, 500);
});

export default app;
