/**
 * FixEmbed Service - Embed HTML Generator
 */

import type { EmbedData } from '../types.ts';

/**
 * FixEmbed logo URL for branding in embeds
 */
export const FIXEMBED_LOGO = 'https://raw.githubusercontent.com/kenhendricks00/FixEmbed/main/assets/logo.png';

function escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

const SNOWCODE_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789{}[]":,.-_';
const INSTAGRAM_ACTIVITY_REVISION = '2';

/** Encode compact activity metadata as digits so Discord recognizes a Mastodon-style status URL. */
export function encodeSnowcode(data: object): string {
    const json = JSON.stringify(data).slice(1, -1);
    return [...json].map((character) => {
        const index = SNOWCODE_CHARS.indexOf(character);
        if (index < 0) throw new Error('Character not supported in activity status: ' + character);
        return index.toString().padStart(2, '0');
    }).join('');
}

/** Encode any canonical source URL as a compact digits-only status identifier. */
export function encodeActivitySource(url: string): string {
    return '99' + [...new TextEncoder().encode(url)]
        .map((byte) => byte.toString().padStart(3, '0'))
        .join('');
}

/** Preserve source line breaks in the safe HTML consumed by Discord's ActivityPub renderer. */
export function formatActivityContent(
    description: string,
    stats?: string,
    statsFirst = false,
): string {
    const normalized = description.replace(/\r\n?/g, '\n');
    const content = escapeHtml(normalized).replace(/\n/g, '<br>');
    const statsMarkup = stats ? '<strong>' + escapeHtml(stats) + '</strong>' : '';
    if (statsFirst && statsMarkup) return '<p>' + statsMarkup + '<br><br>' + content + '</p>';
    return '<p>' + content + (statsMarkup ? '<br><br>' + statsMarkup : '') + '</p>';
}

const GENERIC_POST_TITLES = new Set(['post', 'reel', 'thread', 'tweet']);

function comparableIdentity(value?: string): string {
    return (value || '')
        .toLowerCase()
        .replace(/^@/, '')
        .replace(/\s*\(@[^)]+\)\s*$/, '')
        .trim();
}

/**
 * Keep every platform on the same Discord card hierarchy: creator, content,
 * optional supporting description, engagement stats, then media.
 */
export function normalizeEmbedLayout(embed: EmbedData): EmbedData {
    const title = embed.title.trim();
    const description = embed.description.trim();

    // X reads best in its familiar tweet-card form: handle as the linked title
    // and the full tweet as body copy. Keep this intentional platform exception.
    if (embed.platform === 'twitter') {
        return {
            ...embed,
            title,
            description: description === title ? '' : description,
        };
    }

    const titleIdentity = comparableIdentity(title);
    const repeatsCreator = Boolean(titleIdentity) && [
        comparableIdentity(embed.authorName),
        comparableIdentity(embed.authorHandle),
    ].some((identity) => identity === titleIdentity);
    const genericTitle = GENERIC_POST_TITLES.has(title.toLowerCase());

    if (description && (repeatsCreator || genericTitle)) {
        return {
            ...embed,
            title: description.length > 100 ? `${description.slice(0, 97).trimEnd()}...` : description,
            description: '',
        };
    }

    return {
        ...embed,
        title,
        description: description === title ? '' : description,
    };
}

/** Build the post body shown beneath the creator identity in Discord's activity card. */
export function activityBodyText(embed: EmbedData): string {
    const normalized = normalizeEmbedLayout(embed);
    if (normalized.platform === 'twitter') return normalized.description || normalized.title;

    const title = normalized.title.trim();
    const description = normalized.description.trim();
    if (!description || title.toLowerCase().includes(description.toLowerCase())) return title;
    if (normalized.authorName && description.toLowerCase() === ('by ' + normalized.authorName).toLowerCase()) {
        return title;
    }
    return [title, description].filter(Boolean).join('\n\n');
}

