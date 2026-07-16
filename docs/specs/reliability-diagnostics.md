# Spec: In-Discord Reliability Diagnostics

## Objective

Give server administrators an accurate, privacy-preserving view of FixEmbed's
current platform health without requiring SparkedHost logs. The existing
Reliability page and `/status` alias show the Worker's live first-party,
fallback, latency, and incident data separately from process-local card-build
and Discord-delivery health.

## Product Decisions

- Reliability information is available to every server, not gated by Premium.
- The existing Reliability and Debug surfaces remain distinct: Reliability
  covers platform/provider health; Debug covers Discord permissions and bot
  runtime state.
- No new `/troubleshoot` command is added.
- The Worker coalesces concurrent report refreshes inside each warm isolate and
  reuses a verified report for 60 seconds to avoid public probe storms. Each
  platform probe has a seven-second deadline so one stalled handler cannot
  hold the aggregate report open.
- A recent successful report remains available for at most 15 minutes as
  explicitly marked stale data when an unexpected aggregate refresh fails.
  The Python client preserves that marker instead of presenting recovered data
  as a fresh live check.
- Missing health data must be labeled unavailable; it must never be presented
  as operational.

## Tech Stack and Structure

- `reliability.py`: validated status contract, Worker stale-marker handling,
  short-lived bot cache, stale-data policy, HTTP adapter, and Discord-safe
  formatting.
- `service/src/utils/status_report_cache.ts`: bounded refresh coalescing,
  fresh-report reuse, recent-stale recovery, and probe deadline enforcement.
- `main.py`: Components V2 Reliability page, refresh action, public dashboard
  link, process-local card and delivery sections, and `/status` integration.
- `tests/test_reliability.py`: pure parsing, caching, failure, and formatting
  coverage.

## Commands

- Root tests: `python -m unittest discover -s tests`
- Python compile check: `python -m compileall -q .`
- Worker tests: `cd service && npm test`
- Worker typecheck: `cd service && npx tsc --noEmit`
- Release metadata: `python scripts/check_release_metadata.py`

## Code Style

```python
report = await reliability_client.get_report()
if report.stale:
    status_text += "\n-# Live refresh failed; showing recent verified data."
```

Use immutable data classes for validated external data, bounded strings and
numbers at the HTTP boundary, and dependency injection for deterministic cache
tests. Never expose raw exceptions or requested post URLs in diagnostics.

## Testing Strategy

- Unit-test payload validation and normalization without network access.
- Prove fresh-cache, forced-refresh, stale-cache, and unavailable paths.
- Assert Discord output clearly distinguishes operational, degraded, outage,
  fallback, stale, and unavailable states.
- Run the complete Python and Worker suites before commit.

## Boundaries

- Always: validate external JSON, bound displayed text, cache live probes, and
  preserve the last recent verified report during a short outage.
- Ask first: persistent telemetry storage, new paid gates, new dependencies, or
  changes to public incident history.
- Never: log post URLs/content/usernames, claim historical uptime without stored
  evidence, invent successful health, or expose raw exception details to users.

## Success Criteria

- `/settings` Reliability and `/status` show live status, provider mode, and
  latency for all supported platforms.
- Repeated views within 30 seconds share one live report.
- A failed refresh can show a verified report no older than five minutes and
  labels it stale.
- With no recent verified report, the UI says live health is unavailable while
  the separately rendered process-local sections remain available.
- A refresh button bypasses the fresh-cache window without causing concurrent
  duplicate requests.
- Existing command, settings, embed, and Worker tests remain green.

## Not Doing in This Slice

- Persistent uptime history or SLA claims.
- Automatic NSFW/spoiler classification.
- Translation expansion beyond X.
- New platform support or direct media uploads.
