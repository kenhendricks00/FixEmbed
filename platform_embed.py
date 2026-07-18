"""Shared Components V2 composition for simple social-platform cards."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Optional
from urllib.parse import urlencode

import aiohttp
import discord

from card_preferences import CardPreferences, apply_caption_preferences
from component_emojis import format_component_stats
from embed_footer import FooterBranding, build_component_footer
from timestamp_utils import parse_post_timestamp


FIXEMBED_API = "https://fixembed.app/api/embed"
FIXEMBED_COLOR = 0x5865F2
FIXEMBED_EMOJI_ID = 1525580543503106148


@dataclass(frozen=True)
class PlatformCardSpec:
    api_name: str
    display_name: str
    color: int
    emoji: str


def build_platform_layout(
    payload: Mapping[str, Any],
    spec: PlatformCardSpec,
    converted_url: Optional[str] = None,
    footer_branding: Optional[FooterBranding] = None,
    card_preferences: Optional[CardPreferences] = None,
) -> discord.ui.LayoutView:
    """Render creator, platform context, mixed media, stats, and source details."""
    preferences = card_preferences or CardPreferences()
    source_url = str(payload.get("url") or "").strip()
    title = str(payload.get("title") or f"{spec.display_name} post").strip()
    description = str(
        payload.get("description") or payload.get("caption") or ""
    ).strip()
    description = apply_caption_preferences(description, preferences)
    if description.casefold() == title.casefold():
        description = ""
    if len(description) > 2800:
        description = f"{description[:2797].rstrip()}…"

    author_name = str(payload.get("authorName") or spec.display_name).strip()
    author_handle = str(payload.get("authorHandle") or "").strip().lstrip("@")
    author_url = str(payload.get("authorUrl") or "").strip()
    author_avatar = str(payload.get("authorAvatar") or "").strip()
    if author_handle and author_url:
        identity = f"**{author_name}** ([@{author_handle}]({author_url}))"
    elif author_url:
        identity = f"**[{author_name}]({author_url})**"
    else:
        identity = f"**{author_name}**"
    title_line = f"### [{title}]({source_url})" if source_url else f"### {title}"
    header_text = "\n".join(
        part for part in (identity, title_line, description) if part
    )

    children: list[discord.ui.Item[Any]] = []
    if author_avatar:
        children.append(
            discord.ui.Section(
                header_text,
                accessory=discord.ui.Thumbnail(
                    author_avatar,
                    description=f"{author_name} profile photo",
                ),
            )
        )
    else:
        children.append(discord.ui.TextDisplay(header_text))

    video = payload.get("video") if isinstance(payload.get("video"), Mapping) else {}
    video_url = str(video.get("url") or "").strip()
    images = payload.get("images") if isinstance(payload.get("images"), list) else []
    media_urls = [video_url] if video_url else []
    media_urls.extend(str(url).strip() for url in images if str(url).strip())
    fallback_image = str(payload.get("image") or "").strip()
    if not media_urls and fallback_image:
        media_urls.append(fallback_image)
    sensitive = payload.get("sensitive") is True
    if media_urls:
        children.append(
            discord.ui.MediaGallery(
                *(
                    discord.MediaGalleryItem(
                        url,
                        description=(description or title)[:1024],
                        spoiler=sensitive,
                    )
                    for url in dict.fromkeys(media_urls[:10])
                )
            )
        )

    stats = format_component_stats(str(payload.get("stats") or "").strip())
    if stats and preferences.show_stats:
        children.append(discord.ui.TextDisplay(f"-# {stats}"))

    children.extend(
        (
            discord.ui.Separator(),
            discord.ui.TextDisplay(
                build_component_footer(
                    fixembed_emoji=f"<:fixembed:{FIXEMBED_EMOJI_ID}>",
                    platform_emoji=spec.emoji,
                    platform_name=spec.display_name,
                    source_url=source_url,
                    converted_url=converted_url,
                    timestamp=parse_post_timestamp(payload.get("timestamp")),
                    branding=footer_branding,
                )
            ),
        )
    )
    view = discord.ui.LayoutView(timeout=None)
    view.add_item(
        discord.ui.Container(
            *children,
            accent_color=preferences.accent_or(spec.color or FIXEMBED_COLOR),
        )
    )
    return view


async def fetch_platform_payload(
    source_url: str,
    expected_platform: str,
) -> Mapping[str, Any]:
    """Fetch one validated platform payload from FixEmbed's public API."""
    query = urlencode({"url": source_url, "renderer": "components-v2"})
    timeout = aiohttp.ClientTimeout(total=15)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.get(f"{FIXEMBED_API}?{query}") as response:
            response.raise_for_status()
            body = await response.json()
    if not body.get("success") or body.get("platform") != expected_platform:
        raise ValueError(
            f"FixEmbed did not return {expected_platform.title()} metadata"
        )
    payload = body.get("data")
    return payload if isinstance(payload, Mapping) else {}
