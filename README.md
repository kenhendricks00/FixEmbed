<p align="center">
  <a href="https://github.com/kenhendricks00/FixEmbed/releases"><img src="https://raw.githubusercontent.com/kenhendricks00/FixEmbed/main/assets/banner.png" /></a>
</p>
<div align="center">
  <a href="https://discord.com/oauth2/authorize?client_id=1173820242305224764">
    <img src="https://img.shields.io/static/v1?label=Invite&message=Link&color=blue" alt="Invite Link"></a>
  <a href="https://top.gg/bot/1173820242305224764">
    <img src="https://img.shields.io/static/v1?label=Top.gg&message=Vote&color=red" alt="Top.gg"></a>
  <a href="https://github.com/kenhendricks00/FixEmbed/commits/main/">
    <img src="https://img.shields.io/github/last-commit/kenhendricks00/FixEmbed?label=Last%20Commit&color=green" alt="Last Commit"></a>
</div>
<br>
<h2> <div align="center"><b> Enhance Your Discord with Proper Embeds for Social Media Links. </b></div> </h2>

# 🛠️ Usage
Send a message containing a <code>X/Twitter</code>, <code>Instagram</code>, <code>Reddit</code>, <code>Threads</code>, <code>Pixiv</code>, <code>Bluesky</code>, <code>Bilibili</code>, <code>YouTube community post</code>, or <code>Pinterest Pin</code> link, and the bot will remove your message or just the embed and automatically convert it to its fixed link respectively, replying with the fixed link and label of who sent it.

> [!TIP]
> You can **suppress** automatic conversion for a specific link by surrounding it with `< >` (e.g., `<https://x.com/status/123...>`). FixEmbed will leave that message alone (no edits or deletions).

<p align="center">
<img src="https://raw.githubusercontent.com/kenhendricks00/FixEmbed/main/assets/header.png">
</p>

**Commands:**
- `/fix [link]` - Convert one or more links into polished FixEmbed links (works in DMs and user-installed contexts)
- `/help` - View all commands and supported services
- `/settings` - Configure bot settings for your server
- `/status` - View live first-party, fallback, and latency health for every supported platform
- `/premium` - View and manage your Premium subscription
- `/activate` / `/deactivate` - Toggle link conversion for specific channels
- **Right-click message → Apps → Fix Embed** - Convert links in any message

# 🌟 Why Choose FixEmbed?
- **Comprehensive Platform Support**: Supports X/Twitter, Instagram, Reddit, Threads, Pixiv, Bluesky, Bilibili, YouTube Community Posts, and Pinterest Pins.
- **User-Installable**: Install to your personal account and use `/fix` or the context menu anywhere—even in servers where the bot isn't added!
- **User-Friendly Configuration**: Easy setup with customizable settings for individual servers.
- **Reliable Performance**: Ensures consistent embed functionality across all platforms.
- **Live Reliability Diagnostics**: View current first-party/fallback mode and latency in Discord, with a public status dashboard and safe stale-data handling during brief probe failures.
- **Privacy-Safe Conversion Quality**: Reliability highlights local rich-card rate, link fallbacks, recent p95 build latency, and bounded failure categories without retaining links, post content, or member data.
- **Discord Delivery Diagnostics**: Reliability separates direct sends, component-to-link rescues, complete delivery failures, pending queue depth, and recent p95 delivery latency without retaining channel, message, or member data.
- **Permission-Aware Delivery**: If delete or suppress mode lacks Manage Messages, FixEmbed keeps the original and still replies with the fixed card; Settings, Debug, and Reliability explain the recovery.
- **Direct-First Embeds**: FixEmbed fetches source-platform data and renders every supported service through its own Cloudflare Worker. External embed services are used only as emergency fallbacks.
- **Richer X Posts**: First-party X embeds preserve polls, quotes, Community Notes, long-form notes/articles, link cards, videos, GIFs, and complete photo carousels.

# 📋 Key Features
1. **Multi-Platform Support**:
    - **X/Twitter**
    - **Instagram**
    - **Reddit**
    - **Threads**
    - **Pixiv**
    - **Bluesky**
    - **Bilibili**
    - **YouTube Community Posts**
    - **Pinterest Pins**
2. **User-Installable App**:
    - Install FixEmbed to your personal account
    - Use `/fix [link]` or right-click → Apps → Fix Embed anywhere
    - Works in DMs, group chats, and servers
3. **Customizable Settings**:
    - Activate or deactivate services per channel or server-wide.
4. **Direct Message Capability**:
    - Use the bot privately by sending links directly.
5. **Easy Hosting Options**:
    - Host the bot yourself using Docker.
