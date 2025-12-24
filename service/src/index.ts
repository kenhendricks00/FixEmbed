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
import { FIXEMBED_LOGO, generateEmbedHTML, generateErrorHTML } from './utils/embed';
import { indexHtml, scriptJs, stylesCss, privacyHtml, tosHtml } from './utils/static_site';

const app = new Hono<{ Bindings: Env }>();

// Middleware
app.use('*', cors());
app.use('*', logger());

// Health check
// Serve static landing page
app.get('/', (c) => {
    return c.html(indexHtml);
});

// Serve static assets
app.get('/styles.css', (c) => {
    return c.text(stylesCss, 200, {
        'Content-Type': 'text/css',
    });
});

app.get('/script.js', (c) => {
    return c.text(scriptJs, 200, {
        'Content-Type': 'application/javascript',
    });
});

app.get('/tos', (c) => {
    return c.html(tosHtml);
});

app.get('/privacy', (c) => {
    return c.html(privacyHtml);
});

// oEmbed endpoint - provides provider info with FixEmbed logo for Discord
app.get('/oembed', (c) => {
    const originalUrl = c.req.query('url');
    const stats = c.req.query('stats');
    const author = c.req.query('author');
    const provider = c.req.query('provider'); // Platform-specific branded name
    const format = c.req.query('format') || 'json';

    // Discord handles 'rich' type well for custom metadata
    // 'author_name' is used by Discord for the engagement stats row
    // Only include it if we have actual stats or author info to show
    const oembedResponse: any = {
        version: '1.0',
        type: 'rich',
        provider_name: provider || 'FixEmbed',  // Use branded name if available
        provider_url: 'https://fixembed.app',
        title: 'Post',
    };

    // Only add author_name if we have stats (preferred) or author
    // This prevents "FixEmbed" from showing twice
    if (stats) {
        oembedResponse.author_name = stats;
        oembedResponse.author_url = originalUrl || 'https://fixembed.app';
    } else if (author) {
        oembedResponse.author_name = author;
        oembedResponse.author_url = originalUrl || 'https://fixembed.app';
    }

    // Do NOT set thumbnail_url, thumbnail_width, or thumbnail_height
    // Setting these forces Discord to use the "Rich Embed" (thumbnail on right) layout
    // By omitting them, Discord will use the oEmbed metadata (author/provider) 
    // BUT rely on twitter:card/og:image for the visual (Large Image)


    if (format === 'xml') {
        let authorXml = '';
        if (stats || author) {
            authorXml = `
    <author_name>${stats || author}</author_name>
    <author_url>${originalUrl || 'https://fixembed.app'}</author_url>`;
        }
        const xml = `<?xml version="1.0" encoding="utf-8"?>
<oembed>
    <version>1.0</version>
    <type>rich</type>
    <provider_name>${provider || 'FixEmbed'}</provider_name>
    <provider_url>https://fixembed.app</provider_url>${authorXml}
    <title>Post</title>
</oembed>`;
        return c.text(xml, 200, { 'Content-Type': 'text/xml' });
    }

    return c.json(oembedResponse);
});

// Alias for owoembed (used by FxTwitter/FixupX)
app.get('/owoembed', (c) => {
    const query = c.req.raw.url.split('?')[1] || '';
    return c.redirect(`/oembed?${query}`, 301);
});

