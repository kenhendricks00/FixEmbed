"""Build bot-authored Twitch cards from FixEmbed metadata."""

from __future__ import annotations

from typing import Any, Mapping, Optional

import discord

from card_preferences import CardPreferences
from embed_footer import FooterBranding
from platform_embed import PlatformCardSpec, build_platform_layout, fetch_platform_payload


TWITCH_SPEC = PlatformCardSpec("twitch", "Twitch", 0x9146FF, "🟣")


def build_twitch_layout(
    payload: Mapping[str, Any],
    converted_url: Optional[str] = None,
    footer_branding: Optional[FooterBranding] = None,
    card_preferences: Optional[CardPreferences] = None,
) -> discord.ui.LayoutView:
    return build_platform_layout(
        payload,
        TWITCH_SPEC,
        converted_url,
        footer_branding,
        card_preferences,
    )

async def fetch_twitch_layout(
    source_url: str,
    converted_url: Optional[str] = None,
    footer_branding: Optional[FooterBranding] = None,
    card_preferences: Optional[CardPreferences] = None,
) -> discord.ui.LayoutView:
    return build_twitch_layout(
        await fetch_platform_payload(source_url, TWITCH_SPEC.api_name),
        converted_url,
        footer_branding,
        card_preferences,
    )
