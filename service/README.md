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

> **Note**: YouTube & TikTok are not supported as Discord has excellent native embedding for these platforms.

## Features

- **Rich Embeds**: Consistent `FixEmbed • [emoji] Platform` branding across all platforms
- **Video Playback**: Native video support for Twitter, Instagram Reels, Threads, Reddit, and Bilibili
- **Carousel Images**: Multi-image posts display as grids (Instagram, Threads)
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
│   │   ├── instagram.ts      # VxInstagram + Snapsave fallback
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
- Instagram fallback via [Snapsave](https://snapsave.app)
- Pixiv data via [Phixiv](https://github.com/thelaao/phixiv)
- Bilibili data via [VxBilibili](https://github.com/niconi21/vxBilibili)
- Built with [Hono](https://hono.dev/) framework
- Deployed on [Cloudflare Workers](https://workers.cloudflare.com/)

## License

MIT - See [LICENSE](../LICENSE) for details.
