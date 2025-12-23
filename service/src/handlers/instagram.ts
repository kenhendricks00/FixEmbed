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

    // Extract preview image
    const previewMatch = html.match(/class="media"[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"/) ||
        html.match(/<img[^>]*class="[^"]*download-items__thumb[^"]*"[^>]*src="([^"]+)"/) ||
        html.match(/<figure[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"/);
    if (previewMatch) preview = previewMatch[1];

    // Method 1: Table format (Facebook style)
    if (html.includes('class="table"')) {
        const rowMatches = html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
        for (const row of rowMatches) {
            const hrefMatch = row[1].match(/href="([^"]+)"/);
            if (hrefMatch && hrefMatch[1].startsWith('http')) {
                media.push({
                    url: hrefMatch[1],
                    type: 'video',
                });
                break; // Take first video
            }
        }
    }

    // Method 2: Download items format (Instagram)
    if (html.includes('download-items')) {
        const itemMatches = html.matchAll(/class="download-items"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi);
        for (const item of itemMatches) {
            const content = item[1];
            const thumbMatch = content.match(/download-items__thumb[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"/);
            const hrefMatch = content.match(/href="([^"]+)"/);
            const isPhoto = content.includes('Download Photo');

            if (isPhoto && thumbMatch) {
                media.push({
                    url: thumbMatch[1],
                    type: 'image',
                });
            } else if (hrefMatch) {
                media.push({
                    url: hrefMatch[1],
                    type: 'video',
                    thumbnail: thumbMatch?.[1],
                });
            }
        }
    }

    // Method 3: Card format
    if (html.includes('class="card"') && media.length === 0) {
        const cardMatches = html.matchAll(/class="card"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi);
        for (const card of cardMatches) {
            const content = card[1];
            const hrefMatch = content.match(/href="([^"]+)"/);
            const isPhoto = content.includes('Download Photo');

            if (hrefMatch) {
                media.push({
                    url: hrefMatch[1],
                    type: isPhoto ? 'image' : 'video',
                });
            }
        }
    }

    // Method 4: Direct link fallback
    if (media.length === 0) {
        const directHref = html.match(/<a[^>]*href="(https:\/\/[^"]+d\.rapidcdn\.app[^"]+)"[^>]*>/);
        if (directHref) {
            const isPhoto = html.includes('Download Photo');
            media.push({
                url: directHref[1],
                type: isPhoto ? 'image' : 'video',
            });
        }
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
                        : `View ${parsed.type === 'reel' ? 'Reel' : 'Post'} on Instagram`,
                    url: canonicalUrl,
                    siteName: 'Instagram',
                    color: platformColors.instagram,
                    platform: 'instagram',
                },
            };

            // Add media
            if (firstMedia.type === 'video') {
                result.data!.video = {
                    url: firstMedia.url,
                    width: 1080,
                    height: 1920,
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

        // Pattern 1: Video element with class
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

        // Pattern 2: Image element with class
        if (!mediaUrl) {
            const imagePatterns = [
                /class="[^"]*EmbeddedMediaImage[^"]*"[^>]*src="([^"]+)"/i,
                /src="([^"]+)"[^>]*class="[^"]*EmbeddedMediaImage[^"]*"/i,
                /<img[^>]*class="[^"]*Embed[^"]*"[^>]*src="([^"]+)"/i,
                /"display_url":"([^"]+)"/,
                /"thumbnail_src":"([^"]+)"/,
            ];
            for (const pattern of imagePatterns) {
                const match = html.match(pattern);
                if (match) {
                    mediaUrl = match[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/');
                    break;
                }
            }
        }

        // Pattern 3: Look in the JSON data embedded in script tags
        if (!mediaUrl) {
            const jsonPatterns = [
                /"display_url"\s*:\s*"([^"]+)"/,
                /"src"\s*:\s*"(https:\/\/[^"]+scontent[^"]+)"/,
                /"video_url"\s*:\s*"([^"]+)"/,
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
