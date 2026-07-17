## Unreleased

## v1.5.0 (07/17/2026)

#### **Release highlights**
- Completed FixEmbed's modern Discord Components V2 overhaul across every supported social platform, settings, and informational commands.
- Brought first-party X cards to feature parity with rich quote posts, playable videos, looping GIFs, complete carousels, verification badges, translations, polls, articles, Community Notes, link cards, and original publication times.
- Added Pinterest support and expanded first-party recovery for Instagram, Reddit, Threads, Pixiv, Bluesky, Bilibili, and YouTube Community Posts.
- Introduced server-customizable Premium controls, private content-free analytics, server branding, automatic X translations, and bot/webhook conversion while keeping media quality and reliability improvements free.
- Added privacy-safe conversion and delivery diagnostics, live platform health, production conformance canaries, latency budgets, permission-aware delivery recovery, and complete SparkedHost deployment bundles.
- Added product-led personal/server installation surfaces, refreshed App Discovery marketing assets, and an onboarding DM for new server owners.
- Relicensed FixEmbed under AGPL-3.0-or-later with visible source and creator attribution across public surfaces.

#### **Server install repair**
- Fixed account/server install controls so server installation requests the required bot and application-command scopes instead of failing with "No scopes were provided."
- Requests the minimum channel, media, history, emoji, message-management, and thread permissions used by automatic Components V2 delivery.

#### **Product-led installation and discovery**
- Added distinct personal and server install paths across `/invite`, `/help`, `/about`, and the public website.
- Made personal installation the primary homepage action while preserving server installation for automatic conversion and settings.
- Added focused, indexable X/Twitter, Instagram, and Reddit landing pages plus a responsive product-proof section.
- Added allowlisted, privacy-safe install redirect attribution that records only the placement label and install context.
- Added launch copy, a demonstration storyboard, measurement guidance, and a consent-first testimonial process without adding promotional copy to social-card footers.

#### **Confirmed Discord delivery**
- Waits for queued Discord sends to finish before deleting or suppressing source messages, preserving the original whenever any replacement fails.
- Bounds every component and fallback send attempt to 15 seconds so a stalled Discord request cannot freeze the delivery queue.
- Uses a representative Instagram reel for public health checks so status reflects the format users actually depend on.

#### **Resilient live status refreshes**
- Bounded every public platform-health probe to seven seconds so one stalled upstream cannot hold the entire status report open.
- Coalesced concurrent status refreshes, reused verified reports for 60 seconds, and preserved a clearly marked recent report when an unexpected refresh fails.

#### **SparkedHost deployment integrity**
- Added a deterministic SparkedHost archive containing every root Python module and required runtime metadata, with per-file sizes and SHA-256 checksums in an embedded manifest.
- Made CI build, self-verify, and retain the complete deployment artifact so missing modules cannot hide behind partial manual uploads.

#### **Pixiv first-party reliability**
- Added a cached bot-local Pixiv metadata path so cards keep the real title, creator, profile link, high-resolution avatar, full gallery, publication time, and stats when Pixiv blocks Worker traffic.
- Added a restricted, signed FixEmbed relay contract for future Worker recovery without exposing a general-purpose URL proxy; relay startup remains explicitly opt-in until a reachable allocation is configured.
- Restored creator profile links and higher-resolution creator avatars in Phixiv recovery, validated fallback identity against the requested artwork, and restricted every media URL to trusted HTTPS proxy paths.

#### **Production latency budgets**
- Added reviewed per-card cold latency budgets to the production Components V2 canaries, with bounded over-budget degradation codes and the expected budget included in privacy-safe reports.
- Kept a single slow provider sample nonfatal so transient upstream variance stays visible without turning scheduled checks into alert noise.

#### **Bilibili cold-path latency**
- Overlapped official mobile-page recovery with the emergency BiliFix request after the direct Bilibili API is unavailable.
- Preserved first-party mobile metadata priority while allowing the fallback card to make progress during blocked official requests.

#### **Repeated-link edge caching**
- Added privacy-safe Cloudflare edge caching for successful public embed API responses, cutting repeated-link latency without caching failures.
- Isolated translations and gallery/mosaic layouts in separate hashed cache entries, kept source URLs out of cache keys, and limited freshness to five minutes.

