"""Build bot-authored Reddit cards from FixEmbed metadata."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Mapping
from urllib.parse import urlencode

import aiohttp
import discord

from component_emojis import format_component_stats


FIXEMBED_API = "https://fixembed.app/api/embed"
REDDIT_COLOR = 0xFF4500
FIXEMBED_EMOJI_ID = 1525580543503106148
REDDIT_EMOJI_ID = 1526267589808881684


def _post_timestamp(value: Any) -> int:
    raw = str(value or "").strip()
    if raw:
        try:
            return int(datetime.fromisoformat(raw.replace("Z", "+00:00")).timestamp())
        except ValueError:
            pass
    return int(datetime.now(timezone.utc).timestamp())


def _split_title(value: Any) -> tuple[str, str]:
    raw = str(value or "Reddit post").strip()
    subreddit, separator, title = raw.partition(" • ")
    if separator and subreddit.casefold().startswith("r/"):
        return subreddit, title
    return "Reddit", raw


def _section_text(section: Mapping[str, Any]) -> str:
    title = str(section.get("title") or "Linked content").strip()
    url = str(section.get("url") or "").strip()
    body = str(section.get("body") or "").strip()
    heading = f"### [{title}]({url})" if url else f"### {title}"
    return "\n".join(part for part in (heading, body[:900]) if part)


def build_reddit_layout(payload: Mapping[str, Any]) -> discord.ui.LayoutView:
    """Build a Reddit Components V2 card using only remote media URLs."""
    subreddit, post_title = _split_title(payload.get("title"))
    author = str(payload.get("authorName") or "u/unknown").strip().lstrip("@")
    author_url = str(payload.get("authorUrl") or "").strip()
    subreddit_icon = str(payload.get("authorAvatar") or "").strip()
    source_url = str(payload.get("url") or "").strip()

    author_text = f"[{author}]({author_url})" if author_url else author
    identity = f"**{subreddit}**  ·  Posted by {author_text}"
    description = str(payload.get("description") or payload.get("caption") or "").strip()
    if len(description) > 3000:
        description = f"{description[:2997].rstrip()}…"
    header_text = "\n".join(
        part for part in (identity, f"### {post_title}", description) if part
    )

    children: list[discord.ui.Item[Any]] = []
    if subreddit_icon:
        children.append(
            discord.ui.Section(
                header_text,
                accessory=discord.ui.Thumbnail(
                    subreddit_icon,
                    description=f"{subreddit} icon",
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
        children.append(
            discord.ui.MediaGallery(
                *(
                    discord.MediaGalleryItem(url, description=post_title[:1024] or None)
                    for url in media_urls[:10]
                )
            )
        )

    sections = payload.get("sections") if isinstance(payload.get("sections"), list) else []
    rendered_sections = [
        _section_text(section)
        for section in sections[:4]
        if isinstance(section, Mapping)
    ]
    if rendered_sections:
        children.append(discord.ui.Separator())
        children.extend(discord.ui.TextDisplay(section) for section in rendered_sections if section)

    stats = format_component_stats(
        str(payload.get("stats") or "").strip(),
        platform="reddit",
    )
    if stats:
        children.append(discord.ui.TextDisplay(f"-# {stats}"))

    children.append(discord.ui.Separator())
    footer_parts = [
        f"<:fixembed:{FIXEMBED_EMOJI_ID}> FixEmbed",
        f"<:reddit:{REDDIT_EMOJI_ID}> Reddit",
    ]
    if source_url:
        footer_parts.append(f"[View original]({source_url})")
    footer_parts.append(f"<t:{_post_timestamp(payload.get('timestamp'))}:R>")
    children.append(discord.ui.TextDisplay(f"-# {'  ·  '.join(footer_parts)}"))

    view = discord.ui.LayoutView(timeout=None)
    view.add_item(discord.ui.Container(*children, accent_color=REDDIT_COLOR))
    return view


async def _fetch_reddit_payload(source_url: str) -> Mapping[str, Any]:
    api_url = f"{FIXEMBED_API}?{urlencode({'url': source_url})}"
    timeout = aiohttp.ClientTimeout(total=15)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.get(api_url) as response:
            response.raise_for_status()
            body = await response.json()

    if not body.get("success") or body.get("platform") != "reddit":
        raise ValueError("FixEmbed did not return Reddit metadata")
    return body.get("data") or {}


async def fetch_reddit_layout(source_url: str) -> discord.ui.LayoutView:
    """Fetch first-party metadata and return a Reddit Components V2 card."""
    return build_reddit_layout(await _fetch_reddit_payload(source_url))
