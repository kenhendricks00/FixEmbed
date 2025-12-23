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

// Debug endpoint to test Instagram
app.get('/debug/instagram', async (c) => {
    const url = c.req.query('url') || 'https://www.instagram.com/reel/C05SEFntyFA/';

    const debugInfo: Record<string, unknown> = {
        inputUrl: url,
        steps: [],
    };

    try {
        // Step 1: Call Snapsave API
        const formData = new URLSearchParams();
        formData.append('url', url);

        const response = await fetch('https://snapsave.app/action.php?lang=en', {
            method: 'POST',
            headers: {
                'Accept': '*/*',
                'Content-Type': 'application/x-www-form-urlencoded',
                'Origin': 'https://snapsave.app',
                'Referer': 'https://snapsave.app/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
            body: formData,
        });

        (debugInfo.steps as string[]).push(`1. Snapsave API call: ${response.status} ${response.statusText}`);
        debugInfo.snapsaveStatus = response.status;

        const rawHtml = await response.text();
        debugInfo.rawHtmlLength = rawHtml.length;

        // Step 2: Check for decryption pattern and try decrypt
        const hasDecryptPattern = rawHtml.includes('decodeURIComponent(escape(r))}(');
        (debugInfo.steps as string[]).push(`2. Has decrypt pattern: ${hasDecryptPattern}`);
        debugInfo.hasDecryptPattern = hasDecryptPattern;

        // Step 3: Try embed HTML fallback
        const shortcode = url.match(/\/(p|reel|reels|tv)\/([^\/\?]+)/)?.[2] || 'C05SEFntyFA';
        const embedUrl = `https://www.instagram.com/p/${shortcode}/embed/captioned/`;
        const embedResponse = await fetch(embedUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
        });

        (debugInfo.steps as string[]).push(`3. Instagram embed page: ${embedResponse.status}`);
        debugInfo.embedStatus = embedResponse.status;

        const embedHtml = await embedResponse.text();
        debugInfo.embedHtmlLength = embedHtml.length;

        // Check for media classes
        debugInfo.hasEmbeddedMedia = embedHtml.includes('EmbeddedMedia');
        debugInfo.hasUsernameText = embedHtml.includes('UsernameText');
        debugInfo.hasWatchOnInstagram = embedHtml.includes('WatchOnInstagram');

        // Try to extract media URLs
        const videoUrlMatch = embedHtml.match(/"video_url":"([^"]+)"/);
        const displayUrlMatch = embedHtml.match(/"display_url"\s*:\s*"([^"]+)"/);
        const thumbnailMatch = embedHtml.match(/"thumbnail_src":"([^"]+)"/);
        const embeddedVideoMatch = embedHtml.match(/class="[^"]*EmbeddedMediaVideo[^"]*"[^>]*src="([^"]+)"/i);
        const embeddedImageMatch = embedHtml.match(/class="[^"]*EmbeddedMediaImage[^"]*"[^>]*src="([^"]+)"/i);

        debugInfo.extractedUrls = {
            video_url: videoUrlMatch ? videoUrlMatch[1].substring(0, 100) + '...' : null,
            display_url: displayUrlMatch ? displayUrlMatch[1].substring(0, 100) + '...' : null,
            thumbnail_src: thumbnailMatch ? thumbnailMatch[1].substring(0, 100) + '...' : null,
            embeddedVideo: embeddedVideoMatch ? embeddedVideoMatch[1].substring(0, 100) + '...' : null,
            embeddedImage: embeddedImageMatch ? embeddedImageMatch[1].substring(0, 100) + '...' : null,
        };

        // Search for any video URLs in the entire page
        const allVideoUrls = embedHtml.match(/https:\/\/[^"'\s]+\.mp4[^"'\s]*/g);
        debugInfo.mp4UrlsFound = allVideoUrls ? allVideoUrls.length : 0;
        if (allVideoUrls && allVideoUrls.length > 0) {
            debugInfo.firstMp4Url = allVideoUrls[0].substring(0, 150);
        }

        return c.json(debugInfo);
    } catch (error) {
        debugInfo.error = error instanceof Error ? error.message : 'Unknown error';
        return c.json(debugInfo);
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
