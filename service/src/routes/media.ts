/** Media routes. */

import { Hono } from 'hono';
import type { Env } from '../types.ts';
import { proxyInstagramImage } from './instagram_media_proxy.ts';
import { relayInstagramVideo } from './instagram_video_relay.ts';
import { relayRedditVideo } from './reddit_video.ts';

const app = new Hono<{ Bindings: Env }>();

app.get('/video/instagram', relayInstagramVideo);
app.get('/video/reddit', relayRedditVideo);

app.get('/video/threads', async (c) => {
    const videoUrl = c.req.query('url');

    if (!videoUrl) {
        return c.json({ error: 'Missing video URL' }, 400);
    }

    try {
        // Fetch the video from the source
        const response = await fetch(videoUrl, {
            headers: {
                'User-Agent': 'TelegramBot (like TwitterBot)',
            },
        });

        if (!response.ok) {
            return c.redirect(videoUrl, 302);
        }

        // Stream the video back with proper headers
        const headers = new Headers();
        headers.set('Content-Type', 'video/mp4');
        headers.set('Accept-Ranges', 'bytes');

        const contentLength = response.headers.get('Content-Length');
        if (contentLength) {
            headers.set('Content-Length', contentLength);
        }

        return new Response(response.body, {
            status: 200,
            headers,
        });
    } catch (error) {
        // Fallback to redirect
        return c.redirect(videoUrl, 302);
    }
});

app.get('/proxy/instagram', proxyInstagramImage);

app.get('/proxy/pixiv', async (c) => {
    const rawImageUrl = c.req.query('url');

    if (!rawImageUrl) {
        return c.json({ error: 'Missing image URL' }, 400);
    }

    const trustedImageUrl = (rawUrl: string): string | null => {
        try {
            const parsed = new URL(rawUrl);
            const hostname = parsed.hostname.toLowerCase();
            const trustedHost = hostname === 'embed.pixiv.net'
                || hostname === 'i.pximg.net'
                || hostname.endsWith('.pximg.net')
                || hostname === 'phixiv.net'
                || hostname === 'www.phixiv.net';
            return parsed.protocol === 'https:' && trustedHost ? parsed.toString() : null;
        } catch {
            return null;
        }
    };

    const initialImageUrl = trustedImageUrl(rawImageUrl);
    if (!initialImageUrl) {
        return c.json({ error: 'Invalid Pixiv image URL' }, 400);
    }
    let imageUrl = initialImageUrl;

    try {
        const requestHeaders = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://www.pixiv.net/',
            'Accept': 'image/*',
        };
        let response: Response;
        for (let redirectCount = 0; ; redirectCount += 1) {
            response = await fetch(imageUrl, {
                headers: requestHeaders,
                redirect: 'manual',
            });
            if (response.status < 300 || response.status >= 400) break;
            const location = response.headers.get('location');
            const redirectedUrl = location
                ? trustedImageUrl(new URL(location, imageUrl).toString())
                : null;
            if (!redirectedUrl) {
                return c.json({ error: 'Unsafe Pixiv image redirect' }, 502);
            }
            if (redirectCount >= 2) {
                return c.json({ error: 'Too many Pixiv image redirects' }, 502);
            }
            imageUrl = redirectedUrl;
        }

        if (!response.ok) {
            return c.redirect(imageUrl, 302);
        }

        const contentType = response.headers.get('Content-Type') || '';
        if (!contentType.toLowerCase().startsWith('image/')) {
            return c.json({ error: 'Invalid Pixiv image response' }, 502);
        }

        const headers = new Headers();
        headers.set('Content-Type', contentType);
        headers.set('Cache-Control', 'public, max-age=86400');

        const contentLength = response.headers.get('Content-Length');
        if (contentLength) {
            headers.set('Content-Length', contentLength);
        }

        return new Response(response.body, {
            status: 200,
            headers,
        });
    } catch (error) {
        // Fallback to redirect
        return c.redirect(imageUrl, 302);
    }
});

app.get('/proxy/bilibili', async (c) => {
    const rawVideoUrl = c.req.query('url');

    if (!rawVideoUrl) {
        return c.json({ error: 'Missing video URL' }, 400);
    }

    const trustedVideoUrl = (rawUrl: string): string | null => {
        try {
            const parsed = new URL(rawUrl);
            const hostname = parsed.hostname.toLowerCase();
            const trustedHost = hostname === 'media.vxbilibili.com'
                || hostname.endsWith('.bilivideo.com')
                || hostname.endsWith('.bilivideo.cn')
                || hostname.endsWith('.akamaized.net');
            return parsed.protocol === 'https:' && trustedHost ? parsed.toString() : null;
        } catch {
            return null;
        }
    };

    const initialVideoUrl = trustedVideoUrl(rawVideoUrl);
    if (!initialVideoUrl) {
        return c.json({ error: 'Invalid Bilibili video URL' }, 400);
    }
    let videoUrl: string = initialVideoUrl;

    try {
        const requestHeaders = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://www.bilibili.com/',
            'Accept': 'video/*,*/*',
            'Range': c.req.header('Range') || 'bytes=0-',
        };
        let response: Response;
        for (let redirectCount = 0; ; redirectCount += 1) {
            response = await fetch(videoUrl, {
                headers: requestHeaders,
                redirect: 'manual',
            });

            if (response.status < 300 || response.status >= 400) break;
            const location = response.headers.get('location');
            const redirectedUrl = location
                ? trustedVideoUrl(new URL(location, videoUrl).toString())
                : null;
            if (!redirectedUrl) {
                return c.json({ error: 'Unsafe Bilibili video redirect' }, 502);
            }
            if (redirectCount >= 2) {
                return c.json({ error: 'Too many Bilibili video redirects' }, 502);
            }
            videoUrl = redirectedUrl;
        }

        if (!response.ok && response.status !== 206) {
            return c.redirect(videoUrl, 302);
        }

        // Forward the response with appropriate headers
        const headers = new Headers();
        const contentType = response.headers.get('Content-Type') || 'video/mp4';
        headers.set('Content-Type', contentType);
        headers.set('Accept-Ranges', 'bytes');
        headers.set('Cache-Control', 'public, max-age=3600');

        // Forward Content-Range and Content-Length for range requests
        const contentLength = response.headers.get('Content-Length');
        const contentRange = response.headers.get('Content-Range');
        if (contentLength) headers.set('Content-Length', contentLength);
        if (contentRange) headers.set('Content-Range', contentRange);

        return new Response(response.body, {
            status: response.status,
            headers,
        });
    } catch (error) {
        // Fallback to redirect
        return c.redirect(videoUrl, 302);
    }
});

export default app;
