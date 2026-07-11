# FixEmbed Product Direction

## Problem Statement

How might we make social links on Discord consistently look excellent without requiring members to remember proxy domains or administrators to babysit another bot?

## Recommended Direction

FixEmbed should be the complete free product: install it or invoke `/fix`, paste a supported link, and get a reliable, polished embed. The $1.99 Premium tier is a patron-style server upgrade for customization and operational convenience, not a gate on platforms, embed quality, or reliability.

FixEmbed should progressively own its request routing, rendering, caching, health checks, and branding on Cloudflare. External embed services may remain as invisible emergency fallbacks while first-party handlers prove themselves, but they must not define the normal user experience.

## Key Assumptions to Validate

- [ ] Better conversion reliability and lower interaction friction increase active-server retention.
- [ ] Administrators will support the project for customization and convenience even when the core remains free.
- [ ] Cloudflare Workers can serve first-party embeds within Discord's latency and media-fetch constraints.
- [ ] A layered fallback strategy can improve independence without reducing successful conversions.

## MVP Scope

- One canonical URL parser and formatter shared by bot entry points.
- A polished `/fix` flow that handles multiple supported links and clear error states.
- First-party X/Twitter rendering through FixEmbed, with an external emergency fallback.
- Honest platform health reporting based on current probes rather than invented historical percentages.
- Automated regression, type, dependency, and deployment checks.

## Not Doing (and Why)

- Paywalling platforms or embed quality — the free product must remain complete.
- Removing every fallback immediately — reliability outranks architectural purity.
- Adding many platforms in one release — each handler needs measurable reliability first.
- Building a large analytics dashboard — begin with privacy-preserving operational counters.
- Rewriting the bot wholesale — incremental slices reduce deployment risk.

## Open Questions

- Which premium customization should follow once the free conversion path is measurably reliable?
- Which platform should become fully first-party after X/Twitter: Instagram, TikTok, or YouTube community posts?
