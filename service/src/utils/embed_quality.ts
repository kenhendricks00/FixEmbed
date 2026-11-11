/** Decide whether a rendered card carries the media Discord needs to unfurl it. */

import type { EmbedData, HandlerResponse } from '../types.ts';

/**
 * Explain why a successful card would unfurl as a blank Discord link, or
 * return undefined when it is complete.
 *
 * Only Instagram is gated today. Its provider chain (first-party embed page,
 * canonical page, vxinstagram, Snapsave, kkinstagram) answers differently from
 * one request to the next, and some answers carry a video with no poster, or no
 * media at all. Discord shows nothing for those.
 */
export function incompleteEmbedReason(
    platform: string,
    data: EmbedData | undefined,
): string | undefined {
    if (platform !== 'instagram') return undefined;
    if (!data) return 'missing_data';
    if (data.video) {
        return data.video.thumbnail || data.image ? undefined : 'video_without_poster';
    }
    return data.images?.length || data.image ? undefined : 'missing_media';
}

/** True when a retry could turn this response into a better card. */
export function shouldRetryEmbed(platform: string, result: HandlerResponse): boolean {
    if (platform !== 'instagram' || result.unsupported) return false;
    if (!result.success) return true;
    return Boolean(incompleteEmbedReason(platform, result.data));
}

/** Prefer a complete card, then any successful card, then the first answer. */
export function preferEmbedResult(
    platform: string,
    first: HandlerResponse,
    second: HandlerResponse,
): HandlerResponse {
    const rank = (result: HandlerResponse): number => {
        if (!result.success || !result.data) return 0;
        return incompleteEmbedReason(platform, result.data) ? 1 : 2;
    };
    return rank(second) > rank(first) ? second : first;
}
