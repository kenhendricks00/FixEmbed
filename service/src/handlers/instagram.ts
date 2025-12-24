/**
 * FixEmbed Service - Instagram Handler
 * 
 * Uses two methods for Instagram content:
 * 1. VxInstagram (vxinstagram.com) - For posts/carousel images with composite grid
 * 2. Snapsave API - For reels/videos with direct playback
 * 
 * Credits:
 * - VxInstagram by Lainmode (MIT License): https://github.com/Lainmode/InstagramEmbed-vxinstagram
 * - Snapsave decryption based on: https://github.com/ahmedrangel/snapsave-media-downloader
 */

import { Env, HandlerResponse, PlatformHandler } from '../types';
import { parseInstagramUrl, truncateText } from '../utils/fetch';
import { platformColors, getBrandedSiteName } from '../utils/embed';

// ========== VxInstagram Scraper ==========
// Scrapes vxinstagram.com for composite carousel images and metadata

async function scrapeVxInstagram(shortcode: string, type: string): Promise<{
    success: boolean;
    image?: string;
    username?: string;
    description?: string;
    isVideo?: boolean;
    error?: string;
}> {
    try {
        // Build vxinstagram URL based on content type
        const vxUrl = type === 'reel'
            ? `https://vxinstagram.com/reel/${shortcode}/`
            : `https://vxinstagram.com/p/${shortcode}/`;

        const response = await fetch(vxUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
                'Accept': 'text/html',
            },
        });

        if (!response.ok) {
            return { success: false, error: `vxinstagram returned ${response.status}` };
        }

        const html = await response.text();

        // Extract OG tags
        const ogImage = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1];
        const ogTitle = html.match(/<meta property="og:title" content="([^"]+)"/)?.[1];
        const ogDesc = html.match(/<meta property="og:description" content="([^"]+)"/)?.[1];
        const ogType = html.match(/<meta property="og:type" content="([^"]+)"/)?.[1];

        // Check if it's a video (vxinstagram typically redirects videos to snapsave)
        const isVideo = ogType?.includes('video') || html.includes('og:video');

        // Only use image if it's a generated composite (carousel)
        // Standard single images use a proxy link that often fails or expires
        const isComposite = ogImage?.includes('/generated/');

        if (!isComposite) {
            return { success: false, error: 'Not a carousel/composite image' };
        }

        // Note: vxinstagram doesn't expose the actual author username in metadata
        // The @realAlita in the HTML is a developer credit, so we don't extract it.
        // We'll rely on the fallback scraper (Snapsave) to get the author if needed.

        return {
            success: true,
            image: ogImage,
            username: undefined, // Don't return username from vxinstagram to avoid wrong attribution
            description: ogDesc || ogTitle,
            isVideo,
        };
    } catch (error) {
        console.error('VxInstagram scrape error:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
}

// ========== Snapsave Decryption Logic ==========
// Ported from https://github.com/ahmedrangel/snapsave-media-downloader

function decodeSnapApp(args: string[]): string {
    let [h, u, n, t, e, r] = args;
    const tNum = Number(t);
    const eNum = Number(e);

    function decode(d: string, e: number, f: number): string {
        const g = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+/".split("");
        const hArr = g.slice(0, e);
        const iArr = g.slice(0, f);
        let j = d.split("").reverse().reduce((a: number, b: string, c: number) => {
            const idx = hArr.indexOf(b);
            if (idx !== -1) return a + idx * (Math.pow(e, c));
            return a;
        }, 0);
        let k = "";
        while (j > 0) {
            k = iArr[j % f] + k;
            j = Math.floor(j / f);
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
        result += String.fromCharCode(Number(decode(s, eNum, 10)) - tNum);
    }

    return result;
}

function getEncodedSnapApp(data: string): string[] {
    const match = data.split("decodeURIComponent(escape(r))}(")[1];
    if (!match) return [];
    return match.split("))")[0]
        .split(",")
        .map(v => v.replace(/"/g, "").trim());
}

function getDecodedSnapSave(data: string): string {
    const errorMatch = data?.split('document.querySelector("#alert").innerHTML = "');
    if (errorMatch?.[1]) {
        const errorMessage = errorMatch[1].split('";')[0]?.trim();
        if (errorMessage) throw new Error(errorMessage);
    }

    const htmlMatch = data.split('getElementById("download-section").innerHTML = "')[1];
    if (!htmlMatch) return "";

    return htmlMatch
        .split('"; document.getElementById("inputData").remove();')[0]
        .replace(/\\"/g, '"')
        .replace(/\\\//g, '/');
}

function decryptSnapSave(data: string): string {
    const encoded = getEncodedSnapApp(data);
    if (encoded.length === 0) return "";
    const decoded = decodeSnapApp(encoded);
    return getDecodedSnapSave(decoded);
}

// ========== HTML Parsing Helpers ==========

interface SnapsaveMedia {
    url: string;
    type: 'video' | 'image';
    thumbnail?: string;
}

function parseSnapsaveHtml(html: string): { media: SnapsaveMedia[], description?: string, preview?: string } {
    const media: SnapsaveMedia[] = [];
    let description = '';
    let preview = '';

    // Check if it's a photo or video based on button text AND URL content
    const hasDownloadPhoto = html.includes('Download Photo');
    const hasDownloadVideo = html.includes('Download Video');
    // Default to video unless explicitly photo-only
    let defaultType: 'video' | 'image' = hasDownloadPhoto && !hasDownloadVideo ? 'image' : 'video';

    // Extract description
    const descMatch = html.match(/class="video-des"[^>]*>([^<]*)</) ||
        html.match(/<span[^>]*class="[^"]*video-des[^"]*"[^>]*>([^<]*)</);
    if (descMatch) description = descMatch[1].trim();

    // Extract preview/thumbnail image (rapidcdn thumb or scontent)
    const thumbMatch = html.match(/https:\/\/d\.rapidcdn\.app\/thumb\?token=[^"'\s<>]+/);
    if (thumbMatch) {
        preview = thumbMatch[0];
    } else {
        const previewMatch = html.match(/<img[^>]*src="([^"]+)"/);
        if (previewMatch) preview = previewMatch[1];
    }

    // Helper to determine type based on URL content
    const getMediaType = (url: string): 'video' | 'image' => {
        // Decode JWT token to check actual content
        try {
            const tokenMatch = url.match(/token=([^&]+)/);
            if (tokenMatch) {
                const payload = JSON.parse(atob(tokenMatch[1].split('.')[1]));
                if (payload.url && payload.url.includes('.mp4')) {
                    return 'video';
                }
                if (payload.filename && payload.filename.includes('.mp4')) {
                    return 'video';
                }
            }
        } catch (e) {
            // Ignore decode errors
        }
        // If URL path contains video indicators
        if (url.includes('.mp4') || url.includes('/v2?')) {
            return 'video';
        }
        return defaultType;
    };

    // Priority 1: Find rapidcdn /v2 video URL (this is the actual video)
    const rapidcdnV2Match = html.match(/https:\/\/d\.rapidcdn\.app\/v2\?token=[^"'\s<>]+/);
    if (rapidcdnV2Match) {
        const actualType = getMediaType(rapidcdnV2Match[0]);
        media.push({
            url: rapidcdnV2Match[0],
            type: actualType,
            thumbnail: preview,
        });
        return { media, description, preview };
    }

    // Priority 2: Find rapidcdn /d download URL
    const rapidcdnDMatch = html.match(/https:\/\/d\.rapidcdn\.app\/d\?token=[^"'\s<>]+/);
    if (rapidcdnDMatch) {
        media.push({
            url: rapidcdnDMatch[0],
            type: defaultType,
            thumbnail: preview,
        });
        return { media, description, preview };
    }

    // Priority 3: Any rapidcdn URL that's not a thumb
    const rapidcdnUrls = html.match(/https:\/\/d\.rapidcdn\.app[^"'\s<>]+/g);
    if (rapidcdnUrls) {
        for (const url of rapidcdnUrls) {
            if (!url.includes('/thumb?')) {
                media.push({
                    url,
                    type: defaultType,
                    thumbnail: preview,
                });
                return { media, description, preview };
            }
        }
    }

    // Fallback: Look for href links with rapidcdn
    const hrefMatch = html.match(/href="(https:\/\/d\.rapidcdn\.app[^"]+)"/);
    if (hrefMatch) {
        const isPhoto = html.includes('Download Photo');
        media.push({
            url: hrefMatch[1],
            type: isPhoto ? 'image' : 'video',
            thumbnail: preview,
        });
        return { media, description, preview };
    }

    // Fallback: If only thumb exists, return it as image
    if (preview && preview.includes('rapidcdn')) {
        media.push({
            url: preview,
            type: 'image',
        });
    }

    return { media, description, preview };
}

// ========== Handler ==========

export const instagramHandler: PlatformHandler = {
    name: 'instagram',
    patterns: [
        /instagram\.com\/p\/([^\/\?]+)/i,
        /instagram\.com\/reel\/([^\/\?]+)/i,
        /instagram\.com\/reels\/([^\/\?]+)/i,
        /instagram\.com\/tv\/([^\/\?]+)/i,
        /instagram\.com\/stories\/([^\/]+)\/(\d+)/i,
        /instagram\.com\/share\/(p|reel)\/([^\/\?]+)/i,
    ],

    async handle(url: string, env: Env): Promise<HandlerResponse> {
        const parsed = parseInstagramUrl(url);

        if (!parsed) {
            return { success: false, error: 'Invalid Instagram URL' };
        }

        // Stories don't have embed support
        if (parsed.type === 'story') {
            return { success: false, redirect: url };
        }

        // Build canonical URL
        let canonicalUrl: string;
        if (parsed.type === 'reel') {
            canonicalUrl = `https://www.instagram.com/reel/${parsed.shortcode}/`;
        } else {
            canonicalUrl = `https://www.instagram.com/p/${parsed.shortcode}/`;
        }

        try {
            // Try VxInstagram first for better image/carousel support
            const vxResult = await scrapeVxInstagram(parsed.shortcode, parsed.type);

            if (vxResult.success && vxResult.image && !vxResult.isVideo) {
                // VxInstagram found an image (possibly composite carousel)

                // Fetch author metadata since vxinstagram doesn't provide it reliably
                let authorName = undefined;
                try {
                    const embedInfo = await scrapeEmbedHtml(canonicalUrl, parsed);
                    if (embedInfo.success && embedInfo.data) {
                        // Logic to extract best author name (Name + Handle)
                        if (embedInfo.data.title && embedInfo.data.title.includes('@')) {
                            const authorMatch = embedInfo.data.title.match(/^([^\(]+)/);
                            if (authorMatch) authorName = authorMatch[1].trim();

                            const handleMatch = embedInfo.data.title.match(/\(@([^\)]+)\)/);
                            if (handleMatch) {
                                const handle = `@${handleMatch[1]}`;
                                if (!authorName || authorName === 'Instagram') {
                                    authorName = handle;
                                } else {
                                    authorName = `${authorName} (${handle})`;
                                }
                            }
                        }
                        if (!authorName && embedInfo.data.authorName) {
                            authorName = embedInfo.data.authorName;
                        }
                    }
                } catch (e) {
                    console.warn('Failed to fetch carousel metadata:', e);
                }

                let desc = vxResult.description || '';

                // Clean description: Remove author name if it appears at the start
                if (desc && authorName) {
                    let simpleAuthor = authorName.split('(')[0].trim();
                    // Strip leading @ from simpleAuthor if present
                    if (simpleAuthor.startsWith('@')) {
                        simpleAuthor = simpleAuthor.substring(1);
                    }

                    const handleMatch = authorName.match(/\(@([^\)]+)\)/);
                    const handle = handleMatch ? handleMatch[1] : null;

                    // Helper to remove prefix case-insensitively
                    const removePrefix = (text: string, prefix: string) => {
                        if (text.toLowerCase().startsWith(prefix.toLowerCase())) {
                            return text.substring(prefix.length).trim();
                        }
                        if (text.toLowerCase().startsWith(`@${prefix.toLowerCase()}`)) {
                            return text.substring(prefix.length + 1).trim();
                        }
                        return text;
                    };

                    if (simpleAuthor) {
                        desc = removePrefix(desc, simpleAuthor);
                    }
                    if (handle && handle.toLowerCase() !== simpleAuthor.toLowerCase()) {
                        desc = removePrefix(desc, handle);
                    }
                }

                return {
                    success: true,
                    data: {
                        title: authorName || 'Post',
                        description: desc ? truncateText(desc, 280) : '',
                        url: canonicalUrl,
                        siteName: getBrandedSiteName('instagram'),
                        // authorName: authorName, // OLD: Don't set author field to avoid duplication
                        image: vxResult.image, // This is the composite carousel image from vxinstagram
                        color: platformColors.instagram,
                        platform: 'instagram',
                    },
                };
            }

            // For videos/reels or if vxinstagram failed, use Snapsave
            // Call Snapsave API
            const formData = new URLSearchParams();
            formData.append('url', canonicalUrl);

            const response = await fetch('https://snapsave.app/action.php?lang=en', {
                method: 'POST',
                headers: {
                    'Accept': '*/*',
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Origin': 'https://snapsave.app',
                    'Referer': 'https://snapsave.app/',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                },
                body: formData,
            });

            if (!response.ok) {
                throw new Error(`Snapsave returned ${response.status}`);
            }

            const rawHtml = await response.text();

            // Decrypt the response
            const decryptedHtml = decryptSnapSave(rawHtml);

            if (!decryptedHtml) {
                throw new Error('Failed to decrypt response');
            }

            // Parse the HTML
            const { media, description, preview } = parseSnapsaveHtml(decryptedHtml);

            if (media.length === 0) {
                throw new Error('No media found');
            }

            const firstMedia = media[0];

            const result: HandlerResponse = {
                success: true,
                data: {
                    title: parsed.type === 'reel' ? 'Reel' : 'Post',
                    description: description
                        ? truncateText(description, 280)
                        : '',
                    url: canonicalUrl,
                    siteName: getBrandedSiteName('instagram'),
                    color: platformColors.instagram,
                    platform: 'instagram',
                },
            };

            // Add media
            if (firstMedia.type === 'video') {
                // Use appropriate dimensions based on content type
                // Reels are 9:16 vertical (720x1280), posts are usually square (720x720)
                const isReel = parsed.type === 'reel';

                // Use proxy URL for video like vxinstagram does
                // This ensures Discord fetches the video properly
                const embedDomain = (env as any).EMBED_DOMAIN || 'embed.ken.tools';
                const proxyVideoUrl = `https://${embedDomain}/video/instagram?url=${encodeURIComponent(firstMedia.url)}`;

                result.data!.video = {
                    url: proxyVideoUrl,
                    width: isReel ? 720 : 720,    // Default width
                    height: isReel ? 1280 : 720,  // Reels are 9:16, posts are often square
                    thumbnail: preview || firstMedia.thumbnail,
                };
                result.data!.image = preview || firstMedia.thumbnail;
            } else {
                // Single image post
                // Use the full resolution URL from Snapsave
                result.data!.image = firstMedia.url;

                // Explicitly ensure we don't have video data that might confuse Discord
                result.data!.video = undefined;
            }

            // Try to get better metadata (username) from the embed page
            // Snapsave gives us the video, but often misses the username
            // Try to get better metadata (username) from the embed page
            // Snapsave gives us the video, but often misses the username
            try {
                const embedInfo = await scrapeEmbedHtml(canonicalUrl, parsed);
                if (embedInfo.success && embedInfo.data) {
                    let authorName = '';

                    // Update Title with author if found
                    if (embedInfo.data.title && embedInfo.data.title.includes('@')) {
                        // Parse "Username (@handle)" from title
                        const authorMatch = embedInfo.data.title.match(/^([^\(]+)/);
                        if (authorMatch) {
                            authorName = authorMatch[1].trim();
                        }
                        // Also try to get handle
                        const handleMatch = embedInfo.data.title.match(/\(@([^\)]+)\)/);
                        if (handleMatch) {
                            const handle = `@${handleMatch[1]}`;
                            // Prefer handle if name is just "Instagram" or empty
                            if (!authorName || authorName === 'Instagram') {
                                authorName = handle;
                            } else {
                                // Combine if both exist: Name (@handle)
                                authorName = `${authorName} (${handle})`;
                            }
                        }
                    }

                    // Fallback to simpler username scraping
                    if (!authorName && embedInfo.data.authorName) {
                        authorName = embedInfo.data.authorName;
                    }

                    if (authorName) {
                        // result.data!.authorName = authorName; // Don't set author field to avoid duplication
                        result.data!.title = authorName; // User requested: Author Name as Title
                    }

                    // Update description if we have a better one
                    if (!description && embedInfo.data.description) {
                        result.data!.description = embedInfo.data.description;
                    }
                }
            } catch (e) {
                // Ignore metadata fetch errors, we have the video at least
                console.warn('Failed to fetch extra metadata:', e);
            }

            // Fallback: If we still have generic title but have authorName (e.g. from existing logic), set it
            if ((result.data!.title === 'Post' || result.data!.title === 'Reel') && result.data!.authorName) {
                result.data!.title = result.data!.authorName;
                result.data!.authorName = undefined; // Clear author field to avoid duplication
            }
            // Clean description: Remove author name if it appears at the start
            // This happens often (e.g. "username Caption text")
            // Clean description: Remove author name if it appears at the start
            // This happens often (e.g. "username Caption text")
            if (result.data!.description && result.data!.title) {
                // Get the simple author name (without handle in parens if applicable)
                let simpleAuthor = result.data!.title.split('(')[0].trim();
                // Strip leading @ from simpleAuthor if present
                if (simpleAuthor.startsWith('@')) {
                    simpleAuthor = simpleAuthor.substring(1);
                }

                const handleMatch = result.data!.title.match(/\(@([^\)]+)\)/);
                const handle = handleMatch ? handleMatch[1] : null;

                let desc = result.data!.description;

                // Helper to remove prefix case-insensitively
                const removePrefix = (text: string, prefix: string) => {
                    if (text.toLowerCase().startsWith(prefix.toLowerCase())) {
                        return text.substring(prefix.length).trim();
                    }
                    if (text.toLowerCase().startsWith(`@${prefix.toLowerCase()}`)) {
                        return text.substring(prefix.length + 1).trim();
                    }
                    return text;
                };

                // Check and remove simple author name
                if (simpleAuthor) {
                    desc = removePrefix(desc, simpleAuthor);
                }

                // Check and remove handle if different
                if (handle && handle.toLowerCase() !== simpleAuthor.toLowerCase()) {
                    desc = removePrefix(desc, handle);
                }

                result.data!.description = desc;
            }

            return result;

        } catch (error) {
            console.error('Instagram handler error:', error);

            // Fallback: try embed HTML scraping
            return await scrapeEmbedHtml(canonicalUrl, parsed);
        }
    },
};

// ========== Fallback Scraper ==========

async function scrapeEmbedHtml(canonicalUrl: string, parsed: { type: string; shortcode: string }): Promise<HandlerResponse> {
    try {
        const embedUrl = `https://www.instagram.com/p/${parsed.shortcode}/embed/captioned/`;

        const response = await fetch(embedUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml',
            },
        });

        if (!response.ok) {
            return { success: false, error: `Instagram returned ${response.status}`, redirect: canonicalUrl };
        }

        const html = await response.text();

        // Extract username - multiple patterns
        let username = '';
        const usernamePatterns = [
            /class="UsernameText"[^>]*>([^<]+)</i,
            /"username":"([^"]+)"/,
            /data-log-event="usernameClick"[^>]*>([^<]+)</i,
            /@([a-zA-Z0-9._]+)/,
        ];
        for (const pattern of usernamePatterns) {
            const match = html.match(pattern);
            if (match) {
                username = match[1].trim();
                break;
            }
        }

        // Extract media URL - check multiple patterns
        let mediaUrl = '';
        let isVideo = false;

        // Pattern 1: Video from CDN (most reliable for actual videos)
        const cdnVideoMatch = html.match(/https:\/\/scontent[^"'\s]+\.mp4[^"'\s]*/);
        if (cdnVideoMatch) {
            mediaUrl = cdnVideoMatch[0].replace(/\\u0026/g, '&').replace(/&amp;/g, '&');
            isVideo = true;
        }

        // Pattern 2: Video element with class
        if (!mediaUrl) {
            const videoPatterns = [
                /class="[^"]*EmbeddedMediaVideo[^"]*"[^>]*src="([^"]+)"/i,
                /src="([^"]+)"[^>]*class="[^"]*EmbeddedMediaVideo[^"]*"/i,
                /<video[^>]*src="([^"]+)"/i,
                /"video_url":"([^"]+)"/,
            ];
            for (const pattern of videoPatterns) {
                const match = html.match(pattern);
                if (match) {
                    mediaUrl = match[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/');
                    isVideo = true;
                    break;
                }
            }
        }

        // Pattern 3: Image element with class
        if (!mediaUrl) {
            const imagePatterns = [
                /class="[^"]*EmbeddedMediaImage[^"]*"[^>]*src="([^"]+)"/i,
                /src="([^"]+)"[^>]*class="[^"]*EmbeddedMediaImage[^"]*"/i,
                /<img[^>]*class="[^"]*Embed[^"]*"[^>]*src="([^"]+)"/i,
                /https:\/\/scontent[^"'\s]+\.(?:jpg|jpeg|png|webp)[^"'\s]*/,
            ];
            for (const pattern of imagePatterns) {
                const match = html.match(pattern);
                if (match) {
                    mediaUrl = (match[1] || match[0]).replace(/\\u0026/g, '&').replace(/\\\//g, '/');
                    break;
                }
            }
        }

        // Pattern 4: Look in the JSON data embedded in script tags
        if (!mediaUrl) {
            const jsonPatterns = [
                /"display_url"\s*:\s*"([^"]+)"/,
                /"src"\s*:\s*"(https:\/\/scontent[^"]+)"/,
                /"video_url"\s*:\s*"([^"]+)"/,
                /"thumbnail_src":"([^"]+)"/,
            ];
            for (const pattern of jsonPatterns) {
                const match = html.match(pattern);
                if (match) {
                    mediaUrl = match[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/');
                    isVideo = pattern.source.includes('video');
                    break;
                }
            }
        }

        // Extract caption
        let caption = '';
        const captionPatterns = [
            /class="[^"]*Caption[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
            /"text"\s*:\s*"([^"]{1,500})"/,
        ];
        for (const pattern of captionPatterns) {
            const match = html.match(pattern);
            if (match) {
                caption = match[1]
                    .replace(/<br\s*\/?>/gi, '\n')
                    .replace(/<[^>]+>/g, '')
                    .replace(/\\n/g, '\n')
                    .replace(/\\u0026/g, '&')
                    .trim();
                if (caption.length > 0 && caption.length < 500) break;
            }
        }

        const result: HandlerResponse = {
            success: true,
            data: {
                title: caption ? truncateText(caption, 100) : 'Post',
                description: caption ? truncateText(caption, 280) : '',
                url: canonicalUrl,
                siteName: getBrandedSiteName('instagram'),
                authorName: username ? `@${username}` : undefined,
                color: platformColors.instagram,
                platform: 'instagram',
            },
        };

        if (mediaUrl) {
            if (isVideo) {
                result.data!.video = { url: mediaUrl, width: 1080, height: 1920 };
            } else {
                result.data!.image = mediaUrl;
            }
        }

        return result;

    } catch (error) {
        return { success: false, error: 'Failed to scrape embed', redirect: canonicalUrl };
    }
}
