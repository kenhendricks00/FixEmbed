"""Build bot-authored Tumblr cards from FixEmbed metadata."""

from __future__ import annotations

from typing import Any, Mapping, Optional

import discord

from card_preferences import CardPreferences
from embed_footer import FooterBranding
from platform_embed import PlatformCardSpec, build_platform_layout, fetch_platform_payload


TUMBLR_SPEC = PlatformCardSpec(
    "tumblr",
    "Tumblr",
    0x35465C,
    "<:tumblr:1527868615393546400>",
    content_first=True,
    link_author_name_only=True,
)


def build_tumblr_layout(
    payload: Mapping[str, Any],
    converted_url: Optional[str] = None,
    footer_branding: Optional[FooterBranding] = None,
    card_preferences: Optional[CardPreferences] = None,
) -> discord.ui.LayoutView:
    return build_platform_layout(
        payload,
        TUMBLR_SPEC,
        converted_url,
        footer_branding,
        card_preferences,
    )

async def fetch_tumblr_layout(
    source_url: str,
    converted_url: Optional[str] = None,
    footer_branding: Optional[FooterBranding] = None,
    card_preferences: Optional[CardPreferences] = None,
    *,
    translation_language: Optional[str] = None,
) -> discord.ui.LayoutView:
    return build_tumblr_layout(
        await fetch_platform_payload(
            source_url,
            TUMBLR_SPEC.api_name,
            translation_language,
        ),
        converted_url,
        footer_branding,
        card_preferences,
    )
