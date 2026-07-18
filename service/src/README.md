# FixEmbed Service

A unified embed service for Discord, Telegram, and other platforms. Built with Cloudflare Workers and Hono.

## Supported Platforms

| Platform | Emoji | Status | Method |
|----------|-------|--------|--------|
| Twitter/X | 𝕏 | ✅ | Syndication API |
| Instagram | 📷 | ✅ | VxInstagram + Snapsave |
| Threads | 🧵 | ✅ | GraphQL API |
| Bluesky | 🦋 | ✅ | AT Protocol |
| Reddit | 🔗 | ✅ | JSON API |
| Pixiv | 🎨 | ✅ | Phixiv HTML scraping |
| Bilibili | 📺 | ✅ | VxBilibili HTML scraping |

| YouTube Community Posts | Video | Supported | Official page metadata |
| Pinterest | Pin | Supported | Official Pin metadata |
| TikTok | Video | Supported | Official public oEmbed |
| Tumblr | Post | Supported | Public post metadata |
| Twitch | Stream | Supported | Public Twitch metadata |

## Features

- **Rich Embeds**: Consistent `FixEmbed • [emoji] Platform` branding across all platforms
- **Video Playback**: Native video support for Twitter, Instagram Reels, Threads, Reddit, and Bilibili
- **Mixed Media and Galleries**: Complete image/video collections retain source order when available
- **Sensitive Media**: Source-marked sensitive content is hidden behind Discord spoilers
- **Platform Context**: Creator identity, timestamps, engagement, games, communities, and other source-specific context are preserved when available
- **X Translation**: Explicit X language modifiers include original and translated text; other platforms preserve source-language text
- **Engagement Stats**: Metrics displayed via oEmbed (💬 comments, ❤️ likes, � reposts, 👁 views)
  - Zero values are automatically hidden for cleaner display
- **Author Attribution**: Consistent `@handle` display across all social platforms
- **Smart Proxying**: Video proxy endpoints for platforms requiring special handling
- **Discord Optimized**: Proper OG/Twitter Card tags for rich embeds with correct aspect ratios
- **Fast**: Global low-latency responses via Cloudflare Workers edge network

## Quick Start

### Installation
```bash
cd service
npm install
```

### Development
```bash
npm run dev
```
Starts a local server at http://localhost:8787

### Deployment
```bash
npm run deploy
```

## API Reference

### Embed Endpoint
```
GET /embed?url=<social-media-url>
```
Returns HTML with OG meta tags for Discord/Telegram bots.

### JSON API
```
GET /api/embed?url=<social-media-url>
```
Returns JSON with structured embed data.

Successful responses include `platform`, `source` (`first-party` or
`fallback`), and `data`. The source field supports operational conformance
checks without exposing provider internals.

### Platform Routes
Direct URL patterns for easy use:
```
GET /twitter/{user}/status/{id}
GET /instagram/p/{shortcode}
GET /instagram/reel/{shortcode}
GET /threads/@{username}/post/{shortcode}
GET /bluesky/profile/{handle}/post/{id}
GET /reddit/r/{subreddit}/comments/{id}
GET /pixiv/artworks/{id}
GET /bilibili/video/{bvid}
GET /youtube/post/{id}
GET /pinterest/pin/{id}
GET /tiktok/@{username}/video/{id}
GET /tumblr/{blog}/{id}
GET /twitch/{channel}
GET /twitch/videos/{id}
```

### Video Proxy
Streams video content with proper headers:
```
GET /video/instagram?url=<encoded-url>
GET /video/threads?url=<encoded-url>
GET /video/twitter?url=<encoded-url>
```

## Architecture

```
service/
├── src/
│   ├── index.ts              # Main router, endpoints, video proxies
│   ├── handlers/             # Platform-specific handlers
│   │   ├── twitter.ts        # Twitter/X Syndication API
│   │   ├── instagram.ts      # Instagram direct + external emergency fallbacks
│   │   ├── threads.ts        # Meta Threads GraphQL API
│   │   ├── bluesky.ts        # AT Protocol
│   │   ├── reddit.ts         # Reddit JSON API
│   │   ├── pixiv.ts          # Phixiv HTML scraping
│   │   └── bilibili.ts       # VxBilibili HTML scraping
│   ├── utils/
│   │   ├── embed.ts          # OG tag generation, stats formatting
│   │   └── fetch.ts          # HTTP utilities, URL parsing
│   └── types.ts              # TypeScript definitions
├── wrangler.toml             # Cloudflare Workers config
└── package.json
```

## Embed Format

All embeds follow a consistent format:

| Element | Content |
|---------|---------|
| Site Name | `FixEmbed • 📷 Instagram` |
| Author | `@username` |
| Title | Post/Tweet content |
| Stats | `💬 123 ❤️ 4.5K` (via oEmbed) |
| Media | Image or video player |

## Credits

- Instagram carousel images via [VxInstagram](https://github.com/Lainmode/InstagramEmbed-vxinstagram)
- Direct source-platform requests are primary for every handler; external embed services are emergency fallbacks only.
- Pixiv data via [Phixiv](https://github.com/thelaao/phixiv)
- Bilibili data via [VxBilibili](https://github.com/niconi21/vxBilibili)
- Built with [Hono](https://hono.dev/) framework
- Deployed on [Cloudflare Workers](https://workers.cloudflare.com/)

## License

Copyright (c) 2024-2026 Kenneth Hendricks. Licensed under the [GNU Affero General Public License v3.0 or later](../../LICENSE).

Modified network deployments must offer their users the corresponding source code under the same license.
