# Spec: Conversion Observability

## Objective

Let operators identify platform-specific card degradation before users report it,
without retaining Discord identities, post URLs, captions, or media metadata.

## Questions This Must Answer

1. Which supported service is producing link fallbacks most often in this bot process?
2. Are those fallbacks caused by timeouts, rate limits, network failures, upstream
   client/server responses, invalid metadata, or unexpected code paths?
3. What is the recent p95 rich-card build latency per service?
4. Is the Reliability page showing live Worker availability separately from local
   conversion quality?

## Signals

- A bounded in-memory aggregate records rich-card attempts, rich successes, link
  fallbacks, failure categories, and the latest 200 build durations per service.
- A structured warning is emitted only when a rich card falls back to a link.
- Reliability displays aggregate local card quality and at most three services
  needing attention. It continues to display the Worker's live provider health as
  a separate signal.

## Privacy and Cardinality Boundary

- Allowlisted fields: stable event name, random request ID, supported service,
  bounded failure category, exception type, and bounded duration.
- Never log guild, channel, message, member, post URL, post text, media URL,
  exception message, response body, or authentication material.
- Service and failure-category labels come from fixed sets.
- All local telemetry is process-scoped and resets when the bot restarts. It does
  not claim historical uptime or long-term success rates.

## Failure Categories

- `timeout`
- `rate_limited`
- `network`
- `upstream_4xx`
- `upstream_5xx`
- `invalid_response`
- `unexpected`

## Success Criteria

- Every supported rich-card build records exactly one rich success or link fallback.
- Failure warnings contain no raw exception message or URL.
- Recent p95 latency uses a bounded sample and deterministic calculation.
- Reliability clearly labels the metrics as local and process-scoped.
- A single malformed failure cannot add an unbounded service/category label.
- Existing conversion behavior remains unchanged: a failed rich card still sends
  the shareable FixEmbed link.

## Not Doing in This Slice

- Persistent or per-guild operational telemetry.
- External metrics vendors, tracing backends, or new runtime dependencies.
- User-facing SLA/uptime claims or automated paging.
- Storing or displaying individual conversion events.