// ActivityPub endpoint with encoded embed data for Discord footer branding
// The embed data is base64 encoded in the URL, decoded here to return proper content
app.get('/activity/:encodedData', (c) => {
    const encodedData = c.req.param('encodedData');
    const accept = c.req.header('Accept') || '';

    // Decode the embed data from URL-safe base64
    let embedData: { t?: string; d?: string; i?: string; v?: string; p?: string; a?: string; h?: string; ic?: string; s?: string; u?: string } = {};
    try {
        // Restore base64 padding and special chars
        let base64 = encodedData.replace(/-/g, '+').replace(/_/g, '/');
        while (base64.length % 4) base64 += '=';
        // Decode base64, then decodeURIComponent for UTF-8 support
        const decoded = atob(base64);
        const jsonStr = decodeURIComponent(decoded);
        embedData = JSON.parse(jsonStr);
    } catch (e) {
        console.error('Failed to decode activity data:', e);
    }

    // Only respond with ActivityPub JSON if client requests it
    if (accept.includes('application/activity+json') || accept.includes('application/ld+json')) {
        const authorName = embedData.a || 'FixEmbed';

        // Build attachment
        let attachment: any[] = [];
        if (embedData.v) {
            // Include video as ActivityPub attachment - this is how FxEmbed does it
            // Discord will use this for playback AND we get the footer/branding
            attachment = [{
                'type': 'Document',
                'mediaType': 'video/mp4',
                'url': embedData.v,
                'name': embedData.t || 'Video'
            }];
        } else if (embedData.i) {
            // Image attachment
            attachment = [{
                'type': 'Document',
                'mediaType': 'image/jpeg',
                'url': embedData.i,
                'name': embedData.t || 'Image'
            }];
        }

        const activityPubResponse = {
            '@context': [
                'https://www.w3.org/ns/activitystreams',
                {
                    'sensitive': 'as:sensitive',
                    'toot': 'http://joinmastodon.org/ns#',
                    'Emoji': 'toot:Emoji'
                }
            ],
            'id': `https://fixembed.app/activity/${encodedData}`,
            'type': 'Note',
            'summary': embedData.s || null, // Stats row
            'content': `<p>${embedData.d || ''}</p>`,
            'attributedTo': `https://fixembed.app/activity/${encodedData}/actor`,
            'published': new Date().toISOString(),
            'url': embedData.u || 'https://fixembed.app',
            ...(attachment.length > 0 ? { 'attachment': attachment } : {}),
        };

        return c.json(activityPubResponse, 200, {
            'Content-Type': 'application/activity+json; charset=utf-8',
        });
    }

    // For regular browser requests, redirect to the original URL
    if (embedData.u) {
        return c.redirect(embedData.u, 302);
    }
    return c.redirect('https://fixembed.app/', 302);
});

// ActivityPub Actor endpoint to provide Author Name and Icon in header
app.get('/activity/:encodedData/actor', (c) => {
    const encodedData = c.req.param('encodedData');

    // Decode data
    let embedData: { a?: string; h?: string; ic?: string } = {};
    try {
        let base64 = encodedData.replace(/-/g, '+').replace(/_/g, '/');
        while (base64.length % 4) base64 += '=';
        const decoded = atob(base64);
        const jsonStr = decodeURIComponent(decoded);
        embedData = JSON.parse(jsonStr);
    } catch (e) { }

    const authorName = embedData.a || 'FixEmbed';
    const authorHandle = embedData.h || 'fixembed';
    const authorIcon = embedData.ic || FIXEMBED_LOGO;

    const actor = {
        '@context': [
            'https://www.w3.org/ns/activitystreams',
            {
                'manuallyApprovesFollowers': 'as:manuallyApprovesFollowers',
                'toot': 'http://joinmastodon.org/ns#',
                'featured': {
                    '@id': 'toot:featured',
                    '@type': '@id'
                }
            }
        ],
        'id': `https://fixembed.app/activity/${encodedData}/actor`,
        'type': 'Person',
        'name': authorName,
        'preferredUsername': authorHandle.replace('@', ''),
        'summary': 'FixEmbed Service',
        'url': `https://fixembed.app/users/${encodeURIComponent(authorName)}`,
        'icon': {
            'type': 'Image',
            'mediaType': 'image/jpeg',
            'url': authorIcon
        }
    };

    return c.json(actor, 200, {
        'Content-Type': 'application/activity+json; charset=utf-8',
    });
});

// Legacy ActivityPub endpoint (keep for backwards compatibility)
app.get('/users/:author/statuses/:status', (c) => {
    const author = c.req.param('author');
    const status = c.req.param('status');
    const accept = c.req.header('Accept') || '';

    if (accept.includes('application/activity+json') || accept.includes('application/ld+json')) {
        const activityPubResponse = {
            '@context': ['https://www.w3.org/ns/activitystreams'],
            'id': `https://fixembed.app/users/${author}/statuses/${status}`,
            'type': 'Note',
            'content': '',
            'attributedTo': `https://fixembed.app/users/${author}`,
            'published': new Date().toISOString(),
            'url': `https://fixembed.app/users/${author}/statuses/${status}`,
        };

        return c.json(activityPubResponse, 200, {
            'Content-Type': 'application/activity+json; charset=utf-8',
        });
    }

    return c.redirect('https://fixembed.app/', 302);
});

