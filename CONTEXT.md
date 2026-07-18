# FixEmbed

FixEmbed turns supported public social-media links into reliable, platform-aware cards for Discord.

## Language

**Supported link**:
A public social-media content URL that FixEmbed recognizes, can retrieve safely, and can render as a useful replacement card.
_Avoid_: Supported website, supported profile

**Rich card**:
A FixEmbed-authored Discord card that preserves the source content's identity, text, media, context, engagement, publication time, and source link when available.
_Avoid_: Preview, existing embed

**Direct source**:
The source platform's documented public interface or public content response used to build a rich card.
_Avoid_: Primary scraper, native embed

**Fallback source**:
A separately validated recovery source used when the direct source cannot provide a complete rich card.
_Avoid_: Scraper, proxy

**Media relay**:
A temporary FixEmbed delivery path for source media that Discord cannot consume reliably from its original URL.
_Avoid_: Archive, media mirror

**Live canary**:
A stable public supported link used to verify that retrieval, rich-card rendering, and media delivery still work in production.
_Avoid_: Demo link, fixture
