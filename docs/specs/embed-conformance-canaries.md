# Spec: Embed Conformance Canaries

## Objective

Continuously prove that FixEmbed's public JSON API returns usable, first-party
metadata for the user flows the bot advertises. Existing `/api/status` probes
measure whether handlers respond; conformance canaries additionally verify the
shape of the returned author, original timestamp, stats, media, and structured
sections.

The first increment provides an offline-tested manifest contract and an opt-in
production runner. It does not post to Discord, retain social-post content, or
run during ordinary unit tests.

## On-call Questions

1. Which stable canary case stopped satisfying its card contract?
2. Did the case fail completely or recover through an emergency fallback?
3. How long did the public API take to build the card?
4. Is a failure isolated to one platform or shared across the service?

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
- `conformance/production.json`: reviewed public sample URLs and semantic
  expectations.
- `tests/test_conformance.py`: offline contract and runner tests.
- `.github/workflows/canary.yml`: scheduled and manually dispatched production
  run.

## Manifest Contract

Each case has a stable, non-sensitive `id`, supported `platform`, public HTTPS
`url`, a list of semantic `requires`, an optional `mediaType`, optional
`sectionKinds`, and an explicit `allowFallback` flag. Exact post text, counts,
and media URLs are never asserted because those values legitimately change.

Allowed requirements are `title`, `author`, `timestamp`, `stats`, and `media`.
Allowed media types are `image`, `carousel`, `video`, and `gif`. Section kinds
must match the Worker's bounded section vocabulary.

## Privacy and Security Boundaries

- Reports contain only case ID, platform, bounded outcome codes, source mode,
  and latency. They never contain source URLs, response bodies, author names,
  captions, Discord identifiers, or raw exception messages.
- The manifest accepts only supported HTTPS platform hosts and at most 50 cases.
- HTTP responses are capped at 1 MiB and use a bounded per-case timeout.
- Every run adds one opaque request nonce to all API probes so edge caches
  cannot make a stale deployment appear healthy. The nonce is never reported.
- Normal unit tests inject a fake fetcher and never access the network.
- Production traffic is opt-in through the CLI or scheduled canary workflow.

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

- Add feature-specific X cases for GIF, quote, poll, carousel, and translation.
- Add media reachability checks that validate content type and byte-range
  support without downloading complete media.
- Feed aggregate canary history into a durable status/SLO store.