6. **Link Suppression**:
    - Prevent automatic conversion by wrapping links in `< >`.
7. **Multi-Language Support**:
    - Available in 8 languages: English, Spanish, Portuguese, French, German, Japanese, Korean, and Chinese.
    - Change language via `/settings` → Language.

8. **X Translation**:
    - Append `/en`, `/es`, or another two-letter language code to an X status URL to include both the original and translated post text.
9. **X Layout Modifiers**:
    - Append `/gallery` for media-and-author-only cards or `/mosaic` to force native multi-image attachments.
    - Modifiers can be combined, such as `https://x.com/user/status/123/es/mosaic`.

# 💎 Premium
Make FixEmbed fit your server with **FixEmbed Premium** for **$1.99/month**. Use `/premium` in Discord to subscribe and manage your server's subscription.

**Perks include:**
- 🎨 **Custom Social Card Colors** — Choose a custom accent color for every supported Components V2 social card
- 🖼️ **Social Card Controls** — Show or hide available engagement stats and hashtags, and choose full or compact captions
- 🏷️ **Server-Branded Footers** — Display your server's current name and an optional server emoji while retaining subtle `via FixEmbed` attribution
- 🌐 **Automatic X Translations** — Choose a default language for X posts while preserving per-link translation overrides
- 🤖 **Bot and Webhook Link Fixing** — Automatically process supported links posted by bots and webhooks, not just members
- 🚫 **Member and Role Exclusions** — Exclude selected members or roles from automatic conversion while keeping manual `/fix` usage available
- 📊 **Private 30-Day Analytics** — Review aggregate rich-card and fallback counts by platform without storing URLs, post text, usernames, message IDs, or channel IDs
- ✨ **Cleaner Automatic Posts** — Remove the "Sent by" attribution for a more streamlined appearance
- 💎 **Supporters Role** — Receive the `Supporters` role in the FixEmbed Support Server while Premium is active
- ❤️ **Support FixEmbed** — Help fund hosting, maintenance, platform updates, and new features

Premium adds server customization and operational controls; media quality, playback, carousels, GIF support, and reliability fixes remain available to everyone.

# 🚀 Invite FixEmbed to Your Server
Click the following link to invite FixEmbed to your server: [Invite FixEmbed](https://discord.com/oauth2/authorize?client_id=1173820242305224764)

# 🐳 Host FixEmbed Yourself
You can host the bot yourself using Docker:
<br>
```bash
cp .env.example .env
# Fill in BOT_TOKEN and PREMIUM_SKU_ID in .env, then:
docker pull kenhendricks00/fixembed:latest
docker run --env-file .env -d kenhendricks00/fixembed:latest
```

# 💬 Support
If you need support or have any questions, you can join the [support server](https://discord.gg/QFxTAmtZdn) or open an issue on GitHub.
<br>
**Note:** If it's a technical issue, be sure to have debug info ready by using <code>/settings</code>, then click Debug.

Members of the support server automatically receive the **Voter** role after voting for FixEmbed on Top.gg.

# 🎉 Quick Links
- [Invite FixEmbed](https://discord.com/oauth2/authorize?client_id=1173820242305224764)
- [Vote for FixEmbed on Top.gg](https://top.gg/bot/1173820242305224764)
- [Star our Source Code on GitHub](https://github.com/kenhendricks00/FixEmbed)
- [Join the Support Server](https://discord.gg/QFxTAmtZdn)

# 📜 Credits
- Built with [Hono](https://hono.dev/) framework
- Deployed on [Cloudflare Workers](https://workers.cloudflare.com/)

## Fallback services & acknowledgements

FixEmbed uses first-party platform data whenever available. When a platform blocks or limits access, it may use:

- [FxTwitter](https://github.com/FxEmbed/FxEmbed) — X metadata fallback
- [VxInstagram](https://github.com/Lainmode/InstagramEmbed-vxinstagram) — Instagram fallback
- [KKInstagram](https://kkinstagram.com) — Instagram media fallback
- [SnapSave](https://snapsave.app) — Instagram media recovery
- [Phixiv](https://github.com/thelaao/phixiv) — Pixiv fallback
- [VxBilibili](https://github.com/niconi21/vxBilibili) — Bilibili fallback

These services are not affiliated with or endorsed by FixEmbed.

# License

Copyright (c) 2024-2026 Kenneth Hendricks.

FixEmbed is licensed under the [GNU Affero General Public License v3.0 or later](LICENSE). If you modify FixEmbed and make the modified version available to users over a network, you must offer those users the corresponding source code under the same license. Modified versions must preserve applicable legal notices and identify their changes as required by the license.
