# Premium Controls Suite

## Objective

Give subscribing server administrators durable customization, automation, and insight without degrading FixEmbed's free embed quality. Premium remains guild-scoped and all protected behavior is checked against the active Discord entitlement at use time.

## Included Features

### Social card appearance

- Apply the existing Premium custom embed color to every Components V2 social card, not only command cards.
- Add a global Premium card style with:
  - engagement statistics shown or hidden;
  - hashtags shown or hidden;
  - full or compact captions.
- Defaults preserve the current free and Premium output exactly.

### Default X translation

- Let Premium administrators choose an optional two-letter default language for X posts.
- A language explicitly present in an X link overrides the server default.
- Non-Premium servers always use the source post unless the link itself requests a translation.

### Advanced exclusions

- Let Premium administrators exclude selected members and roles from automatic conversion.
- Exclusions apply only to automatic message processing, not manual `/fix` usage.
- Stored IDs are validated against the current guild and silently ignore deleted members or roles.

### Private analytics

- Persist daily aggregate counts per guild and service for successful rich cards and link fallbacks.
- Show a private 30-day Premium analytics page in `/settings`.
- Never store source URLs, post text, usernames, message IDs, or channel IDs.
- Retain at most 90 days of daily aggregates.

## Authorization and Safety

- `/settings` remains restricted to members with Manage Server.
- Premium is checked when a protected page opens, when its controls are used, and when messages are processed.
- All database writes use parameters.
- Role and member exclusions are limited to IDs supplied by Discord's native selectors.
- Subscription lapse preserves settings but disables their effects.

## Compatibility

- Existing databases migrate automatically with safe defaults.
- Existing social-card builder calls remain valid through optional parameters.
- Free output, carousels, playable media, GIF behavior, reliability fallbacks, and quality profiles remain unchanged.
- No new dependencies are introduced.

## Commands

```powershell
python -m compileall -q .
python -m unittest discover -s tests -v
python scripts/check_release_metadata.py
```

## Success Criteria

- A Premium custom color visibly changes every supported social-card accent.
- Card-style settings consistently affect all supported social renderers.
- Default X translation is applied only when appropriate.
- Selected members and roles bypass automatic conversion only while Premium is active.
- The analytics page reports accurate 30-day aggregate results without content-level storage.
- All tests and release-metadata checks pass, and the worktree is clean after commits.

## Not Included

- No paywall for media quality, playback, carousels, GIFs, or reliability fixes.
- No claim of priority processing or uptime guarantees.
- No complete removal of FixEmbed attribution.
- No media downloading or archival.
