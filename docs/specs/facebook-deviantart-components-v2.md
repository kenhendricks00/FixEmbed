# Facebook and DeviantArt Components V2 support

## Problem Statement

FixEmbed does not recognize Facebook or DeviantArt links, so Discord users receive inconsistent native previews or no useful preview at all. Public Facebook Page content should reach the useful behavioral baseline demonstrated by Embedded while retaining FixEmbed's richer card identity, engagement, timestamp, footer, delivery fallback, and reliability reporting. Public DeviantArt deviations and Sta.sh links should preserve the artwork and artist context exposed by DeviantArt's official interface.

Facebook's access model makes an unconditional launch unsafe. Complete public Page metadata requires approved Meta access, and arbitrary public video or Reel playback is not proven through that interface. The two platforms must therefore ship independently behind evidence-based readiness gates.

## Solution

Add Facebook and DeviantArt as supported links with strict public-content boundaries and platform-aware rich cards.

DeviantArt will use its official public oEmbed interface as the direct source. Cards will preserve artist identity, title, description, media or video preview, engagement, publication time, safety state, source link, and FixEmbed footer. Public deviation and Sta.sh URLs are supported; unrelated DeviantArt pages are not.

Facebook will target public Page posts, photos, galleries, videos, and Reels across proven permalink and share variants. Its direct source is Meta's approved Page public-content interface. A separately validated fallback source may recover missing public metadata or media, but it must be bounded, identity-checked, privacy-safe, observable, and unable to turn private content into a supported link. Facebook stays disabled until fixtures and live canaries prove complete, stable cards for every advertised content class.

FixEmbed will always attempt to replace a supported link. Original media URLs are used when Discord can consume them reliably; a bounded, temporary media relay is used only when direct media delivery fails.

## User Stories

1. As a Discord member, I want a public DeviantArt deviation link to become a rich card, so that I can understand the artwork without leaving Discord.
2. As a Discord member, I want a public Sta.sh link to become the same kind of rich card, so that DeviantArt's documented sharing URLs behave consistently.
3. As an artist, I want my name and profile link preserved, so that shared artwork remains attributed.
4. As an artist, I want the deviation title and description preserved when available, so that the work is not stripped of its context.
5. As a Discord member, I want the best official image or GIF rendition displayed, so that artwork is useful at a glance.
6. As a Discord member, I want hosted DeviantArt videos represented by an accurate preview and source link, so that a page URL is never misrepresented as a playable video.
7. As a Discord member, I want views, favorites, comments, and downloads displayed when DeviantArt exposes them, so that the card preserves engagement context.
8. As a Discord member, I want the deviation's publication time displayed, so that I can judge when it was published.
9. As a server moderator, I want mature DeviantArt content marked as a spoiler, so that sensitive media follows the server's safety expectations.
10. As a Discord member, I want an unavailable optional DeviantArt field to degrade cleanly, so that one missing statistic does not break the entire card.
11. As a Discord member, I want a public Facebook Page post to become a rich card, so that Facebook's inconsistent native preview is replaced.
12. As a Discord member, I want the Facebook Page name, avatar, and source link preserved, so that the post's identity is clear.
13. As a Discord member, I want the full public post text displayed within Discord's limits, so that meaningful captions are not reduced to a generic title.
14. As a Discord member, I want a single-photo Facebook post to show its photo, so that the shared content is immediately useful.
15. As a Discord member, I want a multi-photo Facebook post to preserve gallery order, so that the post's intended sequence remains intact.
16. As a Discord member, I want a Facebook video or Reel to show a trustworthy preview and source link, so that unsupported playback is never falsely advertised.
17. As a Discord member, I want playable Facebook video only when a validated source supplies a permitted media URL, so that playback does not depend on brittle HTML.
18. As a Discord member, I want reaction, comment, and share counts shown when available, so that the card reaches Embedded-level usefulness with FixEmbed detail.
19. As a Discord member, I want the Facebook post time shown, so that I know whether the content is current.
20. As a server administrator, I want Facebook service toggles and channel rules to behave like existing platforms, so that adoption does not create a separate control model.
21. As a server administrator, I want new services enabled through a safe one-time settings migration, so that existing servers receive the feature without losing their choices.
22. As a server administrator, I want live health to distinguish direct source, fallback source, permissions, throttling, and unavailable states, so that failures are diagnosable.
23. As a privacy-conscious user, I want private profiles, private posts, groups, comments, and login-only content excluded, so that FixEmbed never broadens access.
24. As a privacy-conscious user, I want media relays to be bounded and temporary, so that FixEmbed does not become a content archive.
25. As a bot operator, I want concurrent metadata misses coalesced and successful or negative responses cached, so that upstream services are not overloaded.
26. As a bot operator, I want tokens and signed media credentials excluded from logs and generated source URLs, so that secrets do not leak.
27. As a maintainer, I want fixture tests for every advertised content class, so that parser changes fail deterministically before release.
28. As a maintainer, I want live canaries for both platforms, so that upstream changes are discovered before users report them.
29. As a maintainer, I want DeviantArt to ship independently, so that Meta approval cannot delay a ready platform.
30. As a maintainer, I want Facebook disabled until its readiness gate passes, so that FixEmbed never advertises incomplete support.
31. As a user of `/fix` or the message context command, I want the same rich cards as automatic conversion, so that every entry point remains consistent.
32. As a FixEmbed supporter, I want the Facebook and DeviantArt application emojis used in service controls and card footers, so that the new cards match the bot's visual language.

