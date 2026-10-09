"""Build bot-authored X/Twitter cards from FixEmbed metadata."""

from __future__ import annotations

import re
from typing import Any, Mapping, Optional
from urllib.parse import urlencode

import aiohttp
import discord

from component_emojis import application_emoji, format_component_stats
from embed_footer import FooterBranding, build_component_footer, translated_source_name
from card_preferences import CardPreferences, apply_caption_preferences
from markdown_safety import masked_link
from timestamp_utils import parse_post_timestamp
from unavailable_card import build_unavailable_post_layout, is_unavailable_post_payload


FIXEMBED_API = "https://fixembed.app/api/embed"
FIXEMBED_COLOR = 0x5865F2
FIXEMBED_EMOJI_ID = 1525580543503106148
TWITTER_EMOJI_ID = 1526268173589155921


def _verification_emoji(value: Any) -> str:
    emoji_name = {
        "government": "x_government",
        "premium": "x_premium",
        "organization": "x_organization",
    }.get(str(value or "").strip().casefold())
    return f" {application_emoji(emoji_name)}" if emoji_name else ""


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


def _section_text(section: Mapping[str, Any]) -> str:
    title = str(section.get("title") or "Details").strip()
    url = str(section.get("url") or "").strip()
    body = str(section.get("body") or "").strip()
    if len(body) > 900:
        body = f"{body[:897].rstrip()}…"
    heading = f"### {masked_link(title, url)}" if url else f"### {title}"
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


def _media_description(
    data: Mapping[str, Any],
    index: int,
    media_type: Optional[str],
    author_name: str,
    total: int,
    *,
    include_platform: bool,
) -> str:
    """Prefer source-authored alt text, then use a concise honest label."""
    descriptions = data.get("mediaDescriptions")
    if isinstance(descriptions, list) and index < len(descriptions):
        source_description = str(descriptions[index] or "").strip()
        if source_description:
            return source_description[:1024]

    if media_type == "gif":
        media_label = "Animated GIF"
    elif media_type == "video":
        media_label = "X video" if include_platform else "Video"
    else:
        media_label = "X image" if include_platform else "Image"
    position = f" {index + 1} of {total}" if include_platform and total > 1 else ""
    return f"{media_label}{position} from {author_name}"[:1024]


def _quote_section_items(
    section: Mapping[str, Any],
    preferences: CardPreferences,
) -> list[discord.ui.Item[Any]]:
    fallback_name = re.sub(
        r"^quoted(?:\s+post)?\s*",
        "",
        str(section.get("title") or ""),
        flags=re.IGNORECASE,
    ).strip()
    name = str(section.get("authorName") or fallback_name or "Quoted author")
    name = name.strip().lstrip("@")
    handle = _clean_handle(section.get("authorHandle"))
    author_url = str(section.get("authorUrl") or "").strip()
    avatar = _high_resolution_avatar(section.get("authorAvatar"))
    verification = _verification_emoji(section.get("authorVerification"))

    if handle and author_url:
        identity = f"**{name}**{verification} ({masked_link('@' + handle, author_url)})"
    elif handle:
        identity = f"**{name}**{verification} (@{handle})"
    else:
        identity = f"**{name}**{verification}"

    quote_url = str(section.get("url") or "").strip()
    quote_label = f"[Quote from]({quote_url})" if quote_url else "Quote from"
    body = str(section.get("body") or "").strip()
    if len(body) > 900:
        body = f"{body[:897].rstrip()}…"
    heading = f"> {application_emoji('quote')} {quote_label} {identity}"
    quoted_body = "\n".join(
        f"> {line}" if line else "> \u200b" for line in body.splitlines()
    )
    text = f"{heading}\n> \u200b\n{quoted_body}" if quoted_body else heading
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
        total_media = len(media)
        items.append(
            discord.ui.MediaGallery(
                *(
                    discord.MediaGalleryItem(
                        url,
                        description=_media_description(
                            section,
                            index,
                            media_type,
                            name,
                            total_media,
                            include_platform=False,
                        ),
                        spoiler=preferences.content_visibility.should_spoiler(section),
                    )
                    for index, (url, media_type) in enumerate(media)
                )
            )
        )
    return items


