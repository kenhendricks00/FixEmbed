/**
 * FixEmbed Service - Bilibili Handler
 * 
 * Fetches Bilibili video data directly and renders it through FixEmbed.
 * VxBilibili remains an emergency fallback when Bilibili blocks Worker traffic.
 * 
 * Key features:
 * - Direct Bilibili API metadata is the primary path
 * - Scrapes vxbilibili.com only as an emergency fallback
 * - Gets title, thumbnail, description from OG tags
 * - Falls back to basic redirect if scraping fails
 */

import type { Env, HandlerResponse, PlatformHandler } from '../types.ts';
import { formatNumber, platformColors, getBrandedSiteName } from '../utils/embed.ts';
import { fetchWithTimeout } from '../utils/fetch.ts';
import { extractPostTimestampFromHtml } from '../utils/timestamp.ts';

const MAX_BILIBILI_PAGE_BYTES = 1_000_000;

interface BilibiliVideoResponse {
    code?: number;
    data?: {
        title?: string;
        desc?: string;
        pic?: string;
        owner?: { name?: string; mid?: number; face?: string };
        stat?: {
            view?: number;
            reply?: number;
            favorite?: number;
            share?: number;
            like?: number;
            coin?: number;
        };
        pubdate?: number;
    };
}

interface BiliFixOEmbedResponse {
    title?: string;
    author_name?: string;
    author_url?: string;
    provider_name?: string;
}

interface BilibiliPageState {
    video?: {
        viewInfo?: NonNullable<BilibiliVideoResponse['data']>;
    };
}

function buildBilibiliResponse(
    video: NonNullable<BilibiliVideoResponse['data']>,
    bvid: string,
): HandlerResponse {
    const image = typeof video.pic === 'string' && video.pic.startsWith('//') ? `https:${video.pic}` : video.pic;
    const authorAvatar = typeof video.owner?.face === 'string' && video.owner.face.startsWith('//')
        ? `https:${video.owner.face}`
        : video.owner?.face;
    const stats = [
        video.stat?.reply !== undefined ? `\u{1F4AC} ${formatNumber(video.stat.reply)}` : '',
        video.stat?.like !== undefined ? `\u2764\uFE0F ${formatNumber(video.stat.like)}` : '',
        video.stat?.view !== undefined ? `\u{1F441}\uFE0F ${formatNumber(video.stat.view)}` : '',
        video.stat?.coin !== undefined ? `\u{1FA99} ${formatNumber(video.stat.coin)}` : '',
        video.stat?.favorite !== undefined ? `\u{1F516} ${formatNumber(video.stat.favorite)}` : '',
        video.stat?.share !== undefined ? `\u{1F501} ${formatNumber(video.stat.share)}` : '',
    ].filter(Boolean).join(' ');
    return {
        success: true,
        source: 'first-party',
        data: {
            title: video.title || 'Bilibili Video',
            description: video.desc || '',
            url: `https://www.bilibili.com/video/${bvid}`,
            siteName: getBrandedSiteName('bilibili'),
            authorName: video.owner?.name,
            authorUrl: video.owner?.mid ? `https://space.bilibili.com/${video.owner.mid}` : undefined,
            authorAvatar,
            image,
            color: platformColors.bilibili,
            platform: 'bilibili',
            stats: stats || undefined,
            timestamp: video.pubdate ? new Date(video.pubdate * 1000).toISOString() : undefined,
        },
    };
}

function extractJsonObjectAfterMarker(html: string, marker: string): string | undefined {
    const markerIndex = html.indexOf(marker);
    const start = markerIndex >= 0 ? html.indexOf('{', markerIndex + marker.length) : -1;
    if (start < 0) return undefined;

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < html.length; index += 1) {
        const character = html[index];
        if (inString) {
            if (escaped) escaped = false;
            else if (character === '\\') escaped = true;
            else if (character === '"') inString = false;
            continue;
        }
        if (character === '"') inString = true;
        else if (character === '{') depth += 1;
        else if (character === '}' && --depth === 0) return html.slice(start, index + 1);
    }
    return undefined;
}

