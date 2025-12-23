# FixEmbed Service

A unified embed service for Discord, built with Cloudflare Workers and Hono.

## Supported Platforms

| Platform | Status | API Type |
|----------|--------|----------|
| Twitter/X | ✅ | Syndication API |
| Reddit | ✅ | JSON API |
| YouTube | ✅ | oEmbed |
| Bluesky | ✅ | AT Protocol |
| Instagram | ⚠️ | oEmbed (limited) |
| Threads | ⚠️ | oEmbed + fallback |
| Pixiv | ✅ | Phixiv proxy |
| Bilibili | ✅ | Public API |

## Setup

1. Install dependencies:
```bash
cd service
npm install
```

2. Configure wrangler.toml with your Cloudflare account ID

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

### Platform Routes
```
GET /twitter/user/status/123
GET /reddit/r/subreddit/comments/id
GET /youtube/watch?v=videoId
```

## Development

```bash
npm run dev
```

This starts a local dev server at http://localhost:8787

## License

MIT
