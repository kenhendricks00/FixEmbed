/**
 * FixEmbed Service - TikTok Handler
 * Uses TikTok's public oEmbed endpoint and never requires account credentials.
 */

import type { Env, HandlerResponse, PlatformHandler } from '../types.ts';
import { fetchWithTimeout, truncateText } from '../utils/fetch.ts';
import { getBrandedSiteName, platformColors } from '../utils/embed.ts';

type TikTokOEmbed = {
    title?: unknown;
    author_name?: unknown;
    author_url?: unknown;
    author_unique_id?: unknown;
    thumbnail_url?: unknown;
    thumbnail_width?: unknown;
    thumbnail_height?: unknown;
};

const TIKTOK_HOSTS = new Set(['tiktok.com', 'www.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com']);
const TIKTOK_MEDIA_SUFFIXES = [
    'tiktokcdn.com',
    'tiktokcdn-us.com',
    'muscdn.com',
    'byteoversea.com',
    'ibytedtos.com',
];

function trustedTikTokUrl(raw: string): URL | null {
    try {
        const url = new URL(raw);
        const host = url.hostname.toLowerCase();
        return url.protocol === 'https:' && TIKTOK_HOSTS.has(host) ? url : null;
    } catch {
        return null;
    }
}

function trustedThumbnail(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    try {
        const url = new URL(value);
        const host = url.hostname.toLowerCase();
        if (
            url.protocol === 'https:'
            && TIKTOK_MEDIA_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))
        ) {
            return url.toString();
        }
    } catch {
        // Ignore malformed third-party metadata.
    }
    return undefined;
}

function standardTikTokUrl(url: URL): { canonical: string; handle: string; postId: string } | null {
    const match = url.pathname.match(/^\/@([\w.-]+)\/video\/(\d+)\/?$/i);
    if (!match) return null;
    return {
        canonical: `https://www.tiktok.com/@${match[1]}/video/${match[2]}`,
        handle: match[1],
        postId: match[2],
    };
}

async function resolveTikTokUrl(raw: string): Promise<{ canonical: string; handle: string; postId: string } | null> {
    const initial = trustedTikTokUrl(raw);
    if (!initial) return null;
    const standard = standardTikTokUrl(initial);
    if (standard) return standard;

    let current = initial;
    for (let redirectCount = 0; redirectCount < 4; redirectCount += 1) {
        const response = await fetchWithTimeout(current.toString(), {
            redirect: 'manual',
            headers: {
                'Accept': 'text/html',
                'User-Agent': 'Mozilla/5.0 (compatible; FixEmbed/1.0; +https://fixembed.app)',
            },
        }, 5_000);
        const location = response.headers.get('Location');
        if (!location) return standardTikTokUrl(current);
        const next = trustedTikTokUrl(new URL(location, current).toString());
        if (!next) return null;
        current = next;
        const resolved = standardTikTokUrl(current);
        if (resolved) return resolved;
    }
    return null;
}

function positiveDimension(value: unknown, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 && parsed <= 10_000 ? Math.round(parsed) : fallback;
}

export const tiktokHandler: PlatformHandler = {
    name: 'tiktok',
    patterns: [
        /^https:\/\/(?:www\.)?tiktok\.com\/@[\w.-]+\/video\/\d+/i,
        /^https:\/\/(?:vm|vt)\.tiktok\.com\/[A-Za-z0-9_-]+/i,
        /^https:\/\/(?:www\.)?tiktok\.com\/t\/[A-Za-z0-9_-]+/i,
    ],

    async handle(url: string, _env: Env): Promise<HandlerResponse> {
        try {
            const parsed = await resolveTikTokUrl(url);
            if (!parsed) return { success: false, error: 'Invalid TikTok URL', redirect: url };
            const response = await fetchWithTimeout(
                `https://www.tiktok.com/oembed?url=${encodeURIComponent(parsed.canonical)}`,
                {
                    headers: {
                        'Accept': 'application/json',
                        'User-Agent': 'FixEmbed/1.0 (+https://fixembed.app)',
                    },
                },
                6_000,
            );
            if (!response.ok) {
                return { success: false, error: `TikTok oEmbed returned ${response.status}`, redirect: parsed.canonical };
            }
            const body = await response.json() as TikTokOEmbed;
            const title = typeof body.title === 'string' ? truncateText(body.title.trim(), 300) : '';
            const authorName = typeof body.author_name === 'string' ? body.author_name.trim() : '';
            const responseHandle = typeof body.author_unique_id === 'string'
                ? body.author_unique_id.trim().replace(/^@/, '')
                : '';
            const handle = /^[\w.-]+$/.test(responseHandle) ? responseHandle : parsed.handle;
            const authorUrl = typeof body.author_url === 'string' && trustedTikTokUrl(body.author_url)
                ? body.author_url
                : `https://www.tiktok.com/@${handle}`;
            const image = trustedThumbnail(body.thumbnail_url);
            if (!title && !image) {
                return { success: false, error: 'TikTok metadata unavailable', redirect: parsed.canonical };
            }
            return {
                success: true,
                source: 'first-party',
                data: {
                    title: title || 'TikTok post',
                    description: title,
                    url: parsed.canonical,
                    siteName: getBrandedSiteName('tiktok'),
                    authorName: authorName || handle,
                    authorHandle: `@${handle}`,
                    authorUrl,
                    image,
                    video: undefined,
                    color: platformColors.tiktok,
                    platform: 'tiktok',
                    sections: [{
                        kind: 'link-card',
                        title: 'Open TikTok player',
                        body: `${positiveDimension(body.thumbnail_width, 576)}×${positiveDimension(body.thumbnail_height, 1024)} preview`,
                        url: `https://www.tiktok.com/player/v1/${parsed.postId}`,
                    }],
                },
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'TikTok metadata unavailable',
                redirect: url,
            };
        }
    },
};