// ActivityPub actor endpoint for Discord to fetch branding info
app.get('/users/:author', (c) => {
    const author = c.req.param('author');
    const accept = c.req.header('Accept') || '';

    if (accept.includes('application/activity+json') || accept.includes('application/ld+json')) {
        const actorResponse = {
            '@context': [
                'https://www.w3.org/ns/activitystreams',
                'https://w3id.org/security/v1'
            ],
            'id': `https://fixembed.app/users/${author}`,
            'type': 'Person',
            'preferredUsername': author,
            'name': 'FixEmbed',
            'summary': 'Better embeds for social media links',
            'url': 'https://fixembed.app',
            'icon': {
                'type': 'Image',
                'mediaType': 'image/png',
                'url': 'https://raw.githubusercontent.com/kenhendricks00/FixEmbed/main/assets/logo.png'
            },
            'image': {
                'type': 'Image',
                'mediaType': 'image/png',
                'url': 'https://raw.githubusercontent.com/kenhendricks00/FixEmbed/main/assets/logo.png'
            },
        };

        return c.json(actorResponse, 200, {
            'Content-Type': 'application/activity+json; charset=utf-8',
        });
    }

    return c.redirect('https://fixembed.app/', 302);
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

// Video proxy endpoint for Instagram - streams the video with proper headers
app.get('/video/instagram', async (c) => {
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

// Video proxy endpoint for Threads - streams the video with proper headers
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

// Image proxy endpoint for Pixiv - adds required Referer header
app.get('/proxy/pixiv', async (c) => {
    const imageUrl = c.req.query('url');

    if (!imageUrl) {
        return c.json({ error: 'Missing image URL' }, 400);
    }

    try {
        // Pixiv requires Referer header to serve images
        const response = await fetch(imageUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': 'https://www.pixiv.net/',
                'Accept': 'image/*',
            },
        });

        if (!response.ok) {
            return c.redirect(imageUrl, 302);
        }

        // Get content type from response or default to image/jpeg
        const contentType = response.headers.get('Content-Type') || 'image/jpeg';

        // Stream the image back with proper headers and long cache
        const headers = new Headers();
        headers.set('Content-Type', contentType);
        headers.set('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours

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

// Video proxy endpoint for Bilibili - streams video with proper Referer
app.get('/proxy/bilibili', async (c) => {
    const videoUrl = c.req.query('url');

    if (!videoUrl) {
        return c.json({ error: 'Missing video URL' }, 400);
    }

    try {
        // Bilibili requires Referer header
        const response = await fetch(videoUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': 'https://www.bilibili.com/',
                'Accept': 'video/*,*/*',
                'Range': c.req.header('Range') || 'bytes=0-',
            },
        });

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

        // Search for actual CDN video URLs (scontent)
        const cdnVideoUrls = embedHtml.match(/https:\/\/scontent[^"'\s]+\.mp4[^"'\s]*/g);
        debugInfo.cdnVideoUrlsFound = cdnVideoUrls ? cdnVideoUrls.length : 0;
        if (cdnVideoUrls && cdnVideoUrls.length > 0) {
            debugInfo.firstCdnVideoUrl = cdnVideoUrls[0].substring(0, 200);
        }

        // Step 4: Try to decrypt the Snapsave response
        try {
            // Get the encoded params from the raw HTML
            const encoded = rawHtml.split("decodeURIComponent(escape(r))}(")[1];
            if (encoded) {
                const params = encoded.split("))")[0]
                    .split(",")
                    .map((v: string) => v.replace(/"/g, "").trim());

                debugInfo.snapsaveParams = {
                    paramCount: params.length,
                    h_length: params[0]?.length || 0,
                    n: params[2] || 'N/A',
                    t: params[3] || 'N/A',
                    e: params[4] || 'N/A',
                };

                // Try the decryption
                if (params.length >= 5) {
                    const [h, u, n, t, e] = params;
                    const tNum = Number(t);
                    const eNum = Number(e);

                    function decodeBase(d: string, base: number, target: number): string {
                        const g = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+/".split("");
                        const hArr = g.slice(0, base);
                        const iArr = g.slice(0, target);
                        let j = d.split("").reverse().reduce((a: number, b: string, c: number) => {
                            const idx = hArr.indexOf(b);
                            if (idx !== -1) return a + idx * (Math.pow(base, c));
                            return a;
                        }, 0);
                        let k = "";
                        while (j > 0) {
                            k = iArr[j % target] + k;
                            j = Math.floor(j / target);
                        }
                        return k || "0";
                    }

                    let result = "";
                    for (let i = 0, len = h.length; i < len;) {
                        let s = "";
                        while (i < len && h[i] !== n[eNum]) {
                            s += h[i];
                            i++;
                        }
                        i++;
                        for (let j = 0; j < n.length; j++) {
                            s = s.replace(new RegExp(n[j], "g"), j.toString());
                        }
                        result += String.fromCharCode(Number(decodeBase(s, eNum, 10)) - tNum);
                    }

                    debugInfo.decryptedLength = result.length;
                    debugInfo.decryptedPreview = result.substring(0, 300);

                    // Look for download section
                    const downloadSectionMatch = result.match(/getElementById\("download-section"\)\.innerHTML = "(.+?)"; document/);
                    if (downloadSectionMatch) {
                        const cleanedHtml = downloadSectionMatch[1]
                            .replace(/\\"/g, '"')
                            .replace(/\\\//g, '/');
                        debugInfo.downloadSectionLength = cleanedHtml.length;
                        debugInfo.downloadSectionPreview = cleanedHtml.substring(0, 500);

                        // Look for rapidcdn URLs
                        const rapidcdnUrls = cleanedHtml.match(/https:\/\/d\.rapidcdn\.app[^"'\s<>]+/g);
                        debugInfo.rapidcdnUrlsFound = rapidcdnUrls?.length || 0;
                        if (rapidcdnUrls && rapidcdnUrls.length > 0) {
                            debugInfo.allRapidcdnUrls = rapidcdnUrls.map(u => ({
                                type: u.includes('/thumb?') ? 'thumbnail' : (u.includes('/d?') ? 'download' : 'other'),
                                url: u.substring(0, 150) + '...',
                            }));
                            // Find the actual download URL (not thumb)
                            const downloadUrl = rapidcdnUrls.find(u => u.includes('/d?') || (!u.includes('/thumb?')));
                            debugInfo.videoDownloadUrl = downloadUrl;
                        }

                        // Also look for direct video href links
                        const hrefMatches = cleanedHtml.match(/href="([^"]+)"/g);
                        debugInfo.hrefsFound = hrefMatches?.length || 0;
                        if (hrefMatches) {
                            debugInfo.hrefs = hrefMatches.slice(0, 5).map(h => h.substring(0, 100));
                        }
                    }
                }
            }
        } catch (decryptError) {
            debugInfo.decryptError = decryptError instanceof Error ? decryptError.message : 'Unknown';
        }

        return c.json(debugInfo);
    } catch (error) {
        debugInfo.error = error instanceof Error ? error.message : 'Unknown error';
        return c.json(debugInfo);
    }
});

// Debug endpoint to test Pixiv
app.get('/debug/pixiv', async (c) => {
    const url = c.req.query('url') || 'https://www.pixiv.net/artworks/98188712';

    // Extract artwork ID
    const artworkMatch = url.match(/artworks\/(\d+)/);
    const illustId = artworkMatch?.[1] || '98188712';

    const debugInfo: Record<string, unknown> = {
        inputUrl: url,
        illustId,
        tests: [],
    };

    // Test 1: Desktop browser headers
    try {
        const resp1 = await fetch(`https://www.pixiv.net/ajax/illust/${illustId}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://www.pixiv.net/',
            },
        });
        const body1 = await resp1.text();
        (debugInfo.tests as any[]).push({
            name: 'Desktop Browser Headers',
            status: resp1.status,
            bodyPreview: body1.substring(0, 500),
            hasError: body1.includes('"error":true'),
        });
    } catch (e: any) {
        (debugInfo.tests as any[]).push({ name: 'Desktop Browser', error: e.message });
    }

    // Test 2: iOS App headers (like phixiv)
    try {
        const resp2 = await fetch(`https://www.pixiv.net/ajax/illust/${illustId}`, {
            headers: {
                'User-Agent': 'PixivIOSApp/7.13.3 (iOS 14.6; iPhone13,2)',
                'App-Os': 'iOS',
                'App-Os-Version': '14.6',
                'Accept': 'application/json',
            },
        });
        const body2 = await resp2.text();
        (debugInfo.tests as any[]).push({
            name: 'iOS App Headers',
            status: resp2.status,
            bodyPreview: body2.substring(0, 500),
            hasError: body2.includes('"error":true'),
        });
    } catch (e: any) {
        (debugInfo.tests as any[]).push({ name: 'iOS App', error: e.message });
    }

    // Test 3: TelegramBot User-Agent
    try {
        const resp3 = await fetch(`https://www.pixiv.net/ajax/illust/${illustId}`, {
            headers: {
                'User-Agent': 'TelegramBot (like TwitterBot)',
                'Accept': 'application/json',
            },
        });
        const body3 = await resp3.text();
        (debugInfo.tests as any[]).push({
            name: 'TelegramBot Headers',
            status: resp3.status,
            bodyPreview: body3.substring(0, 500),
            hasError: body3.includes('"error":true'),
        });
    } catch (e: any) {
        (debugInfo.tests as any[]).push({ name: 'TelegramBot', error: e.message });
    }

    // Test 4: Try fetching the artwork page HTML directly
    try {
        const resp4 = await fetch(`https://www.pixiv.net/artworks/${illustId}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
                'Accept': 'text/html',
            },
        });
        const body4 = await resp4.text();

        // Try to find OG tags
        const ogTitle = body4.match(/<meta property="og:title" content="([^"]+)"/)?.[1];
        const ogImage = body4.match(/<meta property="og:image" content="([^"]+)"/)?.[1];
        const ogDesc = body4.match(/<meta property="og:description" content="([^"]+)"/)?.[1];

        (debugInfo.tests as any[]).push({
            name: 'Artwork Page (Discordbot)',
            status: resp4.status,
            htmlLength: body4.length,
            ogTitle,
            ogImage,
            ogDesc: ogDesc?.substring(0, 100),
        });
    } catch (e: any) {
        (debugInfo.tests as any[]).push({ name: 'Artwork Page', error: e.message });
    }

    // Test 5: Check artwork page with mobile UA
    try {
        const resp5 = await fetch(`https://www.pixiv.net/artworks/${illustId}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15',
                'Accept': 'text/html',
            },
        });
        const body5 = await resp5.text();

        const ogTitle = body5.match(/<meta property="og:title" content="([^"]+)"/)?.[1];
        const ogImage = body5.match(/<meta property="og:image" content="([^"]+)"/)?.[1];

        (debugInfo.tests as any[]).push({
            name: 'Artwork Page (Mobile)',
            status: resp5.status,
            htmlLength: body5.length,
            ogTitle,
            ogImage,
        });
    } catch (e: any) {
        (debugInfo.tests as any[]).push({ name: 'Mobile Page', error: e.message });
    }

    // Test 6: Try Pixiv's native oEmbed endpoint
    try {
        const oembedUrl = `https://embed.pixiv.net/oembed?url=https://www.pixiv.net/artworks/${illustId}&format=json`;
        const resp6 = await fetch(oembedUrl, {
            headers: { 'Accept': 'application/json' },
        });
        const body6 = await resp6.text();
        (debugInfo.tests as any[]).push({
            name: 'Pixiv oEmbed',
            status: resp6.status,
            bodyPreview: body6.substring(0, 500),
        });
    } catch (e: any) {
        (debugInfo.tests as any[]).push({ name: 'Pixiv oEmbed', error: e.message });
    }

    // Test 7: Try scraping phixiv.net HTML for OG tags
    try {
        const phixivUrl = `https://www.phixiv.net/artworks/${illustId}`;
        const resp7 = await fetch(phixivUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; Discordbot/2.0)',
                'Accept': 'text/html',
            },
        });
        const body7 = await resp7.text();

        const ogTitle = body7.match(/<meta property="og:title" content="([^"]+)"/)?.[1];
        const ogImage = body7.match(/<meta property="og:image" content="([^"]+)"/)?.[1];
        const ogDesc = body7.match(/<meta property="og:description" content="([^"]+)"/)?.[1];

        (debugInfo.tests as any[]).push({
            name: 'Phixiv HTML Scrape',
            status: resp7.status,
            htmlLength: body7.length,
            ogTitle,
            ogImage,
            ogDesc: ogDesc?.substring(0, 100),
        });
    } catch (e: any) {
        (debugInfo.tests as any[]).push({ name: 'Phixiv HTML', error: e.message });
    }

    // Test 8: Try phixiv oEmbed JSON
    try {
        const phixivOembed = `https://www.phixiv.net/oembed?url=https://www.pixiv.net/artworks/${illustId}`;
        const resp8 = await fetch(phixivOembed);
        const body8 = await resp8.text();
        (debugInfo.tests as any[]).push({
            name: 'Phixiv oEmbed JSON',
            status: resp8.status,
            bodyPreview: body8.substring(0, 500),
        });
    } catch (e: any) {
        (debugInfo.tests as any[]).push({ name: 'Phixiv oEmbed', error: e.message });
    }

    return c.json(debugInfo);
});

