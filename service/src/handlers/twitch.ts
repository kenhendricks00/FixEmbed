/**
 * FixEmbed Service - Twitch Handler
 * Uses Twitch's logged-out public GraphQL surface for clips, VODs, and channels.
 */

import type { Env, HandlerResponse, PlatformHandler, VideoEmbed } from '../types.ts';
import { fetchWithTimeout, truncateText } from '../utils/fetch.ts';
import { formatNumber, getBrandedSiteName, platformColors } from '../utils/embed.ts';

// Twitch's public logged-out web client identifier, not an account credential.
const TWITCH_PUBLIC_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
const TWITCH_GQL = 'https://gql.twitch.tv/gql';
const MAX_GQL_BYTES = 500_000;
const TWITCH_RESERVED_CHANNELS = new Set([
    'directory', 'downloads', 'inventory', 'jobs', 'p', 'search',
    'settings', 'subscriptions', 'videos', 'wallet',
]);

type TwitchInput =
    | { kind: 'clip'; slug: string; canonical: string }
    | { kind: 'video'; id: string; canonical: string }
    | { kind: 'channel'; login: string; canonical: string };

type TwitchIdentity = {
    displayName?: unknown;
    login?: unknown;
    profileImageURL?: unknown;
};

function parseTwitchUrl(raw: string): TwitchInput | null {
    try {
        const url = new URL(raw);
        if (url.protocol !== 'https:') return null;
        const host = url.hostname.toLowerCase().replace(/^www\./, '');
        const path = url.pathname.split('/').filter(Boolean);
        if (host === 'clips.twitch.tv' && /^[A-Za-z0-9_-]+$/.test(path[0] || '')) {
            return { kind: 'clip', slug: path[0], canonical: `https://clips.twitch.tv/${path[0]}` };
        }
        if (host !== 'twitch.tv') return null;
        if (path.length >= 3 && path[1]?.toLowerCase() === 'clip' && /^[A-Za-z0-9_-]+$/.test(path[2])) {
            return { kind: 'clip', slug: path[2], canonical: `https://clips.twitch.tv/${path[2]}` };
        }
        if (path[0]?.toLowerCase() === 'videos' && /^\d+$/.test(path[1] || '')) {
            return { kind: 'video', id: path[1], canonical: `https://www.twitch.tv/videos/${path[1]}` };
        }
        if (
            path.length === 1
            && /^[A-Za-z0-9_]+$/.test(path[0])
            && !TWITCH_RESERVED_CHANNELS.has(path[0].toLowerCase())
        ) {
            const login = path[0].toLowerCase();
            return { kind: 'channel', login, canonical: `https://www.twitch.tv/${login}` };
        }
    } catch {
        // Invalid user input.
    }
    return null;
}

function trustedTwitchMedia(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    try {
        const url = new URL(value);
        const host = url.hostname.toLowerCase();
        if (
            url.protocol === 'https:'
            && (
                host === 'static-cdn.jtvnw.net'
                || host.endsWith('.jtvnw.net')
                || host === 'd1ndex63qxojbr.cloudfront.net'
                || host.endsWith('.cloudfront.net')
            )
        ) {
            return url.toString();
        }
    } catch {
        // Ignore malformed GraphQL metadata.
    }
    return undefined;
}

async function readJsonLimited(response: Response): Promise<unknown> {
    if (!response.ok) throw new Error(`Twitch GraphQL returned ${response.status}`);
    const declared = Number.parseInt(response.headers.get('Content-Length') || '', 10);
    if (Number.isFinite(declared) && declared > MAX_GQL_BYTES) throw new Error('Twitch response too large');
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_GQL_BYTES) throw new Error('Twitch response too large');
    return JSON.parse(text);
}

async function twitchQuery(query: string, variables: Record<string, string>): Promise<Record<string, unknown>> {
    const response = await fetchWithTimeout(TWITCH_GQL, {
        method: 'POST',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Client-ID': TWITCH_PUBLIC_CLIENT_ID,
        },
        body: JSON.stringify({ query, variables }),
    }, 6_000);
    const payload = await readJsonLimited(response) as { data?: unknown };
    return payload.data && typeof payload.data === 'object'
        ? payload.data as Record<string, unknown>
        : {};
}

