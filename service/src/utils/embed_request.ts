/** Resolve a supported link and apply the same rendering options on every route. */

import { findHandler } from '../handlers/index.ts';
import type { Env, HandlerOptions } from '../types.ts';
import { applyRequestedTranslation } from './translation.ts';

export function prepareEmbedRequest(url: string, language?: string, mode?: string) {
    const handler = findHandler(url);
    if (!handler) return null;

    const options: HandlerOptions = {
        language,
        mode: mode === 'gallery' || mode === 'mosaic' ? mode : undefined,
    };
    return {
        platform: handler.name,
        options,
        async fetch(env: Env) {
            return applyRequestedTranslation(await handler.handle(url, env, options), env, options);
        },
    };
}
