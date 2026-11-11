/**
 * Bluesky-compatible (AT Protocol) app post links on hosts other than bsky.app.
 *
 * Any HTTPS host whose path is `/profile/<handle-or-did>/post/<rkey>` (or the
 * `/public/profile/...` form) is a candidate. It only renders after the public
 * AT Protocol AppView resolves the handle and returns the post; otherwise the
 * link is treated as unsupported. Lookups are cached per isolate, hits and
 * misses alike, and every request has a short timeout.
 */

import { fetchWithTimeout } from './fetch.ts';

export const PUBLIC_APPVIEW = 'https://public.api.bsky.app';

/** Large sites that are not AT Protocol apps; skipped without a lookup. */
export const NON_ATPROTO_DOMAINS = new Set([
    'amazon.com',
    'apple.com',
    'baidu.com',
    'bilibili.com',
    'bing.com',
    'deviantart.com',
    'discord.com',
    'discord.gg',
    'discordapp.com',
    'facebook.com',
    'fandom.com',
    'fixembed.app',
    'github.com',
    'gitlab.com',
    'google.com',
    'imgur.com',
    'instagram.com',
    'linkedin.com',
    'medium.com',
    'microsoft.com',
    'naver.com',
    'patreon.com',
    'pinterest.com',
    'pixiv.net',
    'quora.com',
    'reddit.com',
    'roblox.com',
    'snapchat.com',
    'spotify.com',
    'stackoverflow.com',
    'steamcommunity.com',
    'substack.com',
    't.me',
    'threads.com',
    'threads.net',
    'tiktok.com',
    'tumblr.com',
    'twitch.tv',
    'twitter.com',
    'vk.com',
    'weibo.com',
    'wikipedia.org',
    'x.com',
    'yahoo.com',
    'youtu.be',
    'youtube.com',
]);

/** Hosts with the direct Bluesky path; never treated as generic candidates. */
const BLUESKY_HOSTS = new Set(['bsky.app', 'bskyx.app']);

// AT Protocol handle syntax (https://atproto.com/specs/handle).
const HANDLE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const DISALLOWED_HANDLE_TLDS = new Set([
    'alt', 'arpa', 'example', 'internal', 'invalid', 'local', 'localhost', 'onion',
]);
const DID_PLC = /^did:plc:[a-z2-7]{24}$/;
// Post records are keyed by TIDs (https://atproto.com/specs/tid).
const TID = /^[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}$/;

export const ATPROTO_REQUEST_TIMEOUT_MS = 4000;
const HIT_TTL_MS = 60 * 60 * 1000;
const POST_HIT_TTL_MS = 5 * 60 * 1000;
const MISS_TTL_MS = 10 * 60 * 1000;
const TRANSIENT_TTL_MS = 60 * 1000;
const MAX_CACHE_ENTRIES = 2048;

export interface AtprotoPostLink {
    /** The app the link was shared from, used for the card's original link. */
    origin: string;
    /** A lowercase handle or a DID. */
    actor: string;
    rkey: string;
}

export function isValidHandle(value: string): boolean {
    const handle = value.toLowerCase();
    if (handle.length > 253 || !HANDLE.test(handle)) return false;
    return !DISALLOWED_HANDLE_TLDS.has(handle.slice(handle.lastIndexOf('.') + 1));
}

export function isValidDid(value: string): boolean {
    if (DID_PLC.test(value)) return true;
    // AT Protocol only supports hostname-level did:web, without ports or paths.
    return value.startsWith('did:web:') && isValidHandle(value.slice('did:web:'.length));
}

export function isValidTid(value: string): boolean {
    return TID.test(value);
}

function isNonAtprotoHost(host: string): boolean {
    for (const domain of NON_ATPROTO_DOMAINS) {
        if (host === domain || host.endsWith(`.${domain}`)) return true;
    }
    return false;
}

