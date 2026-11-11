/** Resolve a supported link and apply the same rendering options on every route. */

import { findHandler } from '../handlers/index.ts';
import type { Env, HandlerOptions, HandlerResponse } from '../types.ts';
import { incompleteEmbedReason, preferEmbedResult, shouldRetryEmbed } from './embed_quality.ts';
import { applyRequestedTranslation } from './translation.ts';

/**
 * A second attempt only starts when the first answered this quickly, so the
 * worst case stays inside Discord's unfurl patience. Bad Instagram answers
 * usually come back fast (a provider skipped or failed, not a slow timeout).
 */
export const EMBED_RETRY_WINDOW_MS = 2000;

export function prepareEmbedRequest(
    url: string,
    language?: string,
    mode?: string,
    now: () => number = Date.now,
) {
    const handler = findHandler(url);
    if (!handler) return null;

    const options: HandlerOptions = {
        language,
        mode: mode === 'gallery' || mode === 'mosaic' ? mode : undefined,
    };
    return {
        platform: handler.name,
        options,
        async fetch(env: Env): Promise<HandlerResponse> {
            const startedAt = now();
            let result = await handler.handle(url, env, options);
            if (
                shouldRetryEmbed(handler.name, result)
                && now() - startedAt < EMBED_RETRY_WINDOW_MS
            ) {
                const retried = await handler.handle(url, env, options);
                result = preferEmbedResult(handler.name, result, retried);
            }
            const reason = result.success ? incompleteEmbedReason(handler.name, result.data) : undefined;
            if (reason) {
                console.warn('embed_incomplete', { platform: handler.name, reason });
                result = { ...result, incomplete: true };
            }
            return applyRequestedTranslation(result, env, options);
        },
    };
}
