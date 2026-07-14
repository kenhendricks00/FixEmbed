"""Build bot-authored Pinterest Pin cards from FixEmbed metadata."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Mapping, Optional
from urllib.parse import quote

import aiohttp
import discord

from embed_footer import FooterBranding, build_component_footer
from card_preferences import CardPreferences, apply_caption_preferences


FIXEMBED_API = "https://fixembed.app/api/embed"
PINTEREST_COLOR = 0xE60023
FIXEMBED_EMOJI_ID = 1525580543503106148
PINTEREST_EMOJI_ID = 1526398381415731240


def _delivery_timestamp() -> int:
    return int(datetime.now(timezone.utc).timestamp())


def build_pinterest_layout(
    payload: Mapping[str, Any],
    converted_url: Optional[str] = None,
    footer_branding: Optional[FooterBranding] = None,
    card_preferences: Optional[CardPreferences] = None,
) -> discord.ui.LayoutView:
    """Build a Pinterest Components V2 card using remote media URLs."""
    title = str(payload.get("title") or "Pinterest Pin").strip()
    preferences = card_preferences or CardPreferences()
    description = str(payload.get("description") or "").strip()
    description = apply_caption_preferences(description, preferences)
    if len(description) > 2500:
        description = f"{description[:2497].rstrip()}…"
    source_url = str(payload.get("url") or "").strip()
    author_name = str(payload.get("authorName") or "").strip()
    author_handle = str(payload.get("authorHandle") or "").strip().lstrip("@")
    author_url = str(payload.get("authorUrl") or "").strip()
    author_avatar = str(payload.get("authorAvatar") or "").strip()

    title_line = f"**[{title}]({source_url})**" if source_url else f"**{title}**"
    if author_name and author_handle and author_url:
        author_line = f"**{author_name}** ([@{author_handle}]({author_url}))"
    elif author_name and author_url:
        author_line = f"**[{author_name}]({author_url})**"
    else:
        author_line = f"**{author_name}**" if author_name else ""
    header_text = "\n".join(part for part in (author_line, title_line, description) if part)

    children: list[discord.ui.Item[Any]] = []
    if author_avatar:
        children.append(
            discord.ui.Section(
                header_text,
                accessory=discord.ui.Thumbnail(
                    author_avatar,
                    description=f"{author_name or 'Pinterest creator'} profile photo",
                ),
            )
        )
    else:
        children.append(discord.ui.TextDisplay(header_text))

    video = payload.get("video") if isinstance(payload.get("video"), Mapping) else {}
    video_url = str(video.get("url") or "").strip()
    images = payload.get("images") if isinstance(payload.get("images"), list) else []
    media_urls = [str(url).strip() for url in images if str(url).strip()]
    fallback_image = str(payload.get("image") or "").strip()
    if video_url:
        media_urls = [video_url]
    elif not media_urls and fallback_image:
        media_urls = [fallback_image]
    if media_urls:
        children.append(
            discord.ui.MediaGallery(
                *(
                    discord.MediaGalleryItem(url, description=(description or title)[:1024])
                    for url in media_urls[:10]
                )
            )
        )

    children.append(discord.ui.Separator())
    children.append(
        discord.ui.TextDisplay(
            build_component_footer(
                fixembed_emoji=f"<:fixembed:{FIXEMBED_EMOJI_ID}>",
                platform_emoji=f"<:pinterest:{PINTEREST_EMOJI_ID}>",
                platform_name="Pinterest",
                source_url=source_url,
                converted_url=converted_url,
                timestamp=_delivery_timestamp(),
                branding=footer_branding,
            )
        )
    )

    view = discord.ui.LayoutView(timeout=None)
    view.add_item(discord.ui.Container(*children, accent_color=preferences.accent_or(PINTEREST_COLOR)))
    return view


async def _fetch_pinterest_payload(source_url: str) -> Mapping[str, Any]:
    api_url = f"{FIXEMBED_API}?url={quote(source_url, safe='')}&renderer=components-v2"
    timeout = aiohttp.ClientTimeout(total=15)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.get(api_url) as response:
            response.raise_for_status()
            body = await response.json()
    if not body.get("success") or body.get("platform") != "pinterest":
        raise ValueError("FixEmbed did not return Pinterest metadata")
    return body.get("data") or {}


async def fetch_pinterest_layout(
    source_url: str,
    converted_url: Optional[str] = None,
    footer_branding: Optional[FooterBranding] = None,
    card_preferences: Optional[CardPreferences] = None,
) -> discord.ui.LayoutView:
    payload = await _fetch_pinterest_payload(source_url)
    return build_pinterest_layout(payload, converted_url, footer_branding, card_preferences)
