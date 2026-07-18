import type { Context } from 'hono';

import type { Env } from '../types.ts';

const MAX_IMAGE_URL_LENGTH = 2048;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_REDIRECTS = 2;

type FixEmbedContext = Context<{ Bindings: Env }>;

function trustedInstagramImageUrl(rawUrl: string): string | null {
    try {
        const parsed = new URL(rawUrl);
        const hostname = parsed.hostname.toLowerCase();
        const trustedHost = hostname === 'cdninstagram.com'
            || hostname.endsWith('.cdninstagram.com')
            || hostname === 'fbcdn.net'
            || hostname.endsWith('.fbcdn.net');
        const hasCredentials = Boolean(parsed.username || parsed.password);
        return parsed.protocol === 'https:' && trustedHost && !hasCredentials
            ? parsed.toString()
            : null;
    } catch {
        return null;
    }
}

export async function proxyInstagramImage(c: FixEmbedContext): Promise<Response> {
    const rawImageUrl = c.req.query('url');

    if (!rawImageUrl) {
        return c.json({ error: 'Missing image URL' }, 400);
    }
    if (rawImageUrl.length > MAX_IMAGE_URL_LENGTH) {
        return c.json({ error: 'Instagram image URL is too long' }, 400);
    }

    const initialImageUrl = trustedInstagramImageUrl(rawImageUrl);
    if (!initialImageUrl) {
        return c.json({ error: 'Invalid Instagram image URL' }, 400);
    }
    let imageUrl = initialImageUrl;

    try {
        const requestHeaders = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://www.instagram.com/',
            'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
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
                ? trustedInstagramImageUrl(new URL(location, imageUrl).toString())
                : null;
            if (!redirectedUrl) {
                return c.json({ error: 'Unsafe Instagram image redirect' }, 502);
            }
            if (redirectCount >= MAX_REDIRECTS) {
                return c.json({ error: 'Too many Instagram image redirects' }, 502);
            }
            imageUrl = redirectedUrl;
        }

        if (!response.ok) {
            return c.json({ error: 'Instagram image request failed' }, 502);
        }

        const contentType = response.headers.get('Content-Type') || '';
        if (!contentType.toLowerCase().startsWith('image/')) {
            return c.json({ error: 'Invalid Instagram image response' }, 502);
        }

        const contentLength = response.headers.get('Content-Length');
        if (contentLength && Number(contentLength) > MAX_IMAGE_BYTES) {
            return c.json({ error: 'Instagram image is too large' }, 413);
        }

        const headers = new Headers();
        headers.set('Content-Type', contentType);
        headers.set('Cache-Control', 'public, max-age=86400');
        headers.set('X-Content-Type-Options', 'nosniff');
        if (contentLength) {
            headers.set('Content-Length', contentLength);
        }

        return new Response(response.body, {
            status: 200,
            headers,
        });
    } catch {
        return c.json({ error: 'Instagram image request failed' }, 502);
    }
}
