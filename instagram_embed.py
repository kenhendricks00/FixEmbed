"""Build exact, bot-authored Instagram cards from FixEmbed metadata."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Mapping, Optional
from urllib.parse import quote

import aiohttp
import discord


FIXEMBED_API = "https://fixembed.app/api/embed"
INSTAGRAM_COLOR = 0xE4405F


@dataclass(frozen=True)
class InstagramCard:
    embed: discord.Embed
    video_url: Optional[str] = None


def _clean_handle(value: Any) -> str:
    return str(value or "").strip().lstrip("@")


def _remove_redundant_identity(caption: str, name: str, handle: str) -> str:
    lines = caption.strip().splitlines()
    if not lines:
        return ""

    first = lines[0].strip().lstrip("@").casefold()
    identities = {value.casefold() for value in (name, handle) if value}
    if first in identities:
        lines = lines[1:]
        while lines and not lines[0].strip():
            lines.pop(0)
    return "\n".join(lines).strip()


def build_instagram_card(
    payload: Mapping[str, Any],
    footer_icon_url: Optional[str] = None,
) -> InstagramCard:
    """Convert FixEmbed's Instagram API payload into a Discord-native card."""
    name = str(payload.get("authorName") or "Instagram").strip().lstrip("@")
    handle = _clean_handle(payload.get("authorHandle")) or name
    author_text = f"{name} (@{handle})" if handle else name

    caption = str(payload.get("description") or payload.get("title") or "")
    caption = _remove_redundant_identity(caption, name, handle)
    stats = str(payload.get("stats") or "").strip()
    description = "\n\n".join(part for part in (caption, stats) if part)
    if len(description) > 4096:
        description = f"{description[:4093].rstrip()}…"

    embed = discord.Embed(
        description=description or None,
        url=str(payload.get("url") or "") or None,
        color=INSTAGRAM_COLOR,
        timestamp=datetime.now(timezone.utc),
    )
    embed.set_author(
        name=author_text,
        url=str(payload.get("authorUrl") or "") or None,
        icon_url=str(payload.get("authorAvatar") or "") or None,
    )

    video = payload.get("video")
    video_url = video.get("url") if isinstance(video, Mapping) else None
    video_thumbnail = video.get("thumbnail") if isinstance(video, Mapping) else None
    media_url = video_thumbnail or payload.get("image")
    if media_url:
        embed.set_image(url=str(media_url))

    embed.set_footer(
        text="FixEmbed • 📷 Instagram",
        icon_url=footer_icon_url,
    )
    return InstagramCard(embed=embed, video_url=str(video_url) if video_url else None)


def build_instagram_embed(
    payload: Mapping[str, Any],
    footer_icon_url: Optional[str] = None,
) -> discord.Embed:
    """Build the card embed without downloading its optional video."""
    return build_instagram_card(payload, footer_icon_url).embed


async def fetch_instagram_card(
    source_url: str,
    footer_icon_url: Optional[str] = None,
) -> InstagramCard:
    """Fetch first-party metadata and return an exact Instagram card."""
    api_url = f"{FIXEMBED_API}?url={quote(source_url, safe='')}"
    timeout = aiohttp.ClientTimeout(total=15)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.get(api_url) as response:
            response.raise_for_status()
            body = await response.json()

    if not body.get("success") or body.get("platform") != "instagram":
        raise ValueError("FixEmbed did not return Instagram metadata")
    return build_instagram_card(body.get("data") or {}, footer_icon_url)


async def fetch_instagram_embed(
    source_url: str,
    footer_icon_url: Optional[str] = None,
) -> discord.Embed:
    """Backward-compatible embed-only metadata helper."""
    return (await fetch_instagram_card(source_url, footer_icon_url)).embed


async def download_instagram_video(video_url: str, max_bytes: int) -> Optional[bytes]:
    """Download a playable Instagram video without exceeding Discord's upload limit."""
    timeout = aiohttp.ClientTimeout(total=60)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.get(video_url) as response:
            response.raise_for_status()
            content_length = response.content_length
            if content_length is not None and content_length > max_bytes:
                return None

            video = bytearray()
            async for chunk in response.content.iter_chunked(64 * 1024):
                video.extend(chunk)
                if len(video) > max_bytes:
                    return None
            return bytes(video)
