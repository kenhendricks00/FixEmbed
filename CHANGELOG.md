## Unreleased

#### **Pinterest and acknowledgements**
- Added first-party Pinterest Pin metadata, full-size image and playable video cards, and safe `pin.it` short-link resolution.
- Added Pinterest Components V2 rendering, settings migration, public docs, status checks, commands, and localized service lists.
- Documented every current emergency fallback in `/about` and the README with its purpose and non-affiliation disclaimer.

#### **Licensing**
- Relicensed FixEmbed from MIT to the GNU Affero General Public License v3.0 or later.
- Added visible author attribution and source links to the hosted service and Discord `/about` surface.

#### **🚀 New Features**
- **`Components V2 Command Cards`**
  - Migrate `/about` and `/help` to the same branded Components V2 system as `/settings` and the remaining configuration commands.
  - Keep every localized help surface aligned with the complete supported-service list, including YouTube community posts.
- **`Richer First-Party X Embeds`**
  - Preserve every photo in X/Twitter carousel posts.
  - Render quoted posts as distinct nested cards with their author, avatar, linked handle, text, and media.
  - Route animated GIF posts through Discord's native `gifv` unfurl so they autoplay and loop when the viewer's client settings allow it.
  - Preserve mixed photo/video media in Components V2 cards while keeping ordinary videos under playback controls.
  - Keep polls, quotes, translations, GIFs, and external video metadata when the fxTwitter recovery path is used.
  - Support opt-in translated posts by appending a two-letter language code to the status URL.
  - Render polls, quotes, Community Notes, long-form notes, X Articles, and website cards inline.
  - Add gallery and native multi-image mosaic URL modifiers.

#### **🔧 Backend Changes**
- **`Consistent Branded Discord Cards`**
  - Render every supported platform with the same creator, engagement, content, media, and branded footer hierarchy used by FixEmbed's X cards.
  - Condense card footers into linked FixEmbed and platform labels followed by the post time.
  - Use creator avatars when available and route non-X embeds through Discord's Mastodon-compatible status discovery.
- **`Discord X Text Rendering`**
  - Preserve paragraphs and numbered lists in ActivityPub-backed X embeds.
  - Carry the complete Discord-sized post description instead of truncating it at 1,000 characters.
  - Use an author-first ActivityPub layout for X videos, with post text before engagement and the original post timestamp in the footer.
- **`Automatic X Provider Switch`**
  - Allow automatic server conversions to use FxTwitter temporarily while `/fix` and direct FixEmbed links continue exercising the first-party renderer.
- **`Workers AI Translation`**
  - Translate requested X posts with Cloudflare's M2M100 binding while retaining the original text.
  - Keep the original first-party embed when translation is unavailable instead of failing the post.
- **`Direct X GraphQL Enrichment`**
  - Use X's guest GraphQL response as the primary rich-data source, with public syndication and FxTwitter retained as successive fallbacks.
  - Advertise all media through the existing first-party ActivityPub route for Discord multi-image support.

#### **🧪 Testing**
- Added regression coverage for multi-photo carousels, translations, polls, quotes, notes/articles, Community Notes, link cards, gallery mode, and native multi-image metadata.

## v1.4.8 (07/11/2026)

#### **🔧 Enhancements**
- **`Application Emoji Integration`**
  - Added the new YouTube application emoji to service settings and status views.
  - YouTube embed branding now follows the same icon-first layout as other supported platforms.

#### **🔧 Backend Changes**
- **`Consistent Platform Branding`**
  - Routed every YouTube metadata path through the shared branded-name formatter so first-party and fallback cards stay consistent.

#### **🧪 Testing**
- Added regression coverage for the YouTube application emoji ID and branded embed header.

#### **📝 Documentation**
- Updated the website, website documentation, metadata, and README to advertise YouTube Community Post support consistently.

## v1.4.7 (07/11/2026)

#### **🚀 New Features**
- **`YouTube Community Posts`**
  - Added first-party embeds for YouTube community post links.
  - Community cards include the creator, post text, engagement stats, avatar, and the largest available image.

#### **🔧 Enhancements**
- **`Instagram Share Links`**
  - Added support for Instagram `/share/p/` and `/share/reel/` URLs.
  - Share links are resolved directly through Instagram before entering FixEmbed's existing post and reel pipeline.
- **`Tagged User Context`**
  - Messages replaced in delete mode now preserve the users tagged in the original message.
  - Preserved tags are displayed without sending duplicate mention notifications.

#### **🔧 Backend Changes**
- **`First-Party Community Post Parser`**
  - Added resilient parsing for YouTube post data and Open Graph metadata with native-link fallback behavior.
- **`Safe Mention Delivery`**
  - Extended the Discord send queue to carry explicit allowed-mention policies.
- **`Existing Server Migration`**
  - Added a one-time migration that enables YouTube community posts for existing guilds while preserving later administrator opt-outs.

#### **🧪 Testing**
- Added regression coverage for YouTube community layouts, Instagram share resolution, and tagged-user preservation.

## v1.4.6 (07/11/2026)

