/**
 * FixEmbed Service - Mastodon Handler
 */

import type { Env, HandlerResponse, PlatformHandler, VideoEmbed } from '../types.ts';
import { fetchJSON, parseMastodonUrl, stripHtml, truncateText } from '../utils/fetch.ts';
import { formatStats, getBrandedSiteName, platformColors } from '../utils/embed.ts';

interface MastodonStatusResponse {
    id: string;
    url?: string;
    uri?: string;
    created_at?: string;
    content: string;
    spoiler_text?: string;
    favourites_count?: number;
    reblogs_count?: number;
    replies_count?: number;
    account: {
        username: string;
        acct: string;
        display_name?: string;
        avatar?: string;
        url?: string;
    };
    media_attachments?: Array<{
        type: 'image' | 'gifv' | 'video' | 'audio' | string;
        url?: string;
        preview_url?: string;
        meta?: {
            original?: {
                width?: number;
                height?: number;
            };
        };
    }>;
}

export const mastodonHandler: PlatformHandler = {
    name: 'mastodon',
    patterns: [
        /https?:\/\/[^\/]+\/@[^\/]+\/\d+(?:\?.*)?$/i,
        /https?:\/\/[^\/]+\/users\/[^\/]+\/statuses\/\d+(?:\?.*)?$/i,
        /https?:\/\/[^\/]+\/web\/statuses\/\d+(?:\?.*)?$/i,
    ],

    async handle(url: string, env: Env): Promise<HandlerResponse> {
        const parsed = parseMastodonUrl(url);

        if (!parsed) {
            return { success: false, error: 'Invalid Mastodon URL' };
        }

        try {
            const apiUrl = `https://${parsed.host}/api/v1/statuses/${parsed.statusId}`;
            const status = await fetchJSON<MastodonStatusResponse>(apiUrl, {
                headers: {
                    Accept: 'application/json',
                    'User-Agent': 'FixEmbed/1.0 (embed service)',
                },
            });

            const content = stripHtml(status.content || '');
            const spoiler = stripHtml(status.spoiler_text || '');
            const accountHandle = status.account.acct || status.account.username;
            const title = truncateText(spoiler || content || `@${accountHandle}`, 280);
            const description = spoiler && content ? truncateText(content, 280) : '';
            const media = status.media_attachments || [];

            let image: string | undefined;
            let video: VideoEmbed | undefined;

            const firstVideo = media.find((attachment) => attachment.type === 'video' || attachment.type === 'gifv');
            const firstImage = media.find((attachment) => attachment.type === 'image');

            if (firstVideo?.url) {
                video = {
                    url: firstVideo.url,
                    width: firstVideo.meta?.original?.width || 1280,
                    height: firstVideo.meta?.original?.height || 720,
                    thumbnail: firstVideo.preview_url,
                };
            }

            if (!video && firstImage?.url) {
                image = firstImage.url;
            } else if (video?.thumbnail) {
                image = video.thumbnail;
            }

            return {
                success: true,
                data: {
                    title,
                    description,
                    url: status.url || status.uri || url,
                    siteName: getBrandedSiteName('mastodon'),
                    authorName: `@${accountHandle}`,
                    authorUrl: status.account.url || `https://${parsed.host}/@${status.account.username}`,
                    authorAvatar: status.account.avatar,
                    image,
                    video,
                    color: platformColors.mastodon,
                    timestamp: status.created_at,
                    platform: 'mastodon',
                    stats: formatStats({
                        likes: status.favourites_count,
                        retweets: status.reblogs_count,
                        comments: status.replies_count,
                    }),
                },
            };
        } catch (error) {
            console.error('Mastodon handler error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch status',
                redirect: url,
            };
        }
    },
};