## Implementation Decisions

- A supported link is limited to public content with a strict, platform-specific URL grammar.
- Facebook v1 covers public Page posts, photos, galleries, videos, and Reels only after each URL class has a proven resolver. Bare Page profiles, groups, comments, private or personal-account content, stories, and login-only content are excluded.
- DeviantArt v1 covers public deviation and Sta.sh URLs documented by its oEmbed interface. Profiles, galleries, favorites, search, and journal pages are excluded.
- DeviantArt oEmbed is the direct source and does not require a new production secret.
- DeviantArt photo responses use the complete signed media URL returned by the service. Signed query parameters are never stripped or reconstructed.
- DeviantArt video responses use the official thumbnail and source link unless a separately validated playable-media capability is proven.
- DeviantArt safety metadata controls spoiler presentation.
- Facebook's direct source is Meta's public Page-content interface after App Review and business verification.
- Meta oEmbed HTML is not treated as normalized card metadata because Discord Components V2 cannot execute it and the current response lacks the required identity and media fields.
- A Facebook fallback source is allowed only when it is separately validated, host-restricted, identity-checked, observable, and limited to already-public content.
- Facebook stays disabled in production until text, single-photo, gallery, video, and Reel fixtures pass and live canaries prove complete cards from a Cloudflare Worker.
- Facebook video or Reel playback is advertised only when a permitted playable URL survives the readiness gate. Otherwise, the card uses a preview and source link.
- Direct media delivery is preferred. A media relay is a bounded, temporary recovery path, not permanent storage.
- Metadata requests use timeouts, response-size bounds, caching, negative caching, concurrent-miss coalescing, and upstream-specific throttling behavior.
- Returned strings are sanitized, returned media URLs are host-validated, and credentials never appear in logs or user-visible URLs.
- Both platforms reuse the existing platform-aware card composition seam and the shared automatic/manual command delivery path.
- Both platforms participate in existing service settings, channel rules, telemetry, reliability reporting, conformance, translations, documentation, and one-time default migrations.
- DeviantArt application emoji ID `1528150711089500180` and Facebook application emoji ID `1528017838567329913` are used consistently in cards and service controls.
- SparkedHost is the known bot-hosting route, but deployment is separate from implementation and occurs only after verification.

## Testing Decisions

- Test the highest existing retrieval seam by submitting a supported source URL to the public embed API and asserting the normalized platform payload.
- Test the highest existing presentation seam by passing a normalized payload through the shared Components V2 card path and asserting user-visible identity, text, media, engagement, safety, timestamp, source, and footer behavior.
- Use sanitized deterministic fixtures for DeviantArt photos, GIFs, hosted videos, mature content, missing optional fields, throttling, not-found responses, and unsafe returned media.
- Use sanitized deterministic fixtures for Facebook text, single-photo, gallery, video preview, Reel preview, missing engagement, unresolved modern URLs, private/not-found responses, permission failures, throttling, and unsafe returned identity or media.
- Extend URL tests to cover every accepted canonical and share variant plus lookalike-host, unsupported-path, private/group, punctuation, query-string, and pre-converted-link cases.
- Extend settings tests to prove both services are added once without overwriting existing choices.
- Extend reliability tests to prove both platforms map to stable service names and expose stage-accurate modes.
- Extend conformance tests and production manifests so every enabled Worker platform has a card builder, approved source hosts, a stable live canary, and bounded media validation.
- Keep live tests outside deterministic unit suites. Production canaries must not send Discord messages or mutate platform state.
- Treat the Facebook readiness matrix as a release gate. If any advertised content class is incomplete or unstable, Facebook remains disabled while DeviantArt may ship.
- Run the repository's complete Python, Worker, type-check, release-metadata, dependency-audit, formatting, and container-startup verification before deployment.

## Out of Scope

- Facebook personal profiles, private posts, groups, comments as standalone links, stories, marketplace, events, bare Page profiles, and login-only content.
- Claiming generic support for every modern Facebook URL before its resolver is proven.
- Executing Meta oEmbed HTML or Facebook JavaScript inside Discord.
- Unbounded Facebook Page-feed scans to discover a post ID.
- Promising arbitrary public Facebook video or Reel playback before a permitted media source is proven.
- DeviantArt profiles, galleries, favorites, search, journals, private deviations, or unauthorized originals.
- Permanent media archiving or stripping signed media credentials.
- Uploading to SparkedHost or restarting the production bot during implementation.

## Further Notes

- The source-feasibility research is retained in the repository and should be refreshed if Meta changes its access or field model.
- DeviantArt is the first implementation frontier because it is currently unblocked.
- Facebook's credentialed tracer bullet is a human-access frontier. Implementation beyond its disabled seams remains blocked until the approved access and readiness evidence exist.
