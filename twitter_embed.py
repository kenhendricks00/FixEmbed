"""Build bot-authored X/Twitter cards from FixEmbed metadata."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Mapping, Optional
from urllib.parse import urlencode

import aiohttp
import discord

from component_emojis import format_component_stats


FIXEMBED_API = "https://fixembed.app/api/embed"
FIXEMBED_COLOR = 0x5865F2
FIXEMBED_EMOJI_ID = 1525580543503106148
TWITTER_EMOJI_ID = 1526268173589155921


def _clean_handle(value: Any) -> str:
    return str(value or "").strip().lstrip("@")


def _post_timestamp(value: Any) -> int:
    raw = str(value or "").strip()
    if raw:
        try:
            return int(datetime.fromisoformat(raw.replace("Z", "+00:00")).timestamp())
        except ValueError:
            try:
                return int(datetime.strptime(raw, "%a %b %d %H:%M:%S %z %Y").timestamp())
            except ValueError:
                pass
    return int(datetime.now(timezone.utc).timestamp())


def _section_text(section: Mapping[str, Any]) -> str:
    title = str(section.get("title") or "Details").strip()
    url = str(section.get("url") or "").strip()
    body = str(section.get("body") or "").strip()
    if len(body) > 900:
        body = f"{body[:897].rstrip()}…"
    heading = f"### [{title}]({url})" if url else f"### {title}"
    return "\n".join(part for part in (heading, body) if part)


def build_twitter_layout(payload: Mapping[str, Any]) -> discord.ui.LayoutView:
    """Build a modern Components V2 card without uploading tweet media."""
    name = str(payload.get("authorName") or "X").strip().lstrip("@")
    handle = _clean_handle(payload.get("authorHandle"))
    author_url = str(payload.get("authorUrl") or "").strip()
    author_avatar = str(payload.get("authorAvatar") or "").strip()
    source_url = str(payload.get("url") or "").strip()

    if handle and author_url:
        identity = f"**{name}** ([@{handle}]({author_url}))"
    elif handle:
        identity = f"**{name}** (@{handle})"
    else:
        identity = f"**{name}**"

    description = str(payload.get("description") or payload.get("caption") or "").strip()
    if len(description) > 3000:
        description = f"{description[:2997].rstrip()}…"
    header_text = "\n".join(part for part in (identity, description) if part)

    children: list[discord.ui.Item[Any]] = []
    if author_avatar:
        children.append(
            discord.ui.Section(
                header_text,
                accessory=discord.ui.Thumbnail(
                    author_avatar,
                    description=f"{name} profile photo",
                ),
            )
        )
    else:
        children.append(discord.ui.TextDisplay(header_text))

    video = payload.get("video")
    video_url = str(video.get("url") or "") if isinstance(video, Mapping) else ""
    image_urls = payload.get("images") if isinstance(payload.get("images"), list) else []
    fallback_image = str(payload.get("image") or "").strip()
    if video_url:
        media_urls = [video_url]
    elif image_urls:
        media_urls = [str(url) for url in image_urls if url]
    elif fallback_image:
        media_urls = [fallback_image]
    else:
        media_urls = []

    if media_urls:
        media_description = description[:1024] or None
        children.append(
            discord.ui.MediaGallery(
                *(
                    discord.MediaGalleryItem(url, description=media_description)
                    for url in media_urls[:10]
                )
            )
        )

    sections = payload.get("sections") if isinstance(payload.get("sections"), list) else []
    rendered_sections = [
        _section_text(section)
        for section in sections[:6]
        if isinstance(section, Mapping)
    ]
    if rendered_sections:
        children.append(discord.ui.Separator())
        children.extend(discord.ui.TextDisplay(section) for section in rendered_sections if section)

    stats = format_component_stats(str(payload.get("stats") or "").strip())
    if stats:
        children.append(discord.ui.TextDisplay(f"-# {stats}"))

    children.append(discord.ui.Separator())
    footer_parts = [
        f"<:fixembed:{FIXEMBED_EMOJI_ID}> FixEmbed",
        f"<:twitter:{TWITTER_EMOJI_ID}> X",
    ]
    if source_url:
        footer_parts.append(f"[View original]({source_url})")
    footer_parts.append(f"<t:{_post_timestamp(payload.get('timestamp'))}:R>")
    children.append(discord.ui.TextDisplay(f"-# {'  ·  '.join(footer_parts)}"))

    view = discord.ui.LayoutView(timeout=None)
    view.add_item(discord.ui.Container(*children, accent_color=FIXEMBED_COLOR))
    return view


async def _fetch_twitter_payload(
    source_url: str,
    language: Optional[str] = None,
    mode: Optional[str] = None,
) -> Mapping[str, Any]:
    query = {"url": source_url}
    if language:
        query["lang"] = language
    if mode:
        query["mode"] = mode
    api_url = f"{FIXEMBED_API}?{urlencode(query)}"
    timeout = aiohttp.ClientTimeout(total=15)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.get(api_url) as response:
            response.raise_for_status()
            body = await response.json()

    if not body.get("success") or body.get("platform") != "twitter":
        raise ValueError("FixEmbed did not return X metadata")
    return body.get("data") or {}


async def fetch_twitter_layout(
    source_url: str,
    language: Optional[str] = None,
    mode: Optional[str] = None,
) -> discord.ui.LayoutView:
    """Fetch first-party metadata and return an X Components V2 card."""
    payload = await _fetch_twitter_payload(source_url, language, mode)
    return build_twitter_layout(payload)
