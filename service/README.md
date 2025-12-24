# FixEmbed Service

A unified embed service for Discord, built with Cloudflare Workers and Hono.

## Supported Platforms

| Platform | Status | Method |
|----------|--------|--------|
| Twitter/X | ✅ | Syndication API |
| Reddit | ✅ | JSON API |
| Bluesky | ✅ | AT Protocol |
| Instagram | ✅ | Snapsave API + Video Proxy |
| Threads | ✅ | GraphQL API + Carousel Support |
| Pixiv | ✅ | Phixiv HTML scraping |
| Bilibili | ✅ | Public API |

> **Note**: YouTube is not supported as Discord and other platforms have excellent native YouTube embedding.

## Features

- **Video Embedding**: Native video playback for Twitter, Reddit, Instagram Reels, Threads, and more
- **Carousel Images**: Multi-image posts display as grids (Threads, Instagram)
- **Consistent Stats**: Engagement metrics (💬 comments, ❤️ likes, 🔄 reposts, 👁️ views) displayed via oEmbed row
- **Smart Proxying**: Video proxy endpoints for platforms that require special handling
- **Metadata Extraction**: Author names, avatars, descriptions, and thumbnails
- **Discord Optimized**: Proper OG tags for rich embeds with correct aspect ratios
- **Fast**: Built on Cloudflare Workers for global low-latency responses

## Setup

1. Install dependencies:
```bash
cd service
npm install
```

2. Configure `wrangler.toml` with your Cloudflare account ID

3. Deploy:
```bash
npm run deploy
```

## Usage

### Embed Endpoint
```
GET /embed?url=https://twitter.com/user/status/123
```

Returns HTML with OG meta tags for Discord/Telegram bots.

### API Endpoint
```
GET /api/embed?url=https://twitter.com/user/status/123
```

Returns JSON with embed data.

### Video Proxy
```
GET /video/instagram?url=<encoded-video-url>
GET /video/threads?url=<encoded-video-url>
```

Streams video content with proper headers for Discord playback.

### Platform Routes
```
GET /twitter/user/status/123
GET /reddit/r/subreddit/comments/id
GET /instagram/reel/shortcode
GET /threads/@username/post/shortcode
GET /bluesky/profile/handle/post/id
GET /pixiv/artworks/12345678
GET /bilibili/video/BVxxxxxxxx
```

## Development

```bash
npm run dev
```

This starts a local dev server at http://localhost:8787

## Architecture

```
service/
├── src/
│   ├── index.ts          # Main router and endpoints
│   ├── handlers/         # Platform-specific handlers
│   │   ├── twitter.ts    # Twitter/X via Syndication API
│   │   ├── reddit.ts     # Reddit JSON API
│   │   ├── bluesky.ts    # AT Protocol
│   │   ├── instagram.ts  # Snapsave + embed scraping
│   │   ├── threads.ts    # GraphQL API + carousel
│   │   ├── pixiv.ts      # Phixiv HTML scraping
│   │   └── bilibili.ts   # Public API
│   ├── utils/
│   │   ├── embed.ts      # OG tag generation, stats formatting
│   │   └── fetch.ts      # HTTP utilities
│   └── types.ts          # TypeScript definitions
├── wrangler.toml         # Cloudflare Workers config
└── package.json
``` 

## License

MIT
