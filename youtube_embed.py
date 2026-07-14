"""Build bot-authored YouTube community-post cards from FixEmbed metadata."""

from __future__ import annotations

from typing import Any, Mapping, Optional
from urllib.parse import quote

import aiohttp
import discord

from component_emojis import format_component_stats
from embed_footer import FooterBranding, build_component_footer
from card_preferences import CardPreferences, apply_caption_preferences
from timestamp_utils import parse_post_timestamp


FIXEMBED_API = "https://fixembed.app/api/embed"
YOUTUBE_COLOR = 0xFF0033
FIXEMBED_EMOJI_ID = 1525580543503106148
YOUTUBE_EMOJI_ID = 1526267390592290926


def build_youtube_community_layout(
    payload: Mapping[str, Any],
    converted_url: Optional[str] = None,
    footer_branding: Optional[FooterBranding] = None,
    card_preferences: Optional[CardPreferences] = None,
) -> discord.ui.LayoutView:
    """Build a YouTube community-post Components V2 card from remote media."""
    preferences = card_preferences or CardPreferences()
    description = str(payload.get("description") or "").strip()
    description = apply_caption_preferences(description, preferences)
    if len(description) > 2500:
        description = f"{description[:2497].rstrip()}…"

    author_name = str(payload.get("authorName") or "").strip()
    author_url = str(payload.get("authorUrl") or "").strip()
    author_avatar = str(payload.get("authorAvatar") or "").strip()
    source_url = str(payload.get("url") or "").strip()

    if author_name and author_url:
        author_line = f"**[{author_name}]({author_url})**"
    elif author_name:
        author_line = f"**{author_name}**"
    else:
        author_line = ""
    header_text = "\n".join(part for part in (author_line, description) if part)
    if not header_text:
        header_text = "**YouTube community post**"

    children: list[discord.ui.Item[Any]] = []
    if author_avatar:
        children.append(
            discord.ui.Section(
                header_text,
                accessory=discord.ui.Thumbnail(
                    author_avatar,
                    description=f"{author_name or 'YouTube creator'} profile photo",
                ),
            )
        )
    else:
        children.append(discord.ui.TextDisplay(header_text))

    image_urls = payload.get("images") if isinstance(payload.get("images"), list) else []
    media_urls = [str(url).strip() for url in image_urls if str(url).strip()]
    fallback_image = str(payload.get("image") or "").strip()
    if not media_urls and fallback_image:
        media_urls = [fallback_image]
    if media_urls:
        children.append(
            discord.ui.MediaGallery(
                *(
                    discord.MediaGalleryItem(
                        url,
                        description=(description or "YouTube community post")[:1024],
                    )
                    for url in media_urls[:10]
                )
            )
        )

    stats = format_component_stats(str(payload.get("stats") or "").strip())
    if stats and preferences.show_stats:
        children.append(discord.ui.TextDisplay(f"-# {stats}"))

    children.append(discord.ui.Separator())
    children.append(
        discord.ui.TextDisplay(
            build_component_footer(
                fixembed_emoji=f"<:fixembed:{FIXEMBED_EMOJI_ID}>",
                platform_emoji=f"<:youtube:{YOUTUBE_EMOJI_ID}>",
                platform_name="YouTube",
                source_url=source_url,
                converted_url=converted_url,
                timestamp=parse_post_timestamp(payload.get("timestamp")),
                branding=footer_branding,
            )
        )
    )

    view = discord.ui.LayoutView(timeout=None)
    view.add_item(discord.ui.Container(*children, accent_color=preferences.accent_or(YOUTUBE_COLOR)))
    return view


async def _fetch_youtube_community_payload(source_url: str) -> Mapping[str, Any]:
    api_url = f"{FIXEMBED_API}?url={quote(source_url, safe='')}&renderer=components-v2"
    timeout = aiohttp.ClientTimeout(total=15)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.get(api_url) as response:
            response.raise_for_status()
            body = await response.json()

    if not body.get("success") or body.get("platform") != "youtube":
        raise ValueError("FixEmbed did not return YouTube community-post metadata")
    return body.get("data") or {}


async def fetch_youtube_community_layout(
    source_url: str,
    converted_url: Optional[str] = None,
    footer_branding: Optional[FooterBranding] = None,
    card_preferences: Optional[CardPreferences] = None,
) -> discord.ui.LayoutView:
    """Fetch metadata and return a YouTube community-post Components V2 card."""
    payload = await _fetch_youtube_community_payload(source_url)
    return build_youtube_community_layout(payload, converted_url, footer_branding, card_preferences)