def build_twitter_layout(
    payload: Mapping[str, Any],
    converted_url: Optional[str] = None,
    footer_branding: Optional[FooterBranding] = None,
    card_preferences: Optional[CardPreferences] = None,
) -> discord.ui.LayoutView:
    """Build a modern Components V2 card without uploading tweet media."""
    if is_unavailable_post_payload(payload):
        return build_unavailable_post_layout(
            payload,
            platform_name="X",
            platform_emoji=f"<:twitter:{TWITTER_EMOJI_ID}>",
            accent_color=FIXEMBED_COLOR,
            converted_url=converted_url,
            footer_branding=footer_branding,
            card_preferences=card_preferences,
        )
    name = str(payload.get("authorName") or "X").strip().lstrip("@")
    handle = _clean_handle(payload.get("authorHandle"))
    author_url = str(payload.get("authorUrl") or "").strip()
    author_avatar = _high_resolution_avatar(payload.get("authorAvatar"))
    verification = _verification_emoji(payload.get("authorVerification"))
    source_url = str(payload.get("url") or "").strip()

    if handle and author_url:
        identity = f"**{name}**{verification} ({masked_link('@' + handle, author_url)})"
    elif handle:
        identity = f"**{name}**{verification} (@{handle})"
    else:
        identity = f"**{name}**{verification}"

    preferences = card_preferences or CardPreferences()
    description = str(payload.get("description") or payload.get("caption") or "").strip()
    description = apply_caption_preferences(description, preferences)
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
        total_media = len(media)
        children.append(
            discord.ui.MediaGallery(
                *(
                    discord.MediaGalleryItem(
                        url,
                        description=_media_description(
                            payload,
                            index,
                            media_type,
                            name,
                            total_media,
                            include_platform=True,
                        ),
                        spoiler=preferences.content_visibility.should_spoiler(payload),
                    )
                    for index, (url, media_type) in enumerate(media)
                )
            )
        )

    sections = payload.get("sections") if isinstance(payload.get("sections"), list) else []
    rendered_sections: list[discord.ui.Item[Any]] = []
    for section in sections[:6]:
        if not isinstance(section, Mapping):
            continue
        if section.get("kind") == "quote":
            rendered_sections.extend(_quote_section_items(section, preferences))
        else:
            section_text = _section_text(section)
            if section_text:
                rendered_sections.append(discord.ui.TextDisplay(section_text))
    if rendered_sections:
        children.append(discord.ui.Separator())
        children.extend(rendered_sections)

    stats = format_component_stats(str(payload.get("stats") or "").strip())
    if stats and preferences.show_stats:
        children.append(discord.ui.TextDisplay(f"-# {stats}"))

    children.append(discord.ui.Separator())
    children.append(
        discord.ui.TextDisplay(
            build_component_footer(
                fixembed_emoji=f"<:fixembed:{FIXEMBED_EMOJI_ID}>",
                platform_emoji=f"<:twitter:{TWITTER_EMOJI_ID}>",
                platform_name="X",
                source_url=source_url,
                converted_url=converted_url,
                timestamp=parse_post_timestamp(payload.get("timestamp")),
                branding=footer_branding,
                translated_from=translated_source_name(payload),
            )
        )
    )

    view = discord.ui.LayoutView(timeout=None)
    view.add_item(
        discord.ui.Container(
            *children, accent_color=preferences.accent_or(FIXEMBED_COLOR)
        )
    )
    return view


async def fetch_twitter_payload(
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
    footer_branding: Optional[FooterBranding] = None,
    card_preferences: Optional[CardPreferences] = None,
) -> discord.ui.LayoutView:
    """Fetch first-party metadata and return an X Components V2 card."""
    payload = await fetch_twitter_payload(source_url, language, mode)
    return build_twitter_layout(
        payload, converted_url, footer_branding, card_preferences
    )
