"""Build bot-authored Bilibili video cards from FixEmbed metadata."""

from __future__ import annotations

from typing import Any, Mapping, Optional
from urllib.parse import quote

import aiohttp
import discord

from component_emojis import format_component_stats
from embed_footer import FooterBranding, build_component_footer, translated_source_name
from card_preferences import CardPreferences, apply_caption_preferences
from timestamp_utils import parse_post_timestamp


FIXEMBED_API = "https://fixembed.app/api/embed"
BILIBILI_COLOR = 0x00A1D6
FIXEMBED_EMOJI_ID = 1525580543503106148
BILIBILI_EMOJI_ID = 1526271150739423304


def build_bilibili_layout(
    payload: Mapping[str, Any],
    converted_url: Optional[str] = None,
    footer_branding: Optional[FooterBranding] = None,
    card_preferences: Optional[CardPreferences] = None,
) -> discord.ui.LayoutView:
    """Build a Bilibili Components V2 card without uploading remote media."""
    title = str(payload.get("title") or "Bilibili Video").strip()
    preferences = card_preferences or CardPreferences()
    description = str(payload.get("description") or "").strip()
    description = apply_caption_preferences(description, preferences)
    if len(description) > 2500:
        description = f"{description[:2497].rstrip()}…"

    author_name = str(payload.get("authorName") or "").strip()
    author_url = str(payload.get("authorUrl") or "").strip()
    author_avatar = str(payload.get("authorAvatar") or "").strip()
    source_url = str(payload.get("url") or "").strip()

    author_line = ""
    if author_name and author_url:
        author_line = f"**[{author_name}]({author_url})**"
    elif author_name:
        author_line = f"**{author_name}**"

    title_line = f"**[{title}]({source_url})**" if source_url else f"**{title}**"
    header_text = "\n".join(part for part in (author_line, title_line, description) if part)

    children: list[discord.ui.Item[Any]] = []
    if author_avatar:
        children.append(
            discord.ui.Section(
                header_text,
                accessory=discord.ui.Thumbnail(
                    author_avatar,
                    description=f"{author_name or 'Bilibili creator'} profile photo",
                ),
            )
        )
    else:
        children.append(discord.ui.TextDisplay(header_text))

    video = payload.get("video")
    video_url = str(video.get("url") or "") if isinstance(video, Mapping) else ""
    image_url = str(payload.get("image") or "").strip()
    media_url = video_url or image_url
    if media_url:
        children.append(
            discord.ui.MediaGallery(
                discord.MediaGalleryItem(
                    media_url,
                    description=(description or title)[:1024],
                    spoiler=payload.get("sensitive") is True,
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
                platform_emoji=f"<:bilibili:{BILIBILI_EMOJI_ID}>",
                platform_name="Bilibili",
                source_url=source_url,
                converted_url=converted_url,
                timestamp=parse_post_timestamp(payload.get("timestamp")),
                branding=footer_branding,
                translated_from=translated_source_name(payload),
            )
        )
    )

    view = discord.ui.LayoutView(timeout=None)
    view.add_item(discord.ui.Container(*children, accent_color=preferences.accent_or(BILIBILI_COLOR)))
    return view


async def _fetch_bilibili_payload(
    source_url: str,
    translation_language: Optional[str] = None,
) -> Mapping[str, Any]:
    api_url = f"{FIXEMBED_API}?url={quote(source_url, safe='')}"
    if translation_language:
        api_url += f"&lang={quote(translation_language, safe='')}"
    timeout = aiohttp.ClientTimeout(total=15)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.get(api_url) as response:
            response.raise_for_status()
            body = await response.json()

    if not body.get("success") or body.get("platform") != "bilibili":
        raise ValueError("FixEmbed did not return Bilibili metadata")
    return body.get("data") or {}


async def fetch_bilibili_layout(
    source_url: str,
    converted_url: Optional[str] = None,
    footer_branding: Optional[FooterBranding] = None,
    card_preferences: Optional[CardPreferences] = None,
    *,
    translation_language: Optional[str] = None,
) -> discord.ui.LayoutView:
    """Fetch first-party metadata and return a Bilibili Components V2 card."""
    return build_bilibili_layout(
        await _fetch_bilibili_payload(source_url, translation_language),
        converted_url,
        footer_branding,
        card_preferences,
    )
