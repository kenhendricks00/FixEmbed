/**
 * FixEmbed Service - Handler Index
 * Re-exports all platform handlers
 */

export { twitterHandler } from './twitter.ts';
export { redditHandler } from './reddit.ts';
export { blueskyHandler } from './bluesky.ts';
export { instagramHandler } from './instagram.ts';
export { threadsHandler } from './threads.ts';
export { pixivHandler } from './pixiv.ts';
export { bilibiliHandler } from './bilibili.ts';
export { youtubeHandler } from './youtube.ts';
export { pinterestHandler } from './pinterest.ts';
export { tiktokHandler } from './tiktok.ts';
export { tumblrHandler } from './tumblr.ts';
export { twitchHandler } from './twitch.ts';
export { deviantartHandler } from './deviantart.ts';

import { twitterHandler } from './twitter.ts';
import { redditHandler } from './reddit.ts';
import { blueskyHandler } from './bluesky.ts';
import { instagramHandler } from './instagram.ts';
import { threadsHandler } from './threads.ts';
import { pixivHandler } from './pixiv.ts';
import { bilibiliHandler } from './bilibili.ts';
import { youtubeHandler } from './youtube.ts';
import { pinterestHandler } from './pinterest.ts';
import { tiktokHandler } from './tiktok.ts';
import { tumblrHandler } from './tumblr.ts';
import { twitchHandler } from './twitch.ts';
import { deviantartHandler } from './deviantart.ts';
import type { PlatformHandler } from '../types.ts';

// All handlers in priority order
export const handlers: PlatformHandler[] = [
    twitterHandler,
    redditHandler,
    blueskyHandler,
    instagramHandler,
    threadsHandler,
    pixivHandler,
    bilibiliHandler,
    youtubeHandler,
    pinterestHandler,
    tiktokHandler,
    tumblrHandler,
    twitchHandler,
    deviantartHandler,
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
