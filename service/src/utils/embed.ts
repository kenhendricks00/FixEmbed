/**
 * FixEmbed Service - Embed HTML Generator
 */

import { EmbedData } from '../types';

/**
 * FixEmbed logo URL for branding in embeds
 */
export const FIXEMBED_LOGO = 'https://raw.githubusercontent.com/kenhendricks00/FixEmbed/main/assets/logo.png';

/**
 * Generate Open Graph meta tags for Discord/Telegram embeds
 */
export function generateEmbedHTML(embed: EmbedData, userAgent: string): string {
    const isDiscord = userAgent.toLowerCase().includes('discord');
    const isTelegram = userAgent.toLowerCase().includes('telegram');

    // Escape HTML entities
    const escape = (str: string) =>
        str.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');

    let html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta property="og:title" content="${escape(embed.title)}">
  <meta property="og:description" content="${escape(embed.description)}">
  <meta property="og:url" content="${escape(embed.url)}">
  <meta property="og:site_name" content="${escape(embed.siteName)}">
  <meta property="og:type" content="${embed.video ? 'video.other' : 'article'}">
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
    if (embed.images && embed.images.length > 0) {
        // Multiple images (carousel) - output all og:image tags
        for (const imgUrl of embed.images) {
            html += `  <meta property="og:image" content="${escape(imgUrl)}">\n`;
        }
        html += `  <meta name="twitter:card" content="summary_large_image">\n`;
        html += `  <meta name="twitter:image" content="${escape(embed.images[0])}">\n`;
    } else if (embed.image) {
        html += `  <meta property="og:image" content="${escape(embed.image)}">\n`;
        html += `  <meta name="twitter:card" content="summary_large_image">\n`;
        html += `  <meta name="twitter:image" content="${escape(embed.image)}">\n`;
    }

    // Video embed
    if (embed.video) {
        html += `  <meta property="og:video" content="${escape(embed.video.url)}">\n`;
        html += `  <meta property="og:video:url" content="${escape(embed.video.url)}">\n`;
        html += `  <meta property="og:video:secure_url" content="${escape(embed.video.url)}">\n`;
        html += `  <meta property="og:video:type" content="video/mp4">\n`;

        // Only include dimensions if they're set (non-zero)
        if (embed.video.width && embed.video.height) {
            html += `  <meta property="og:video:width" content="${embed.video.width}">\n`;
            html += `  <meta property="og:video:height" content="${embed.video.height}">\n`;
        }

        if (embed.video.thumbnail) {
            html += `  <meta property="og:image" content="${escape(embed.video.thumbnail)}">\n`;
        }

        // Use summary_large_image for video files to get large preview
        // 'player' card is for iframes, which we are not using for direct MP4s
        html += `  <meta name="twitter:card" content="summary_large_image">\n`;

        // Remove twitter:player as it's meant for iframes
        // Discord will use og:video for the actual playback
    }

    // Twitter-specific tags
    html += `  <meta name="twitter:title" content="${escape(embed.title)}">\n`;
    html += `  <meta name="twitter:description" content="${escape(embed.description)}">\n`;

    // FixEmbed branding - multiple approaches for Discord enhanced embeds
    // 1. Multiple icon sizes (like FxEmbed)
    const iconSizes = ['16', '24', '32', '48', '64'];
    for (const size of iconSizes) {
        html += `  <link href="${FIXEMBED_LOGO}" rel="icon" sizes="${size}x${size}" type="image/png">\n`;
    }

    // 2. Apple touch icon for mobile
    html += `  <link rel="apple-touch-icon" href="${FIXEMBED_LOGO}">\n`;

    // 3. oEmbed link for Discord to fetch provider info
    html += `  <link rel="alternate" type="application/json+oembed" href="https://embed.ken.tools/oembed?url=${encodeURIComponent(embed.url)}&amp;format=json">\n`;

    // 4. ActivityPub-style link for Discord's enhanced footer format
    // Encode essential embed data so the ActivityPub endpoint can return proper content
    const activityData = {
        t: embed.title.substring(0, 100),       // title (truncated)
        d: embed.description.substring(0, 200), // description (truncated)
        i: embed.image || embed.video?.thumbnail || '', // image
        a: embed.authorName || '',              // author
        u: embed.url,                           // original URL
    };
    const encodedData = btoa(JSON.stringify(activityData)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    html += `  <link href="https://embed.ken.tools/activity/${encodedData}" rel="alternate" type="application/activity+json">\n`;

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
    twitter: '𝕏',
    instagram: '📷 Instagram',
    reddit: '🔗 Reddit',
    threads: '🧵 Threads',
    pixiv: '🎨 Pixiv',
    bluesky: '🦋 Bluesky',
    bilibili: '📺 Bilibili',
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

    if (stats.comments !== undefined) {
        parts.push(`💬 ${formatNumber(stats.comments)}`);
    }
    if (stats.retweets !== undefined) {
        parts.push(`🔁 ${formatNumber(stats.retweets)}`);
    }
    if (stats.likes !== undefined) {
        parts.push(`❤️ ${formatNumber(stats.likes)}`);
    }
    if (stats.views !== undefined) {
        parts.push(`👁 ${formatNumber(stats.views)}`);
    }
    if (stats.shares !== undefined) {
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
