/**
 * FixEmbed Service - Fetch Utilities
 */

/**
 * Fetch with timeout and retries
 */
export async function fetchWithTimeout(
    url: string,
    options: RequestInit = {},
    timeout = 10000
): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal,
        });
        clearTimeout(timeoutId);
        return response;
    } catch (error) {
        clearTimeout(timeoutId);
        throw error;
    }
}

/**
 * Fetch JSON from an API endpoint
 */
export async function fetchJSON<T>(url: string, options: RequestInit = {}): Promise<T> {
    const response = await fetchWithTimeout(url, {
        ...options,
        headers: {
            'Accept': 'application/json',
            'User-Agent': 'FixEmbed/1.0',
            ...options.headers,
        },
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response.json() as Promise<T>;
}

/**
 * Extract video URL from various sources
 */
export function getBestVideoUrl(variants: Array<{ bit_rate?: number; url: string; content_type: string }>): string | null {
    // Filter for mp4 videos and sort by bitrate
    const mp4Videos = variants
        .filter(v => v.content_type === 'video/mp4' && v.bit_rate)
        .sort((a, b) => (b.bit_rate || 0) - (a.bit_rate || 0));

    return mp4Videos.length > 0 ? mp4Videos[0].url : null;
}

/**
 * Clean up URLs - remove tracking params etc.
 */
export function cleanUrl(url: string): string {
    try {
        const parsed = new URL(url);

        // Remove common tracking parameters
        const trackingParams = ['s', 't', 'utm_source', 'utm_medium', 'utm_campaign', 'ref', 'ref_src'];
        trackingParams.forEach(param => parsed.searchParams.delete(param));

        return parsed.toString();
    } catch {
        return url;
    }
}

/**
 * Parse Twitter/X status URL
 */
export function parseTwitterUrl(url: string): { username: string; tweetId: string } | null {
    const patterns = [
        /(?:twitter\.com|x\.com)\/([^\/]+)\/status\/(\d+)/i,
        /(?:fxtwitter\.com|vxtwitter\.com|fixupx\.com)\/([^\/]+)\/status\/(\d+)/i,
    ];

    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) {
            return { username: match[1], tweetId: match[2] };
        }
    }
    return null;
}

/**
 * Parse Reddit post URL
 */
export function parseRedditUrl(url: string): { subreddit: string; postId: string } | null {
    const pattern = /reddit\.com\/r\/([^\/]+)\/comments\/([^\/]+)/i;
    const match = url.match(pattern);

    if (match) {
        return { subreddit: match[1], postId: match[2] };
    }
    return null;
}

/**
 * Parse Instagram post URL
 */
export function parseInstagramUrl(url: string): { shortcode: string; type: 'post' | 'reel' | 'story' } | null {
    const patterns = [
        { pattern: /instagram\.com\/p\/([^\/\?]+)/i, type: 'post' as const },
        { pattern: /instagram\.com\/reel\/([^\/\?]+)/i, type: 'reel' as const },
        { pattern: /instagram\.com\/stories\/[^\/]+\/(\d+)/i, type: 'story' as const },
    ];

    for (const { pattern, type } of patterns) {
        const match = url.match(pattern);
        if (match) {
            return { shortcode: match[1], type };
        }
    }
    return null;
}

/**
 * Parse YouTube video URL
 */
export function parseYouTubeUrl(url: string): { videoId: string } | null {
    const patterns = [
        /youtube\.com\/watch\?v=([^&]+)/i,
        /youtu\.be\/([^?]+)/i,
        /youtube\.com\/shorts\/([^?]+)/i,
        /youtube\.com\/embed\/([^?]+)/i,
    ];

    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) {
            return { videoId: match[1] };
        }
    }
    return null;
}

/**
 * Parse Bluesky post URL
 */
export function parseBlueskyUrl(url: string): { handle: string; postId: string } | null {
    const pattern = /bsky\.app\/profile\/([^\/]+)\/post\/([^\/\?]+)/i;
    const match = url.match(pattern);

    if (match) {
        return { handle: match[1], postId: match[2] };
    }
    return null;
}

/**
 * Truncate text to a maximum length
 */
export function truncateText(text: string, maxLength: number = 280): string {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength - 3) + '...';
}

/**
 * Decode HTML entities
 */
export function decodeHtmlEntities(text: string): string {
    return text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}
