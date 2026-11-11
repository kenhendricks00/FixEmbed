/**
 * One short-lived store of complete cards shared by /api/embed, /embed, and the
 * Mastodon status routes. Discord unfurls a link in two hops (/embed, then the
 * advertised status), so both hops must see the same card instead of asking
 * the source platform twice and getting two different answers.
 */

import type { EmbedData, Env, HandlerOptions, HandlerResponse } from '../types.ts';

// v22: v21 entries could hold Instagram cards with no poster or media.
const CACHE_NAME = 'fixembed-embed-api-v22';
const DEFAULT_TTL_SECONDS = 300;
const MAX_TTL_SECONDS = 3600;
const MEMORY_CACHE_MAX_ENTRIES = 128;

type WaitUntil = { waitUntil(promise: Promise<unknown>): void };

/** Hono throws when a request has no ExecutionContext (local tests). */
export function optionalExecutionContext(c: { readonly executionCtx: WaitUntil }): WaitUntil | undefined {
    try {
        return c.executionCtx;
    } catch {
        return undefined;
    }
}

interface PreparedEmbedRequest {
    platform: string;
    options: HandlerOptions;
    fetch(env: Env): Promise<HandlerResponse>;
}

export interface EmbedCacheContext {
    cache: Cache;
    key: Request;
    ttlSeconds: number;
}

/** The JSON body /api/embed returns for a successful card. */
export interface CachedEmbedBody {
    success: true;
    platform: string;
    source?: HandlerResponse['source'];
    data: EmbedData;
}

// Cache.put runs in waitUntil, so Discord's status hop can arrive before the
// edge entry exists. This per-isolate copy closes that gap.
const memoryCache = new Map<string, { body: CachedEmbedBody; expiresAt: number }>();

/** Test hook: forget every in-isolate entry. */
export function clearEmbedMemoryCache(): void {
    memoryCache.clear();
}

function readMemory(key: string, now = Date.now()): CachedEmbedBody | undefined {
    const entry = memoryCache.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now) {
        memoryCache.delete(key);
        return undefined;
    }
    return entry.body;
}

function writeMemory(key: string, body: CachedEmbedBody, ttlSeconds: number, now = Date.now()): void {
    memoryCache.delete(key);
    memoryCache.set(key, { body, expiresAt: now + ttlSeconds * 1000 });
    while (memoryCache.size > MEMORY_CACHE_MAX_ENTRIES) {
        const oldest = memoryCache.keys().next().value;
        if (oldest === undefined) break;
        memoryCache.delete(oldest);
    }
}

/** Reuse only complete cards whose requested translation arrived. */
export function isCacheableEmbed(result: HandlerResponse): boolean {
    return Boolean(
        result.success
        && result.data
        && !result.unsupported
        && !result.incomplete
        && !result.translationUnavailable,
    );
}

export function cachedEmbedBody(platform: string, result: HandlerResponse): CachedEmbedBody {
    return {
        success: true,
        platform,
        source: result.source,
        data: result.data as EmbedData,
    };
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

/** Read a complete card from this isolate or the edge cache. */
export async function readCachedEmbed(
    context: EmbedCacheContext | undefined,
): Promise<CachedEmbedBody | undefined> {
    if (!context) return undefined;
    const remembered = readMemory(context.key.url);
    if (remembered) return remembered;

    try {
        const cached = await context.cache.match(context.key);
        if (!cached) return undefined;
        const body = await cached.json() as CachedEmbedBody;
        if (!body?.success || !body.data) return undefined;
        writeMemory(context.key.url, body, context.ttlSeconds);
        return body;
    } catch (error) {
        console.warn('embed_cache_read_failed', {
            errorType: error instanceof Error ? error.name : 'UnknownError',
        });
        return undefined;
    }
}

/** Remember a complete card for every route; incomplete cards are ignored. */
export function rememberEmbed(
    context: EmbedCacheContext | undefined,
    platform: string,
    result: HandlerResponse,
    executionContext?: WaitUntil,
): void {
    if (!context || !isCacheableEmbed(result)) return;
    const body = cachedEmbedBody(platform, result);
    writeMemory(context.key.url, body, context.ttlSeconds);
    const stored = new Response(JSON.stringify(body), {
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': `public, max-age=0, s-maxage=${context.ttlSeconds}`,
        },
    });
    const write = context.cache.put(context.key, stored).catch((error) => {
        console.warn('embed_cache_write_failed', {
            errorType: error instanceof Error ? error.name : 'UnknownError',
        });
    });
    executionContext?.waitUntil(write);
}

/**
 * Serve a complete card from the shared store, or build one and remember it.
 * Both Discord hops go through here, so the status hop reuses the card that
 * /embed advertised instead of re-asking the source platform.
 */
export async function resolveEmbedThroughCache(
    env: Env,
    requestUrl: string,
    sourceUrl: string,
    request: PreparedEmbedRequest,
    executionContext?: WaitUntil,
): Promise<HandlerResponse> {
    const context = await prepareEmbedCache(env, requestUrl, sourceUrl, request.options);
    const cached = await readCachedEmbed(context);
    // Routes reshape card data, so never hand out the shared in-isolate copy.
    if (cached) return { success: true, source: cached.source, data: structuredClone(cached.data) };

    const result = await request.fetch(env);
    rememberEmbed(context, request.platform, result, executionContext);
    // The activity status names the card by its canonical URL, which can
    // differ from the shared link (share links, tracking parameters).
    const canonicalUrl = result.data?.url;
    if (canonicalUrl && canonicalUrl !== sourceUrl && isCacheableEmbed(result)) {
        const canonicalContext = await prepareEmbedCache(env, requestUrl, canonicalUrl, request.options);
        rememberEmbed(canonicalContext, request.platform, result, executionContext);
    }
    return result;
}

export async function readEmbedCache(
    context: EmbedCacheContext | undefined,
): Promise<Response | undefined> {
    if (!context) return undefined;

    const remembered = readMemory(context.key.url);
    if (remembered) {
        return Response.json(remembered, {
            headers: { 'Cache-Control': 'no-store', 'X-FixEmbed-Cache': 'HIT' },
        });
    }

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
