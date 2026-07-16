# Spec: Discord Delivery Observability

## Objective

Let operators distinguish metadata/card failures from Discord delivery failures
without retaining Discord identities, content, or destination information.

## Questions This Must Answer

1. How many queued sends completed directly, required a link rescue, or failed?
2. Is the queue backed up, and what is recent end-to-end p95 delivery latency?
3. Are delivery problems caused by missing permissions, unavailable channels,
   rate limits, Discord responses, networking, timeouts, or unexpected code?
4. Is Discord delivery health displayed separately from platform availability
   and local card-build quality?

## Signals

- Every queued send receives a random correlation ID unrelated to Discord or
  post identity.
- Exactly one terminal outcome is recorded per completed queue item: direct
  delivery, component-to-link rescue, or complete failure.
- The latest 200 end-to-end queue/send durations are retained in memory for p95.
- Structured warnings are emitted for link rescues and structured errors for
  complete failures.
- Reliability displays completed outcomes, live pending depth, recent delivery
  rate, p95 latency, and the most actionable bounded failure category.
- Capability-aware delivery records a bounded aggregate whenever a configured
  destructive mode is safely downgraded to reply mode.

## Privacy and Cardinality Boundary

- Allowlisted event fields: stable event name, random request ID, fixed delivery
  kind, fixed failure category, exception type, and bounded duration.
- Never include guild, channel, message, member, post/media URL, content,
  exception message, response body, or authentication data.
- Delivery kind and failure-category labels come from fixed sets.
- Aggregates are process-scoped and reset on restart. They are operational
  diagnostics, not historical uptime or an SLA.

## Failure Categories

- `timeout`
- `forbidden`
- `not_found`
- `rate_limited`
- `network`
- `discord_4xx`
- `discord_5xx`
- `unexpected`

## Success Criteria

- Existing rate limiting and silent delivery behavior remain unchanged.
- A successful component send records one direct delivery.
- A failed component send followed by a successful shareable-link send records
  one link rescue, not a complete failure.
- A failed final send records one complete failure.
- A missing Manage Messages permission is visible as an automatic recovery, not
  misreported as a card-build or platform-health failure.
- Duplicate terminal calls for one ticket cannot double-count it.
- Reliability presents three distinct stages: live platform health, local card
  quality, and Discord delivery.
- Logs remain structured and contain no raw exception message or Discord ID.

## Not Doing in This Slice

- Persistent per-guild delivery history or external telemetry vendors.
- Automated paging, SLA claims, or public historical uptime.
- Storing individual delivery events after a queue item completes.
