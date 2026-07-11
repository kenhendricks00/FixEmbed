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
## v1.4.1 (07/11/2026)

#### **🔧 Fixes**
- **`Instagram Media Rendering`**
  - Restored media for Instagram image posts when Instagram's embed document contains captions but omits media URLs.
  - Restored playable reel video embeds through FixEmbed's media proxy when the direct Instagram response is incomplete.
  - Added separate media recovery paths for VxInstagram and KKInstagram before the existing Snapsave fallback.

#### **🔧 Backend Changes**
- **`Instagram Regression Coverage`**
  - Added post and reel tests that prevent caption-only Instagram embeds from returning unnoticed.
