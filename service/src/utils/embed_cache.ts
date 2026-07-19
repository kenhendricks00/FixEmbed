import type { Env, HandlerOptions } from '../types.ts';

const CACHE_NAME = 'fixembed-embed-api-v3';
const DEFAULT_TTL_SECONDS = 300;
const MAX_TTL_SECONDS = 3600;

export interface EmbedCacheContext {
    cache: Cache;
    key: Request;
    ttlSeconds: number;
}

function cacheEnabled(value: unknown): boolean {
    return String(value).trim().toLowerCase() === 'true';
}

function cacheTtlSeconds(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TTL_SECONDS;
    return Math.min(Math.floor(parsed), MAX_TTL_SECONDS);
}

async function digestCacheInput(
    sourceUrl: string,
    options: HandlerOptions,
): Promise<string> {
    const input = JSON.stringify([
        sourceUrl,
        options.language?.trim().toLowerCase() ?? '',
        options.mode ?? '',
    ]);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function prepareEmbedCache(
    env: Env,
    requestUrl: string,
    sourceUrl: string,
    options: HandlerOptions,
): Promise<EmbedCacheContext | undefined> {
    if (!cacheEnabled(env.ENABLE_CACHE) || typeof globalThis.caches === 'undefined') {
        return undefined;
    }

    try {
        if (new URL(requestUrl).searchParams.has('_conformance')) {
            return undefined;
        }
        const digest = await digestCacheInput(sourceUrl, options);
        const origin = new URL(requestUrl).origin;
        return {
            cache: await globalThis.caches.open(CACHE_NAME),
            key: new Request(`${origin}/__cache/embed/${digest}`, { method: 'GET' }),
            ttlSeconds: cacheTtlSeconds(env.CACHE_TTL),
        };
    } catch (error) {
        console.warn('embed_cache_prepare_failed', {
            errorType: error instanceof Error ? error.name : 'UnknownError',
        });
        return undefined;
    }
}

export async function readEmbedCache(
    context: EmbedCacheContext | undefined,
): Promise<Response | undefined> {
    if (!context) return undefined;

    try {
        const cached = await context.cache.match(context.key);
        if (!cached) return undefined;
        const headers = new Headers(cached.headers);
        headers.set('Cache-Control', 'no-store');
        headers.set('X-FixEmbed-Cache', 'HIT');
        return new Response(await cached.arrayBuffer(), {
            status: cached.status,
            statusText: cached.statusText,
            headers,
        });
    } catch (error) {
        console.warn('embed_cache_read_failed', {
            errorType: error instanceof Error ? error.name : 'UnknownError',
        });
        return undefined;
    }
}

export function storeEmbedCache(
    context: EmbedCacheContext | undefined,
    response: Response,
    executionContext: { waitUntil(promise: Promise<unknown>): void },
): Response {
    if (!context || response.status !== 200) return response;

    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('X-FixEmbed-Cache', 'MISS');
    const cachedResponse = response.clone();
    cachedResponse.headers.set(
        'Cache-Control',
        `public, max-age=0, s-maxage=${context.ttlSeconds}`,
    );
    const write = context.cache.put(context.key, cachedResponse).catch((error) => {
        console.warn('embed_cache_write_failed', {
            errorType: error instanceof Error ? error.name : 'UnknownError',
        });
    });
    executionContext.waitUntil(write);
    return response;
}