function htmlAttribute(tag: string, name: string): string | undefined {
    const match = tag.match(new RegExp(
        `\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
        'i',
    ));
    return match?.[1] ?? match?.[2] ?? match?.[3];
}

function metaContent(html: string, key: string): string | undefined {
    for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
        const tag = match[0];
        if (htmlAttribute(tag, 'property') === key || htmlAttribute(tag, 'name') === key) {
            return htmlAttribute(tag, 'content');
        }
    }
    return undefined;
}

function biliFixStats(providerName = ''): string | undefined {
    const activity = providerName.split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.includes('📺'));
    if (!activity) return undefined;
    return activity
        .replace(/📺\s*/u, '👁️ ')
        .replace(/👍\s*/u, '❤️ ')
        .replace(/🪙\s*/u, '🪙 ')
        .replace(/⭐\s*/u, '🔖 ')
        .replace(/📤\s*/u, '🔁 ');
}

async function fetchBilibiliVideo(bvid: string): Promise<HandlerResponse | null> {
    try {
        const response = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`, {
            headers: {
                'Accept': 'application/json',
                'Referer': `https://www.bilibili.com/video/${bvid}`,
                'User-Agent': 'Mozilla/5.0 (compatible; FixEmbed/1.0; +https://fixembed.app)',
            },
        });
        if (!response.ok) {
            console.warn('first_party_fetch_failed', {
                platform: 'bilibili',
                stage: 'video',
                status: response.status,
            });
            return null;
        }
        const payload = await response.json() as BilibiliVideoResponse;
        const video = payload?.data;
        if (payload?.code !== 0 || !video?.title) {
            console.warn('first_party_payload_rejected', {
                platform: 'bilibili',
                stage: 'video',
                upstreamCode: payload?.code,
                hasTitle: Boolean(video?.title),
            });
            return null;
        }
        return buildBilibiliResponse(video, bvid);
    } catch (error) {
        console.warn('Bilibili direct request failed:', error);
        return null;
    }
}

async function fetchBilibiliMobilePage(bvid: string): Promise<HandlerResponse | null> {
    try {
        const response = await fetchWithTimeout(`https://m.bilibili.com/video/${encodeURIComponent(bvid)}`, {
            headers: {
                'Accept': 'text/html,application/xhtml+xml',
                'Referer': `https://www.bilibili.com/video/${bvid}`,
                'User-Agent': 'Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36',
            },
        }, 5000);
        if (!response.ok) {
            console.warn('first_party_fetch_failed', {
                platform: 'bilibili',
                stage: 'mobile_page',
                status: response.status,
            });
            return null;
        }

        const declaredLength = Number(response.headers.get('content-length') || 0);
        if (Number.isFinite(declaredLength) && declaredLength > MAX_BILIBILI_PAGE_BYTES) {
            console.warn('first_party_payload_rejected', {
                platform: 'bilibili',
                stage: 'mobile_page',
                reason: 'declared_size',
            });
            return null;
        }
        const html = await response.text();
        if (new TextEncoder().encode(html).byteLength > MAX_BILIBILI_PAGE_BYTES) {
            console.warn('first_party_payload_rejected', {
                platform: 'bilibili',
                stage: 'mobile_page',
                reason: 'actual_size',
            });
            return null;
        }

        const stateJson = extractJsonObjectAfterMarker(html, '__INITIAL_STATE__');
        const state = stateJson ? JSON.parse(stateJson) as BilibiliPageState : undefined;
        const video = state?.video?.viewInfo;
        if (!video?.title) {
            console.warn('first_party_payload_rejected', {
                platform: 'bilibili',
                stage: 'mobile_page',
                hasState: Boolean(stateJson),
                hasTitle: Boolean(video?.title),
            });
            return null;
        }
        return buildBilibiliResponse(video, bvid);
    } catch (error) {
        console.warn('Bilibili official mobile page request failed:', error);
        return null;
    }
}

