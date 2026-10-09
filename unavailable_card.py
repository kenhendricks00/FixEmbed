"""The shared "Post unavailable" card for posts a platform says are gone.

The Worker returns a FixEmbed-owned tombstone payload (no author, one
``tombstone`` section titled "Post unavailable") only when the platform itself
says the post was deleted, is protected, or its account is gone. Without it the
bot fell back to the raw or FxTwitter link, and Discord showed that site's own
"unavailable" embed instead of a FixEmbed card. Outages never produce this
payload, so a working post is never shown as unavailable.
"""

from __future__ import annotations

from typing import Any, Mapping, Optional

import discord

from card_preferences import CardPreferences
from embed_footer import FooterBranding, build_component_footer

FIXEMBED_EMOJI_ID = 1525580543503106148
DEFAULT_REASON = "This post was deleted or is no longer available."


def is_unavailable_post_payload(payload: Mapping[str, Any]) -> bool:
    """True for the Worker's "Post unavailable" payload."""
    sections = payload.get("sections") if isinstance(payload.get("sections"), list) else []
    return not str(payload.get("authorName") or "").strip() and any(
        isinstance(section, Mapping)
        and section.get("kind") == "tombstone"
        and str(section.get("title") or "").strip().casefold() == "post unavailable"
        for section in sections
    )


def build_unavailable_post_layout(
    payload: Mapping[str, Any],
    *,
    platform_name: str,
    platform_emoji: str,
    accent_color: int,
    converted_url: Optional[str] = None,
    footer_branding: Optional[FooterBranding] = None,
    card_preferences: Optional[CardPreferences] = None,
) -> discord.ui.LayoutView:
    """"**Platform** / ### Post unavailable / reason" with the normal footer."""
    reason = str(payload.get("description") or DEFAULT_REASON).strip()
    preferences = card_preferences or CardPreferences()
    children: list[discord.ui.Item[Any]] = [
        discord.ui.TextDisplay(f"**{platform_name}**\n### Post unavailable\n{reason}"),
        discord.ui.Separator(),
        discord.ui.TextDisplay(
            build_component_footer(
                fixembed_emoji=f"<:fixembed:{FIXEMBED_EMOJI_ID}>",
                platform_emoji=platform_emoji,
                platform_name=platform_name,
                source_url=str(payload.get("url") or "").strip(),
                converted_url=converted_url,
                timestamp=None,
                branding=footer_branding,
            )
        ),
    ]
    view = discord.ui.LayoutView(timeout=None)
    view.add_item(discord.ui.Container(*children, accent_color=preferences.accent_or(accent_color)))
    return view
