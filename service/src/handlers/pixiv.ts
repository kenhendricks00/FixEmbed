/**
 * FixEmbed Service - Pixiv Handler
 */

import { Env, HandlerResponse, PlatformHandler } from '../types';
import { truncateText } from '../utils/fetch';
import { platformColors } from '../utils/embed';

export const pixivHandler: PlatformHandler = {
    name: 'pixiv',
    patterns: [
        /pixiv\.net\/(?:\w+\/)?artworks\/(\d+)/i,
        /pixiv\.net\/member_illust\.php\?.*illust_id=(\d+)/i,
    ],

    async handle(url: string, env: Env): Promise<HandlerResponse> {
        // Parse artwork ID from URL
        let illustId: string | null = null;

        const artworkMatch = url.match(/pixiv\.net\/(?:\w+\/)?artworks\/(\d+)/i);
        const legacyMatch = url.match(/pixiv\.net\/member_illust\.php\?.*illust_id=(\d+)/i);

        illustId = artworkMatch?.[1] || legacyMatch?.[1] || null;

        if (!illustId) {
            return { success: false, error: 'Invalid Pixiv URL' };
        }

        try {
            // Pixiv requires authentication for their API
            // We'll use phixiv.net as a proxy service for now
            // This provides reliable embed data without auth

            // Construct phixiv URL for API
            const phixivUrl = `https://www.phixiv.net/api/info?id=${illustId}`;

            const response = await fetch(phixivUrl, {
                headers: {
                    'User-Agent': 'FixEmbed/1.0',
                },
            });

            if (response.ok) {
                const data = await response.json() as {
                    title?: string;
                    description?: string;
                    author_name?: string;
                    author_id?: string;
                    image_proxy_urls?: string[];
                    url?: string;
                };

                return {
                    success: true,
                    data: {
                        title: data.title || 'Pixiv Artwork',
                        description: data.description
                            ? truncateText(data.description.replace(/<[^>]*>/g, ''), 280)
                            : `Artwork by ${data.author_name || 'Unknown'}`,
                        url: `https://www.pixiv.net/artworks/${illustId}`,
                        siteName: 'Pixiv',
                        authorName: data.author_name,
                        authorUrl: data.author_id ? `https://www.pixiv.net/users/${data.author_id}` : undefined,
                        image: data.image_proxy_urls?.[0],
                        color: platformColors.pixiv,
                        platform: 'pixiv',
                    },
                };
            }

            // Fallback: create basic embed with image proxy
            const proxyImage = `https://www.phixiv.net/imageproxy/img-original/img/${illustId}_p0.jpg`;

            return {
                success: true,
                data: {
                    title: 'Pixiv Artwork',
                    description: 'View artwork on Pixiv',
                    url: `https://www.pixiv.net/artworks/${illustId}`,
                    siteName: 'Pixiv',
                    image: proxyImage,
                    color: platformColors.pixiv,
                    platform: 'pixiv',
                },
            };
        } catch (error) {
            console.error('Pixiv handler error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch artwork',
                redirect: `https://www.pixiv.net/artworks/${illustId}`,
            };
        }
    },
};