// Debug endpoint to test YouTube
app.get('/debug/youtube', async (c) => {
    const url = c.req.query('url') || 'https://www.youtube.com/watch?v=JS4wtEen2EM';

    // Extract video ID
    const videoIdMatch = url.match(/(?:v=|youtu\.be\/|shorts\/)([a-zA-Z0-9_-]+)/);
    const videoId = videoIdMatch?.[1] || 'JS4wtEen2EM';

    const debugInfo: Record<string, unknown> = {
        inputUrl: url,
        videoId,
        tests: [],
    };

    // Test 1: YouTube oEmbed API
    try {
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(videoUrl)}&format=json`;

        const resp1 = await fetch(oembedUrl);
        const body1 = await resp1.text();

        (debugInfo.tests as any[]).push({
            name: 'YouTube oEmbed',
            status: resp1.status,
            bodyPreview: body1.substring(0, 800),
        });

        if (resp1.ok) {
            try {
                debugInfo.oembedData = JSON.parse(body1);
            } catch {
                debugInfo.oembedParseError = 'Failed to parse JSON';
            }
        }
    } catch (e: any) {
        (debugInfo.tests as any[]).push({ name: 'YouTube oEmbed', error: e.message });
    }

    // Test 2: YouTube noembed (alternative)
    try {
        const noembedUrl = `https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`;
        const resp2 = await fetch(noembedUrl);
        const body2 = await resp2.text();

        (debugInfo.tests as any[]).push({
            name: 'Noembed API',
            status: resp2.status,
            bodyPreview: body2.substring(0, 800),
        });
    } catch (e: any) {
        (debugInfo.tests as any[]).push({ name: 'Noembed', error: e.message });
    }

    return c.json(debugInfo);
});

// Debug endpoint to test Bilibili
app.get('/debug/bilibili', async (c) => {
    const url = c.req.query('url') || 'https://www.bilibili.com/video/BV1nhZ2YHEtL';

    const bvMatch = url.match(/BV[a-zA-Z0-9]+/);
    const bvid = bvMatch?.[0] || 'BV1nhZ2YHEtL';

    const debugInfo: Record<string, unknown> = {
        inputUrl: url,
        bvid,
        tests: [],
    };

    let cid: number | null = null;

    // Test 1: Bilibili Info API
    try {
        const apiUrl = `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`;
        const resp1 = await fetch(apiUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': 'https://www.bilibili.com/',
            },
        });
        const body1 = await resp1.text();

        (debugInfo.tests as any[]).push({
            name: 'Bilibili Info API',
            status: resp1.status,
            bodyLength: body1.length,
        });

        if (resp1.ok) {
            try {
                const data = JSON.parse(body1);
                cid = data.data?.cid;
                debugInfo.infoApiData = {
                    code: data.code,
                    message: data.message,
                    title: data.data?.title,
                    cid: data.data?.cid,
                    owner: data.data?.owner?.name,
                    pic: data.data?.pic,
                    views: data.data?.stat?.view,
                    likes: data.data?.stat?.like,
                    duration: data.data?.duration,
                };
            } catch {
                debugInfo.infoParseError = 'Failed to parse JSON';
            }
        }
    } catch (e: any) {
        (debugInfo.tests as any[]).push({ name: 'Bilibili Info API (blocked)', error: e.message });
    }

    // Test 2: vxbilibili.com HTML scraping (our actual approach)
    try {
        const vxUrl = `https://www.vxbilibili.com/video/${bvid}`;
        const resp2 = await fetch(vxUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
                'Accept': 'text/html',
            },
        });
        const html = await resp2.text();

        (debugInfo.tests as any[]).push({
            name: 'vxbilibili HTML Scrape',
            status: resp2.status,
            bodyLength: html.length,
        });

        if (resp2.ok) {
            const ogTitle = html.match(/<meta property="og:title" content="([^"]+)"/)?.[1];
            const ogImage = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1];
            const ogDesc = html.match(/<meta property="og:description" content="([^"]+)"/)?.[1];
            const ogVideo = html.match(/<meta property="og:video(?::url)?" content="([^"]+)"/)?.[1];

            debugInfo.vxbilibiliData = {
                title: ogTitle,
                image: ogImage,
                description: ogDesc?.substring(0, 100),
                video: ogVideo?.substring(0, 100),
            };
        }
    } catch (e: any) {
        (debugInfo.tests as any[]).push({ name: 'vxbilibili HTML Scrape', error: e.message });
    }

    return c.json(debugInfo);
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