function identity(value: unknown): TwitchIdentity | undefined {
    return value && typeof value === 'object' ? value as TwitchIdentity : undefined;
}

function text(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function finiteNumber(value: unknown): number | undefined {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function authorFields(value: unknown) {
    const author = identity(value);
    const login = text(author?.login).toLowerCase();
    return {
        authorName: text(author?.displayName) || login || 'Twitch',
        authorHandle: login ? `@${login}` : undefined,
        authorUrl: login ? `https://www.twitch.tv/${login}` : undefined,
        authorAvatar: trustedTwitchMedia(author?.profileImageURL),
    };
}

const CLIP_QUERY = `
query Clip($slug: ID!) {
  clip(slug: $slug) {
    slug title createdAt durationSeconds viewCount
    thumbnailURL(width: 1280, height: 720)
    broadcaster { displayName login profileImageURL(width: 300) }
    curator { displayName login }
    game { displayName }
    playbackAccessToken(params: {
      platform: "web"
      playerBackend: "mediaplayer"
      playerType: "site"
    }) { signature value }
    videoQualities { sourceURL quality frameRate }
  }
}`;

const VIDEO_QUERY = `
query Video($id: ID!) {
  video(id: $id) {
    id title description createdAt lengthSeconds viewCount
    previewThumbnailURL(width: 1280, height: 720)
    owner { displayName login profileImageURL(width: 300) }
    game { displayName }
  }
}`;

const CHANNEL_QUERY = `
query Channel($login: String!) {
  user(login: $login) {
    displayName login description profileImageURL(width: 300) bannerImageURL
    stream {
      title viewersCount createdAt previewImageURL(width: 1280, height: 720)
      game { displayName }
    }
  }
}`;

function object(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

async function handleClip(input: Extract<TwitchInput, { kind: 'clip' }>): Promise<HandlerResponse> {
    const root = await twitchQuery(CLIP_QUERY, { slug: input.slug });
    const clip = object(root.clip);
    if (!clip) return { success: false, error: 'Twitch clip not found', redirect: input.canonical };
    const broadcaster = authorFields(clip.broadcaster);
    const curator = identity(clip.curator);
    const game = object(clip.game);
    const duration = finiteNumber(clip.durationSeconds);
    const viewCount = finiteNumber(clip.viewCount);
    const qualities = Array.isArray(clip.videoQualities)
        ? clip.videoQualities
            .map(object)
            .filter((item): item is Record<string, unknown> => Boolean(item))
            .sort((left, right) => (finiteNumber(right.quality) || 0) - (finiteNumber(left.quality) || 0))
        : [];
    const accessToken = object(clip.playbackAccessToken);
    const sourceUrl = trustedTwitchMedia(qualities[0]?.sourceURL);
    const signature = text(accessToken?.signature);
    const token = text(accessToken?.value);
    let videoUrl: string | undefined;
    if (sourceUrl && signature && token) {
        const signedUrl = new URL(sourceUrl);
        signedUrl.searchParams.set('sig', signature);
        signedUrl.searchParams.set('token', token);
        videoUrl = trustedTwitchMedia(signedUrl.toString());
    }
    const thumbnail = trustedTwitchMedia(clip.thumbnailURL);
    const video: VideoEmbed | undefined = videoUrl ? {
        url: videoUrl,
        width: 1280,
        height: 720,
        thumbnail,
    } : undefined;
    const context = [
        text(game?.displayName),
        text(curator?.displayName) ? `Clipped by ${text(curator?.displayName)}` : '',
        duration !== undefined ? `${Math.round(duration)}s` : '',
    ].filter(Boolean).join(' · ');
    return {
        success: true,
        source: 'first-party',
        data: {
            title: truncateText(text(clip.title) || 'Twitch clip', 300),
            description: context,
            url: input.canonical,
            siteName: getBrandedSiteName('twitch'),
            ...broadcaster,
            image: video ? undefined : thumbnail,
            video,
            timestamp: text(clip.createdAt) || undefined,
            stats: viewCount ? `👁️ ${formatNumber(viewCount)} views` : undefined,
            color: platformColors.twitch,
            platform: 'twitch',
        },
    };
}

async function handleVideo(input: Extract<TwitchInput, { kind: 'video' }>): Promise<HandlerResponse> {
    const root = await twitchQuery(VIDEO_QUERY, { id: input.id });
    const video = object(root.video);
    if (!video) return { success: false, error: 'Twitch VOD not found', redirect: input.canonical };
    const game = object(video.game);
    const length = finiteNumber(video.lengthSeconds);
    const views = finiteNumber(video.viewCount);
    const hours = length !== undefined ? Math.floor(length / 3600) : 0;
    const minutes = length !== undefined ? Math.floor((length % 3600) / 60) : 0;
    const context = [
        text(game?.displayName),
        length !== undefined ? (hours ? `${hours}h ${minutes}m` : `${minutes}m`) : '',
        text(video.description),
    ].filter(Boolean).join(' · ');
    return {
        success: true,
        source: 'first-party',
        data: {
            title: truncateText(text(video.title) || 'Twitch VOD', 300),
            description: truncateText(context, 2_000),
            url: input.canonical,
            siteName: getBrandedSiteName('twitch'),
            ...authorFields(video.owner),
            image: trustedTwitchMedia(video.previewThumbnailURL),
            timestamp: text(video.createdAt) || undefined,
            stats: views ? `👁️ ${formatNumber(views)} views` : undefined,
            color: platformColors.twitch,
            platform: 'twitch',
        },
    };
}

async function handleChannel(input: Extract<TwitchInput, { kind: 'channel' }>): Promise<HandlerResponse> {
    const root = await twitchQuery(CHANNEL_QUERY, { login: input.login });
    const user = object(root.user);
    if (!user) return { success: false, error: 'Twitch channel not found', redirect: input.canonical };
    const stream = object(user.stream);
    const game = object(stream?.game);
    const viewers = finiteNumber(stream?.viewersCount);
    const liveContext = stream
        ? [text(game?.displayName), 'LIVE'].filter(Boolean).join(' · ')
        : 'Channel offline';
    return {
        success: true,
        source: 'first-party',
        data: {
            title: truncateText(text(stream?.title) || `${text(user.displayName) || input.login} on Twitch`, 300),
            description: truncateText(
                [liveContext, text(user.description)].filter(Boolean).join('\n\n'),
                2_000,
            ),
            url: input.canonical,
            siteName: getBrandedSiteName('twitch'),
            ...authorFields(user),
            image: trustedTwitchMedia(stream?.previewImageURL) || trustedTwitchMedia(user.bannerImageURL),
            timestamp: text(stream?.createdAt) || undefined,
            stats: viewers ? `👁️ ${formatNumber(viewers)} watching` : undefined,
            color: platformColors.twitch,
            platform: 'twitch',
        },
    };
}

export const twitchHandler: PlatformHandler = {
    name: 'twitch',
    patterns: [
        /^https:\/\/clips\.twitch\.tv\/[A-Za-z0-9_-]+/i,
        /^https:\/\/(?:www\.)?twitch\.tv\/[A-Za-z0-9_]+\/clip\/[A-Za-z0-9_-]+/i,
        /^https:\/\/(?:www\.)?twitch\.tv\/videos\/\d+/i,
        /^https:\/\/(?:www\.)?twitch\.tv\/[A-Za-z0-9_]+\/?(?:[?#].*)?$/i,
    ],

    async handle(url: string, _env: Env): Promise<HandlerResponse> {
        const input = parseTwitchUrl(url);
        if (!input) return { success: false, error: 'Invalid Twitch URL' };
        try {
            if (input.kind === 'clip') return await handleClip(input);
            if (input.kind === 'video') return await handleVideo(input);
            return await handleChannel(input);
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Twitch metadata unavailable',
                redirect: input.canonical,
            };
        }
    },
};
