/** Activity routes. */

import { Hono } from 'hono';
import type { Env } from '../types.ts';
import { type Context } from 'hono';
import { prepareEmbedRequest } from '../utils/embed_request.ts';
import { normalizeLanguage } from '../utils/translation.ts';
import { FIXEMBED_LOGO, activityBodyText, formatActivityContent } from '../utils/embed.ts';

const app = new Hono<{ Bindings: Env }>();

interface ActivityEmbedData {
    src?: string;
    t?: string;
    d?: string;
    i?: string;
    is?: string[];
    v?: string;
    vt?: string;
    vw?: number;
    vh?: number;
    mt?: 'video' | 'gif';
    p?: string;
    a?: string;
    h?: string;
    ic?: string;
    s?: string;
    u?: string;
    m?: string;
    ts?: string;
    au?: string;
    sn?: string;
    l?: string;
    tn?: string;
    tu?: string;
}

function decodeActivitySource(encodedData: string): ActivityEmbedData {
    if (encodedData.length > 4096) return {};
    const bytes = encodedData.slice(2);
    if (!bytes || bytes.length % 3 !== 0) return {};
    const decoded: number[] = [];
    for (let index = 0; index < bytes.length; index += 3) {
        const byte = Number(bytes.slice(index, index + 3));
        if (!Number.isInteger(byte) || byte < 0 || byte > 255) return {};
        decoded.push(byte);
    }
    try {
        return { src: new TextDecoder().decode(new Uint8Array(decoded)) };
    } catch {
        return {};
    }
}

interface MastodonMediaAttachment {
    id: string;
    type: 'video' | 'gifv' | 'image';
    url: string;
    preview_url: string | null;
    remote_url: null;
    preview_remote_url: null;
    text_url: null;
    description: null;
    meta: {
        original: {
            width: number;
            height: number;
            size?: string;
            aspect?: number;
        };
    };
}

const SNOWCODE_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789{}[]":,.-_';

function decodeSnowcode(encodedData: string): ActivityEmbedData {
    if (encodedData.length % 2 !== 0) return {};
    let json = '';
    for (let index = 0; index < encodedData.length; index += 2) {
        const characterIndex = Number(encodedData.slice(index, index + 2));
        if (!Number.isInteger(characterIndex) || characterIndex < 0 || characterIndex >= SNOWCODE_CHARS.length) {
            return {};
        }
        json += SNOWCODE_CHARS[characterIndex];
    }
    try {
        return JSON.parse('{' + json + '}') as ActivityEmbedData;
    } catch {
        return {};
    }
}

function decodeActivityData(encodedData: string): ActivityEmbedData {
    if (encodedData.startsWith('99')) return decodeActivitySource(encodedData);
    if (/^\d+$/.test(encodedData)) return decodeSnowcode(encodedData);
    try {
        let base64 = encodedData.replace(/-/g, '+').replace(/_/g, '/');
        while (base64.length % 4) base64 += '=';
        return JSON.parse(decodeURIComponent(atob(base64))) as ActivityEmbedData;
    } catch (error) {
        console.error('Failed to decode activity data:', error);
        return {};
    }
}

function isFixEmbedPlaceholder(value?: string): boolean {
    return /^@?fixembed(?:\s+service)?$/i.test(value?.trim() || '');
}

