"""Build bot-authored TikTok cards from FixEmbed metadata."""

from __future__ import annotations

from typing import Any, Mapping, Optional

import discord

from card_preferences import CardPreferences
from embed_footer import FooterBranding
from platform_embed import PlatformCardSpec, build_platform_layout, fetch_platform_payload


TIKTOK_SPEC = PlatformCardSpec(
    "tiktok",
    "TikTok",
    0xFE2C55,
    "<:tiktok:1527868616215629954>",
    content_first=True,
)


def build_tiktok_layout(
    payload: Mapping[str, Any],
    converted_url: Optional[str] = None,
    footer_branding: Optional[FooterBranding] = None,
    card_preferences: Optional[CardPreferences] = None,
) -> discord.ui.LayoutView:
    return build_platform_layout(
        payload,
        TIKTOK_SPEC,
        converted_url,
        footer_branding,
        card_preferences,
    )

async def fetch_tiktok_layout(
    source_url: str,
    converted_url: Optional[str] = None,
    footer_branding: Optional[FooterBranding] = None,
    card_preferences: Optional[CardPreferences] = None,
) -> discord.ui.LayoutView:
    return build_tiktok_layout(
        await fetch_platform_payload(source_url, TIKTOK_SPEC.api_name),
        converted_url,
        footer_branding,
        card_preferences,
    )
