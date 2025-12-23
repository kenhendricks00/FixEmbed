/**
 * FixEmbed Service - Bilibili Handler
 */

import { Env, HandlerResponse, PlatformHandler } from '../types';
import { fetchJSON, truncateText } from '../utils/fetch';
import { platformColors } from '../utils/embed';

interface BilibiliVideoInfo {
    code: number;
    data: {
        bvid: string;
        aid: number;
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
            share: number;
        };
        duration: number;
        pubdate: number;
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

        // Handle short URLs - redirect first
        if (shortMatch && !bvid && !aid) {
            return {
                success: false,
                redirect: url,
            };
        }

        if (!bvid && !aid) {
            return { success: false, error: 'Invalid Bilibili URL' };
        }

        try {
            // Use Bilibili's public API
            let apiUrl: string;

            if (bvid) {
                apiUrl = `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`;
            } else {
                apiUrl = `https://api.bilibili.com/x/web-interface/view?aid=${aid}`;
            }

            const data = await fetchJSON<BilibiliVideoInfo>(apiUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; FixEmbed/1.0)',
                    'Referer': 'https://www.bilibili.com/',
                },
            });

            if (data.code !== 0 || !data.data) {
                return { success: false, error: 'Video not found' };
            }

            const video = data.data;

            // Build description with stats
            let description = video.desc
                ? truncateText(video.desc, 200)
                : `Video by ${video.owner.name}`;

            description += `\n\n▶️ ${formatNumber(video.stat.view)} • 👍 ${formatNumber(video.stat.like)}`;

            // Format duration
            const minutes = Math.floor(video.duration / 60);
            const seconds = video.duration % 60;
            const durationStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

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
                    image: video.pic,
                    video: {
                        // Bilibili doesn't allow direct video embedding
                        // Use thumbnail for now
                        url: video.pic,
                        width: 1920,
                        height: 1080,
                        thumbnail: video.pic,
                    },
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

// Helper function to format large numbers
function formatNumber(num: number): string {
    if (num >= 10000) {
        return (num / 10000).toFixed(1) + '万';
    }
    return num.toLocaleString();
}
