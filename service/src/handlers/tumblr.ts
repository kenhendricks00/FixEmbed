/**
 * FixEmbed Service - Tumblr Handler
 * Reads bounded public permalink metadata and Tumblr's JSON-LD post identity.
 */

import type { Env, HandlerResponse, PlatformHandler } from '../types.ts';
import { decodeHtmlEntities, fetchWithTimeout, truncateText } from '../utils/fetch.ts';
import { getBrandedSiteName, platformColors } from '../utils/embed.ts';

const MAX_TUMBLR_HTML_BYTES = 1_500_000;
const TUMBLR_MEDIA_SUFFIXES = ['media.tumblr.com', 'assets.tumblr.com'];

type TumblrPostUrl = {
    canonical: string;
    blog: string;
    postId: string;
};

type JsonLdAuthor = {
    name?: unknown;
    url?: unknown;
    image?: unknown;
};

type TumblrJsonLd = {
    '@type'?: unknown;
    datePublished?: unknown;
    articleBody?: unknown;
    keywords?: unknown;
    author?: JsonLdAuthor;
};

function parseTumblrPostUrl(raw: string): TumblrPostUrl | null {
    try {
        const url = new URL(raw);
        if (url.protocol !== 'https:') return null;
        const host = url.hostname.toLowerCase();
        const path = url.pathname.split('/').filter(Boolean);
        if (host === 'www.tumblr.com' && path.length >= 2 && /^[\w-]+$/.test(path[0]) && /^\d+$/.test(path[1])) {
            const slug = path[2] ? `/${path[2]}` : '';
            return {
                canonical: `https://${path[0]}.tumblr.com/post/${path[1]}${slug}`,
                blog: path[0],
                postId: path[1],
            };
        }
        const match = host.match(/^([\w-]+)\.tumblr\.com$/);
        if (match && path[0]?.toLowerCase() === 'post' && /^\d+$/.test(path[1] || '')) {
            const slug = path[2] ? `/${path[2]}` : '';
            return {
                canonical: `https://${match[1]}.tumblr.com/post/${path[1]}${slug}`,
                blog: match[1],
                postId: path[1],
            };
        }
    } catch {
        // Invalid user input.
    }
    return null;
}

function isTrustedTumblrUrl(raw: string): boolean {
    try {
        const url = new URL(raw);
        return url.protocol === 'https:' && (
            url.hostname.toLowerCase() === 'www.tumblr.com'
            || /^[\w-]+\.tumblr\.com$/i.test(url.hostname)
        );
    } catch {
        return false;
    }
}

async function readTextLimited(response: Response): Promise<string> {
    const declared = Number.parseInt(response.headers.get('Content-Length') || '', 10);
    if (Number.isFinite(declared) && declared > MAX_TUMBLR_HTML_BYTES) {
        throw new Error('Tumblr response too large');
    }
    if (!response.body) return '';
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let total = 0;
    let html = '';
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_TUMBLR_HTML_BYTES) {
            await reader.cancel();
            throw new Error('Tumblr response too large');
        }
        html += decoder.decode(value, { stream: true });
    }
    return html + decoder.decode();
}

async function fetchTumblrHtml(canonical: string): Promise<{ html: string; canonical: string }> {
    let current = canonical;
    for (let redirects = 0; redirects <= 3; redirects += 1) {
        if (!isTrustedTumblrUrl(current)) throw new Error('Unsafe Tumblr redirect');
        const response = await fetchWithTimeout(current, {
            redirect: 'manual',
            headers: {
                'Accept': 'text/html,application/xhtml+xml',
                'User-Agent': 'Mozilla/5.0 (compatible; FixEmbed/1.0; +https://fixembed.app)',
            },
        }, 6_000);
        if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get('Location');
            if (!location || redirects === 3) throw new Error('Unsafe Tumblr redirect');
            current = new URL(location, current).toString();
            continue;
        }
        if (!response.ok) throw new Error(`Tumblr returned ${response.status}`);
        return { html: await readTextLimited(response), canonical: current };
    }
    throw new Error('Tumblr metadata unavailable');
}

function metaContent(html: string, key: string): string {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const pattern of [
        new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, 'i'),
        new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, 'i'),
    ]) {
        const value = html.match(pattern)?.[1];
        if (value !== undefined) return decodeHtmlEntities(value).trim();
    }
    return '';
}

function tumblrJsonLd(html: string): TumblrJsonLd | undefined {
    for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
        try {
            const parsed = JSON.parse(match[1]) as TumblrJsonLd | TumblrJsonLd[];
            const candidates = Array.isArray(parsed) ? parsed : [parsed];
            const post = candidates.find((item) => item?.['@type'] === 'SocialMediaPosting');
            if (post) return post;
        } catch {
            // Continue past invalid or unrelated JSON-LD blocks.
        }
    }
    return undefined;
}

