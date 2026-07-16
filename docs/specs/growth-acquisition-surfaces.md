# Spec: Product-Led Acquisition Surfaces

## Objective

Turn successful FixEmbed usage into discoverable, low-friction installs without
adding promotional copy to social-card footers. The primary audience is a
Discord member who wants to use `/fix` anywhere; server administrators remain a
first-class secondary audience for automatic conversion.

## Commands

- Python tests: `python -m unittest discover -s tests`
- Python compile: `python -m compileall -q .`
- Worker tests: `cd service && npm test`
- Worker types: `cd service && npx tsc --noEmit`
- Dependency audit: `cd service && npm audit --omit=dev`
- Release metadata: `python scripts/check_release_metadata.py`

## Project Structure

- `install_links.py`: canonical bot-facing install destinations and buttons.
- `main.py`: `/invite`, `/help`, and `/about` command surfaces.
- `service/src/utils/install.ts`: validated web install redirect contract.
- `service/src/utils/static_site.ts`: homepage and platform landing pages.
- `service/src/index.ts`: public landing and redirect routes.
- `tests/` and `service/tests/`: contract and regression coverage.
- `docs/growth-playbook.md`: non-code launch copy and measurement guidance.

## Interface Contract

`GET /install/:context/:source` accepts only:

- contexts: `user`, `server`
- sources: fixed labels committed with the product surface

A valid request returns a temporary redirect to Discord OAuth. Invalid values
return 404. A valid redirect emits one bounded `install_redirect` event
containing only the context and source label. The event is directional click
telemetry, not a fraud-resistant conversion or a user identity record.

Stable landing pages are available at `/twitter`, `/instagram`, and `/reddit`.
They share the existing FixEmbed design system and lead with account install,
with server install presented as the automatic-conversion option.

## Code Style

Use explicit allowlists and small pure functions at HTTP boundaries:

```ts
const context = parseInstallContext(c.req.param('context'));
const source = parseInstallSource(c.req.param('source'));
if (!context || !source) return c.json({ error: 'Not found' }, 404);
```

## Testing Strategy

- Unit-test both OAuth destinations and every accepted/rejected redirect value.
- Assert that command cards contain distinct account and server controls.
- Assert that the homepage and each platform page contain one clear primary
  account-install CTA and a server-install alternative.
- Exercise the real Hono routes for redirect status and `Location` headers.
- Browser-check homepage and one platform page at mobile and desktop widths.

## Boundaries

- Always: preserve quiet social-card footers; use Discord-native OAuth; keep
  attribution labels bounded; retain accessible HTML and keyboard focus.
- Ask first: third-party analytics, tracking cookies, paid advertising, or
  posting announcements from the owner's accounts.
- Never: fabricate testimonials, store message/member data for attribution, or
  make Premium a prerequisite for reliable media and embeds.

## Success Criteria

- The homepage makes account installation the primary action.
- `/invite`, `/help`, and `/about` expose separate account/server install paths.
- `/twitter`, `/instagram`, and `/reddit` render focused, indexable pages.
- Install redirects are allowlisted, privacy-safe, and covered end to end.
- The growth playbook contains launch templates and a real-testimonial intake
  process without invented endorsements.
- All bot and Worker release gates pass and production routes are verified.

## Open Questions

- Real testimonials remain intentionally absent until users consent to public
  attribution.
- A video demonstration requires approved source footage and is a separate
  publishing asset; this slice supplies the storyboard and landing destination.
