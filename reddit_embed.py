"""Build bot-authored Reddit cards from FixEmbed metadata."""

from __future__ import annotations

from typing import Any, Mapping, Optional
from urllib.parse import urlencode

import aiohttp
import discord

from component_emojis import format_component_stats
from embed_footer import FooterBranding, build_component_footer, translated_source_name
from card_preferences import CardPreferences, apply_caption_preferences
from timestamp_utils import parse_post_timestamp


FIXEMBED_API = "https://fixembed.app/api/embed"
REDDIT_COLOR = 0xFF4500
FIXEMBED_EMOJI_ID = 1525580543503106148
REDDIT_EMOJI_ID = 1526267589808881684


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


def build_reddit_layout(
    payload: Mapping[str, Any],
    converted_url: Optional[str] = None,
    footer_branding: Optional[FooterBranding] = None,
    card_preferences: Optional[CardPreferences] = None,
) -> discord.ui.LayoutView:
    """Build a Reddit Components V2 card using only remote media URLs."""
    subreddit, post_title = _split_title(payload.get("title"))
    author = str(payload.get("authorName") or "u/unknown").strip().lstrip("@")
    author_url = str(payload.get("authorUrl") or "").strip()
    subreddit_icon = str(payload.get("authorAvatar") or "").strip()
    source_url = str(payload.get("url") or "").strip()
    sections = payload.get("sections") if isinstance(payload.get("sections"), list) else []
    linked_article = next(
        (
            section
            for section in sections
            if isinstance(section, Mapping)
            and section.get("kind") == "link-card"
            and str(section.get("url") or "").strip().startswith(("https://", "http://"))
        ),
        None,
    )
    linked_article_url = (
        str(linked_article.get("url") or "").strip() if linked_article else ""
    )

    author_text = f"[{author}]({author_url})" if author_url else author
    identity = f"**{subreddit}**  ·  Posted by {author_text}"
    preferences = card_preferences or CardPreferences()
    description = str(payload.get("description") or payload.get("caption") or "").strip()
    description = apply_caption_preferences(description, preferences)
    if len(description) > 3000:
        description = f"{description[:2997].rstrip()}…"
    title_text = (
        f"### [{post_title}]({linked_article_url})"
        if linked_article_url
        else f"### {post_title}"
    )
    header_text = "\n".join(part for part in (identity, title_text, description) if part)

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

    if linked_article_url:
        children.append(discord.ui.TextDisplay(linked_article_url))

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
                    discord.MediaGalleryItem(
                        url,
                        description=post_title[:1024] or None,
                        spoiler=payload.get("sensitive") is True,
                    )
                    for url in media_urls[:10]
                )
            )
        )

    rendered_sections = [
        _section_text(section)
        for section in sections[:4]
        if isinstance(section, Mapping) and section is not linked_article
    ]
    if rendered_sections:
        children.append(discord.ui.Separator())
        children.extend(discord.ui.TextDisplay(section) for section in rendered_sections if section)

    stats = format_component_stats(
        str(payload.get("stats") or "").strip(),
        platform="reddit",
    )
    if stats and preferences.show_stats:
        children.append(discord.ui.TextDisplay(f"-# {stats}"))

    children.append(discord.ui.Separator())
    children.append(
        discord.ui.TextDisplay(
            build_component_footer(
                fixembed_emoji=f"<:fixembed:{FIXEMBED_EMOJI_ID}>",
                platform_emoji=f"<:reddit:{REDDIT_EMOJI_ID}>",
                platform_name="Reddit",
                source_url=source_url,
                converted_url=converted_url,
                timestamp=parse_post_timestamp(payload.get("timestamp")),
                branding=footer_branding,
                translated_from=translated_source_name(payload),
            )
        )
    )

    view = discord.ui.LayoutView(timeout=None)
    view.add_item(discord.ui.Container(*children, accent_color=preferences.accent_or(REDDIT_COLOR)))
    return view


async def _fetch_reddit_payload(
    source_url: str,
    translation_language: Optional[str] = None,
) -> Mapping[str, Any]:
    query = {"url": source_url}
    if translation_language:
        query["lang"] = translation_language
    api_url = f"{FIXEMBED_API}?{urlencode(query)}"
    timeout = aiohttp.ClientTimeout(total=15)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.get(api_url) as response:
            response.raise_for_status()
            body = await response.json()

    if not body.get("success") or body.get("platform") != "reddit":
        raise ValueError("FixEmbed did not return Reddit metadata")
    return body.get("data") or {}


async def fetch_reddit_layout(
    source_url: str,
    converted_url: Optional[str] = None,
    footer_branding: Optional[FooterBranding] = None,
    card_preferences: Optional[CardPreferences] = None,
    *,
    translation_language: Optional[str] = None,
) -> discord.ui.LayoutView:
    """Fetch first-party metadata and return a Reddit Components V2 card."""
    return build_reddit_layout(
        await _fetch_reddit_payload(source_url, translation_language),
        converted_url,
        footer_branding,
        card_preferences,
    )