function jsonLdImage(author: JsonLdAuthor | undefined): string | undefined {
    const image = author?.image;
    const raw = typeof image === 'string'
        ? image
        : image && typeof image === 'object' && 'url' in image
            ? (image as { url?: unknown }).url
            : undefined;
    return trustedTumblrMedia(raw);
}

function trustedTumblrMedia(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    try {
        const url = new URL(decodeHtmlEntities(value));
        const host = url.hostname.toLowerCase();
        if (
            url.protocol === 'https:'
            && TUMBLR_MEDIA_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))
        ) {
            return url.toString();
        }
    } catch {
        // Ignore malformed page metadata.
    }
    return undefined;
}

function tumblrImages(html: string): string[] {
    const article = html.match(/<article\b[^>]*class=["'][^"']*\bpost\b[^"']*["'][^>]*>([\s\S]*?)<\/article>/i)?.[1] || '';
    const urls = [...article.matchAll(/<(?:img|source)\b[^>]*(?:data-orig-src|data-src|src)=["']([^"']+)["']/gi)]
        .map((match) => trustedTumblrMedia(match[1]))
        .filter((url): url is string => Boolean(url));
    return [...new Set(urls)].slice(0, 10);
}

function normalizeTimestamp(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function isSensitiveTumblrPost(html: string): boolean {
    return (
        /<meta[^>]+name=["']rating["'][^>]+content=["']adult["']/i.test(html)
        || /["'](?:isAdult|is_adult)["']\s*:\s*true/i.test(html)
        || /["']content_rating["']\s*:\s*["']adult["']/i.test(html)
    );
}

function tumblrTagContext(value: unknown): string | undefined {
    const candidates = Array.isArray(value)
        ? value
        : typeof value === 'string'
            ? value.split(',')
            : [];
    const tags = candidates
        .filter((tag): tag is string => typeof tag === 'string')
        .map((tag) => tag.trim().replace(/^#/, '').replace(/\s+/g, '-'))
        .filter((tag) => /^[\p{L}\p{N}_-]{1,50}$/u.test(tag))
        .slice(0, 10);
    return tags.length ? tags.map((tag) => `#${tag}`).join(' ') : undefined;
}

export const tumblrHandler: PlatformHandler = {
    name: 'tumblr',
    patterns: [
        /^https:\/\/[\w-]+\.tumblr\.com\/post\/\d+/i,
        /^https:\/\/www\.tumblr\.com\/[\w-]+\/\d+/i,
    ],

    async handle(url: string, _env: Env): Promise<HandlerResponse> {
        const parsed = parseTumblrPostUrl(url);
        if (!parsed) return { success: false, error: 'Invalid Tumblr URL' };
        try {
            const result = await fetchTumblrHtml(parsed.canonical);
            const jsonLd = tumblrJsonLd(result.html);
            const title = truncateText(metaContent(result.html, 'og:title') || 'Tumblr post', 300);
            const description = truncateText(
                metaContent(result.html, 'og:description')
                || (typeof jsonLd?.articleBody === 'string' ? jsonLd.articleBody : ''),
                2_500,
            );
            const authorName = typeof jsonLd?.author?.name === 'string'
                ? jsonLd.author.name.trim()
                : parsed.blog;
            const authorUrl = typeof jsonLd?.author?.url === 'string' && isTrustedTumblrUrl(jsonLd.author.url)
                ? jsonLd.author.url
                : `https://${parsed.blog}.tumblr.com/`;
            const images = tumblrImages(result.html);
            const noteMatch = result.html.match(/\b([\d,]+)\s+notes?\b/i);
            const notes = noteMatch ? Number(noteMatch[1].replace(/,/g, '')) : 0;
            return {
                success: true,
                source: 'first-party',
                data: {
                    title,
                    description,
                    url: parsed.canonical,
                    siteName: getBrandedSiteName('tumblr'),
                    authorName: authorName || parsed.blog,
                    authorHandle: `@${parsed.blog}`,
                    authorUrl,
                    authorAvatar: jsonLdImage(jsonLd?.author),
                    image: images.length === 1 ? images[0] : undefined,
                    images: images.length > 1 ? images : undefined,
                    timestamp: normalizeTimestamp(jsonLd?.datePublished),
                    stats: notes > 0 ? `📝 ${notes.toLocaleString('en-US')} notes` : undefined,
                    context: tumblrTagContext(jsonLd?.keywords),
                    sensitive: isSensitiveTumblrPost(result.html),
                    color: platformColors.tumblr,
                    platform: 'tumblr',
                },
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Tumblr metadata unavailable',
                redirect: parsed.canonical,
            };
        }
    },
};
