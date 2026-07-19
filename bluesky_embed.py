"""Build bot-authored Bluesky cards from FixEmbed metadata."""

from __future__ import annotations

from typing import Any, Mapping, Optional
from urllib.parse import quote

import aiohttp
import discord

from component_emojis import format_component_stats
from embed_footer import FooterBranding, build_component_footer, translated_source_name
from card_preferences import CardPreferences, apply_caption_preferences
from timestamp_utils import parse_post_timestamp


FIXEMBED_API = "https://fixembed.app/api/embed"
BLUESKY_COLOR = 0x1185FE
FIXEMBED_EMOJI_ID = 1525580543503106148
BLUESKY_EMOJI_ID = 1526269663334502544


def _clean_handle(value: Any) -> str:
    return str(value or "").strip().lstrip("@")


def build_bluesky_layout(
    payload: Mapping[str, Any],
    converted_url: Optional[str] = None,
    footer_branding: Optional[FooterBranding] = None,
    card_preferences: Optional[CardPreferences] = None,
) -> discord.ui.LayoutView:
    """Build a Bluesky Components V2 card using remote media URLs."""
    raw_name = str(payload.get("authorName") or "Bluesky").strip()
    handle = _clean_handle(payload.get("authorHandle"))
    if not handle and raw_name.startswith("@"):
        handle = _clean_handle(raw_name)

    name = raw_name.lstrip("@")
    author_url = str(payload.get("authorUrl") or "").strip()
    author_avatar = str(payload.get("authorAvatar") or "").strip()
    source_url = str(payload.get("url") or "").strip()
    if handle and name.casefold() != handle.casefold():
        handle_text = f"[@{handle}]({author_url})" if author_url else f"@{handle}"
        identity = f"**{name}** ({handle_text})"
    elif handle:
        identity = f"**[@{handle}]({author_url})**" if author_url else f"**@{handle}**"
    else:
        identity = f"**{name}**"

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
    header_text = "\n".join(part for part in (identity, post_text) if part)

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

    image_urls = payload.get("images") if isinstance(payload.get("images"), list) else []
    media_urls = [str(url) for url in image_urls if url]
    fallback_image = str(payload.get("image") or "").strip()
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
                    for url in media_urls[:4]
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
                platform_emoji=f"<:bluesky:{BLUESKY_EMOJI_ID}>",
                platform_name="Bluesky",
                source_url=source_url,
                converted_url=converted_url,
                timestamp=parse_post_timestamp(payload.get("timestamp")),
                branding=footer_branding,
                translated_from=translated_source_name(payload),
            )
        )
    )

    view = discord.ui.LayoutView(timeout=None)
    view.add_item(discord.ui.Container(*children, accent_color=preferences.accent_or(BLUESKY_COLOR)))
    return view


async def _fetch_bluesky_payload(
    source_url: str,
    translation_language: Optional[str] = None,
) -> Mapping[str, Any]:
    api_url = f"{FIXEMBED_API}?url={quote(source_url, safe='')}"
    if translation_language:
        api_url += f"&lang={quote(translation_language, safe='')}"
    timeout = aiohttp.ClientTimeout(total=15)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.get(api_url) as response:
            response.raise_for_status()
            body = await response.json()

    if not body.get("success") or body.get("platform") != "bluesky":
        raise ValueError("FixEmbed did not return Bluesky metadata")
    return body.get("data") or {}


async def fetch_bluesky_layout(
    source_url: str,
    converted_url: Optional[str] = None,
    footer_branding: Optional[FooterBranding] = None,
    card_preferences: Optional[CardPreferences] = None,
    *,
    translation_language: Optional[str] = None,
) -> discord.ui.LayoutView:
    """Fetch first-party metadata and return a Bluesky Components V2 card."""
    return build_bluesky_layout(
        await _fetch_bluesky_payload(source_url, translation_language),
        converted_url,
        footer_branding,
        card_preferences,
    )
