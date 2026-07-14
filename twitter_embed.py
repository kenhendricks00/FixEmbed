"""Build bot-authored X/Twitter cards from FixEmbed metadata."""

from __future__ import annotations

from datetime import datetime, timezone
import re
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


def _high_resolution_avatar(value: Any) -> str:
    avatar_url = str(value or "").strip()
    if not avatar_url.lower().startswith("https://pbs.twimg.com/profile_images/"):
        return avatar_url
    return re.sub(
        r"_(?:normal|bigger|mini|200x200|400x400)(?=\.[^/?#]+(?:[?#]|$))",
        "",
        avatar_url,
        count=1,
        flags=re.IGNORECASE,
    )


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


def _media_urls(data: Mapping[str, Any]) -> list[tuple[str, Optional[str]]]:
    """Return remote video/GIF and image URLs without duplicating thumbnails."""
    media: list[tuple[str, Optional[str]]] = []
    video = data.get("video")
    if isinstance(video, Mapping):
        video_url = str(video.get("url") or "").strip()
        if video_url:
            media_type = str(video.get("mediaType") or "video").lower()
            media.append((video_url, media_type))

    images = data.get("images") if isinstance(data.get("images"), list) else []
    media.extend((str(url).strip(), "image") for url in images if str(url).strip())

    fallback_image = str(data.get("image") or "").strip()
    if fallback_image and not media:
        media.append((fallback_image, "image"))
    return media[:10]


def _quote_section_items(section: Mapping[str, Any]) -> list[discord.ui.Item[Any]]:
    name = str(section.get("authorName") or "Quoted author").strip().lstrip("@")
    handle = _clean_handle(section.get("authorHandle"))
    author_url = str(section.get("authorUrl") or "").strip()
    avatar = _high_resolution_avatar(section.get("authorAvatar"))

    if handle and author_url:
        identity = f"**{name}** ([@{handle}]({author_url}))"
    elif handle:
        identity = f"**{name}** (@{handle})"
    else:
        identity = f"**{name}**"

    heading = _section_text(section).split("\n", 1)[0]
    body = str(section.get("body") or "").strip()
    if len(body) > 900:
        body = f"{body[:897].rstrip()}…"
    text = "\n".join(part for part in (heading, identity, body) if part)
    items: list[discord.ui.Item[Any]] = []
    if avatar:
        items.append(
            discord.ui.Section(
                text,
                accessory=discord.ui.Thumbnail(
                    avatar,
                    description=f"{name} profile photo",
                ),
            )
        )
    else:
        items.append(discord.ui.TextDisplay(text))

    media = _media_urls(section)
    if media:
        items.append(
            discord.ui.MediaGallery(
                *(
                    discord.MediaGalleryItem(
                        url,
                        description=(
                            f"Animated GIF from {name}"
                            if media_type == "gif"
                            else f"Media from {name}"
                        ),
                    )
                    for url, media_type in media
                )
            )
        )
    return items


def build_twitter_layout(
    payload: Mapping[str, Any],
    converted_url: Optional[str] = None,
) -> discord.ui.LayoutView:
    """Build a modern Components V2 card without uploading tweet media."""
    name = str(payload.get("authorName") or "X").strip().lstrip("@")
    handle = _clean_handle(payload.get("authorHandle"))
    author_url = str(payload.get("authorUrl") or "").strip()
    author_avatar = _high_resolution_avatar(payload.get("authorAvatar"))
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

    media = [] if payload.get("mediaOrigin") == "quote" else _media_urls(payload)

    if media:
        media_description = description[:1024] or None
        children.append(
            discord.ui.MediaGallery(
                *(
                    discord.MediaGalleryItem(url, description=media_description)
                    for url, _media_type in media
                )
            )
        )

    sections = payload.get("sections") if isinstance(payload.get("sections"), list) else []
    rendered_sections: list[discord.ui.Item[Any]] = []
    for section in sections[:6]:
        if not isinstance(section, Mapping):
            continue
        if section.get("kind") == "quote":
            rendered_sections.extend(_quote_section_items(section))
        else:
            section_text = _section_text(section)
            if section_text:
                rendered_sections.append(discord.ui.TextDisplay(section_text))
    if rendered_sections:
        children.append(discord.ui.Separator())
        children.extend(rendered_sections)

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
    if converted_url:
        footer_parts.append(f"[FixEmbed link]({converted_url})")
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
    converted_url: Optional[str] = None,
) -> discord.ui.LayoutView:
    """Fetch first-party metadata and return an X Components V2 card."""
    payload = await _fetch_twitter_payload(source_url, language, mode)
    return build_twitter_layout(payload, converted_url)
