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
FIXEMBED_COLOR = 0x5865F2
FIXEMBED_EMOJI_ID = 1525580543503106148
INSTAGRAM_EMOJI_ID = 1486919548732051586


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


def build_instagram_layout(payload: Mapping[str, Any]) -> discord.ui.LayoutView:
    """Build an Embedded-style Components V2 card with remotely unfurled media."""
    name = str(payload.get("authorName") or "Instagram").strip().lstrip("@")
    handle = _clean_handle(payload.get("authorHandle")) or name
    author_url = str(payload.get("authorUrl") or "").strip()
    author_avatar = str(payload.get("authorAvatar") or "").strip()
    source_url = str(payload.get("url") or "").strip()

    caption = str(payload.get("description") or payload.get("title") or "")
    caption = _remove_redundant_identity(caption, name, handle)
    if len(caption) > 3500:
        caption = f"{caption[:3497].rstrip()}…"

    author_label = handle or name
    if author_url:
        author_line = f"**[{author_label}]({author_url})**"
    else:
        author_line = f"**{author_label}**"
    header_text = "\n".join(part for part in (author_line, caption) if part)

    children: list[discord.ui.Item[Any]] = []
    if author_avatar:
        children.append(
            discord.ui.Section(
                header_text,
                accessory=discord.ui.Thumbnail(author_avatar, description=f"{author_label} profile photo"),
            )
        )
    else:
        children.append(discord.ui.TextDisplay(header_text))

    video = payload.get("video")
    video_url = str(video.get("url") or "") if isinstance(video, Mapping) else ""
    image_urls = payload.get("images") if isinstance(payload.get("images"), list) else []
    fallback_image = str(payload.get("image") or "")
    media_urls = [video_url] if video_url else [str(url) for url in image_urls if url]
    if not media_urls and fallback_image:
        media_urls = [fallback_image]
    if media_urls:
        description = caption[:1024] or None
        children.append(
            discord.ui.MediaGallery(
                *(discord.MediaGalleryItem(url, description=description) for url in media_urls[:10])
            )
        )

    stats = str(payload.get("stats") or "").strip()
    if stats:
        children.append(discord.ui.TextDisplay(f"-# {stats}"))

    children.append(discord.ui.Separator())
    footer_parts = [
        f"<:fixembed:{FIXEMBED_EMOJI_ID}> FixEmbed",
        f"<:instagram:{INSTAGRAM_EMOJI_ID}> Instagram",
    ]
    if source_url:
        footer_parts.append(f"[View original]({source_url})")
    footer_parts.append(f"<t:{int(datetime.now(timezone.utc).timestamp())}:R>")
    children.append(discord.ui.TextDisplay(f"-# {'  ·  '.join(footer_parts)}"))

    view = discord.ui.LayoutView(timeout=None)
    view.add_item(discord.ui.Container(*children, accent_color=FIXEMBED_COLOR))
    return view


async def _fetch_instagram_payload(source_url: str) -> Mapping[str, Any]:
    api_url = f"{FIXEMBED_API}?url={quote(source_url, safe='')}"
    timeout = aiohttp.ClientTimeout(total=15)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.get(api_url) as response:
            response.raise_for_status()
            body = await response.json()

    if not body.get("success") or body.get("platform") != "instagram":
        raise ValueError("FixEmbed did not return Instagram metadata")
    return body.get("data") or {}


async def fetch_instagram_card(
    source_url: str,
    footer_icon_url: Optional[str] = None,
) -> InstagramCard:
    """Fetch first-party metadata and return an exact Instagram card."""
    return build_instagram_card(await _fetch_instagram_payload(source_url), footer_icon_url)


async def fetch_instagram_layout(source_url: str) -> discord.ui.LayoutView:
    """Fetch first-party metadata and return a playable Components V2 card."""
    return build_instagram_layout(await _fetch_instagram_payload(source_url))


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
