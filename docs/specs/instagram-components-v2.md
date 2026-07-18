# Instagram Components V2

## Goal

Render Instagram posts as bot-authored Components V2 cards while preserving the
full caption, creator identity, engagement context, publication time, and every
distinct carousel image exposed by the source.

## Gallery delivery

- Preserve source order and render up to ten items per Discord media gallery.
- Send trusted Instagram CDN images through
  `GET /proxy/instagram?url=<encoded HTTPS image URL>`.
- Keep non-Instagram media URLs on their existing delivery paths.
- Keep the original post URL in the footer.
- Use the plain-link card only when the native Components V2 send genuinely
  fails.

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

- The Python card test verifies that all carousel items serialize to the
  restricted FixEmbed relay and still decode to the original source URLs.
- The Worker tests verify trusted image streaming, untrusted-host rejection,
  and unsafe-redirect rejection.
- The live acceptance test posts a ten-image Instagram carousel in Discord and
  requires one successful Components V2 card with all ten images.
