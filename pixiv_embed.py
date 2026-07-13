"""Build bot-authored Pixiv artwork cards from FixEmbed metadata."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Mapping, Optional
from urllib.parse import quote

import aiohttp
import discord

from component_emojis import format_component_stats


FIXEMBED_API = "https://fixembed.app/api/embed"
PIXIV_COLOR = 0x0096FA
FIXEMBED_EMOJI_ID = 1525580543503106148
PIXIV_EMOJI_ID = 1526268469920792577


def _clean_handle(value: Any) -> str:
    return str(value or "").strip().lstrip("@")


def _artwork_timestamp(value: Any) -> int:
    raw = str(value or "").strip()
    if raw:
        try:
            return int(datetime.fromisoformat(raw.replace("Z", "+00:00")).timestamp())
        except ValueError:
            pass
    return int(datetime.now(timezone.utc).timestamp())


def build_pixiv_layout(
    payload: Mapping[str, Any],
    converted_url: Optional[str] = None,
) -> discord.ui.LayoutView:
    """Build a Pixiv Components V2 card using proxied remote artwork URLs."""
    title = str(payload.get("title") or "Pixiv Artwork").strip()
    description = str(payload.get("description") or "").strip()
    if len(description) > 3000:
        description = f"{description[:2997].rstrip()}…"

    author_name = str(payload.get("authorName") or "Pixiv creator").strip().lstrip("@")
    author_handle = _clean_handle(payload.get("authorHandle"))
    author_url = str(payload.get("authorUrl") or "").strip()
    source_url = str(payload.get("url") or "").strip()

    creator_label = author_name
    if author_handle and author_handle.casefold() != author_name.casefold():
        creator_label = f"{author_name} (@{author_handle})"
    creator_line = (
        f"**[{creator_label}]({author_url})**" if author_url else f"**{creator_label}**"
    )
    title_line = f"**[{title}]({source_url})**" if source_url else f"**{title}**"
    header_text = "\n".join(part for part in (creator_line, title_line, description) if part)

    children: list[discord.ui.Item[Any]] = [discord.ui.TextDisplay(header_text)]

    image_urls = payload.get("images") if isinstance(payload.get("images"), list) else []
    media_urls = [str(url) for url in image_urls if url]
    fallback_image = str(payload.get("image") or "").strip()
    if not media_urls and fallback_image:
        media_urls = [fallback_image]

    if media_urls:
        media_description = title[:1024] or None
        children.append(
            discord.ui.MediaGallery(
                *(
                    discord.MediaGalleryItem(url, description=media_description)
                    for url in media_urls[:10]
                )
            )
        )

    stats = format_component_stats(str(payload.get("stats") or "").strip())
    if stats:
        children.append(discord.ui.TextDisplay(f"-# {stats}"))

    children.append(discord.ui.Separator())
    footer_parts = [
        f"<:fixembed:{FIXEMBED_EMOJI_ID}> FixEmbed",
        f"<:pixiv:{PIXIV_EMOJI_ID}> Pixiv",
    ]
    if source_url:
        footer_parts.append(f"[View original]({source_url})")
    if converted_url:
        footer_parts.append(f"[FixEmbed link]({converted_url})")
    footer_parts.append(f"<t:{_artwork_timestamp(payload.get('timestamp'))}:R>")
    children.append(discord.ui.TextDisplay(f"-# {'  ·  '.join(footer_parts)}"))

    view = discord.ui.LayoutView(timeout=None)
    view.add_item(discord.ui.Container(*children, accent_color=PIXIV_COLOR))
    return view


async def _fetch_pixiv_payload(source_url: str) -> Mapping[str, Any]:
    api_url = f"{FIXEMBED_API}?url={quote(source_url, safe='')}"
    timeout = aiohttp.ClientTimeout(total=15)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.get(api_url) as response:
            response.raise_for_status()
            body = await response.json()

    if not body.get("success") or body.get("platform") != "pixiv":
        raise ValueError("FixEmbed did not return Pixiv metadata")
    return body.get("data") or {}


async def fetch_pixiv_layout(
    source_url: str,
    converted_url: Optional[str] = None,
) -> discord.ui.LayoutView:
    """Fetch first-party metadata and return a Pixiv Components V2 card."""
    return build_pixiv_layout(await _fetch_pixiv_payload(source_url), converted_url)
