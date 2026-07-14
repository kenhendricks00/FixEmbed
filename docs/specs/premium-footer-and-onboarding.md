# Spec: Premium Footer Branding and Owner Onboarding

## Objective

Give Premium servers a tasteful, opt-in identity in Components V2 social-card footers and give new server owners a private, one-time getting-started message after installation.

## Tech Stack and Commands

- Python 3.12 with discord.py 2.7 and SQLite.
- Test: `python -m unittest discover -s tests`
- Compile: `python -m compileall -q .`

## Project Structure

- `embed_footer.py`: shared footer-branding contract and safe text formatting.
- Platform `*_embed.py` modules: additive optional branding input.
- `main.py`: Premium enforcement, persisted guild settings, settings UI, and guild-join orchestration.
- `onboarding.py`: Components V2 onboarding card and private delivery helper.
- `tests/`: footer, settings, onboarding, and platform regression coverage.

## Interface Contract

- Footer branding is represented by an optional immutable value containing a server name and optional guild-emoji mention.
- Existing platform builders remain backward-compatible when branding is omitted.
- Default footer: `FixEmbed · Platform · time`.
- Premium branded footer: `Server Name · Platform · time · via FixEmbed`.
- The server name is derived live from Discord and escaped before rendering. Arbitrary names, URLs, or external icons are not accepted.
- A selected emoji ID is valid only while it belongs to the current guild. Missing or deleted emojis degrade to text-only server branding.

## Settings and Authorization

- Persist `footer_branding_enabled` and `footer_emoji_id` on `guild_settings` with safe disabled/null defaults.
- Only active Premium guilds render custom branding. A lapsed subscription preserves settings but renders the default FixEmbed footer.
- Only members with Manage Server permission can change server settings.
- The settings UI provides a Premium footer-branding page, enable/disable control, and optional guild-emoji selector.

## Onboarding

- On `on_guild_join`, send one Components V2 DM to the guild owner for that installation.
- Explain that FixEmbed works immediately, recommend `/settings`, and link `/help`, Debug, and the support server.
- Do not advertise Premium in onboarding.
- If the owner is unavailable or DMs are closed, return quietly and do not post publicly.

## Security Boundaries

- Always validate emoji ownership and escape guild-controlled text.
- Always enforce Premium at render time rather than trusting persisted settings.
- Never request Audit Log access to discover the installer.
- Never accept arbitrary footer URLs, image URLs, or raw emoji markup.
- Never post onboarding publicly as a fallback.

## Success Criteria

- Every Components V2 social platform uses the shared optional branding contract.
- Default footer output remains unchanged.
- Active Premium branding renders the server identity plus `via FixEmbed`; non-Premium branding never renders.
- Settings survive restart and safely handle deleted emojis.
- Guild join sends the private onboarding card once and closed DMs do not raise.
- Full Python tests and compilation pass with no new dependencies.