// Scrape vxbilibili.com HTML for OG tags
async function scrapeVxBilibili(bvid: string): Promise<{
    success: boolean;
    title?: string;
    image?: string;
    description?: string;
    author?: string;
    authorUrl?: string;
    video?: string;
    stats?: string;
    timestamp?: string;
    error?: string;
}> {
    try {
        const vxUrl = `https://www.vxbilibili.com/video/${bvid}`;
        const response = await fetch(vxUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
                'Accept': 'text/html',
            },
        });

        if (!response.ok) {
            return { success: false, error: `vxbilibili returned ${response.status}` };
        }

        const html = await response.text();

        const ogTitle = metaContent(html, 'og:title');
        const ogImage = metaContent(html, 'og:image');
        const ogDesc = metaContent(html, 'og:description');
        const ogVideo = metaContent(html, 'og:video') || metaContent(html, 'og:video:url');
        const ogSiteName = metaContent(html, 'og:site_name');

        let oembed: BiliFixOEmbedResponse | undefined;
        try {
            const oembedResponse = await fetch(
                `https://www.vxbilibili.com/oembed/video?id=${encodeURIComponent(bvid)}&lang=zh-cn`,
                { headers: { 'Accept': 'application/json' } },
            );
            if (oembedResponse.ok) {
                oembed = await oembedResponse.json() as BiliFixOEmbedResponse;
            }
        } catch {
            // Open Graph still provides a useful media card when oEmbed is unavailable.
        }

        // Older BiliFix pages included the author in the title.
        let author = oembed?.author_name;
        const authorMatch = ogTitle?.match(/(.+?) - (.+?)的bilibili视频/);
        let title = oembed?.title || ogTitle || 'Bilibili Video';
        if (authorMatch) {
            title = authorMatch[1];
            author ||= authorMatch[2];
        }

        return {
            success: true,
            title,
            image: ogImage,
            description: ogDesc,
            author,
            authorUrl: oembed?.author_url,
            video: ogVideo,
            stats: biliFixStats(oembed?.provider_name || ogSiteName),
            timestamp: extractPostTimestampFromHtml(html),
        };
    } catch (error) {
        console.error('vxbilibili scrape error:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
}

async function fetchBilibiliPostTimestamp(bvid: string): Promise<string | undefined> {
    try {
        const apiUrl = `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}&platform=html5`;
        const response = await fetchWithTimeout(apiUrl, {
            headers: {
                'Accept': 'application/json',
                'Referer': `https://www.bilibili.com/video/${bvid}`,
                'User-Agent': 'Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36',
            },
        }, 5000);
        if (response.ok) {
            const payload = await response.json() as BilibiliVideoResponse;
            const timestamp = payload.data?.pubdate
                ? new Date(payload.data.pubdate * 1000).toISOString()
                : undefined;
            if (timestamp) return timestamp;
        }
    } catch {
        // The mobile page remains available when Bilibili blocks this API shape.
    }

    try {
        const searchUrl = 'https://api.bilibili.com/x/web-interface/wbi/search/type'
            + `?search_type=video&keyword=${encodeURIComponent(bvid)}`;
        const response = await fetchWithTimeout(searchUrl, {
            headers: {
                'Accept': 'application/json',
                'Referer': 'https://search.bilibili.com/',
                'User-Agent': 'Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36',
            },
        }, 5000);
        if (response.ok) {
            const payload = await response.json() as {
                code?: number;
                data?: { result?: Array<{ bvid?: string; pubdate?: number }> };
            };
            const match = payload.code === 0
                ? payload.data?.result?.find(item => item.bvid?.toUpperCase() === bvid.toUpperCase())
                : undefined;
            if (match?.pubdate) return new Date(match.pubdate * 1000).toISOString();
        }
    } catch {
        // The mobile page is the final first-party timestamp source.
    }

    try {
        const response = await fetchWithTimeout(`https://m.bilibili.com/video/${encodeURIComponent(bvid)}`, {
            headers: {
                'Accept': 'text/html,application/xhtml+xml',
                'Referer': `https://www.bilibili.com/video/${bvid}`,
                'User-Agent': 'Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36',
            },
        }, 5000);
        if (!response.ok) return undefined;
        return extractPostTimestampFromHtml(await response.text());
    } catch {
        return undefined;
    }
}

export const bilibiliHandler: PlatformHandler = {
    name: 'bilibili',
    patterns: [
        /bilibili\.com\/video\/(BV[a-zA-Z0-9]+)/i,
        /bilibili\.com\/video\/av(\d+)/i,
        /b23\.tv\/([a-zA-Z0-9]+)/i,
    ],

    async handle(url: string, env: Env): Promise<HandlerResponse> {
        // Parse BV or AV ID from URL
        const bvMatch = url.match(/bilibili\.com\/video\/(BV[a-zA-Z0-9]+)/i);
        const avMatch = url.match(/bilibili\.com\/video\/av(\d+)/i);
        const shortMatch = url.match(/b23\.tv\/([a-zA-Z0-9]+)/i);

        let bvid: string | null = bvMatch?.[1] || null;

        // Handle short URLs - need to resolve redirect first
        if (shortMatch && !bvid) {
            try {
                const response = await fetch(`https://b23.tv/${shortMatch[1]}`, {
                    method: 'HEAD',
                    redirect: 'follow',
                });
                const finalUrl = response.url;
                const resolvedBv = finalUrl.match(/bilibili\.com\/video\/(BV[a-zA-Z0-9]+)/i);
                if (resolvedBv) {
                    bvid = resolvedBv[1];
                }
            } catch (error) {
                console.error('Failed to resolve b23.tv URL:', error);
            }
        }

        // AV IDs would need conversion to BV, just redirect for now
        if (avMatch && !bvid) {
            return {
                success: false,
                redirect: url,
            };
        }

        if (!bvid) {
            return { success: false, error: 'Invalid Bilibili URL' };
        }

        const canonicalUrl = `https://www.bilibili.com/video/${bvid}`;
        const embedDomain = env.EMBED_DOMAIN || 'fixembed.app';

        try {
            const directResult = await fetchBilibiliVideo(bvid);
            if (directResult) return directResult;

            const mobilePageResult = await fetchBilibiliMobilePage(bvid);
            if (mobilePageResult) return mobilePageResult;

            // Emergency fallback when Bilibili rejects the direct Worker request.
            const scrapeResult = await scrapeVxBilibili(bvid);

            if (scrapeResult.success && (scrapeResult.title || scrapeResult.image)) {
                scrapeResult.timestamp ||= await fetchBilibiliPostTimestamp(bvid);
                // Ensure image URL uses HTTPS
                let imageUrl = scrapeResult.image;
                if (imageUrl && imageUrl.startsWith('http://')) {
                    imageUrl = imageUrl.replace('http://', 'https://');
                }

                return {
                    success: true,
                    source: 'fallback',
                    data: {
                        title: scrapeResult.title || 'Bilibili Video',
                        description: scrapeResult.description || '',
                        url: canonicalUrl,
                        siteName: getBrandedSiteName('bilibili'),
                        authorName: scrapeResult.author || undefined, // Don't set if no author found
                        authorUrl: scrapeResult.authorUrl,
                        image: imageUrl,
                        video: scrapeResult.video ? {
                            url: `https://${embedDomain}/proxy/bilibili?url=${encodeURIComponent(scrapeResult.video)}`,
                            width: 1920,
                            height: 1080,
                            thumbnail: imageUrl,
                        } : undefined,
                        color: platformColors.bilibili,
                        platform: 'bilibili',
                        stats: scrapeResult.stats,
                        timestamp: scrapeResult.timestamp,
                    },
                };
            }

            // Fallback to basic redirect
            return {
                success: true,
                source: 'first-party',
                data: {
                    title: 'Bilibili Video',
                    description: `Watch on Bilibili`,
                    url: canonicalUrl,
                    siteName: getBrandedSiteName('bilibili'),
                    color: platformColors.bilibili,
                    platform: 'bilibili',
                },
            };
        } catch (error) {
            console.error('Bilibili handler error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch video',
                redirect: canonicalUrl,
            };
        }
    },
};