#### **🚀 New Features**
- **`Premium Supporters Role`**
  - Active Premium purchasers now automatically receive the `Supporters` role in the FixEmbed Support Server.
  - Subscribers who join the support server after purchasing Premium receive the role when they arrive.

#### **🔧 Enhancements**
- **`Subscription Lifecycle Sync`**
  - Existing entitlements are reconciled when the bot starts so current subscribers are recognized immediately.
  - Entitlement creation and renewal preserve the role, while expiration, deletion, and refunds remove it.

#### **🧪 Testing**
- Added regression coverage for role grants, expirations, unrelated SKUs, and subscribers outside the support server.

## v1.4.5 (07/11/2026)

#### **🚀 New Features**
- **`Top.gg Voter Role Rewards`**
  - Added a first-party Top.gg vote webhook that automatically grants the existing `Voter` role in the FixEmbed Support Server.
  - Real `vote.create` events grant the role idempotently; Top.gg test events validate the endpoint without granting rewards.

#### **🔧 Backend Changes**
- **`Secure Webhook Verification`**
  - Added raw-body HMAC SHA-256 signature verification, timestamp replay protection, payload limits, and strict FixEmbed project validation.
  - Added an authenticated Discord REST role assignment with safe handling for voters who have not joined the support server.

#### **🧪 Testing**
- Added regression coverage for rejected signatures, valid vote rewards, and non-rewarding test events.

## v1.4.4 (07/11/2026)

#### **🔧 Enhancements**
- **`Reliable Reddit Post Cards`**
  - Added a first-party recovery path through Reddit's official embed page when its legacy JSON endpoint denies access.
  - Reddit cards now preserve the actual post title, author, image, score, and comment count instead of falling back to Reddit's generic community embed.

#### **🧪 Testing**
- Added regression coverage for Reddit JSON `403` responses and official embed recovery.

## v1.4.3 (07/11/2026)

#### **🔧 Enhancements**
- **`Classic X Card Layout`**
  - Restored the familiar X presentation with engagement stats, the linked `@handle`, tweet text, and media in that order.
  - Kept the standardized duplicate-content cleanup for Instagram and other platforms while treating X as an intentional layout exception.

#### **🧪 Testing**
- Added regression coverage to preserve X handles as titles and tweet text as body copy.

## v1.4.2 (07/11/2026)

#### **🔧 Enhancements**
- **`Consistent Platform Card Layout`**
  - Standardized every platform on the same creator, content, optional description, engagement, and media hierarchy.
  - Removed creator names from the content-title position when the handle or person is already displayed above it.
  - Prevented identical titles and descriptions from rendering twice.
- **`Instagram Engagement Context`**
  - Added likes and comment counts when Instagram includes them in its first-party embed data.

#### **🔧 Backend Changes**
- **`Shared Layout Normalization`**
  - Added one renderer-level normalization policy so first-party and fallback handlers remain visually consistent.
  - Updated Instagram recovery paths to preserve creator attribution without replacing the post caption.

#### **🧪 Testing**
- Added regression coverage for duplicate creator titles, distinct descriptions, and Instagram engagement stats.

## v1.4.1 (07/11/2026)

#### **🔧 Fixes**
- **`Instagram Media Rendering`**
  - Restored media for Instagram image posts when Instagram's embed document contains captions but omits media URLs.
  - Restored playable reel video embeds through FixEmbed's media proxy when the direct Instagram response is incomplete.
  - Added separate media recovery paths for VxInstagram and KKInstagram before the existing Snapsave fallback.
  - Normalized Instagram's HTML-escaped CDN query strings so Discord receives valid media URLs instead of double-escaped links.
  - Added an embed revision parameter so Discord recrawls corrected media instead of retaining stale caption-only cards.
  - Simplified Instagram cards to show attribution and the caption once instead of repeating the same text in the title and body.

#### **🔧 Backend Changes**
- **`Instagram Regression Coverage`**
  - Added post and reel tests that prevent caption-only Instagram embeds from returning unnoticed.

## v1.4.0 (07/11/2026)

#### **🚀 New Features**
- **`Direct-First Embed Pipeline`**
  - Every supported platform now attempts an original-platform data source before any external embed service.
  - FixEmbed owns URL handling, metadata parsing, branded rendering, media proxying, error handling, and fallback selection on its Cloudflare Worker.

#### **🔧 Enhancements**
- **`Instagram and YouTube Ownership`**
  - Instagram now uses its native embed document before VxInstagram or Snapsave.
  - YouTube now uses its official oEmbed endpoint before Invidious.
- **`Pixiv and Bilibili Ownership`**
  - Pixiv and Bilibili now query their original-platform metadata endpoints before Phixiv or VxBilibili.
- **`Honest Source Reporting`**
  - Handler responses identify direct rendering as first-party and external recovery paths as fallbacks.

#### **🔧 Backend Changes**
- **`Emergency Fallback Policy`**
  - FxTwitter, VxInstagram, Snapsave, Phixiv, VxBilibili, and Invidious remain available only when their respective direct path fails.
- **`Direct-Path Regression Coverage`**
  - Added tests that verify Instagram, YouTube, Pixiv, and Bilibili contact their original platforms before external services.

