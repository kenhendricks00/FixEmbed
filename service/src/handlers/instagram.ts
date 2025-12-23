/**
 * FixEmbed Service - Instagram Handler
 * 
 * Uses Snapsave API with proper decryption.
 * Based on snapsave-media-downloader implementation.
 */

import { Env, HandlerResponse, PlatformHandler } from '../types';
import { parseInstagramUrl, truncateText } from '../utils/fetch';
import { platformColors } from '../utils/embed';

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

    // Priority 1: Find rapidcdn /v2 video URL (this is the actual video)
    const rapidcdnV2Match = html.match(/https:\/\/d\.rapidcdn\.app\/v2\?token=[^"'\s<>]+/);
    if (rapidcdnV2Match) {
        media.push({
            url: rapidcdnV2Match[0],
            type: 'video',
            thumbnail: preview,
        });
        return { media, description, preview };
    }

    // Priority 2: Find rapidcdn /d download URL
    const rapidcdnDMatch = html.match(/https:\/\/d\.rapidcdn\.app\/d\?token=[^"'\s<>]+/);
    if (rapidcdnDMatch) {
        media.push({
            url: rapidcdnDMatch[0],
            type: 'video',
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
                    type: 'video',
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
                    title: 'Instagram',
                    description: description
                        ? truncateText(description, 280)
                        : undefined, // Don't set default description
                    url: canonicalUrl,
                    siteName: 'Instagram',
                    color: platformColors.instagram,
                    platform: 'instagram',
                },
            };

            // Add media
            if (firstMedia.type === 'video') {
                // Use appropriate dimensions based on content type
                // Reels are 9:16 vertical (720x1280), posts are usually square
                const isReel = parsed.type === 'reel';

                // Use proxy URL for video like vxinstagram does
                // This ensures Discord fetches the video properly
                const embedDomain = (env as any).EMBED_DOMAIN || 'embed.ken.tools';
                const proxyVideoUrl = `https://${embedDomain}/video/instagram?url=${encodeURIComponent(firstMedia.url)}`;

                result.data!.video = {
                    url: proxyVideoUrl,
                    width: isReel ? 720 : 720,  // Re-add dimensions to guide Discord
                    height: isReel ? 1280 : 720,
                    thumbnail: preview || firstMedia.thumbnail,
                };
                result.data!.image = preview || firstMedia.thumbnail;
            } else {
                result.data!.image = firstMedia.url;
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
                title: username ? `@${username} on Instagram` : 'Instagram',
                description: caption ? truncateText(caption, 280) : `View on Instagram`,
                url: canonicalUrl,
                siteName: 'Instagram',
                authorName: username || undefined,
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
