/**
 * FixEmbed Service - Type Definitions
 */

// Environment bindings for Cloudflare Workers
export interface Env {
    SITE_NAME: string;
    BRANDING_NAME: string;
    EMBED_DOMAIN: string;
    ENABLE_CACHE: string;
    CACHE_TTL: string;
    EMBED_CACHE?: KVNamespace;
}

// Supported platforms
export type Platform =
    | 'twitter'
    | 'instagram'
    | 'reddit'
    | 'threads'
    | 'pixiv'
    | 'bluesky'
    | 'youtube'
    | 'bilibili';

// Embed data returned by handlers
export interface EmbedData {
    // Basic info
    title: string;
    description?: string;
    url: string;
    siteName: string;

    // Author info
    authorName?: string;
    authorUrl?: string;
    authorAvatar?: string;

    // Media
    image?: string;
    video?: VideoEmbed;

    // Metadata
    color?: string;
    timestamp?: string;
    platform: Platform;
}

export interface VideoEmbed {
    url: string;
    width: number;
    height: number;
    thumbnail?: string;
}

// Handler response
export interface HandlerResponse {
    success: boolean;
    data?: EmbedData;
    error?: string;
    redirect?: string;
}

// Platform handler interface
export interface PlatformHandler {
    name: Platform;
    patterns: RegExp[];
    handle: (url: string, env: Env) => Promise<HandlerResponse>;
}

// API response from external services
export interface TwitterAPIResponse {
    data?: {
        text: string;
        author_id: string;
        attachments?: {
            media_keys?: string[];
        };
        created_at: string;
    };
    includes?: {
        users?: Array<{
            id: string;
            name: string;
            username: string;
            profile_image_url?: string;
        }>;
        media?: Array<{
            media_key: string;
            type: string;
            url?: string;
            preview_image_url?: string;
            variants?: Array<{
                bit_rate?: number;
                content_type: string;
                url: string;
            }>;
        }>;
    };
}

export interface RedditAPIResponse {
    data: {
        children: Array<{
            data: {
                title: string;
                selftext: string;
                author: string;
                subreddit: string;
                url: string;
                thumbnail?: string;
                preview?: {
                    images?: Array<{
                        source: { url: string; width: number; height: number };
                    }>;
                };
                is_video?: boolean;
                media?: {
                    reddit_video?: {
                        fallback_url: string;
                        width: number;
                        height: number;
                    };
                };
                created_utc: number;
            };
        }>;
    };
}
