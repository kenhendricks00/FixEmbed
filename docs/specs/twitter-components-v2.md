# Spec: X Components V2 Cards

## Objective

Render first-party X/Twitter posts as modern, bot-authored Discord Components V2 cards. Preserve the existing author identity, post text, translations, media carousels, playable remote video, polls, quotes, Community Notes, articles, link cards, activity stats, and original-post link. If first-party metadata fails, keep the current public-link fallback.

## Tech Stack

- Python 3.12 and discord.py 2.7 for the Discord bot card
- TypeScript and Hono for the FixEmbed metadata API
- Existing FixEmbed application emojis and remote media URLs

## Commands

- Python tests: `python -m unittest discover -s tests -v`
- Python compile: `python -m py_compile main.py twitter_embed.py component_emojis.py`
- Service tests: `npm test --prefix service`
- Diff validation: `git diff --check`

## Project Structure

- `twitter_embed.py`: X payload normalization, Components V2 layout, and API fetch
- `main.py`: automatic X delivery and link fallback
- `service/src/index.ts`: metadata API option forwarding
- `tests/test_twitter_embed.py`: card-level unit tests
- `service/tests/run-tests.ts`: metadata option integration test

## Code Style

```python
layout = build_twitter_layout(payload)
await rate_limited_send(
    message.channel,
    view=layout,
    fallback_content=automatic_url,
)
```

Use one branded container, a compact author section, remote media gallery, optional structured sections, a subdued application-emoji stats row, and a FixEmbed/X footer.

## Testing Strategy

- Unit-test identity, text, stats, gallery/video media, structured sections, and footer output.
- Add a static integration guard proving Twitter enters the bot-authored layout path.
- Verify the metadata API forwards translation and gallery options.
- Run both complete Python and service test suites before committing.

## Boundaries

- Always: preserve first-party data and existing fallbacks; keep media remote and playable; retain translations and gallery modes.
- Ask first: new dependencies, database changes, or changes to provider policy.
- Never: upload social media files to Discord, expose credentials, or remove the FxTwitter emergency fallback.

## Success Criteria

- Automatic X links render through a `discord.ui.LayoutView` instead of a legacy link unfurl.
- Video remains playable from its remote URL and multi-image posts preserve every available image up to Discord's gallery limit.
- Author, post text, stats, structured sections, X icon, FixEmbed footer, source link, and post timestamp are present when supplied.
- Translation and gallery/mosaic modifiers reach the first-party handler.
- Metadata failure still sends the existing automatic URL.

## Open Questions

None. The migration follows the already-approved Instagram Components V2 delivery pattern.
