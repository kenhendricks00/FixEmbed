## v1.2.7 (03/28/2026)

#### **New Features**
- **`Mastodon Support`**
  - Added Mastodon link conversion support across the Discord bot and embed service.
  - Supports common Mastodon post URL formats including `/@user/status`, `/users/{user}/statuses/{id}`, and `/web/statuses/{id}`.
  - Added custom Mastodon emoji support for service selectors and status displays.

#### **Enhancements**
- **`Embed Service Test Coverage`**
  - Added a lightweight TypeScript test harness for service URL parsing and handler routing.
  - Added coverage for Mastodon parsing plus existing supported platform routing and Twitter redirect behavior.
- **`Node-Compatible Service Imports`**
  - Updated the Cloudflare Worker TypeScript imports to run cleanly under direct local Node-based test execution.
- **`Status Dashboard`**
  - Added Mastodon to the public service status probes so the reliability dashboard reports its health alongside the other platforms.

#### **Documentation**
- **`README Updates`**
  - Documented Mastodon support in the bot and service READMEs.
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
