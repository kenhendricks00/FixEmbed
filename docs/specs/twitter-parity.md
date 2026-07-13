# Spec: First-Party X Embed Parity

## Objective

Bring FixEmbed's first-party X/Twitter cards to user-visible parity with FxEmbed/FixupX for Discord embeds. Supported public posts should preserve their complete content without redirecting to an external renderer during normal operation.

## Tech Stack

- Discord bot: Python 3.12 and discord.py 2.6.4
- Embed service: Cloudflare Workers, Hono 4.12, TypeScript 5.3
- Primary public data source: X syndication tweet payloads
- Optional translation backend: Cloudflare Workers AI M2M100

## Commands

- Python compile: `python -m compileall -q main.py translations.py link_utils.py`
- Python tests: `python -m unittest discover -s tests -v`
- Release metadata: `python scripts/check_release_metadata.py`
- Service tests: `cd service && npm test`
- Service type check: `cd service && npx tsc --noEmit`
- Dependency audit: `cd service && npm audit --omit=dev`
- Container check: `docker build --tag fixembed:twitter-parity .`

## Project Structure

- `link_utils.py`: public X URL modifiers preserved by the Discord bot
- `service/src/handlers/twitter.ts`: X payload validation and first-party normalization
- `service/src/types.ts`: platform-neutral embed contract
- `service/src/utils/embed.ts`: Open Graph and oEmbed rendering
- `service/src/index.ts`: public Worker routes and modifier parsing
- `service/tests/run-tests.ts`: service behavior and generated metadata tests
- `tests/test_link_utils.py`: bot URL normalization tests

## Code Style

Use explicit typed normalized structures at the X handler boundary, then pass platform-neutral data to the shared renderer:

```ts
const poll = normalizeTwitterPoll(tweet.card);
return { success: true, source: 'first-party', data: { ...baseEmbed, poll } };
```

Keep optional features additive and preserve the original post when optional enrichment fails.

## Testing Strategy

- Unit-test every syndication payload shape with deterministic fixtures.
- Test generated Open Graph metadata for every new embed field.
- Test bot-to-Worker modifier preservation for translation, gallery, and mosaic modes.
- Run the full Python and TypeScript suites after every committed vertical slice.

## Boundaries

- Always: validate untrusted X payloads, escape rendered metadata, retain original post links, and degrade optional enrichment safely.
- Ask first: add a new paid third-party API, require X account cookies, or change existing guild defaults.
- Never: scrape user credentials, make external proxy rendering the normal path, expose secrets, or claim support without regression coverage.

## Success Criteria

- Multi-photo and mixed-media posts preserve all available media.
- Quoted posts show quoted author, text, and media context.
- Polls show every choice, vote share/count, and final/active state when supplied by X.
- Long-form notes and X article cards use the expanded title/text/media supplied by X.
- Community Notes appear with their explanatory text and source link when supplied by X.
- Deleted, private, withheld, and unavailable posts render a useful tombstone or use the existing emergency fallback without crashing.
- `/xx` translation suffixes, gallery mode, and mosaic mode survive bot normalization and alter only the requested card.
- Existing platform handlers and unmodified X links retain their current behavior.

## Upstream Behavior Reference

- FxEmbed documentation: `https://docs.fxembed.com/`
- FxEmbed source: `https://github.com/FxEmbed/FxEmbed`
- Cloudflare Workers AI M2M100: `https://developers.cloudflare.com/workers-ai/models/m2m100-1.2b/`

## Implementation Tasks

- [x] Normalize quote, poll, note/article, Community Note, tombstone, and mixed-media payloads.
- [x] Extend the shared embed contract and metadata renderer for structured X enrichments.
- [x] Preserve and render gallery/mosaic modifiers.
- [x] Add fixtures and end-to-end metadata tests for each parity behavior.
- [x] Update public documentation and cache revision.
- [x] Complete quality, security, and parity review with a clean committed worktree.

## Open Questions

None. The user explicitly approved closing all previously identified parity gaps.
