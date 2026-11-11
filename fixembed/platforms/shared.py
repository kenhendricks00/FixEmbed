"""Shared Components V2 composition for simple social-platform cards."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Optional

import discord

from fixembed.platforms.client import fetch_embed_payload
from fixembed.presentation.emojis import format_component_stats
from fixembed.presentation.footer import (
    FooterBranding,
    build_component_footer,
    translated_source_name,
)
from fixembed.presentation.preferences import CardPreferences, apply_caption_preferences
from fixembed.presentation.timestamps import parse_post_timestamp

FIXEMBED_COLOR = 0x5865F2
FIXEMBED_EMOJI_ID = 1525580543503106148


@dataclass(frozen=True)
class PlatformCardSpec:
    api_name: str
    display_name: str
    color: int
    emoji: str
    content_first: bool = False
    link_author_name_only: bool = False
    merge_context_with_stats: bool = False


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
    if spec.link_author_name_only and author_url:
        identity = f"**[{author_name}]({author_url})**"
    elif author_handle and author_url:
        identity = f"**{author_name}** ([@{author_handle}]({author_url}))"
    elif author_url:
        identity = f"**[{author_name}]({author_url})**"
    else:
        identity = f"**{author_name}**"
    if spec.content_first:
        header_text = "\n".join(
            part for part in (identity, description or title) if part
        )
    else:
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
    deduplicated_media_urls = list(dict.fromkeys(media_urls))
    if deduplicated_media_urls:
        spoiler = preferences.content_visibility.should_spoiler(payload)
        for start in range(0, len(deduplicated_media_urls), 10):
            gallery_urls = deduplicated_media_urls[start : start + 10]
            children.append(
                discord.ui.MediaGallery(
                    *(
                        discord.MediaGalleryItem(
                            url,
                            description=(description or title)[:1024],
                            spoiler=spoiler,
                        )
                        for url in gallery_urls
                    )
                )
            )

    context = str(payload.get("context") or "").strip()
    stats = format_component_stats(
        str(payload.get("stats") or "").strip(),
        platform=spec.api_name,
    )
    if spec.merge_context_with_stats and context:
        secondary_metadata = " · ".join(
            part
            for part in (
                stats if preferences.show_stats else "",
                context,
            )
            if part
        )
        children.append(discord.ui.TextDisplay(f"-# {secondary_metadata[:1000]}"))
        stats = ""
    elif context:
        children.append(discord.ui.TextDisplay(f"-# {context[:1000]}"))

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
                    translated_from=translated_source_name(payload),
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
    language: Optional[str] = None,
) -> Mapping[str, Any]:
    return await fetch_embed_payload(
        source_url, expected_platform, language=language, renderer="components-v2"
    )
