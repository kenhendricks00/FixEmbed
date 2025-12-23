/**
 * FixEmbed Service - Instagram Handler
 * 
 * Uses snapsave-media-downloader for reliable media fetching.
 * Based on the vxinstagram approach.
 */

import { Env, HandlerResponse, PlatformHandler } from '../types';
import { parseInstagramUrl, truncateText } from '../utils/fetch';
import { platformColors } from '../utils/embed';

// Snapsave response types
interface SnapsaveMedia {
    url: string;
    thumbnail?: string;
    type: 'video' | 'image';
    resolution?: string;
}

interface SnapsaveResponse {
    success: boolean;
    data?: {
        description?: string;
        preview?: string;
        media?: SnapsaveMedia[];
    };
}

// Dynamic import for snapsave since it's an ESM module
async function fetchWithSnapsave(url: string): Promise<SnapsaveResponse | null> {
    try {
        // We need to replicate snapsave logic since we can't use npm packages directly in CF Workers
        // Snapsave API endpoint
        const snapsaveUrl = 'https://snapsave.app/action.php';

        const formData = new URLSearchParams();
        formData.append('url', url);

        const response = await fetch(snapsaveUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': '*/*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Origin': 'https://snapsave.app',
                'Referer': 'https://snapsave.app/',
            },
            body: formData,
        });

        if (!response.ok) {
            return null;
        }

        const html = await response.text();

        // Parse the response - snapsave returns HTML with embedded data
        // Look for the download links in the response
        const mediaUrls: SnapsaveMedia[] = [];

        // Try to extract video URL
        const videoMatch = html.match(/href="(https:\/\/[^"]+)"[^>]*>.*?Download.*?Video/gi);
        if (videoMatch) {
            for (const match of videoMatch) {
                const urlMatch = match.match(/href="([^"]+)"/);
                if (urlMatch) {
                    mediaUrls.push({
                        url: urlMatch[1],
                        type: 'video',
                    });
                    break; // Take first video
                }
            }
        }

        // Try to extract image URL
        const imageMatch = html.match(/href="(https:\/\/[^"]+)"[^>]*>.*?Download.*?Photo/gi) ||
            html.match(/href="(https:\/\/[^"]+)"[^>]*>.*?Download.*?Image/gi);
        if (imageMatch && mediaUrls.length === 0) {
            for (const match of imageMatch) {
                const urlMatch = match.match(/href="([^"]+)"/);
                if (urlMatch) {
                    mediaUrls.push({
                        url: urlMatch[1],
                        type: 'image',
                    });
                    break; // Take first image
                }
            }
        }

        // Alternative: look for rapidcdn URLs directly
        const cdnMatches = html.match(/https:\/\/d\.rapidcdn\.app\/d\?token=[^"'\s]+/g);
        if (cdnMatches && mediaUrls.length === 0) {
            // Determine type from context
            const isVideo = html.includes('video') || html.includes('mp4');
            mediaUrls.push({
                url: cdnMatches[0],
                type: isVideo ? 'video' : 'image',
            });
        }

        // Extract preview/thumbnail
        const previewMatch = html.match(/https:\/\/[^"'\s]+\.(?:jpg|jpeg|png|webp)/i);

        if (mediaUrls.length > 0) {
            return {
                success: true,
                data: {
                    media: mediaUrls,
                    preview: previewMatch ? previewMatch[0] : undefined,
                },
            };
        }

        return null;
    } catch (error) {
        console.error('Snapsave fetch error:', error);
        return null;
    }
}

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

        // Build canonical URL
        let canonicalUrl: string;
        if (parsed.type === 'reel') {
            canonicalUrl = `https://www.instagram.com/reel/${parsed.shortcode}/`;
        } else if (parsed.type === 'story') {
            canonicalUrl = url;
        } else {
            canonicalUrl = `https://www.instagram.com/p/${parsed.shortcode}/`;
        }

        try {
            // First, try to get data via snapsave
            const snapsaveResult = await fetchWithSnapsave(canonicalUrl);

            if (snapsaveResult?.success && snapsaveResult.data?.media && snapsaveResult.data.media.length > 0) {
                const firstMedia = snapsaveResult.data.media[0];

                const result: HandlerResponse = {
                    success: true,
                    data: {
                        title: 'Instagram',
                        description: snapsaveResult.data.description
                            ? truncateText(snapsaveResult.data.description, 280)
                            : `View ${parsed.type === 'reel' ? 'Reel' : 'Post'} on Instagram`,
                        url: canonicalUrl,
                        siteName: 'Instagram',
                        color: platformColors.instagram,
                        platform: 'instagram',
                    },
                };

                // Add media based on type
                if (firstMedia.type === 'video') {
                    result.data!.video = {
                        url: firstMedia.url,
                        width: 1080,
                        height: 1920,
                        thumbnail: snapsaveResult.data.preview || firstMedia.thumbnail,
                    };
                    result.data!.image = snapsaveResult.data.preview || firstMedia.thumbnail;
                } else {
                    result.data!.image = firstMedia.url;
                }

                return result;
            }

            // Fallback: Try embed HTML scraping
            return await scrapeEmbedHtml(canonicalUrl, parsed);

        } catch (error) {
            console.error('Instagram handler error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch Instagram content',
                redirect: canonicalUrl,
            };
        }
    },
};

// Fallback: Scrape Instagram's embed HTML
async function scrapeEmbedHtml(canonicalUrl: string, parsed: { type: string; shortcode: string }): Promise<HandlerResponse> {
    try {
        const embedUrl = `https://www.instagram.com/p/${parsed.shortcode}/embed/captioned/`;

        const response = await fetch(embedUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
        });

        if (!response.ok) {
            return {
                success: false,
                error: `Instagram returned ${response.status}`,
                redirect: canonicalUrl,
            };
        }

        const html = await response.text();

        // Extract username
        let username = '';
        const usernameMatch = html.match(/class="UsernameText"[^>]*>([^<]+)</i) ||
            html.match(/"username":"([^"]+)"/);
        if (usernameMatch) {
            username = usernameMatch[1].trim();
        }

        // Extract media URL
        let mediaUrl = '';
        let isVideo = false;

        // Try video first
        const videoMatch = html.match(/class="EmbeddedMediaVideo"[^>]*src="([^"]+)"/i) ||
            html.match(/src="([^"]+)"[^>]*class="EmbeddedMediaVideo"/i);
        if (videoMatch) {
            mediaUrl = videoMatch[1].replace(/\\u0026/g, '&');
            isVideo = true;
        }

        // Try image
        if (!mediaUrl) {
            const imageMatch = html.match(/class="EmbeddedMediaImage"[^>]*src="([^"]+)"/i) ||
                html.match(/src="([^"]+)"[^>]*class="EmbeddedMediaImage"/i);
            if (imageMatch) {
                mediaUrl = imageMatch[1].replace(/\\u0026/g, '&');
            }
        }

        // Extract caption
        let caption = '';
        const captionMatch = html.match(/class="Caption"[^>]*>([\s\S]*?)<\/div>/i);
        if (captionMatch) {
            caption = captionMatch[1]
                .replace(/<br\s*\/?>/gi, '\n')
                .replace(/<[^>]+>/g, '')
                .replace(/\\n/g, '\n')
                .trim();
        }

        // Build response
        const result: HandlerResponse = {
            success: true,
            data: {
                title: username ? `@${username} on Instagram` : 'Instagram',
                description: caption ? truncateText(caption, 280) : `View on Instagram`,
                url: canonicalUrl,
                siteName: 'Instagram',
                authorName: username || undefined,
                authorUrl: username ? `https://www.instagram.com/${username}/` : undefined,
                color: platformColors.instagram,
                platform: 'instagram',
            },
        };

        if (mediaUrl) {
            if (isVideo) {
                result.data!.video = {
                    url: mediaUrl,
                    width: 1080,
                    height: 1920,
                };
            } else {
                result.data!.image = mediaUrl;
            }
        }

        return result;

    } catch (error) {
        return {
            success: false,
            error: 'Failed to scrape embed',
            redirect: canonicalUrl,
        };
    }
}