/** Return a strictly validated post link on a non-Bluesky host, or null. */
export function parseAtprotoPostUrl(url: string): AtprotoPostLink | null {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return null;
    }
    if (
        parsed.protocol !== 'https:'
        || parsed.username
        || parsed.password
        || (parsed.port && parsed.port !== '443')
    ) {
        return null;
    }
    const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
    const site = host.startsWith('www.') ? host.slice(4) : host;
    // isValidHandle also rejects IP literals, single-label hosts, and .local etc.
    if (!isValidHandle(host) || BLUESKY_HOSTS.has(site) || isNonAtprotoHost(site)) {
        return null;
    }

    let segments = parsed.pathname.split('/').filter(Boolean);
    // W Social, for one, also serves posts under /public/profile/...
    if (segments[0] === 'public') segments = segments.slice(1);
    if (segments.length !== 4 || segments[0] !== 'profile' || segments[2] !== 'post') {
        return null;
    }

    let actor: string;
    try {
        actor = decodeURIComponent(segments[1]);
    } catch {
        return null;
    }
    if (actor.startsWith('did:')) {
        if (!isValidDid(actor)) return null;
    } else if (isValidHandle(actor)) {
        actor = actor.toLowerCase();
    } else {
        return null;
    }
    const rkey = segments[3];
    if (!isValidTid(rkey)) return null;
    return { origin: `https://${host}`, actor, rkey };
}

class TtlCache<T> {
    private readonly entries = new Map<string, { expiresAt: number; value: T }>();

    get(key: string): { value: T } | undefined {
        const entry = this.entries.get(key);
        if (!entry) return undefined;
        if (entry.expiresAt <= Date.now()) {
            this.entries.delete(key);
            return undefined;
        }
        // Refresh recency for LRU eviction.
        this.entries.delete(key);
        this.entries.set(key, entry);
        return { value: entry.value };
    }

    set(key: string, value: T, ttlMs: number): void {
        this.entries.delete(key);
        this.entries.set(key, { expiresAt: Date.now() + ttlMs, value });
        while (this.entries.size > MAX_CACHE_ENTRIES) {
            const oldest = this.entries.keys().next().value;
            if (oldest === undefined) break;
            this.entries.delete(oldest);
        }
    }

    clear(): void {
        this.entries.clear();
    }
}

const didCache = new TtlCache<string | null>();
const postCache = new TtlCache<unknown | null>();

export function clearAtprotoCaches(): void {
    didCache.clear();
    postCache.clear();
}

type Lookup<T> = { outcome: 'found'; value: T } | { outcome: 'missing' | 'transient' };

async function appviewLookup<T>(
    path: string,
    found: (body: Record<string, unknown>) => T | undefined,
): Promise<Lookup<T>> {
    let response: Response;
    try {
        response = await fetchWithTimeout(`${PUBLIC_APPVIEW}${path}`, {
            headers: { 'Accept': 'application/json', 'User-Agent': 'FixEmbed/1.5' },
        }, ATPROTO_REQUEST_TIMEOUT_MS);
    } catch {
        return { outcome: 'transient' };
    }
    if (response.status >= 500 || response.status === 429) return { outcome: 'transient' };
    if (!response.ok) return { outcome: 'missing' };
    let body: unknown;
    try {
        body = await response.json();
    } catch {
        return { outcome: 'missing' };
    }
    const value = body && typeof body === 'object'
        ? found(body as Record<string, unknown>)
        : undefined;
    return value === undefined ? { outcome: 'missing' } : { outcome: 'found', value };
}

function ttlFor(outcome: 'found' | 'missing' | 'transient', hitTtl: number): number {
    if (outcome === 'found') return hitTtl;
    return outcome === 'missing' ? MISS_TTL_MS : TRANSIENT_TTL_MS;
}

/** Resolve a handle to its DID through the public AppView, or null. */
export async function resolveAtprotoDid(handle: string): Promise<string | null> {
    const cached = didCache.get(handle);
    if (cached) return cached.value;
    const result = await appviewLookup(
        `/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`,
        (body) => (typeof body.did === 'string' && isValidDid(body.did) ? body.did : undefined),
    );
    const did = result.outcome === 'found' ? result.value : null;
    didCache.set(handle, did, ttlFor(result.outcome, HIT_TTL_MS));
    return did;
}

/** Fetch `at://<did>/app.bsky.feed.post/<rkey>` from the public AppView, or null. */
export async function fetchAtprotoPostThread<T>(did: string, rkey: string): Promise<T | null> {
    const uri = `at://${did}/app.bsky.feed.post/${rkey}`;
    const cached = postCache.get(uri);
    if (cached) return cached.value as T | null;
    const result = await appviewLookup(
        `/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent(uri)}&depth=0&parentHeight=0`,
        (body) => {
            const thread = body.thread as { post?: { uri?: string } } | undefined;
            return thread?.post?.uri === uri ? body : undefined;
        },
    );
    const thread = result.outcome === 'found' ? result.value : null;
    postCache.set(uri, thread, ttlFor(result.outcome, POST_HIT_TTL_MS));
    return thread as T | null;
}
