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

import type { EmbedData, Env, HandlerResponse, PlatformHandler } from '../types.ts';
import {
    deriveMetaShortcodeTimestamp,
    normalizePostTimestamp,
} from '../utils/timestamp.ts';
import { createTimeoutBudget, fetchWithTimeout, parseInstagramUrl, truncateText } from '../utils/fetch.ts';
import { formatStats, platformColors, getBrandedSiteName } from '../utils/embed.ts';

const INSTAGRAM_TOTAL_TIMEOUT_MS = 3500;
const INSTAGRAM_NATIVE_TIMEOUT_MS = 2200;
const INSTAGRAM_CANONICAL_TIMEOUT_MS = 1200;
const INSTAGRAM_VX_TIMEOUT_MS = 1200;
const INSTAGRAM_KK_TIMEOUT_MS = 600;
const INSTAGRAM_STATS_TIMEOUT_MS = 650;
const INSTAGRAM_MAX_CAROUSEL_ITEMS = 20;

// ========== VxInstagram Scraper ==========
// Scrapes vxinstagram.com for composite carousel images and metadata

async function scrapeVxInstagram(shortcode: string, type: string, timeoutMs: number): Promise<{
    success: boolean;
    image?: string;
    video?: string;
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

        const response = await fetchWithTimeout(vxUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
                'Accept': 'text/html',
            },
        }, timeoutMs);

        if (!response.ok) {
            return { success: false, error: `vxinstagram returned ${response.status}` };
        }

        const html = await response.text();

        // Extract OG tags
        const ogImage = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1];
        const ogTitle = html.match(/<meta property="og:title" content="([^"]+)"/)?.[1];
        const ogDesc = html.match(/<meta property="og:description" content="([^"]+)"/)?.[1];
        const ogType = html.match(/<meta property="og:type" content="([^"]+)"/)?.[1];
        const ogVideo = html.match(/<meta property="og:video(?::url|:secure_url)?" content="([^"]+)"/)?.[1];

        // Check if it's a video (vxinstagram typically redirects videos to snapsave)
        const isVideo = Boolean(ogVideo || ogType?.includes('video') || html.includes('og:video'));

        // Only use image if it's a generated composite (carousel)
        // Standard single images use a proxy link that often fails or expires
        const isComposite = ogImage?.includes('/generated/');

        if (!isComposite && !ogVideo) {
            return { success: false, error: 'Not a carousel/composite image' };
        }

        // Note: vxinstagram doesn't expose the actual author username in metadata
        // The @realAlita in the HTML is a developer credit, so we don't extract it.
        // We'll rely on the fallback scraper (Snapsave) to get the author if needed.

        return {
            success: true,
            image: ogImage,
            video: ogVideo,
            username: undefined, // Don't return username from vxinstagram to avoid wrong attribution
            description: ogDesc || ogTitle,
            isVideo,
        };
    } catch (error) {
        console.warn('fallback_fetch_failed', {
            platform: 'instagram',
            provider: 'vxinstagram',
            errorType: error instanceof Error ? error.name : 'unknown',
        });
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
                // If payload exists but no .mp4 found, it's likely an image
                if (payload.url || payload.filename) {
                    return 'image';
                }
            }
        } catch (e) {
            // Ignore decode errors
        }
        // Only treat as video if URL directly contains .mp4 extension
        if (url.includes('.mp4')) {
            return 'video';
        }
        // Fall back to button text detection
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
        let inputUrl: URL;
        try {
            inputUrl = new URL(url);
        } catch {
            return { success: false, error: 'Invalid Instagram URL' };
        }
        const inputHost = inputUrl.hostname.toLowerCase().replace(/^www\./, '');
        if (inputUrl.protocol !== 'https:' || inputHost !== 'instagram.com') {
            return { success: false, error: 'Invalid Instagram URL' };
        }

        let resolvedUrl = url;
        let parsed = parseInstagramUrl(resolvedUrl);

        if (!parsed && /instagram\.com\/share\/(?:p|reel)\//i.test(url)) {
            try {
                const safeShareUrl = `https://www.instagram.com${inputUrl.pathname}`;
                const response = await fetchWithTimeout(safeShareUrl, {
                    redirect: 'follow',
                    headers: {
                        'Accept': 'text/html,application/xhtml+xml',
                        'User-Agent': 'Mozilla/5.0 (compatible; FixEmbed/1.0; +https://fixembed.app)',
                    },
                }, INSTAGRAM_NATIVE_TIMEOUT_MS);
                resolvedUrl = response.url || url;
                parsed = parseInstagramUrl(resolvedUrl);

                if (!parsed && response.ok) {
                    const html = await response.text();
                    const canonicalMatch = html.match(
                        /<(?:link|meta)[^>]+(?:href|content)=["'](https:\/\/(?:www\.)?instagram\.com\/(?:p|reels?)\/[^"']+)["'][^>]*>/i,
                    );
                    if (canonicalMatch) {
                        resolvedUrl = canonicalMatch[1].replace(/&amp;/g, '&');
                        parsed = parseInstagramUrl(resolvedUrl);
                    }
                }
            } catch (error) {
                console.warn('first_party_fetch_failed', {
                    platform: 'instagram',
                    stage: 'share_resolution',
                    errorType: error instanceof Error ? error.name : 'unknown',
                });
            }
        }

        if (!parsed) {
            return { success: false, error: 'Unable to resolve Instagram share URL', redirect: url };
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

        let nativeResult: HandlerResponse | undefined;
        try {
            const remainingProviderTime = createTimeoutBudget(INSTAGRAM_TOTAL_TIMEOUT_MS);
            const shortcodeTimestamp = deriveMetaShortcodeTimestamp(parsed.shortcode);
            // First-party FixEmbed path: use Instagram's own embed document and
            // render its metadata ourselves before consulting embed services.
            nativeResult = await scrapeEmbedHtml(
                canonicalUrl,
                parsed,
                remainingProviderTime(INSTAGRAM_NATIVE_TIMEOUT_MS),
            );
            if (nativeResult.data && !nativeResult.data.timestamp) {
                nativeResult.data.timestamp = shortcodeTimestamp;
            }
            if (parsed.type === 'reel' && nativeResult.data?.video?.url) {
                // Discord must fetch media through FixEmbed, not Instagram CDN
                // directly. Relay trusted first-party MP4s so reel recovery does
                // not depend on flaky third-party embed hosts.
                const trustedVideo = trustedInstagramMediaUrl(nativeResult.data.video.url);
                if (trustedVideo) {
                    const embedDomain = env.EMBED_DOMAIN || 'fixembed.app';
                    nativeResult.data = {
                        ...nativeResult.data,
                        video: {
                            ...nativeResult.data.video,
                            url: `https://${embedDomain}/video/instagram?url=${encodeURIComponent(trustedVideo)}`,
                        },
                    };
                } else {
                    nativeResult.data = {
                        ...nativeResult.data,
                        video: undefined,
                    };
                }
            }
            let nativeHasRequiredMedia = parsed.type === 'reel'
                ? Boolean(nativeResult.data?.video)
                : Boolean(nativeResult.data?.image || nativeResult.data?.video);
            const nativeHasPublicContext = Boolean(
                nativeResult.data?.authorHandle || nativeResult.data?.caption,
            );
            if (
                nativeResult.success
                && nativeHasRequiredMedia
                && nativeHasPublicContext
            ) {
                return nativeResult;
            }

            // Instagram's embed document can be skeletal while the canonical
            // crawler response still contains the public creator, caption,
            // engagement, avatar, and poster. Recover that metadata in parallel
            // with Vx media so the fallback remains inside one shared deadline.
            const [canonicalResult, vxResult] = await Promise.all([
                scrapeCanonicalHtml(
                    canonicalUrl,
                    parsed,
                    remainingProviderTime(INSTAGRAM_CANONICAL_TIMEOUT_MS),
                ),
                scrapeVxInstagram(
                    parsed.shortcode,
                    parsed.type,
                    remainingProviderTime(INSTAGRAM_VX_TIMEOUT_MS),
                ),
            ]);
            if (canonicalResult.success && canonicalResult.data) {
                const canonicalData = parsed.type === 'reel'
                    ? {
                        ...canonicalResult.data,
                        video: undefined,
                    }
                    : canonicalResult.data;
                const enrichedData = mergeCanonicalInstagramData(
                    nativeResult.data,
                    canonicalData,
                );
                nativeResult = {
                    ...nativeResult,
                    success: true,
                    data: enrichedData,
                };
                nativeHasRequiredMedia = parsed.type === 'reel'
                    ? Boolean(enrichedData.video)
                    : Boolean(enrichedData.image || enrichedData.video);
                if (nativeHasRequiredMedia) {
                    return nativeResult;
                }
            }

            if (vxResult.success && vxResult.isVideo && vxResult.video) {
                const embedDomain = env.EMBED_DOMAIN || 'fixembed.app';
                const metadata = nativeResult.data;
                const preview = vxResult.image || metadata?.video?.thumbnail || metadata?.image;
                return {
                    success: true,
                    source: 'fallback',
                    data: {
                        title: metadata?.title || 'Reel',
                        description: metadata?.description || vxResult.description || '',
                        caption: metadata?.caption || vxResult.description || undefined,
                        url: canonicalUrl,
                        siteName: getBrandedSiteName('instagram'),
                        authorName: metadata?.authorName,
                        authorHandle: metadata?.authorHandle,
                        authorUrl: metadata?.authorUrl,
                        authorAvatar: metadata?.authorAvatar,
                        stats: metadata?.stats,
                        timestamp: metadata?.timestamp || shortcodeTimestamp,
                        video: {
                            url: `https://${embedDomain}/video/instagram?url=${encodeURIComponent(vxResult.video)}`,
                            width: 720,
                            height: 1280,
                            thumbnail: preview,
                        },
                        image: preview,
                        color: platformColors.instagram,
                        platform: 'instagram',
                    },
                };
            }

            if (
                vxResult.success
                && vxResult.image
                && !vxResult.isVideo
                && parsed.type !== 'reel'
            ) {
                // VxInstagram found an image (possibly composite carousel)

                const metadata = nativeResult.data;
                const authorName = metadata?.authorName;
                const authorHandle = metadata?.authorHandle;
                const authorUrl = metadata?.authorUrl;
                const authorAvatar = metadata?.authorAvatar;
                const timestamp = metadata?.timestamp || shortcodeTimestamp;

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
                    source: 'fallback',
                    data: {
                        title: desc ? truncateText(desc, 100) : 'Post',
                        description: '',
                        caption: desc || undefined,
                        url: canonicalUrl,
                        siteName: getBrandedSiteName('instagram'),
                        authorName: authorName || undefined,
                        authorHandle,
                        authorUrl,
                        authorAvatar,
                        timestamp: timestamp || shortcodeTimestamp,
                        image: vxResult.image, // This is the composite carousel image from vxinstagram
                        color: platformColors.instagram,
                        platform: 'instagram',
                    },
                };
            }

            // Instagram's embed HTML no longer consistently includes media URLs.
            // KKInstagram resolves the public post/reel to Instagram's CDN, so use
            // it as the media-only recovery path while preserving our own metadata
            // and branded rendering.
            const kkMediaUrl = `https://kkinstagram.com/${parsed.type === 'reel' ? 'reel' : 'p'}/${parsed.shortcode}/`;
            let kkAvailable = false;
            let kkContentType = '';
            let kkRedirectedToVideo = false;
            try {
                // KK returns 405 for Range probes and 302 to CDN MP4 for plain GET.
                // Inspect redirects manually so availability checks stay cheap.
                const kkResponse = await fetchWithTimeout(kkMediaUrl, {
                    redirect: 'manual',
                    headers: {
                        'Accept': 'image/*,video/*',
                        'User-Agent': 'Discordbot/2.0',
                    },
                }, remainingProviderTime(INSTAGRAM_KK_TIMEOUT_MS));
                kkContentType = kkResponse.headers.get('Content-Type') || '';
                const kkLocation = kkResponse.headers.get('Location') || '';
                kkRedirectedToVideo = [301, 302, 303, 307, 308].includes(kkResponse.status)
                    && /\.mp4(?:$|[?#])/i.test(kkLocation);
                kkAvailable = (
                    kkResponse.ok && (
                        kkContentType.startsWith('image/')
                        || kkContentType.startsWith('video/')
                    )
                ) || kkRedirectedToVideo;
            } catch (error) {
                console.warn('fallback_fetch_failed', {
                    platform: 'instagram',
                    provider: 'kkinstagram',
                    errorType: error instanceof Error ? error.name : 'unknown',
                });
            }

            if (
                kkAvailable
                && parsed.type === 'reel'
                && (kkContentType.startsWith('video/') || kkRedirectedToVideo)
            ) {
                const embedDomain = env.EMBED_DOMAIN || 'fixembed.app';
                return {
                    success: true,
                    source: 'fallback',
                    data: {
                        ...(nativeResult.data || {}),
                        title: nativeResult.data?.title || 'Reel',
                        description: nativeResult.data?.description || '',
                        url: canonicalUrl,
                        siteName: getBrandedSiteName('instagram'),
                        video: {
                            url: `https://${embedDomain}/video/instagram?url=${encodeURIComponent(kkMediaUrl)}`,
                            width: 720,
                            height: 1280,
                        },
                        color: platformColors.instagram,
                        platform: 'instagram',
                    },
                };
            }

            if (kkAvailable && parsed.type !== 'reel') {
                return {
                    success: true,
                    source: 'fallback',
                    data: {
                        ...(nativeResult.data || {}),
                        title: nativeResult.data?.title || 'Post',
                        description: nativeResult.data?.description || '',
                        url: canonicalUrl,
                        siteName: getBrandedSiteName('instagram'),
                        image: kkMediaUrl,
                        color: platformColors.instagram,
                        platform: 'instagram',
                    },
                };
            }

            // For videos/reels or if vxinstagram failed, use Snapsave
            // Call Snapsave API
            const formData = new URLSearchParams();
            formData.append('url', canonicalUrl);

            const response = await fetchWithTimeout('https://snapsave.app/action.php?lang=en', {
                method: 'POST',
                headers: {
                    'Accept': '*/*',
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Origin': 'https://snapsave.app',
                    'Referer': 'https://snapsave.app/',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                },
                body: formData,
            }, remainingProviderTime());

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
            if (parsed.type === 'reel' && firstMedia.type !== 'video') {
                throw new Error('Recovered Instagram reel media was not a video');
            }

            const result: HandlerResponse = {
                success: true,
                source: 'fallback',
                data: {
                    ...(nativeResult.data || {}),
                    title: nativeResult.data?.title || (parsed.type === 'reel' ? 'Reel' : 'Post'),
                    description: nativeResult.data?.description || (description
                        ? truncateText(description, 280)
                        : ''),
                    caption: nativeResult.data?.caption || description || undefined,
                    url: canonicalUrl,
                    siteName: getBrandedSiteName('instagram'),
                    timestamp: nativeResult.data?.timestamp || shortcodeTimestamp,
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
                const embedDomain = env.EMBED_DOMAIN || 'fixembed.app';
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
            console.warn('fallback_fetch_failed', {
                platform: 'instagram',
                provider: 'media_recovery_chain',
                errorType: error instanceof Error ? error.name : 'unknown',
            });

            if (
                nativeResult?.success
                && (parsed.type !== 'reel' || Boolean(nativeResult.data?.video))
            ) {
                return nativeResult;
            }
            return { success: false, error: 'Unable to recover Instagram media', redirect: canonicalUrl };
        }
    },
};

// ========== Fallback Scraper ==========

function decodeInstagramMediaUrl(value: string): string {
    let decoded = value
        .replace(
            /\\+u([0-9a-f]{4})/gi,
            (_escape, code: string) => String.fromCharCode(Number.parseInt(code, 16)),
        )
        .replace(/\\+\//g, '/')
        .replace(/&#0*38;/g, '&');
    while (decoded.includes('&amp;')) {
        decoded = decoded.replace(/&amp;/g, '&');
    }
    return decoded;
}

function decodeInstagramText(value: string): string {
    const decodeCodePoint = (entity: string, code: string, radix: number): string => {
        const value = Number.parseInt(code, radix);
        return Number.isInteger(value) && value >= 0 && value <= 0x10ffff
            ? String.fromCodePoint(value)
            : entity;
    };
    return value
        .replace(/&#x([0-9a-f]+);/gi, (entity, code) => decodeCodePoint(entity, code, 16))
        .replace(/&#(\d+);/g, (entity, code) => decodeCodePoint(entity, code, 10))
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&apos;|&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
}

function trustedInstagramMediaUrl(value: string): string | undefined {
    try {
        const decoded = decodeInstagramMediaUrl(value);
        const url = new URL(decoded);
        const hostname = url.hostname.toLowerCase();
        const trustedHost = hostname === 'cdninstagram.com'
            || hostname.endsWith('.cdninstagram.com')
            || hostname === 'fbcdn.net'
            || hostname.endsWith('.fbcdn.net');
        if (
            url.protocol !== 'https:'
            || !trustedHost
            || url.username
            || url.password
        ) {
            return undefined;
        }
        return url.toString();
    } catch {
        return undefined;
    }
}

function extractInstagramMeta(
    html: string,
    attribute: 'name' | 'property',
    key: string,
): string | undefined {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
        new RegExp(
            `<meta\\b[^>]*\\b${attribute}=["']${escapedKey}["'][^>]*\\bcontent=["']([^"']*)["']`,
            'i',
        ),
        new RegExp(
            `<meta\\b[^>]*\\bcontent=["']([^"']*)["'][^>]*\\b${attribute}=["']${escapedKey}["']`,
            'i',
        ),
    ];
    for (const pattern of patterns) {
        const value = html.match(pattern)?.[1];
        if (value) return decodeInstagramText(value).trim();
    }
    return undefined;
}

function decodeInstagramJsonString(value: string | undefined): string | undefined {
    if (!value) return undefined;
    try {
        return decodeInstagramText(JSON.parse(`"${value}"`)).trim() || undefined;
    } catch {
        return undefined;
    }
}

function extractInstagramCanonicalAvatar(
    html: string,
    expectedUsername: string,
): string | undefined {
    if (!expectedUsername) return undefined;
    const escapedUsername = expectedUsername.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
        new RegExp(
            `"user"\\s*:\\s*\\{[^{}]{0,4096}?"username"\\s*:\\s*"${escapedUsername}"[^{}]{0,4096}?"profile_pic_url"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`,
            'i',
        ),
        new RegExp(
            `"user"\\s*:\\s*\\{[^{}]{0,4096}?"profile_pic_url"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"[^{}]{0,4096}?"username"\\s*:\\s*"${escapedUsername}"`,
            'i',
        ),
    ];
    for (const pattern of patterns) {
        const avatar = html.match(pattern)?.[1];
        if (avatar) return trustedInstagramMediaUrl(avatar);
    }
    return undefined;
}

function parseCanonicalInstagramMetadata(
    html: string,
    canonicalUrl: string,
    parsed: { type: string; shortcode: string },
): EmbedData | undefined {
    const escapedShortcode = parsed.shortcode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const mediaMarker = new RegExp(`"code"\\s*:\\s*"${escapedShortcode}"`, 'g');
    let mediaIndex = -1;
    for (const match of html.matchAll(mediaMarker)) mediaIndex = match.index;
    const mediaHtml = mediaIndex >= 0
        ? html.slice(mediaIndex, mediaIndex + 256 * 1024)
        : html;
    const twitterTitle = extractInstagramMeta(html, 'name', 'twitter:title');
    const titleIdentity = twitterTitle?.match(
        /^(.+?)\s+\(@([a-z0-9._]+)\)\s+\u2022\s+Instagram\b/i,
    );
    const publicUrl = extractInstagramMeta(html, 'property', 'og:url');
    let username = titleIdentity?.[2] || '';
    if (!username && publicUrl) {
        try {
            const segments = new URL(publicUrl).pathname.split('/').filter(Boolean);
            if (segments[1] === 'p' || segments[1] === 'reel' || segments[1] === 'reels') {
                [username] = segments;
            }
        } catch {
            // Invalid canonical metadata is ignored.
        }
    }

    const caption = decodeInstagramJsonString(
        mediaHtml.match(
            /"caption"\s*:\s*\{[^{}]{0,4096}?"text"\s*:\s*"((?:\\.|[^"\\])*)"/i,
        )?.[1],
    );
    const likes = Number(mediaHtml.match(/"like_count"\s*:\s*(\d+)/)?.[1]);
    const comments = Number(mediaHtml.match(/"comment_count"\s*:\s*(\d+)/)?.[1]);
    const poster = trustedInstagramMediaUrl(
        extractInstagramMeta(html, 'property', 'og:image') || '',
    );
    const authorName = titleIdentity?.[1]?.trim() || username;
    const authorAvatar = extractInstagramCanonicalAvatar(html, username);
    const timestamp = extractInstagramTimestamp(mediaHtml);
    const hasPublicMetadata = Boolean(
        username
        || caption
        || poster
        || Number.isFinite(likes)
        || Number.isFinite(comments),
    );
    if (!hasPublicMetadata) return undefined;

    return {
        title: caption
            ? truncateText(caption, 100)
            : parsed.type === 'reel'
                ? 'Reel'
                : 'Post',
        description: '',
        caption,
        url: canonicalUrl,
        siteName: getBrandedSiteName('instagram'),
        authorName: authorName || undefined,
        authorHandle: username ? `@${username}` : undefined,
        authorUrl: username ? `https://www.instagram.com/${username}/` : undefined,
        authorAvatar,
        image: poster,
        color: platformColors.instagram,
        platform: 'instagram',
        stats: formatStats({
            likes: Number.isFinite(likes) ? likes : undefined,
            comments: Number.isFinite(comments) ? comments : undefined,
        }),
        timestamp,
    };
}

function mergeCanonicalInstagramData(
    current: EmbedData | undefined,
    canonical: EmbedData,
): EmbedData {
    if (!current) return canonical;
    const currentHasCaption = Boolean(current.caption);
    return {
        ...current,
        title: currentHasCaption ? current.title : canonical.title,
        description: current.description || canonical.description,
        caption: current.caption || canonical.caption,
        authorName: current.authorName || canonical.authorName,
        authorHandle: current.authorHandle || canonical.authorHandle,
        authorUrl: current.authorUrl || canonical.authorUrl,
        authorAvatar: current.authorAvatar || canonical.authorAvatar,
        image: current.image || canonical.image,
        video: current.video || canonical.video,
        stats: canonical.stats || current.stats,
        timestamp: canonical.timestamp || current.timestamp,
    };
}

function extractInstagramOwnerAvatar(
    html: string,
    expectedUsername: string,
): string | undefined {
    const ownerFormats = [
        /\\"owner\\"\s*:\s*\{[^{}]{0,4096}?\\"username\\"\s*:\s*\\"([^"\\]+)\\"[^{}]{0,4096}?\\"profile_pic_url\\"\s*:\s*\\"([\s\S]{1,4096}?)\\"(?=\s*[,}])/gi,
        /"owner"\s*:\s*\{[^{}]{0,4096}?"username"\s*:\s*"([^"]+)"[^{}]{0,4096}?"profile_pic_url"\s*:\s*"([^"]{1,4096})"(?=\s*[,}])/gi,
    ];

    for (const format of ownerFormats) {
        for (const ownerMatch of html.matchAll(format)) {
            const ownerUsername = ownerMatch[1];
            const avatar = ownerMatch[2];
            if (
                !ownerUsername
                || !avatar
                || (
                    expectedUsername
                    && ownerUsername.toLowerCase() !== expectedUsername.toLowerCase()
                )
            ) {
                continue;
            }
            const trustedAvatar = trustedInstagramMediaUrl(avatar);
            if (trustedAvatar) return trustedAvatar;
        }
    }
    return undefined;
}

function parseInstagramCount(value: string | undefined): number | undefined {
    const match = value?.trim().match(/^([\d,.]+)\s*([KMB])?$/i);
    if (!match) return undefined;

    const number = Number(match[1].replace(/,/g, ''));
    if (!Number.isFinite(number)) return undefined;

    const multiplier = match[2]?.toUpperCase() === 'K'
        ? 1_000
        : match[2]?.toUpperCase() === 'M'
            ? 1_000_000
            : match[2]?.toUpperCase() === 'B'
                ? 1_000_000_000
                : 1;
    return Math.round(number * multiplier);
}

function parseInstagramReaderStats(
    markdown: string,
    shortcode: string,
): { likes?: number; comments?: number } {
    const commentsText = markdown.match(
        /(?:View all|##)\s+([\d,.]+\s*[KMB]?)\s+comments?/i,
    )?.[1];
    const comments = parseInstagramCount(commentsText)
        ?? (/##\s+No comments yet\.?/i.test(markdown) ? 0 : undefined);

    const explicitLikes = markdown.match(/([\d,.]+\s*[KMB]?)\s+likes?\b/i)?.[1];
    const escapedShortcode = shortcode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const timestampAdjacentLikes = markdown.match(new RegExp(
        String.raw`(?:^|\n)\s*([\d,.]+\s*[KMB]?)\s*\r?\n\s*\r?\n\[[^\]\r\n]+\]\(https:\/\/www\.instagram\.com\/[^)\r\n]*\/${escapedShortcode}\/?(?:\?[^)\r\n]*)?\)`,
        'i',
    ))?.[1];
    const likes = parseInstagramCount(explicitLikes || timestampAdjacentLikes);

    return { likes, comments };
}

async function scrapeInstagramReaderStats(
    canonicalUrl: string,
    shortcode: string,
    timeoutMs: number,
): Promise<{ likes?: number; comments?: number }> {
    try {
        const response = await fetchWithTimeout(
            `https://r.jina.ai/${canonicalUrl}`,
            { headers: { 'Accept': 'text/plain' } },
            Math.min(INSTAGRAM_STATS_TIMEOUT_MS, timeoutMs),
        );
        if (!response.ok) return {};
        return parseInstagramReaderStats(await response.text(), shortcode);
    } catch {
        return {};
    }
}

function extractInstagramImageUrls(html: string): string[] {
    const urls: string[] = [];
    const seen = new Set<string>();

    const patterns = [
        /"display_url"\s*:\s*"([^"]+)"/g,
        /\\"display_url\\"\s*:\s*\\"(.+?)\\"/g,
    ];
    for (const pattern of patterns) {
        for (const match of html.matchAll(pattern)) {
            const url = decodeInstagramMediaUrl(match[1]);
            if (!url.startsWith('https://') || seen.has(url)) continue;
            seen.add(url);
            urls.push(url);
            if (urls.length === INSTAGRAM_MAX_CAROUSEL_ITEMS) return urls;
        }
    }

    return urls;
}

function extractInstagramTimestamp(html: string): string | undefined {
    const numeric = html.match(/"taken_at"\s*:\s*(\d{9,13})/)?.[1]
        || html.match(/"taken_at_timestamp"\s*:\s*(\d{9,13})/)?.[1];
    if (numeric) return normalizePostTimestamp(numeric);

    const dateValue = html.match(/<time\b[^>]*\bdatetime=["']([^"']+)["']/i)?.[1]
        || html.match(/<meta\b[^>]*(?:itemprop|property)=["'](?:datePublished|uploadDate|article:published_time)["'][^>]*\bcontent=["']([^"']+)["']/i)?.[1]
        || html.match(/<meta\b[^>]*\bcontent=["']([^"']+)["'][^>]*(?:itemprop|property)=["'](?:datePublished|uploadDate|article:published_time)["']/i)?.[1];
    return normalizePostTimestamp(dateValue);
}

async function scrapeCanonicalHtml(
    canonicalUrl: string,
    parsed: { type: string; shortcode: string },
    timeoutMs: number,
): Promise<HandlerResponse> {
    try {
        const response = await fetchWithTimeout(canonicalUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; FixEmbed/1.0; +https://fixembed.app)',
                'Accept': 'text/html,application/xhtml+xml',
            },
        }, timeoutMs);
        if (!response.ok) {
            return {
                success: false,
                error: `Instagram returned ${response.status}`,
                redirect: canonicalUrl,
            };
        }

        const data = parseCanonicalInstagramMetadata(
            await response.text(),
            canonicalUrl,
            parsed,
        );
        return data
            ? { success: true, source: 'first-party', data }
            : {
                success: false,
                error: 'Instagram canonical metadata was incomplete',
                redirect: canonicalUrl,
            };
    } catch {
        return {
            success: false,
            error: 'Failed to scrape canonical Instagram metadata',
            redirect: canonicalUrl,
        };
    }
}

async function scrapeEmbedHtml(
    canonicalUrl: string,
    parsed: { type: string; shortcode: string },
    timeoutMs: number = INSTAGRAM_NATIVE_TIMEOUT_MS,
): Promise<HandlerResponse> {
    try {
        const embedUrl = `https://www.instagram.com/p/${parsed.shortcode}/embed/captioned/`;

        const response = await fetchWithTimeout(embedUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml',
            },
        }, timeoutMs);

        if (!response.ok) {
            console.warn('first_party_fetch_failed', {
                platform: 'instagram',
                stage: 'embed',
                status: response.status,
            });
            return { success: false, error: `Instagram returned ${response.status}`, redirect: canonicalUrl };
        }

        const html = await response.text();
        const timestamp = extractInstagramTimestamp(html);

        const extractCount = (patterns: RegExp[]): number | undefined => {
            for (const pattern of patterns) {
                const value = html.match(pattern)?.[1];
                if (value !== undefined) return Number(value.replace(/,/g, ''));
            }
            return undefined;
        };
        let likes = extractCount([
            /"edge_media_preview_like"\s*:\s*\{\s*"count"\s*:\s*(\d+)/,
            /"like_count"\s*:\s*(\d+)/,
            /"edge_liked_by"\s*:\s*\{\s*"count"\s*:\s*(\d+)/,
            /\\"edge_liked_by\\"\s*:\s*\{\s*\\"count\\"\s*:\s*(\d+)/,
        ]);
        let comments = extractCount([
            /"edge_media_to_parent_comment"\s*:\s*\{\s*"count"\s*:\s*(\d+)/,
            /"comment_count"\s*:\s*(\d+)/,
            /"edge_media_to_comment"\s*:\s*\{\s*"count"\s*:\s*(\d+)/,
            /\\"edge_media_to_comment\\"\s*:\s*\{\s*\\"count\\"\s*:\s*(\d+)/,
            /View all\s+(\d[\d,]*)\s+comments/i,
        ]);
        if (
            html.includes('contextJSON')
            && (likes === undefined || comments === undefined)
        ) {
            const readerStats = await scrapeInstagramReaderStats(
                canonicalUrl,
                parsed.shortcode,
                timeoutMs,
            );
            likes ??= readerStats.likes;
            comments ??= readerStats.comments;
        }

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

        const avatarMatch = html.match(
            /<a[^>]+class=["'][^"']*\bAvatar\b[^"']*["'][^>]*>\s*<img[^>]+src=["']([^"']+)["']/i,
        );
        const authorAvatar = avatarMatch
            ? decodeInstagramMediaUrl(avatarMatch[1])
            : extractInstagramOwnerAvatar(html, username);

        // Extract media URL - check multiple patterns
        let mediaUrl = '';
        let isVideo = false;
        let previewUrl = '';
        const imageUrls = extractInstagramImageUrls(html);

        // Pattern 1: Video from CDN (most reliable for actual videos)
        const cdnVideoMatch = html.match(/https:\/\/scontent[^"'\s]+\.mp4[^"'\s]*/);
        if (cdnVideoMatch) {
            mediaUrl = decodeInstagramMediaUrl(cdnVideoMatch[0]);
            isVideo = true;
        }

        // Pattern 1b: Double-escaped contextJSON video_url (common in embed HTML)
        if (!mediaUrl) {
            const escapedVideoMatch = html.match(
                /\\"video_url\\"\s*:\s*\\"((?:\\\\.|[^"\\\\])*)\\"/,
            );
            if (escapedVideoMatch) {
                mediaUrl = decodeInstagramMediaUrl(escapedVideoMatch[1]);
                isVideo = true;
            }
        }

        // Pattern 2: Video element with class / JSON video_url
        if (!mediaUrl) {
            const videoPatterns = [
                /class="[^"]*EmbeddedMediaVideo[^"]*"[^>]*src="([^"]+)"/i,
                /src="([^"]+)"[^>]*class="[^"]*EmbeddedMediaVideo[^"]*"/i,
                /<video[^>]*src="([^"]+)"/i,
                /"video_url"\s*:\s*"((?:\\.|[^"\\])*)"/,
            ];
            for (const pattern of videoPatterns) {
                const match = html.match(pattern);
                if (match) {
                    mediaUrl = decodeInstagramMediaUrl(match[1]);
                    isVideo = true;
                    break;
                }
            }
        }

        // A video and its poster are separate values in Instagram's embed data.
        // Keep looking for the poster even after the MP4 has been found so the
        // Discord Activity attachment can provide a usable preview_url.
        if (isVideo) {
            const previewPatterns = [
                /<video[^>]*poster="([^"]+)"/i,
                /"thumbnail_src"\s*:\s*"((?:\\.|[^"\\])*)"/,
                /"display_url"\s*:\s*"((?:\\.|[^"\\])*)"/,
                /\\"thumbnail_src\\"\s*:\s*\\"((?:\\\\.|[^"\\\\])*)\\"/,
                /\\"display_url\\"\s*:\s*\\"((?:\\\\.|[^"\\\\])*)\\"/,
                /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
                /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
            ];
            for (const pattern of previewPatterns) {
                const match = html.match(pattern);
                if (match) {
                    const decodedPreview = decodeInstagramMediaUrl(match[1]);
                    previewUrl = trustedInstagramMediaUrl(decodedPreview) || decodedPreview;
                    break;
                }
            }
        }

        // Pattern 3: Image element with class
        if (!mediaUrl) {
            if (imageUrls.length > 0) {
                [mediaUrl] = imageUrls;
            }
        }

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
                    mediaUrl = decodeInstagramMediaUrl(match[1] || match[0]);
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
                    mediaUrl = decodeInstagramMediaUrl(match[1]);
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
                caption = decodeInstagramText(caption);
                if (caption.length > 0 && caption.length < 500) break;
            }
        }
        if (caption && username) {
            const escapedUsername = username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            caption = caption
                .replace(new RegExp(`^@?${escapedUsername}(?:\\s|:|-)*`, 'i'), '')
                .trim();
        }
        caption = caption
            .replace(/\s*View all \d[\d,.]* comments?\s*$/i, '')
            .trim();

        const result: HandlerResponse = {
            success: true,
            source: 'first-party',
            data: {
                title: caption ? truncateText(caption, 100) : 'Post',
                // The caption is already the linked title. Repeating it in the
                // description makes Discord render the same text twice.
                description: '',
                caption: caption || undefined,
                url: canonicalUrl,
                siteName: getBrandedSiteName('instagram'),
                authorName: username || undefined,
                authorHandle: username ? `@${username}` : undefined,
                authorUrl: username ? `https://www.instagram.com/${username}/` : undefined,
                authorAvatar,
                color: platformColors.instagram,
                platform: 'instagram',
                stats: formatStats({ likes, comments }),
                timestamp,
            },
        };

        if (mediaUrl) {
            if (isVideo) {
                const trustedVideo = trustedInstagramMediaUrl(mediaUrl);
                if (trustedVideo) {
                    result.data!.video = {
                        url: trustedVideo,
                        width: 1080,
                        height: 1920,
                        thumbnail: previewUrl || undefined,
                    };
                    result.data!.image = previewUrl || undefined;
                } else if (previewUrl) {
                    // Keep poster metadata when the MP4 host is untrusted.
                    result.data!.image = previewUrl;
                }
            } else {
                result.data!.image = mediaUrl;
                result.data!.images = imageUrls.length > 1
                    ? imageUrls
                    : undefined;
            }
        }

        if (!mediaUrl) {
            console.warn('first_party_payload_rejected', {
                platform: 'instagram',
                stage: 'embed',
                contentType: parsed.type,
                hasAuthor: Boolean(username),
                hasCaption: Boolean(caption),
            });
        }

        return result;

    } catch (error) {
        return { success: false, error: 'Failed to scrape embed', redirect: canonicalUrl };
    }
}
