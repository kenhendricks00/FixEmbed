/**
 * FixEmbed Service - Embed HTML Generator
 */

import type { EmbedData } from '../types.ts';

/**
 * FixEmbed logo URL for branding in embeds
 */
export const FIXEMBED_LOGO = 'https://raw.githubusercontent.com/kenhendricks00/FixEmbed/main/assets/logo.png';

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function truncateMeta(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
        return value;
    }

    return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function buildActivityData(embed: EmbedData): string {
    const payload = {
        t: truncateMeta(embed.title, 300),
        d: truncateMeta(embed.description, 1000),
        i: embed.images?.[0] || embed.image,
        v: embed.video?.url,
        p: embed.siteName,
        a: embed.authorName,
        h: embed.authorHandle,
        ic: embed.authorAvatar || FIXEMBED_LOGO,
        s: embed.stats,
        u: embed.url,
        fo: embed.footerOnlyActivity ? 1 : 0,
    };

    const json = JSON.stringify(payload);
    const encoded = btoa(unescape(encodeURIComponent(json)));
    return encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function shouldExposeActivityPub(embed: EmbedData): boolean {
    return embed.footerOnlyActivity || embed.platform === 'twitter' || embed.platform === 'bluesky' || embed.platform === 'threads';
}

/**
 * Generate Open Graph meta tags for Discord/Telegram embeds
 */
export function generateEmbedHTML(embed: EmbedData, userAgent: string): string {
    const isDiscord = userAgent.toLowerCase().includes('discord');
    const isTelegram = userAgent.toLowerCase().includes('telegram');
    const escape = escapeHtml;
    const metaTitle = truncateMeta(embed.title || embed.authorName || 'FixEmbed', 300);
    const metaDescription = truncateMeta(
        embed.description || embed.title || embed.authorName || embed.siteName,
        1000,
    );
    const activityUrl = `https://fixembed.app/activity/${buildActivityData(embed)}`;

    let html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${escape(metaDescription)}">
  <meta property="og:title" content="${escape(metaTitle)}">
  <meta property="og:description" content="${escape(metaDescription)}">
  <meta property="og:url" content="${escape(embed.url)}">
  <meta property="og:site_name" content="${escape(embed.siteName)}">
  <meta property="og:type" content="${embed.video ? 'video.other' : 'website'}">
`;

    if (embed.color) {
        html += `  <meta name="theme-color" content="${embed.color}">\n`;
    }

    if (embed.authorName) {
        html += `  <meta property="og:article:author" content="${escape(embed.authorName)}">\n`;
    }

    if (embed.images && embed.images.length > 0) {
        for (const imgUrl of embed.images) {
            html += `  <meta property="og:image" content="${escape(imgUrl)}">\n`;
        }
        html += `  <meta property="og:image:alt" content="${escape(metaTitle)}">\n`;
        if (!embed.video) {
            html += `  <meta name="twitter:card" content="summary_large_image">\n`;
        }
        html += `  <meta name="twitter:image" content="${escape(embed.images[0])}">\n`;
        html += `  <meta name="twitter:image:alt" content="${escape(metaTitle)}">\n`;
    } else if (embed.image) {
        html += `  <meta property="og:image" content="${escape(embed.image)}">\n`;
        html += `  <meta property="og:image:alt" content="${escape(metaTitle)}">\n`;
        if (!embed.video) {
            html += `  <meta name="twitter:card" content="summary_large_image">\n`;
        }
        html += `  <meta name="twitter:image" content="${escape(embed.image)}">\n`;
        html += `  <meta name="twitter:image:alt" content="${escape(metaTitle)}">\n`;
    }

    if (embed.video) {
        html += `  <meta property="og:video" content="${escape(embed.video.url)}">\n`;
        html += `  <meta property="og:video:url" content="${escape(embed.video.url)}">\n`;
        html += `  <meta property="og:video:secure_url" content="${escape(embed.video.url)}">\n`;
        html += `  <meta property="og:video:type" content="video/mp4">\n`;
        html += `  <meta property="og:video:width" content="${embed.video.width}">\n`;
        html += `  <meta property="og:video:height" content="${embed.video.height}">\n`;

        if (embed.video.thumbnail) {
            html += `  <meta property="og:image" content="${escape(embed.video.thumbnail)}">\n`;
            html += `  <meta property="og:image:alt" content="${escape(metaTitle)}">\n`;
            html += `  <meta name="twitter:image" content="${escape(embed.video.thumbnail)}">\n`;
            html += `  <meta name="twitter:image:alt" content="${escape(metaTitle)}">\n`;
        }

        html += `  <meta name="twitter:card" content="summary_large_image">\n`;
    } else {
        html += `  <meta name="twitter:card" content="summary_large_image">\n`;
    }

    html += `  <meta name="twitter:title" content="${escape(metaTitle)}">\n`;
    html += `  <meta name="twitter:description" content="${escape(metaDescription)}">\n`;
    html += `  <link href="${FIXEMBED_LOGO}" rel="icon" type="image/png">\n`;
    html += `  <link rel="apple-touch-icon" href="${FIXEMBED_LOGO}">\n`;

    const oembedUrl = new URL('https://fixembed.app/oembed');
    oembedUrl.searchParams.set('url', embed.url);
    if (embed.siteName) oembedUrl.searchParams.set('provider', embed.siteName);
    if (embed.stats) oembedUrl.searchParams.set('stats', embed.stats);
    if (embed.authorName) oembedUrl.searchParams.set('author', embed.authorName);
    if (embed.title) oembedUrl.searchParams.set('title', metaTitle);
    if (embed.description) oembedUrl.searchParams.set('desc', metaDescription);

    html += `  <link rel="alternate" type="application/json+oembed" href="${escape(oembedUrl.toString())}">\n`;
    if (shouldExposeActivityPub(embed)) {
        html += `  <link rel="alternate" type="application/activity+json" href="${escape(activityUrl)}">\n`;
    }

    if (isDiscord || isTelegram) {
        html += `  <meta name="referrer" content="no-referrer">\n`;
    }

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
    youtube: '#FF0000',
    bilibili: '#00A1D6',
};

/**
 * Platform display names for branding
 */
export const platformNames: Record<string, string> = {
    twitter: 'Twitter',
    instagram: 'Instagram',
    reddit: 'Reddit',
    threads: 'Threads',
    pixiv: 'Pixiv',
    bluesky: 'Bluesky',
    bilibili: 'Bilibili',
    youtube: 'YouTube',
};

/**
 * Generate branded site name for consistent FixEmbed branding
 * Format: "FixEmbed - Platform" or "FixEmbed - Platform - Duration"
 */
export function getBrandedSiteName(platform: string, extra?: string): string {
    const platformDisplay = platformNames[platform] || platform;
    if (extra) {
        return `FixEmbed - ${platformDisplay} - ${extra}`;
    }
    return `FixEmbed - ${platformDisplay}`;
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
 * Format stats line for compact, clean metadata rows
 */
export function formatStats(stats: {
    likes?: number;
    comments?: number;
    retweets?: number;
    views?: number;
    shares?: number;
}): string {
    const parts: string[] = [];

    if (stats.comments !== undefined && stats.comments > 0) {
        parts.push(`Replies ${formatNumber(stats.comments)}`);
    }
    if (stats.retweets !== undefined && stats.retweets > 0) {
        parts.push(`Reposts ${formatNumber(stats.retweets)}`);
    }
    if (stats.likes !== undefined && stats.likes > 0) {
        parts.push(`Likes ${formatNumber(stats.likes)}`);
    }
    if (stats.views !== undefined && stats.views > 0) {
        parts.push(`Views ${formatNumber(stats.views)}`);
    }
    if (stats.shares !== undefined && stats.shares > 0) {
        parts.push(`Shares ${formatNumber(stats.shares)}`);
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