app.get('/oembed', (c) => {
    const originalUrl = c.req.query('url');
    const stats = c.req.query('stats');
    const author = c.req.query('author');
    const provider = c.req.query('provider'); // Platform-specific branded name
    const title = c.req.query('title');
    const desc = c.req.query('desc');
    const format = c.req.query('format') || 'json';

    // Discord handles 'rich' type well for custom metadata
    // 'author_name' is used by Discord for the engagement stats row
    // Only include it if we have actual stats or author info to show
    const oembedResponse: any = {
        version: '1.0',
        type: 'rich',
        provider_name: provider || 'FixEmbed',  // Use branded name if available
        provider_url: 'https://fixembed.app',
        title: title || 'Post',
    };

    if (desc) {
        oembedResponse.description = desc;
    }

    // Only add author_name if we have stats (preferred) or author
    // This prevents "FixEmbed" from showing twice
    if (stats) {
        oembedResponse.author_name = stats;
        oembedResponse.author_url = originalUrl || 'https://fixembed.app';
    } else if (author) {
        oembedResponse.author_name = author;
        oembedResponse.author_url = originalUrl || 'https://fixembed.app';
    }

    // Do NOT set thumbnail_url, thumbnail_width, or thumbnail_height
    // Setting these forces Discord to use the "Rich Embed" (thumbnail on right) layout
    // By omitting them, Discord will use the oEmbed metadata (author/provider) 
    // BUT rely on twitter:card/og:image for the visual (Large Image)


    if (format === 'xml') {
        let authorXml = '';
        if (stats || author) {
            authorXml = `
    <author_name>${stats || author}</author_name>
    <author_url>${originalUrl || 'https://fixembed.app'}</author_url>`;
        }
        const xml = `<?xml version="1.0" encoding="utf-8"?>
<oembed>
    <version>1.0</version>
    <type>rich</type>
    <provider_name>${provider || 'FixEmbed'}</provider_name>
    <provider_url>https://fixembed.app</provider_url>${authorXml}
    <title>Post</title>
</oembed>`;
        return c.text(xml, 200, { 'Content-Type': 'text/xml' });
    }

    return c.json(oembedResponse);
});

app.get('/owoembed', (c) => {
    const query = c.req.raw.url.split('?')[1] || '';
    return c.redirect(`/oembed?${query}`, 301);
});

app.get('/activity/:encodedData', (c) => {
    const encodedData = c.req.param('encodedData');
    const accept = c.req.header('Accept') || '';

    // Decode the embed data from URL-safe base64
    const embedData = decodeActivityData(encodedData);

    // Only respond with ActivityPub JSON if client requests it
    if (accept.includes('application/activity+json') || accept.includes('application/ld+json')) {
        const authorName = embedData.a || 'FixEmbed';

        // Build attachment
        const attachment: any[] = [];
        if (embedData.v) {
            // Include video as ActivityPub attachment - this is how FxEmbed does it
            // Discord will use this for playback AND we get the footer/branding
            attachment.push({
                'type': 'Document',
                'mediaType': 'video/mp4',
                'url': embedData.v,
                'name': embedData.t || 'Video'
            });
        }
        const imageUrls = embedData.is?.length ? embedData.is : embedData.i ? [embedData.i] : [];
        imageUrls.forEach((imageUrl, index) => {
            attachment.push({
                'type': 'Document',
                'mediaType': 'image/jpeg',
                'url': imageUrl,
                'name': `${embedData.t || 'Image'}${imageUrls.length > 1 ? ` ${index + 1}` : ''}`
            });
        });

        const activityPubResponse = {
            '@context': [
                'https://www.w3.org/ns/activitystreams',
                {
                    'sensitive': 'as:sensitive',
                    'toot': 'http://joinmastodon.org/ns#',
                    'Emoji': 'toot:Emoji'
                }
            ],
            'id': `https://fixembed.app/activity/${encodedData}`,
            'type': 'Note',
            'summary': embedData.p === 'twitter' ? null : embedData.s || null,
            'content': formatActivityContent(embedData.d || '', embedData.p === 'twitter' ? embedData.s : undefined),
            'attributedTo': `https://fixembed.app/activity/${encodedData}/actor`,
            'published': embedData.ts || new Date().toISOString(),
            'url': embedData.u || 'https://fixembed.app',
            ...(attachment.length > 0 ? { 'attachment': attachment } : {}),
        };

        return c.json(activityPubResponse, 200, {
            'Content-Type': 'application/activity+json; charset=utf-8',
        });
    }

    // For regular browser requests, redirect to the original URL
    if (embedData.u) {
        return c.redirect(embedData.u, 302);
    }
    return c.redirect('https://fixembed.app/', 302);
});

