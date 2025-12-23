/**
 * FixEmbed Service - Handler Index
 * Re-exports all platform handlers
 */

export { twitterHandler } from './twitter';
export { redditHandler } from './reddit';
export { youtubeHandler } from './youtube';
export { blueskyHandler } from './bluesky';
export { instagramHandler } from './instagram';
export { threadsHandler } from './threads';
export { pixivHandler } from './pixiv';
export { bilibiliHandler } from './bilibili';

import { twitterHandler } from './twitter';
import { redditHandler } from './reddit';
import { youtubeHandler } from './youtube';
import { blueskyHandler } from './bluesky';
import { instagramHandler } from './instagram';
import { threadsHandler } from './threads';
import { pixivHandler } from './pixiv';
import { bilibiliHandler } from './bilibili';
import type { PlatformHandler } from '../types';

// All handlers in priority order
export const handlers: PlatformHandler[] = [
    twitterHandler,
    redditHandler,
    youtubeHandler,
    blueskyHandler,
    instagramHandler,
    threadsHandler,
    pixivHandler,
    bilibiliHandler,
];

/**
 * Find the appropriate handler for a URL
 */
export function findHandler(url: string): PlatformHandler | null {
    for (const handler of handlers) {
        for (const pattern of handler.patterns) {
            if (pattern.test(url)) {
                return handler;
            }
        }
    }
    return null;
}
