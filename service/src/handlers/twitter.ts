/**
 * FixEmbed Service - Twitter/X Handler
 * Uses FxTwitter (fxtwitter.com) for embeds temporarily
 */

import { Env, HandlerResponse, PlatformHandler } from '../types';
import { parseTwitterUrl } from '../utils/fetch';

export const twitterHandler: PlatformHandler = {
    name: 'twitter',
    patterns: [
        /(?:twitter\.com|x\.com)\/([^\/]+)\/status\/(\d+)/i,
    ],

    async handle(url: string, env: Env): Promise<HandlerResponse> {
        const parsed = parseTwitterUrl(url);

        if (!parsed) {
            return { success: false, error: 'Invalid Twitter URL' };
        }

        // Redirect to FxTwitter (fxtwitter.com)
        return {
            success: false,
            redirect: `https://fxtwitter.com/${parsed.username}/status/${parsed.tweetId}`,
            error: 'Redirecting to FxTwitter',
        };
    },
};

