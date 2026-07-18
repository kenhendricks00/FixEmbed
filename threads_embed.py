"""Build bot-authored Threads cards from FixEmbed metadata."""

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
FIXEMBED_COLOR = 0x5865F2
FIXEMBED_EMOJI_ID = 1525580543503106148
THREADS_EMOJI_ID = 1526267848924725399


def _clean_handle(value: Any) -> str:
    return str(value or "").strip().lstrip("@")


def build_threads_layout(
    payload: Mapping[str, Any],
    converted_url: Optional[str] = None,
    footer_branding: Optional[FooterBranding] = None,
    card_preferences: Optional[CardPreferences] = None,
) -> discord.ui.LayoutView:
    """Build a modern Components V2 card without uploading Threads media."""
    raw_name = str(payload.get("authorName") or "Threads").strip()
    handle = _clean_handle(payload.get("authorHandle"))
    if not handle and raw_name.startswith("@"):
        handle = _clean_handle(raw_name)

    author_url = str(payload.get("authorUrl") or "").strip()
    author_avatar = str(payload.get("authorAvatar") or "").strip()
    source_url = str(payload.get("url") or "").strip()
    identity = f"@{handle}" if handle else raw_name.lstrip("@")
    author_line = f"**[{identity}]({author_url})**" if author_url else f"**{identity}**"

    preferences = card_preferences or CardPreferences()
    post_text = str(
        payload.get("caption")
        or payload.get("description")
        or payload.get("title")
        or ""
    ).strip()
    post_text = apply_caption_preferences(post_text, preferences)
    if len(post_text) > 3500:
        post_text = f"{post_text[:3497].rstrip()}…"
    header_text = "\n".join(part for part in (author_line, post_text) if part)

    children: list[discord.ui.Item[Any]] = []
    if author_avatar:
        children.append(
            discord.ui.Section(
                header_text,
                accessory=discord.ui.Thumbnail(
                    author_avatar,
                    description=f"{identity} profile photo",
                ),
            )
        )
    else:
        children.append(discord.ui.TextDisplay(header_text))

    video = payload.get("video")
    video_url = str(video.get("url") or "") if isinstance(video, Mapping) else ""
    image_urls = payload.get("images") if isinstance(payload.get("images"), list) else []
    fallback_image = str(payload.get("image") or "").strip()
    media_urls = [video_url] if video_url else [str(url) for url in image_urls if url]
    if not media_urls and fallback_image:
        media_urls = [fallback_image]

    if media_urls:
        media_description = post_text[:1024] or None
        children.append(
            discord.ui.MediaGallery(
                *(
                    discord.MediaGalleryItem(
                        url,
                        description=media_description,
                        spoiler=payload.get("sensitive") is True,
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
                platform_emoji=f"<:threads:{THREADS_EMOJI_ID}>",
                platform_name="Threads",
                source_url=source_url,
                converted_url=converted_url,
                timestamp=parse_post_timestamp(payload.get("timestamp")),
                branding=footer_branding,
            )
        )
    )

    view = discord.ui.LayoutView(timeout=None)
    view.add_item(discord.ui.Container(*children, accent_color=preferences.accent_or(FIXEMBED_COLOR)))
    return view


async def _fetch_threads_payload(source_url: str) -> Mapping[str, Any]:
    api_url = f"{FIXEMBED_API}?url={quote(source_url, safe='')}"
    timeout = aiohttp.ClientTimeout(total=15)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.get(api_url) as response:
            response.raise_for_status()
            body = await response.json()

    if not body.get("success") or body.get("platform") != "threads":
        raise ValueError("FixEmbed did not return Threads metadata")
    return body.get("data") or {}


async def fetch_threads_layout(
    source_url: str,
    converted_url: Optional[str] = None,
    footer_branding: Optional[FooterBranding] = None,
    card_preferences: Optional[CardPreferences] = None,
) -> discord.ui.LayoutView:
    """Fetch first-party metadata and return a Threads Components V2 card."""
    return build_threads_layout(
        await _fetch_threads_payload(source_url), converted_url, footer_branding, card_preferences
    )
