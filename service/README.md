# FixEmbed Service

A unified embed service for Discord, built with Cloudflare Workers and Hono.

## Supported Platforms

| Platform | Status | Method |
|----------|--------|--------|
| Twitter/X | ✅ | Syndication API |
| Reddit | ✅ | JSON API |
| YouTube | ✅ | oEmbed |
| Bluesky | ✅ | AT Protocol |
| Instagram | ✅ | Snapsave API + Video Proxy |
| Threads | ✅ | GraphQL API + Carousel Support |
| Pixiv | ✅ | Phixiv proxy |
| Bilibili | ✅ | Public API |

## Features

- **Video Embedding**: Full video playback support for Instagram Reels, Twitter videos, Reddit videos, Threads videos, and more
- **Carousel Images**: Multi-image posts display as grids (Threads, Instagram)
- **Smart Proxying**: Video proxy endpoints for platforms that require special handling
- **Metadata Extraction**: Author names, descriptions, thumbnails, and engagement stats
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
GET /youtube/watch?v=videoId
GET /instagram/reel/shortcode
GET /threads/@username/post/shortcode
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
│   │   ├── twitter.ts
│   │   ├── reddit.ts
│   │   ├── youtube.ts
│   │   ├── bluesky.ts
│   │   ├── instagram.ts  # Snapsave + embed scraping
│   │   ├── threads.ts    # GraphQL API + carousel
│   │   ├── pixiv.ts
│   │   └── bilibili.ts
│   ├── utils/
│   │   └── embed.ts      # OG tag generation
│   └── types.ts          # TypeScript definitions
├── wrangler.toml         # Cloudflare Workers config
└── package.json
```

## License

MIT
