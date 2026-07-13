# Spec: Reddit Components V2 Cards

## Objective

Render first-party Reddit posts as modern, bot-authored Discord Components V2 cards. Preserve subreddit and author identity, post title and self-text, remote image galleries, playable remote video, vote/comment stats, linked articles, post time, and the original Reddit link. Keep the existing automatic-link fallback whenever metadata or component delivery fails.

## Tech Stack

- Python 3.12 and discord.py 2.7 for Discord Components V2
- TypeScript and Hono for first-party Reddit metadata
- Existing FixEmbed application emojis and remote media URLs

## Commands

- Python tests: `python -m unittest discover -s tests -v`
- Python compile: `python -m py_compile main.py reddit_embed.py component_emojis.py`
- Service tests: `npm test --prefix service`
- Diff validation: `git diff --check`

## Project Structure

- `reddit_embed.py`: Reddit payload normalization, Components V2 layout, and API fetch
- `main.py`: automatic Reddit delivery and existing link fallback
- `service/src/handlers/reddit.ts`: first-party Reddit metadata, gallery, icon, timestamp, and linked-article data
- `tests/test_reddit_embed.py`: card-level unit tests
- `service/tests/run-tests.ts`: Reddit metadata integration tests

## Code Style

```python
layout = await fetch_reddit_layout(item.canonical_url)
await rate_limited_send(
    message.channel,
    view=layout,
    fallback_content=automatic_url,
)
```

Use one branded container with a subreddit/author header, clear title hierarchy, optional self-text, remote media gallery, optional linked-article section, subdued Reddit-specific stats, and a FixEmbed/Reddit footer.

## Testing Strategy

- Unit-test subreddit and author identity, title/body hierarchy, custom upvote/comment stats, playable video, image gallery, linked-article section, and footer timestamp.
- Add a static integration guard proving Reddit enters the bot-authored V2 path without uploading media.
- Extend service tests for gallery order, subreddit icon, timestamp, and non-duplicated image-post text.
- Run complete Python and Worker suites before deployment.

## Boundaries

- Always: keep media remote and playable, preserve gallery order, retain first-party data and existing fallbacks.
- Ask first: new dependencies, database changes, or changes to provider policy.
- Never: upload Reddit media to Discord, expose credentials, or remove the public-link fallback.

## Success Criteria

- Automatic Reddit links render through a `discord.ui.LayoutView` instead of only a fixed-link unfurl.
- The header shows `r/subreddit` and a linked `u/author`; a subreddit icon is shown when Reddit supplies one.
- Title and self-text are not duplicated, video stays playable, and galleries preserve up to Discord's 10-item limit.
- Vote and comment counts use the uploaded application emojis, with Reddit using the upvote icon rather than the shared like icon.
- Linked articles, the original Reddit link, Reddit and FixEmbed icons, and post-relative timestamp are present when supplied.
- Metadata or component failure still sends the existing automatic URL.

## Open Questions

None. This follows the approved first-party X and Instagram Components V2 delivery architecture while retaining Reddit-specific hierarchy and branding.