#### **CI supply-chain hardening**
- Upgraded repository workflows to the official Node 24 action releases and pinned every third-party action to an immutable commit.
- Added a regression test that rejects floating action tags and deprecated release majors while keeping Dependabot responsible for reviewed updates.

#### **Provider recovery hardening**
- Added bounded official Pixiv oEmbed and Bilibili mobile-page recovery paths before external fallbacks when platform APIs reject Worker requests.
- Added privacy-safe first-party failure diagnostics without post identifiers or source URLs.
- Restricted the Pixiv media proxy to trusted HTTPS image hosts, validated every redirect, rejected non-image responses, and closed public access to internal diagnostic routes.

#### **Continuous embed conformance**
- Added an offline-tested semantic canary runner and reviewed production manifest covering all nine Worker platforms.
- Scheduled six-hour production checks for author, original timestamp, stats, media type, and structured-section contracts, with bounded privacy-safe reports retained for 14 days.
- Added first-party/fallback provenance to the public JSON embed API and corrected YouTube health checks to exercise community posts instead of ordinary videos.

#### **Permission-aware delivery recovery**
- Automatically falls back from delete/suppress to reply mode when Manage Messages is unavailable, preserving the fixed card instead of aborting conversion.
- Handles permission changes between preflight and Discord API calls without losing queued cards.
- Shows configured versus effective delivery behavior in Delivery settings and Debug, with privacy-safe aggregate recovery counts in Reliability.

#### **Discord delivery observability**
- Added bounded, process-local direct-delivery, link-rescue, complete-failure, pending-depth, and recent p95 delivery diagnostics.
- Replaced free-form queue exception logs with structured, privacy-safe events using fixed categories and random correlation IDs.
- Split Reliability into three explicit stages—live platform health, local card quality, and Discord delivery—and removed the ambiguous legacy process counter.

#### **Privacy-safe conversion observability**
- Added bounded, process-local rich-card quality telemetry with per-service success, link-fallback, recent p95 latency, and fixed failure categories.
- Replaced URL-bearing component-build warnings with structured fallback events containing only a random correlation ID, service, category, exception type, and duration.
- Added an actionable local card-quality section to Reliability while keeping live Worker provider health visually distinct.

#### **Live reliability diagnostics**
- Connected `/settings` Reliability and `/status` to the Worker's live per-platform first-party, fallback, outage, and latency probes.
- Added a refresh control, public dashboard shortcut, 30-second report cache, five-minute verified stale-data window, and retry cooldown after failed refreshes.
- Kept local bot delivery counters visible when live Worker health is temporarily unavailable without misreporting the platform as operational.
- Allowed up to 30 seconds for the Worker's multi-platform live probe and removed unused prefix-command parsing that logged `CommandNotFound` for manually typed slash text.

#### **Original post times**
- Standardized every social card footer to use the platform's original publication time instead of the time FixEmbed converted the link.
- Omit the time when upstream metadata does not provide a valid publication timestamp rather than displaying a misleading conversion time.

#### **Premium discovery**
- Added a restrained native Premium purchase button to `/settings` for non-subscribers while keeping social embed footers promotion-free.
- Added Premium custom footer branding with the server's live name and an optional server emoji across every Components V2 social card.
- Preserved a subtle `via FixEmbed` attribution and safely degraded to the standard footer when Premium is inactive.
- Added global social-card controls for custom accents, engagement stats, hashtags, and compact captions across every Components V2 renderer.
- Added a default X translation language with explicit per-link overrides taking priority.
- Added member and role exclusions for automatic processing, rechecking Premium entitlement on every settings mutation.
- Added private 30-day analytics backed by content-free daily aggregates with 90-day retention.

#### **Server onboarding**
- Added a one-time Components V2 welcome DM to the server owner when FixEmbed joins a guild.
- The private card confirms immediate readiness and points owners to `/settings`, `/help`, Debug, and the support server without a sales prompt.

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
  - Render animated GIF posts as real `image/gif` media in Components V2 so Discord autoplays and loops them when the viewer's client settings allow it.
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
