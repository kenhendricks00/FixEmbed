/**
 * FixEmbed Service - Instagram Handler
 * 
 * Uses Instagram's embed HTML page to scrape media data.
 * Approach inspired by InstaFix - no third-party dependencies.
 * 
 * Note: This may break if Instagram changes their embed page structure.
 */

import { Env, HandlerResponse, PlatformHandler } from '../types';
import { parseInstagramUrl, truncateText } from '../utils/fetch';
import { platformColors } from '../utils/embed';

// HTML parsing helpers
function extractBetween(html: string, start: string, end: string): string | null {
    const startIdx = html.indexOf(start);
    if (startIdx === -1) return null;
    const endIdx = html.indexOf(end, startIdx + start.length);
    if (endIdx === -1) return null;
    return html.substring(startIdx + start.length, endIdx);
}

function extractAttribute(html: string, tagClass: string, attr: string): string | null {
    // Look for class="tagClass" and then extract attr="value"
    const classPattern = new RegExp(`class="[^"]*${tagClass}[^"]*"[^>]*${attr}="([^"]+)"`, 'i');
    const classMatch = html.match(classPattern);
    if (classMatch) return classMatch[1];

    // Try reverse order (attr before class)
    const reversePattern = new RegExp(`${attr}="([^"]+)"[^>]*class="[^"]*${tagClass}[^"]*"`, 'i');
    const reverseMatch = html.match(reversePattern);
    if (reverseMatch) return reverseMatch[1];

    return null;
}

function extractTextContent(html: string, tagClass: string): string | null {
    // Find the element with the class and extract text content
    const pattern = new RegExp(`class="[^"]*${tagClass}[^"]*"[^>]*>([^<]+)<`, 'i');
    const match = html.match(pattern);
    return match ? match[1].trim() : null;
}

