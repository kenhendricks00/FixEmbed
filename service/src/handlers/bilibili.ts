/**
 * FixEmbed Service - Bilibili Handler
 * 
 * Based on bilibili-API-collect documentation:
 * https://github.com/SocialSisterYi/bilibili-API-collect
 * 
 * Key features:
 * - Fetches video metadata from /x/web-interface/view
 * - Fetches video stream URLs from /x/player/playurl with platform=html5
 * - Platform=html5 removes Referer check for direct video playback
 * - Falls back to thumbnail if video stream fails
 */

import { Env, HandlerResponse, PlatformHandler } from '../types';
import { truncateText } from '../utils/fetch';
import { platformColors } from '../utils/embed';

interface BilibiliVideoInfo {
    code: number;
    message?: string;
    data: {
        bvid: string;
        aid: number;
        cid: number; // Content ID needed for playurl
        title: string;
        desc: string;
        pic: string;
        owner: {
            mid: number;
            name: string;
            face: string;
        };
        stat: {
            view: number;
            like: number;
            coin: number;
            favorite: number;
            share: number;
            danmaku: number;
        };
        duration: number;
        pubdate: number;
        pages?: Array<{
            cid: number;
            page: number;
            part: string;
            duration: number;
        }>;
    };
}

interface BilibiliPlayUrl {
    code: number;
    message?: string;
    data: {
        quality: number;
        format: string;
        timelength: number;
        durl?: Array<{
            order: number;
            length: number;
            size: number;
            url: string;
            backup_url?: string[];
        }>;
    };
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
        let aid: number | null = avMatch ? parseInt(avMatch[1]) : null;

        // Handle short URLs - need to resolve redirect first
        if (shortMatch && !bvid && !aid) {
            try {
                // Follow redirect to get actual URL
                const response = await fetch(`https://b23.tv/${shortMatch[1]}`, {
                    method: 'HEAD',
                    redirect: 'follow',
                });
                const finalUrl = response.url;

                const resolvedBv = finalUrl.match(/bilibili\.com\/video\/(BV[a-zA-Z0-9]+)/i);
                const resolvedAv = finalUrl.match(/bilibili\.com\/video\/av(\d+)/i);

                if (resolvedBv) {
                    bvid = resolvedBv[1];
                } else if (resolvedAv) {
                    aid = parseInt(resolvedAv[1]);
                }
            } catch (error) {
                console.error('Failed to resolve b23.tv URL:', error);
            }
        }

        if (!bvid && !aid) {
            return { success: false, error: 'Invalid Bilibili URL' };
        }

        const embedDomain = (env as any).EMBED_DOMAIN || 'embed.ken.tools';

        try {
            // Step 1: Fetch video info to get metadata and CID
            let apiUrl: string;
            if (bvid) {
                apiUrl = `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`;
            } else {
                apiUrl = `https://api.bilibili.com/x/web-interface/view?aid=${aid}`;
            }

            const infoResponse = await fetch(apiUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Referer': 'https://www.bilibili.com/',
                },
            });

            if (!infoResponse.ok) {
                throw new Error(`Bilibili API returned ${infoResponse.status}`);
            }

            const data = await infoResponse.json() as BilibiliVideoInfo;

            if (data.code !== 0 || !data.data) {
                return { success: false, error: data.message || 'Video not found' };
            }

            const video = data.data;
            const cid = video.cid;

            // Build description with stats
            let description = video.desc
                ? truncateText(video.desc, 180)
                : '';

            const stats = `▶️ ${formatNumber(video.stat.view)} • 👍 ${formatNumber(video.stat.like)} • ⭐ ${formatNumber(video.stat.favorite)}`;
            description = description ? `${description}\n\n${stats}` : stats;

            // Format duration
            const minutes = Math.floor(video.duration / 60);
            const seconds = video.duration % 60;
            const durationStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

            // Step 2: Try to get video stream URL (platform=html5 for no Referer check)
            let videoUrl: string | undefined;
            let videoWidth = 1280;
            let videoHeight = 720;

            try {
                const playUrlApi = `https://api.bilibili.com/x/player/playurl?bvid=${video.bvid}&cid=${cid}&qn=64&fnval=1&platform=html5&high_quality=1`;

                const playResponse = await fetch(playUrlApi, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)',
                        'Referer': 'https://www.bilibili.com/',
                    },
                });

                if (playResponse.ok) {
                    const playData = await playResponse.json() as BilibiliPlayUrl;

                    if (playData.code === 0 && playData.data?.durl && playData.data.durl.length > 0) {
                        const stream = playData.data.durl[0];
                        // Proxy the video through our domain for CORS
                        videoUrl = `https://${embedDomain}/proxy/bilibili?url=${encodeURIComponent(stream.url)}`;
                    }
                }
            } catch (error) {
                console.log('Failed to get video stream, using thumbnail only');
            }

            return {
                success: true,
                data: {
                    title: video.title,
                    description,
                    url: `https://www.bilibili.com/video/${video.bvid}`,
                    siteName: `Bilibili • ${durationStr}`,
                    authorName: video.owner.name,
                    authorUrl: `https://space.bilibili.com/${video.owner.mid}`,
                    authorAvatar: video.owner.face,
                    image: video.pic.startsWith('//') ? `https:${video.pic}` : video.pic,
                    video: videoUrl ? {
                        url: videoUrl,
                        width: videoWidth,
                        height: videoHeight,
                        thumbnail: video.pic.startsWith('//') ? `https:${video.pic}` : video.pic,
                    } : undefined,
                    color: platformColors.bilibili,
                    platform: 'bilibili',
                },
            };
        } catch (error) {
            console.error('Bilibili handler error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch video',
                redirect: url,
            };
        }
    },
};

// Helper function to format large numbers (Chinese style - 万)
function formatNumber(num: number): string {
    if (num >= 100000000) {
        return (num / 100000000).toFixed(1) + '亿';
    } else if (num >= 10000) {
        return (num / 10000).toFixed(1) + '万';
    }
    return num.toLocaleString();
}
