/**
 * FixEmbed Service - Pixiv Handler
 * 
 * Pixiv requires authentication for their API.
 * Without third-party services, we can only provide basic embed with redirect.
 */

import { Env, HandlerResponse, PlatformHandler } from '../types';
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

        const canonicalUrl = `https://www.pixiv.net/artworks/${illustId}`;

        // Pixiv doesn't have a public API without authentication
        // Return basic embed and redirect to original URL
        return {
            success: true,
            data: {
                title: 'Pixiv Artwork',
                description: `View artwork #${illustId} on Pixiv`,
                url: canonicalUrl,
                siteName: 'Pixiv',
                color: platformColors.pixiv,
                platform: 'pixiv',
            },
        };
    },
};
