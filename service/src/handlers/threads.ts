/**
 * FixEmbed Service - Threads Handler
 * 
 * Threads uses Instagram's infrastructure but has its own URL patterns.
 */

import { Env, HandlerResponse, PlatformHandler } from '../types';
import { fetchJSON, truncateText } from '../utils/fetch';
import { platformColors } from '../utils/embed';

interface ThreadsData {
    code: string;
    username: string;
    text?: string;
    media?: Array<{
        type: string;
        url: string;
    }>;
}

export const threadsHandler: PlatformHandler = {
    name: 'threads',
    patterns: [
        /threads\.net\/@?([^\/]+)\/post\/([^\/\?]+)/i,
        /threads\.net\/t\/([^\/\?]+)/i,
    ],

    async handle(url: string, env: Env): Promise<HandlerResponse> {
        // Parse URL to extract post info
        const postMatch = url.match(/threads\.net\/@?([^\/]+)\/post\/([^\/\?]+)/i);
        const shortMatch = url.match(/threads\.net\/t\/([^\/\?]+)/i);

        if (!postMatch && !shortMatch) {
            return { success: false, error: 'Invalid Threads URL' };
        }

        try {
            // Unfortunately Threads doesn't have a public API yet
            // We'll use a scraping approach or redirect to a working service

            // For now, construct what we can from the URL
            let username = postMatch?.[1] || 'Thread';
            let postCode = postMatch?.[2] || shortMatch?.[1] || '';

            // Clean up username (remove @ if present)
            username = username.replace('@', '');

            // Try to get oEmbed data (Threads might support this)
            try {
                const oembedUrl = `https://www.threads.net/oembed/?url=${encodeURIComponent(url)}`;
                const response = await fetch(oembedUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (compatible; FixEmbed/1.0)',
                    },
                });

                if (response.ok) {
                    const data = await response.json() as {
                        author_name?: string;
                        title?: string;
                        thumbnail_url?: string;
                    };

                    return {
                        success: true,
                        data: {
                            title: `${data.author_name || username} on Threads`,
                            description: data.title ? truncateText(data.title, 280) : 'View on Threads',
                            url: url,
                            siteName: 'Threads',
                            authorName: data.author_name || username,
                            authorUrl: `https://threads.net/@${username}`,
                            image: data.thumbnail_url,
                            color: platformColors.threads,
                            platform: 'threads',
                        },
                    };
                }
            } catch (e) {
                // oEmbed failed, continue with fallback
            }

            // Fallback: return basic info
            return {
                success: true,
                data: {
                    title: `@${username} on Threads`,
                    description: 'View thread on Threads',
                    url: url,
                    siteName: 'Threads',
                    authorName: username,
                    authorUrl: `https://threads.net/@${username}`,
                    color: platformColors.threads,
                    platform: 'threads',
                },
            };
        } catch (error) {
            console.error('Threads handler error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch thread',
                redirect: url,
            };
        }
    },
};
