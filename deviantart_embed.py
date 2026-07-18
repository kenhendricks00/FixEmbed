"""Build bot-authored DeviantArt Components V2 cards."""

from __future__ import annotations

from typing import Any, Mapping, Optional

import discord
from discord.utils import escape_markdown, escape_mentions

from card_preferences import CardPreferences
from deviantart_source import (
    fetch_deviantart_payload,
    normalize_deviantart_oembed_payload,
)
from embed_footer import FooterBranding
from platform_embed import PlatformCardSpec, build_platform_layout


DEVIANTART_SPEC = PlatformCardSpec(
    "deviantart",
    "DeviantArt",
    0x05CC47,
    "<:deviantart:1528150711089500180>",
)


def _escape_discord_text(value: Any) -> str:
    escaped = escape_mentions(escape_markdown(str(value or "")))
    return escaped.replace("<@", "<@\u200b").replace("<#", "<#\u200b")


def build_deviantart_layout(
    payload: Mapping[str, Any],
    converted_url: Optional[str] = None,
    footer_branding: Optional[FooterBranding] = None,
    card_preferences: Optional[CardPreferences] = None,
) -> discord.ui.LayoutView:
    safe_payload = dict(payload)
    for field in ("title", "description", "caption", "authorName", "context"):
        if field in safe_payload:
            safe_payload[field] = _escape_discord_text(safe_payload[field])
    return build_platform_layout(
        safe_payload,
        DEVIANTART_SPEC,
        converted_url,
        footer_branding,
        card_preferences,
    )


async def fetch_deviantart_layout(
    source_url: str,
    converted_url: Optional[str] = None,
    footer_branding: Optional[FooterBranding] = None,
    card_preferences: Optional[CardPreferences] = None,
) -> discord.ui.LayoutView:
    return build_deviantart_layout(
        await fetch_deviantart_payload(source_url),
        converted_url,
        footer_branding,
        card_preferences,
    )
