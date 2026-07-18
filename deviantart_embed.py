"""Build bot-authored DeviantArt cards from FixEmbed metadata."""

from __future__ import annotations

from typing import Any, Mapping, Optional

import discord

from card_preferences import CardPreferences
from embed_footer import FooterBranding
from platform_embed import PlatformCardSpec, build_platform_layout, fetch_platform_payload


DEVIANTART_SPEC = PlatformCardSpec(
    "deviantart",
    "DeviantArt",
    0x05CC47,
    "<:deviantart:1528150711089500180>",
)


def build_deviantart_layout(
    payload: Mapping[str, Any],
    converted_url: Optional[str] = None,
    footer_branding: Optional[FooterBranding] = None,
    card_preferences: Optional[CardPreferences] = None,
) -> discord.ui.LayoutView:
    return build_platform_layout(
        payload,
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
        await fetch_platform_payload(source_url, DEVIANTART_SPEC.api_name),
        converted_url,
        footer_branding,
        card_preferences,
    )
