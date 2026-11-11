/** Platforms routes. */

import { Hono } from 'hono';
import type { Env } from '../types.ts';

const app = new Hono<{ Bindings: Env }>();

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
        pinterest: 'pinterest.com',
        pin: 'pinterest.com',
        deviantart: 'deviantart.com',
        da: 'deviantart.com',
        stash: 'sta.sh',
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

export default app;