app.get('/activity/:encodedData/actor', (c) => {
    const encodedData = c.req.param('encodedData');

    // Decode data
    const embedData = decodeActivityData(encodedData);

    const authorName = embedData.a || 'FixEmbed';
    const authorHandle = embedData.h || 'fixembed';
    const authorIcon = embedData.ic || FIXEMBED_LOGO;

    const actor = {
        '@context': [
            'https://www.w3.org/ns/activitystreams',
            {
                'manuallyApprovesFollowers': 'as:manuallyApprovesFollowers',
                'toot': 'http://joinmastodon.org/ns#',
                'featured': {
                    '@id': 'toot:featured',
                    '@type': '@id'
                }
            }
        ],
        'id': `https://fixembed.app/activity/${encodedData}/actor`,
        'type': 'Person',
        'name': authorName,
        'preferredUsername': authorHandle.replace('@', ''),
        'summary': 'FixEmbed Service',
        'url': embedData.au || `https://fixembed.app/users/${encodeURIComponent(authorName)}`,
        'icon': {
            'type': 'Image',
            'mediaType': 'image/jpeg',
            'url': authorIcon
        }
    };

    return c.json(actor, 200, {
        'Content-Type': 'application/activity+json; charset=utf-8',
    });
});

const mastodonStatusRequest = async (c: Context<{ Bindings: Env }>) => {
    const params = c.req.param();
    const author = params.author || 'fixembed';
    const status = params.status;

    let embedData = decodeActivityData(status);
    if (Object.keys(embedData).length === 0) {
        return c.json({ error: 'Invalid activity status token' }, 400);
    }
    if ((embedData.src || embedData.i) && !embedData.u) {
        let sourceUrl = embedData.src
            || 'https://x.com/' + encodeURIComponent(author) + '/status/' + embedData.i;
        let translationLanguage = normalizeLanguage(embedData.l);
        if (embedData.src) {
            try {
                const parsedSource = new URL(sourceUrl);
                const requestedLanguage = normalizeLanguage(
                    parsedSource.searchParams.get('fixembed_lang'),
                );
                if (requestedLanguage) {
                    translationLanguage = requestedLanguage;
                }
                parsedSource.searchParams.delete('fixembed_lang');
                sourceUrl = parsedSource.toString();
            } catch {
                return c.json({ error: 'Invalid activity source URL' }, 400);
            }
        }
        const request = prepareEmbedRequest(sourceUrl, translationLanguage);
        const result = await request?.fetch(c.env);
        if (!result?.success || !result.data) {
            return c.json({ error: result?.error || 'Unable to rebuild activity status' }, 502);
        }

        const source = result.data;
        const sectionText = (source.sections || [])
            .map((section) => '**' + section.title + '**\n' + section.body + (section.url ? '\n' + section.url : ''))
            .join('\n\n');
        const description = [activityBodyText(source), sectionText].filter(Boolean).join('\n\n').slice(0, 4000);
        const parsedTimestamp = source.timestamp ? new Date(source.timestamp) : null;
        const creatorName = source.authorName && !isFixEmbedPlaceholder(source.authorName)
            ? source.authorName
            : source.siteName;
        const creatorHandle = source.authorHandle && !isFixEmbedPlaceholder(source.authorHandle)
            ? source.authorHandle
            : source.platform;
        embedData = {
            d: description,
            i: source.image,
            is: source.images,
            v: source.video?.url,
            vt: source.video?.thumbnail,
            vw: source.video?.width,
            vh: source.video?.height,
            mt: source.video?.mediaType,
            p: source.platform,
            a: creatorName,
            h: creatorHandle,
            ic: source.authorAvatar || FIXEMBED_LOGO,
            s: source.stats,
            u: source.url,
            m: source.mode,
            ts: parsedTimestamp && !Number.isNaN(parsedTimestamp.getTime()) ? parsedTimestamp.toISOString() : undefined,
            au: source.authorUrl || source.url,
            sn: source.siteName,
            tn: source.translation?.sourceLanguageName,
            tu: source.translation?.originalUrl,
        };
    }
    const handle = (embedData.h || `@${author}`).replace(/^@/, '');
    const isInstagram = embedData.p === 'instagram';
    const instagramProfileUrl = embedData.au || `https://www.instagram.com/${encodeURIComponent(handle)}/`;
    const createdAt = embedData.ts || new Date().toISOString();
    const translationSourceName = /^[A-Za-z][A-Za-z ]{0,49}$/.test(embedData.tn || '')
        ? embedData.tn
        : undefined;
    let translationOriginalUrl: string | undefined;
    if (translationSourceName && embedData.tu) {
        try {
            const parsedOriginalUrl = new URL(embedData.tu);
            if (parsedOriginalUrl.protocol === 'https:') {
                translationOriginalUrl = parsedOriginalUrl.toString();
            }
        } catch {
            translationOriginalUrl = undefined;
        }
    }
    const mediaAttachments: MastodonMediaAttachment[] = [];

    if (embedData.v) {
        const width = embedData.vw || 0;
        const height = embedData.vh || 0;
        mediaAttachments.push({
            id: '1',
            type: embedData.mt === 'gif' ? 'image' : 'video',
            url: embedData.v,
            preview_url: embedData.vt || embedData.i || null,
            remote_url: null,
            preview_remote_url: null,
            text_url: null,
            description: null,
            meta: {
                original: {
                    width,
                    height,
                    size: `${width}x${height}`,
                    aspect: height ? width / height : 0,
                },
            },
        });
    }

    const imageUrls = embedData.is?.length ? embedData.is : embedData.i ? [embedData.i] : [];
    if (!embedData.v) {
        imageUrls.forEach((url, index) => {
            mediaAttachments.push({
                id: String(index + 1),
                type: 'image',
                url,
                preview_url: null,
                remote_url: null,
                preview_remote_url: null,
                text_url: null,
                description: null,
                meta: { original: { width: 0, height: 0 } },
            });
        });
    }

    const activityStatus = {
        id: status,
        url: embedData.u || `https://x.com/${handle}`,
        uri: embedData.u || `https://x.com/${handle}`,
        created_at: createdAt,
        edited_at: null,
        reblog: null,
        in_reply_to_id: null,
        in_reply_to_account_id: null,
        language: null,
        content: formatActivityContent(
            embedData.d || '',
            embedData.s,
            embedData.p !== 'twitter' && embedData.p !== 'instagram',
        ),
        spoiler_text: '',
        visibility: 'public',
        application: {
            name: translationSourceName
                ? `Translated from ${translationSourceName}`
                : embedData.sn || 'FixEmbed',
            website: translationOriginalUrl || 'https://fixembed.app',
        },
        media_attachments: mediaAttachments,
        account: {
            id: handle,
            display_name: isInstagram ? handle : (embedData.a || handle),
            ...(isInstagram ? {
                username: handle,
                acct: handle,
                url: instagramProfileUrl,
                uri: instagramProfileUrl,
            } : {
                username: handle,
                acct: handle,
                url: embedData.au || embedData.u || `https://x.com/${handle}`,
                uri: embedData.au || embedData.u || `https://x.com/${handle}`,
            }),
            created_at: createdAt,
            locked: false,
            bot: false,
            discoverable: true,
            indexable: false,
            group: false,
            avatar: embedData.ic || FIXEMBED_LOGO,
            avatar_static: embedData.ic || FIXEMBED_LOGO,
            header: '',
            header_static: '',
            followers_count: 0,
            following_count: 0,
            statuses_count: 0,
            hide_collections: false,
            noindex: false,
            emojis: [],
            roles: [],
            fields: [],
        },
        mentions: [],
        tags: [],
        emojis: [],
        card: null,
        poll: null,
    };

    return c.json(activityStatus);
};

