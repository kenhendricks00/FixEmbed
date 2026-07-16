# Spec: Embed Conformance Canaries

## Objective

Continuously prove that FixEmbed's public JSON API returns usable metadata and
that the production Python renderer can turn it into a valid Discord Components
V2 card for the user flows the bot advertises. Existing `/api/status` probes
measure whether handlers respond; conformance canaries additionally verify the
shape of the returned author, original timestamp, stats, media, and structured
sections before building the same `discord.py` layout used by the live bot.

The runner does not post to Discord, retain social-post content, or make
ordinary unit tests depend on the internet.

## On-call Questions

1. Which stable canary case stopped satisfying its card contract?
2. Did the case fail completely or recover through an emergency fallback?
3. How long did the public API take to build the card?
4. Is a failure isolated to one platform or shared across the service?
5. Did live metadata succeed but the bot's Components V2 layout lose identity,
   media, stats, structured context, footer links, or the source timestamp?
6. Did an approved Discord-facing CDN or proxy stop returning usable image,
   GIF, or video bytes for a rendered card?

## Commands

- Offline tests:
  `python -m unittest discover -s tests -p test_conformance.py -v`
- All Python tests: `python -m unittest discover -s tests -v`
- Production canary:
  `python conformance.py --manifest conformance/production.json --fail-on-degraded`
- Worker tests: `cd service && npm test`
- Worker type check: `cd service && npx tsc --noEmit`

## Project Structure

- `conformance.py`: manifest validation, contract evaluation, bounded HTTP
  client, privacy-safe report, and CLI.
- `card_conformance.py`: real platform-layout registry and bounded serialized
  Components V2 checks.
- `media_conformance.py`: typed media targets, approved CDN policy, bounded
  byte-range fetches, and privacy-safe reachability outcomes.
- `conformance/production.json`: reviewed public sample URLs and semantic
  expectations.
- `tests/test_conformance.py`: offline contract and runner tests.
- `.github/workflows/canary.yml`: scheduled and manually dispatched production
  run.

## Manifest Contract

Each case has a stable, non-sensitive `id`, supported `platform`, public HTTPS
`url`, a list of semantic `requires`, an optional `mediaType`, optional
`sectionKinds`, an explicit `allowFallback` flag, and an optional reviewed
`renderer`. A `probeMedia` flag opts a rendered card into bounded media delivery
checks. X cases may also supply allowlisted `lang` and `mode` options. Exact post
text, counts, and media URLs are never copied into reports because those values
legitimately change.

Allowed requirements are `title`, `author`, `timestamp`, `stats`, `media`, and
`translation`.
Allowed media types are `image`, `carousel`, `video`, and `gif`. Section kinds
must match the Worker's bounded section vocabulary.

When `renderer` is `components-v2`, the canary calls the real platform builder
and validates one Discord container with the expected identity/avatar, remote
media, stats, requested structured sections, original-link footer, source
timestamp, and translation marker. Renderer failures use fixed codes and never
include card text or media URLs in the report.

When `probeMedia` is true, the runner extracts the media and thumbnail targets
from the serialized card, deduplicates them, and probes at most 16 targets. Each
request uses HTTPS, a platform-specific CDN suffix allowlist, a one-byte Range
GET, at most three separately validated redirects, and the normal per-case
timeout. A successful target must return HTTP 200/206 with an `image/*` or
`video/*` content type. Failures use bounded codes for rejected hosts, timeouts,
HTTP failures, invalid content types, target limits, and unexpected probe errors.

## Privacy and Security Boundaries

- Reports contain only case ID, platform, bounded outcome codes, source mode,
  and latency. They never contain source URLs, response bodies, author names,
  captions, serialized cards, Discord identifiers, or raw exception messages.
- The manifest accepts only supported HTTPS platform hosts and at most 50 cases.
- HTTP responses are capped at 1 MiB and use a bounded per-case timeout.
- Media probes never retain URLs, response bodies, redirect locations, or raw
  headers; reports expose only bounded outcome codes.
- Every run adds one opaque request nonce to all API probes so edge caches
  cannot make a stale deployment appear healthy. The nonce is never reported.
- Normal unit tests inject a fake fetcher and never access the network.
- Production traffic is opt-in through the CLI or scheduled canary workflow.
- Components V2 validation is local and never sends a message or requires a
  Discord token.

## Outcome Semantics

- `passed`: the first-party response satisfies every declared expectation.
- `degraded`: the response satisfies the card contract but used an explicitly
  permitted emergency fallback.
- `failed`: the API, response envelope, platform identity, source mode, or card
  contract is invalid.

The CLI exits non-zero for failed cases. `--fail-on-degraded` also exits
non-zero when an emergency fallback is serving a canary.

## Success Criteria

- Invalid or unsafe manifests fail before any network request.
- Every supported platform has at least one production case.
- Every production case builds the same Components V2 layout used by the bot.
- Every production card proves its rendered remote media is retrievable from an
  approved public CDN or FixEmbed proxy.
- Stable X cases cover carousels, GIFs, videos, translations, and tombstones.
- The public API exposes whether metadata came from first-party or fallback
  handling.
- Reports never expose URLs, content, or raw errors.
- Scheduled runs upload their bounded JSON report even when the canary fails.
- The entire Python and Worker verification matrix remains green.

## Boundaries

- Always: use semantic assertions, bounded output, timeouts, and deterministic
  offline tests.
- Ask first: introduce a paid monitoring vendor or store post-level history.
- Never: send messages to Discord, mutate social-platform state, log response
  bodies, or make normal unit tests depend on the internet.

## Follow-up Increments

- Add still-live, stable X quote and poll cases when reviewed public samples are
  available; do not substitute fixture-only confidence for production behavior.
- Feed aggregate canary history into a durable status/SLO store.
