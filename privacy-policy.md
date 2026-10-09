# FixEmbed Privacy Policy

Last updated and effective: October 9, 2026

This privacy policy applies to the Discord bot FixEmbed#5654 (application ID `1173820242305224764`) and its companion web service at fixembed.app.

## Message content

FixEmbed uses Discord's Message Content intent to read messages in server channels where it is enabled. It reads message text only to detect links to supported sites (such as X/Twitter, Instagram, Reddit, TikTok, Bluesky and others). The rest of the message is ignored.

- Message content is processed in memory and discarded. It is never written to FixEmbed's database, and the bot does not log message text.
- Direct messages are ignored.
- Detected links are used to fetch publicly available information about the linked post, either directly from the source site or through FixEmbed's own web service at fixembed.app. FixEmbed then replies with a preview card.
- To avoid posting duplicate cards, FixEmbed briefly remembers recently fixed links in memory for a few seconds. Finished preview cards may be cached for a short time at fixembed.app under hashed keys.
- Message content is not sold or shared with anyone, and it is not used to train AI or machine learning models.

## Data stored

FixEmbed stores only the settings that server admins choose, so the bot behaves the way each server configured it:

- **Server and channel settings:** server (guild) IDs and channel IDs, with each server's chosen options such as enabled sites, language, display options, and per-channel on/off, site and visibility rules.
- **Premium exclusions:** if a server's admins choose to exclude specific members or roles from automatic link fixing, FixEmbed stores those member IDs and role IDs. Members are excluded only when admins select them.
- **Premium analytics:** daily counts per server and site of how many links were fixed. These counts include no links, message content or member information, and they are deleted after 90 days.
- **Reliability telemetry:** aggregate counts, timings and error categories, kept in memory. These include no links, message content or member information.

FixEmbed does not store usernames, message content, links, or any other information about individual users beyond the excluded member IDs described above.

Premium status comes from Discord's own entitlement system. FixEmbed does not collect or process payment information.

## Sharing

The data above is used only to run FixEmbed. It is not sold or shared with anyone else.

## Removing your data

Removing FixEmbed from a server stops all processing in that server. To have stored settings or excluded member IDs deleted, or to contact me ([Kenneth Hendricks](https://github.com/kenhendricks00)), the developer of FixEmbed, for any other reason, you can mention strikermonkeyxd (<code>1121099921655865375</code>) in the official [FixEmbed Support Discord server](https://discord.gg/QFxTAmtZdn).

Also see [Discord’s Privacy Policy](https://discord.com/privacy).

Thanks for using FixEmbed!
