# Instagram Components V2

## Goal

Render Instagram posts as bot-authored Components V2 cards while preserving the
full caption, creator identity, engagement context, publication time, and every
distinct carousel image exposed by the source.

## Gallery delivery

- Preserve source order and render up to ten items per Discord media gallery.
- Normalize trusted Instagram CDN images through
  `GET /proxy/instagram?url=<encoded HTTPS image URL>`.
- Download up to ten carousel images concurrently and attach them to the
  Components V2 message in source order.
- Keep single images and videos on their existing remote-media paths.
- Keep non-Instagram media URLs on their existing delivery paths.
- Keep the original post URL in the footer.
- Use the plain-link card only when the native Components V2 send genuinely
  fails.

## Video relay contract

- Keep Reels as remote video Media Gallery items. Do not upload them as message
  attachments.
- Forward Discord byte-range requests to the recovered Instagram video.
- Preserve the upstream `206`, `Content-Range`, and `Content-Length` response
  so Discord can initialize inline playback.
- Advertise the response as an inline MP4 and retain the remote-video fallback
  when media recovery fails.

## Relay contract

- Accept only HTTPS URLs on `cdninstagram.com`, `fbcdn.net`, or their
  subdomains.
- Reject URLs containing credentials, oversized input URLs, redirects to
  untrusted hosts, non-image responses, and images advertised above 25 MiB.
- Validate every redirect before following it.
- Return the upstream image content type, a one-day public cache policy, and
  `X-Content-Type-Options: nosniff`.
- Return structured client or upstream errors without redirecting Discord back
  to the direct Instagram CDN URL.

## Regression coverage

- The Python regression tests trace the ordered carousel from the extracted
  image list through restricted relay normalization, concurrent download, and
  the final `attachment://` Media Gallery items.
- The affected Reel regression traces the recovered remote video through
  video-first normalization and into the Components V2 Media Gallery while
  ensuring its poster remains fallback metadata only.
- The Worker tests verify trusted image streaming, untrusted-host rejection,
  and unsafe-redirect rejection.
- The live acceptance test posts a ten-image Instagram carousel in Discord and
  requires one successful Components V2 card with all ten images, in order,
  without waiting for the plain-link rescue timeout.