app.get('/users/:author/statuses/:status', mastodonStatusRequest);

app.get('/api/v1/statuses/:status', mastodonStatusRequest);

app.get('/users/:author', (c) => {
    const author = c.req.param('author');
    const accept = c.req.header('Accept') || '';

    if (accept.includes('application/activity+json') || accept.includes('application/ld+json')) {
        const actorResponse = {
            '@context': [
                'https://www.w3.org/ns/activitystreams',
                'https://w3id.org/security/v1'
            ],
            'id': `https://fixembed.app/users/${author}`,
            'type': 'Person',
            'preferredUsername': author,
            'name': 'FixEmbed',
            'summary': 'Better embeds for social media links',
            'url': 'https://fixembed.app',
            'icon': {
                'type': 'Image',
                'mediaType': 'image/png',
                'url': 'https://raw.githubusercontent.com/kenhendricks00/FixEmbed/main/assets/logo.png'
            },
            'image': {
                'type': 'Image',
                'mediaType': 'image/png',
                'url': 'https://raw.githubusercontent.com/kenhendricks00/FixEmbed/main/assets/logo.png'
            },
        };

        return c.json(actorResponse, 200, {
            'Content-Type': 'application/activity+json; charset=utf-8',
        });
    }

    return c.redirect('https://fixembed.app/', 302);
});

export default app;