function activityActorSlug(embed: EmbedData): string {
    const identity = embed.authorHandle || embed.authorName || embed.platform;
    return identity
        .replace(/^@/, '')
        .replace(/^u\//i, '')
        .replace(/[^a-zA-Z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '')
        || embed.platform;
}

/**
 * Generate Open Graph meta tags for Discord/Telegram embeds
 */
export function generateEmbedHTML(embed: EmbedData, userAgent: string): string {
    embed = normalizeEmbedLayout(embed);
    const isDiscord = userAgent.toLowerCase().includes('discord');
    const isTelegram = userAgent.toLowerCase().includes('telegram');
    // Discord drops Instagram Activity videos that do not include a poster.
    // Use the polished Activity card when media has a preview, and retain the
    // native Open Graph path as a safe fallback for posterless reels.
    const hasInstagramActivityMedia = embed.video
        ? Boolean(embed.video.thumbnail || embed.image)
        : Boolean(embed.images?.length || embed.image);
    const supportsDiscordActivityCard = embed.platform !== 'instagram' || hasInstagramActivityMedia;
    const useDiscordActivityCard = isDiscord && embed.platform !== 'twitter' && supportsDiscordActivityCard;
    const useDiscordActivityVideo = isDiscord && embed.platform === 'twitter' && Boolean(embed.video);
    const suppressDiscordOgMedia = useDiscordActivityCard || useDiscordActivityVideo;
    const displayTitle = embed.platform === 'twitter' && embed.authorName && embed.authorHandle
        ? `${embed.authorName} (${embed.authorHandle})`
        : embed.title;

    // Escape HTML entities
    const escape = escapeHtml;

    const sectionText = (embed.sections || [])
        .map((section) => `**${section.title}**\n${section.body}${section.url ? `\n${section.url}` : ''}`)
        .join('\n\n');
    const renderedDescription = [embed.description, sectionText].filter(Boolean).join('\n\n').slice(0, 4000);

    let html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta property="og:title" content="${escape(displayTitle)}">
  <meta property="og:description" content="${escape(renderedDescription)}">
  <meta property="og:url" content="${escape(embed.url)}">
  <meta property="og:site_name" content="${escape(embed.siteName)}">
  <meta property="og:type" content="${embed.video && !suppressDiscordOgMedia ? 'video.other' : 'website'}">
`;

    // Color theme
    if (embed.color) {
        html += `  <meta name="theme-color" content="${embed.color}">\n`;
    }

    // Author info
    if (embed.authorName) {
        html += `  <meta property="og:article:author" content="${escape(embed.authorName)}">\n`;
    }

    // Image embed - support single image or carousel
    if (!suppressDiscordOgMedia && embed.images && embed.images.length > 0) {
        // Multiple images (carousel) - output all og:image tags
        for (const imgUrl of embed.images) {
            html += `  <meta property="og:image" content="${escape(imgUrl)}">\n`;
        }
        // Only set card to summary_large_image if NOT a video
        if (!embed.video) {
            html += `  <meta name="twitter:card" content="summary_large_image">\n`;
        }
        html += `  <meta name="twitter:image" content="${escape(embed.images[0])}">\n`;
    } else if (!suppressDiscordOgMedia && embed.image) {
        html += `  <meta property="og:image" content="${escape(embed.image)}">\n`;
        // Only set card to summary_large_image if NOT a video
        if (!embed.video) {
            html += `  <meta name="twitter:card" content="summary_large_image">\n`;
        }
        html += `  <meta name="twitter:image" content="${escape(embed.image)}">\n`;
    }

    // Video embed
    if (embed.video) {
        if (suppressDiscordOgMedia) {
            // Avoid a competing Open Graph card so Discord uses the author-first
            // ActivityPub note and its playable video attachment.
            html += `  <meta name="twitter:card" content="player">\n`;
        } else {
            html += `  <meta property="og:video" content="${escape(embed.video.url)}">\n`;
            html += `  <meta property="og:video:url" content="${escape(embed.video.url)}">\n`;
            html += `  <meta property="og:video:secure_url" content="${escape(embed.video.url)}">\n`;
            html += `  <meta property="og:video:type" content="video/mp4">\n`;

            if (embed.video.thumbnail) {
                html += `  <meta property="og:image" content="${escape(embed.video.thumbnail)}">\n`;
            }

            html += `  <meta name="twitter:card" content="summary_large_image">\n`;
            if (embed.video.thumbnail) {
                html += `  <meta name="twitter:image" content="${escape(embed.video.thumbnail)}">\n`;
            }
        }
    } else {
        html += `  <meta name="twitter:card" content="summary_large_image">\n`;
    }

    // Twitter-specific tags
    html += `  <meta name="twitter:title" content="${escape(displayTitle)}">\n`;
    html += `  <meta name="twitter:description" content="${escape(renderedDescription)}">\n`;

    // FixEmbed branding - multiple approaches for Discord enhanced embeds
    // 1. Single high-quality icon for branding
    html += `  <link href="${FIXEMBED_LOGO}" rel="icon" type="image/png">\n`;

    // 2. Apple touch icon for mobile
    html += `  <link rel="apple-touch-icon" href="${escape(embed.authorAvatar || FIXEMBED_LOGO)}">\n`;

    // 3. oEmbed link for Discord to fetch provider and engagement info
    // Note: Previously excluded Instagram to force large images, but testing if it still works with oEmbed
    const oembedUrl = new URL('https://fixembed.app/oembed');
    oembedUrl.searchParams.set('url', embed.url);
    if (embed.siteName) oembedUrl.searchParams.set('provider', embed.siteName);
    if (embed.stats) oembedUrl.searchParams.set('stats', embed.stats);
    if (embed.authorName) oembedUrl.searchParams.set('author', embed.authorName);
    if (embed.title) oembedUrl.searchParams.set('title', embed.title);
    if (embed.description) oembedUrl.searchParams.set('desc', embed.description.slice(0, 1000)); // Limit length for URL
    html += `  <link rel="alternate" type="application/json+oembed" href="${escape(oembedUrl.toString())}">\n`;

    if (supportsDiscordActivityCard) {
        const twitterStatusId = embed.url.match(/\/status\/(\d+)/)?.[1];
        const activitySourceUrl = embed.platform === 'instagram'
            ? `${embed.url}${embed.url.includes('?') ? '&' : '?'}fixembed_activity=${INSTAGRAM_ACTIVITY_REVISION}`
            : embed.url;
        const encodedActivity = embed.platform === 'twitter' && twitterStatusId
            ? encodeSnowcode({ i: twitterStatusId })
            : encodeActivitySource(activitySourceUrl);
        const activityUrl = `https://fixembed.app/users/${encodeURIComponent(activityActorSlug(embed))}/statuses/${encodedActivity}`;
        html += "  <link href='" + activityUrl + "' rel='alternate' type='application/activity+json'>\n";
    }


    // Close head and add redirect body
    html += `</head>
<body>
  <p>Redirecting to <a href="${escape(embed.url)}">${escape(embed.url)}</a></p>
  <script>window.location.href = "${escape(embed.url)}";</script>
</body>
</html>`;

    return html;
}

/**
 * Generate a simple error page
 */
export function generateErrorHTML(message: string, url: string): string {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta property="og:title" content="FixEmbed Error">
  <meta property="og:description" content="${message}">
  <meta name="theme-color" content="#ff0000">
</head>
<body>
  <h1>Error</h1>
  <p>${message}</p>
  <p><a href="${url}">Go to original URL</a></p>
</body>
</html>`;
}

/**
 * Platform-specific colors
 */
export const platformColors: Record<string, string> = {
    twitter: '#1DA1F2',
    instagram: '#E4405F',
    reddit: '#FF4500',
    threads: '#000000',
    pixiv: '#0096FA',
    bluesky: '#1185FE',
    bilibili: '#00A1D6',
};

/**
 * Platform display names for branding
 */
export const platformNames: Record<string, string> = {
    twitter: '𝕏 Twitter',
    instagram: '📷 Instagram',
    reddit: '🔗 Reddit',
    threads: '🧵 Threads',
    pixiv: '🎨 Pixiv',
    bluesky: '🦋 Bluesky',
    bilibili: '📺 Bilibili',
    youtube: '▶️ YouTube',
};

/**
 * Generate branded site name for consistent FixEmbed branding
 * Format: "FixEmbed • Platform" or "FixEmbed • Platform • Duration"
 */
export function getBrandedSiteName(platform: string, extra?: string): string {
    const platformDisplay = platformNames[platform] || platform;
    if (extra) {
        return `FixEmbed • ${platformDisplay} • ${extra}`;
    }
    return `FixEmbed • ${platformDisplay}`;
}

/**
 * Format large numbers consistently (e.g., 1.2K, 3.5M)
 */
export function formatNumber(num: number): string {
    if (num >= 1_000_000) {
        return (num / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
    } else if (num >= 1_000) {
        return (num / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
    }
    return num.toLocaleString();
}

/**
 * Format stats line with emojis for consistent display
 */
export function formatStats(stats: {
    likes?: number;
    comments?: number;
    retweets?: number;
    views?: number;
    shares?: number;
}): string {
    const parts: string[] = [];

    // Only show stats that are defined AND greater than 0
    if (stats.comments !== undefined && stats.comments > 0) {
        parts.push(`💬 ${formatNumber(stats.comments)}`);
    }
    if (stats.retweets !== undefined && stats.retweets > 0) {
        parts.push(`🔁 ${formatNumber(stats.retweets)}`);
    }
    if (stats.likes !== undefined && stats.likes > 0) {
        parts.push(`❤️ ${formatNumber(stats.likes)}`);
    }
    if (stats.views !== undefined && stats.views > 0) {
        parts.push(`👁 ${formatNumber(stats.views)}`);
    }
    if (stats.shares !== undefined && stats.shares > 0) {
        parts.push(`↗️ ${formatNumber(stats.shares)}`);
    }

    return parts.join(' ');
}

/**
 * Format duration (seconds to MM:SS or HH:MM:SS)
 */
export function formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
}