## v1.3.1 (07/11/2026)

#### **🔧 Fixes**
- **`Multi-Link Automatic Conversion`**
  - Removed a deprecated `TextChannel.trigger_typing()` call that caused automatic conversion to fail when a message contained multiple supported links.
- **`Runtime Compatibility Check`**
  - Added a regression check so the unsupported discord.py API cannot return unnoticed.

## v1.3.0 (07/11/2026)

#### **🚀 New Features**
- **`First-Party X/Twitter Embeds`**
  - FixEmbed now fetches and renders X/Twitter post text, authors, media, and engagement data through its own Cloudflare Worker.
  - FxTwitter remains available only as an emergency fallback when first-party rendering cannot complete.
- **`Multi-Link /fix`**
  - `/fix` now converts every supported link in one invocation while preserving the original order.
  - Already-fixed FixEmbed, FxTwitter, and Bluesky proxy links normalize back to canonical source URLs.

#### **🔧 Enhancements**
- **`One Canonical Link Engine`**
  - Slash commands, the message context command, and automatic conversion now share the same host-safe parser, labels, suppression rules, and FixEmbed URL builder.
  - Multi-link automatic conversion sends and deletes or suppresses once per message instead of repeating those actions for each link.
- **`Honest Reliability Dashboard`**
  - Replaced synthetic uptime percentages with live first-party/fallback state, current latency, check time, and incident notices.
  - Escaped live status content before rendering it in the dashboard.
- **`Release Metadata Guard`**
  - Added an automated release check so the bot version, manifests, service package, and changelog cannot silently drift apart.

#### **🔧 Fixes**
- **`Instagram Reels`**
  - Fixed Instagram `/reels/` links across the bot and embed service.
- **`Bluesky Link Recognition`**
  - Fixed Bluesky handles ending in `x.com` being misclassified as Twitter.
  - Added support for already-fixed `bskyx.app` links.
- **`Bluesky Post Text`**
  - Preserved the full text of Bluesky posts in embeds.
- **`Discord Sharding`**
  - Enabled Discord automatic sharding so large-scale gateway startup succeeds reliably.

## v1.2.7 (03/28/2026)

#### **🚀 New Features**
- **`New Status Page`**
  - Added a public status dashboard for the embed service with per-platform uptime, latency, and incident notices.
- **`Power User Commands`**
  - Added `/delivery`, `/quality`, `/rule`, and `/status` commands for faster advanced configuration and diagnostics.

#### **🔧 Enhancements**
- **`Icons for All Services`**
  - Added or completed branded icons for every supported service.
- **`Default Conversion Behavior`**
  - Set the default delivery behavior to suppress the original embed instead of deleting the original message.
- **`Language Selection UX`**
  - Added country flags to the language selector to make multilingual settings easier to scan.
- **`Threads.com Support`**
  - Added support for `threads.com` links alongside the existing `threads.net` URLs.
- **`Opt-Out Link Handling`**
  - Respect links wrapped in angle brackets (`< >`) so users can intentionally prevent automatic conversion.
- **`Embed Service Test Coverage`**
  - Added a lightweight TypeScript test harness for service URL parsing and handler routing.
  - Added coverage for supported platform routing and Twitter redirect behavior.
- **`Node-Compatible Service Imports`**
  - Updated the Cloudflare Worker TypeScript imports to run cleanly under direct local Node-based test execution.

#### **📝 Documentation**
- **`README Updates`**
  - Updated user-facing supported service strings across all translations.

## v1.2.6 (03/15/2026)

#### **🚀 New Features**
- **`Server Subscriptions (Premium Tier)`**
  - Integrated Discord Server Subscriptions via Entitlements API.
  - New `/premium` command to view perks, status, and subscribe for $1.99/month.
  - **`Custom Embed Colors`**: Premium guilds can now set a custom branding color for bot responses via `/settings`.

#### **🔧 Enhancements**
- **`Premium Perk: Bot Compatibility`**
  - Premium servers now process and fix links sent by other bots.
- **`Premium Perk: Clean Embeds`**
  - Removed "Sent by @user" label for premium servers to provide a cleaner look.
- **`Link Suppression Logic`**
  - Improved link suppression handling—wrapping a single link in `< >` no longer suppresses other non-wrapped links in the same message.
- **`Discoverability`**
  - Added a "💎 Premium" section to the `/help` command to showcase benefits.
  - Custom branding colors now apply to all bot command embeds (`/help`, `/about`, `/settings`, debug info).

#### **🔧 Backend Changes**
- **`Database Schema Update`**
  - Added `embed_color` column to `guild_settings` to persist custom colors.
- **`Subscription Lifecycle Handling`**
  - Implemented event handlers for subscription creation, update, and expiration.
  - Added in-memory caching for guild premium status to minimize API calls.

#### **📝 Documentation**
- **`Updated translations.py`**
  - Added 24 new translation keys for premium features across all 8 supported languages.
- **`Updated README.md`**
  - Added comprehensive Premium section detailing perks and setup.
  - Documented new link suppression behavior.