function decodeHtmlEntities(text: string): string {
    return text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#x27;/g, "'")
        .replace(/&#x2F;/g, '/')
        .replace(/\\u0026/g, '&')
        .replace(/\\u003c/g, '<')
        .replace(/\\u003e/g, '>')
        .replace(/\\n/g, '\n');
}

export const instagramHandler: PlatformHandler = {
    name: 'instagram',
    patterns: [
        /instagram\.com\/p\/([^\/\?]+)/i,
        /instagram\.com\/reel\/([^\/\?]+)/i,
        /instagram\.com\/reels\/([^\/\?]+)/i,
        /instagram\.com\/tv\/([^\/\?]+)/i,
        /instagram\.com\/stories\/([^\/]+)\/(\d+)/i,
    ],

    async handle(url: string, env: Env): Promise<HandlerResponse> {
        const parsed = parseInstagramUrl(url);

        if (!parsed) {
            return { success: false, error: 'Invalid Instagram URL' };
        }

        // Stories don't have embed support
        if (parsed.type === 'story') {
            return {
                success: false,
                redirect: url,
            };
        }

        try {
            // Fetch the embed/captioned page
            const embedUrl = `https://www.instagram.com/p/${parsed.shortcode}/embed/captioned/`;

            const response = await fetch(embedUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Accept-Encoding': 'gzip, deflate, br',
                },
            });

            if (!response.ok) {
                return {
                    success: false,
                    error: `Instagram returned ${response.status}`,
                    redirect: url,
                };
            }

            const html = await response.text();

            // Check for login requirement
            if (html.includes('login') && !html.includes('EmbeddedMedia')) {
                return {
                    success: false,
                    error: 'Content requires login',
                    redirect: url,
                };
            }

            // Extract data from embed HTML
            let username = '';
            let caption = '';
            let mediaUrl = '';
            let isVideo = false;

            // Method 1: Extract from HTML elements
            // Username: class="UsernameText"
            const usernameMatch = html.match(/class="UsernameText"[^>]*>([^<]+)</i);
            if (usernameMatch) {
                username = usernameMatch[1].trim();
            }

            // Try to get username from other patterns
            if (!username) {
                const altUsernameMatch = html.match(/"username":"([^"]+)"/);
                if (altUsernameMatch) {
                    username = altUsernameMatch[1];
                }
            }

            // Caption: class="Caption" - extract text between tags
            const captionMatch = html.match(/class="Caption"[^>]*>([\s\S]*?)<\/div>/i);
            if (captionMatch) {
                // Strip HTML tags and decode entities
                caption = captionMatch[1]
                    .replace(/<br\s*\/?>/gi, '\n')
                    .replace(/<[^>]+>/g, '')
                    .trim();
                caption = decodeHtmlEntities(caption);
            }

            // Media URL: Check for video first, then image
            // Video: class="EmbeddedMediaVideo" src="..."
            const videoMatch = html.match(/class="EmbeddedMediaVideo"[^>]*src="([^"]+)"/i) ||
                html.match(/src="([^"]+)"[^>]*class="EmbeddedMediaVideo"/i);
            if (videoMatch) {
                mediaUrl = decodeHtmlEntities(videoMatch[1]);
                isVideo = true;
            }

            // Image: class="EmbeddedMediaImage" src="..."
            if (!mediaUrl) {
                const imageMatch = html.match(/class="EmbeddedMediaImage"[^>]*src="([^"]+)"/i) ||
                    html.match(/src="([^"]+)"[^>]*class="EmbeddedMediaImage"/i);
                if (imageMatch) {
                    mediaUrl = decodeHtmlEntities(imageMatch[1]);
                }
            }

            // Method 2: Try to extract from embedded JSON (TimeSliceImpl)
            if (!mediaUrl || !username) {
                const jsonMatch = html.match(/"shortcode_media":\s*(\{[\s\S]*?\})\s*[,}]/);
                if (jsonMatch) {
                    try {
                        // This is fragile - Instagram's JSON is often escaped
                        const unescaped = decodeHtmlEntities(jsonMatch[1]);

                        // Extract fields with regex since JSON might be malformed
                        if (!username) {
                            const ownerMatch = unescaped.match(/"username":"([^"]+)"/);
                            if (ownerMatch) username = ownerMatch[1];
                        }

                        if (!mediaUrl) {
                            const displayUrlMatch = unescaped.match(/"display_url":"([^"]+)"/);
                            if (displayUrlMatch) {
                                mediaUrl = decodeHtmlEntities(displayUrlMatch[1]);
                            }
                        }

                        if (!caption) {
                            const textMatch = unescaped.match(/"text":"([^"]+)"/);
                            if (textMatch) {
                                caption = decodeHtmlEntities(textMatch[1]);
                            }
                        }
                    } catch (e) {
                        // JSON parsing failed, continue with what we have
                    }
                }
            }

            // Method 3: Look for og:image in meta tags
            if (!mediaUrl) {
                const ogImageMatch = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i) ||
                    html.match(/<meta[^>]*content="([^"]+)"[^>]*property="og:image"/i);
                if (ogImageMatch) {
                    mediaUrl = decodeHtmlEntities(ogImageMatch[1]);
                }
            }

            // If we still don't have enough data, fall back to redirect
            if (!mediaUrl && !username) {
                return {
                    success: false,
                    error: 'Could not extract content',
                    redirect: url,
                };
            }

            // Build canonical URL
            const canonicalUrl = `https://www.instagram.com/${parsed.type === 'reel' ? 'reel' : 'p'}/${parsed.shortcode}/`;

            // Prepare description
            const description = caption
                ? truncateText(caption, 280)
                : `${parsed.type === 'reel' ? 'Reel' : 'Post'} by @${username || 'Instagram User'}`;

            // Build response
            const result: HandlerResponse = {
                success: true,
                data: {
                    title: username ? `@${username} on Instagram` : 'Instagram',
                    description,
                    url: canonicalUrl,
                    siteName: 'Instagram',
                    authorName: username || undefined,
                    authorUrl: username ? `https://www.instagram.com/${username}/` : undefined,
                    color: platformColors.instagram,
                    platform: 'instagram',
                },
            };

            // Add media
            if (mediaUrl) {
                if (isVideo) {
                    result.data!.video = {
                        url: mediaUrl,
                        width: 1080,
                        height: 1920,
                    };
                    // Also set thumbnail
                    result.data!.image = mediaUrl.replace(/\.mp4.*$/, '.jpg');
                } else {
                    result.data!.image = mediaUrl;
                }
            }

            return result;

        } catch (error) {
            console.error('Instagram handler error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch Instagram content',
                redirect: url,
            };
        }
    },
};
