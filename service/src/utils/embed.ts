/**
 * FixEmbed Service - Embed HTML Generator
 */

import { EmbedData } from '../types';

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
  ${embed.description ? `<meta property="og:description" content="${escape(embed.description)}">` : ''}
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

    // Image embed
    if (embed.image) {
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
    if (embed.description) {
        html += `  <meta name="twitter:description" content="${escape(embed.description)}">\n`;
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
    youtube: '#FF0000',
    bilibili: '#00A1D6',
};
