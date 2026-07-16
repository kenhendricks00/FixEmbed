"""Build bot-authored Pixiv artwork cards from FixEmbed metadata."""

from __future__ import annotations

import html
import logging
import re
from typing import Any, Mapping, Optional
from urllib.parse import quote, urlparse

import aiohttp
import discord

from component_emojis import format_component_stats
from embed_footer import FooterBranding, build_component_footer
from card_preferences import CardPreferences, apply_caption_preferences
from timestamp_utils import parse_post_timestamp
from pixiv_relay import PixivRelayService, UpstreamResponseError


FIXEMBED_API = "https://fixembed.app/api/embed"
PIXIV_ARTWORK_API = "https://www.pixiv.net/ajax/illust"
PIXIV_USER_API = "https://www.pixiv.net/ajax/user"
PIXIV_COLOR = 0x0096FA
FIXEMBED_EMOJI_ID = 1525580543503106148
PIXIV_EMOJI_ID = 1526268469920792577
_PIXIV_METADATA_SERVICE = PixivRelayService()


def _clean_handle(value: Any) -> str:
    return str(value or "").strip().lstrip("@")


def _escape_markdown(value: str) -> str:
    return re.sub(r"([\\`*_{}\[\]()<>#+\-.!|])", r"\\\1", value)


def _clean_description(value: Any) -> str:
    description = re.sub(r"<[^>]+>", "", str(value or ""))
    for _ in range(2):
        description = html.unescape(description)
    return description.strip()


def _format_count(value: int) -> str:
    if value >= 1_000_000:
        return f"{value / 1_000_000:.1f}".removesuffix(".0") + "M"
    if value >= 1_000:
        return f"{value / 1_000:.1f}".removesuffix(".0") + "K"
    return f"{value:,}"


def _proxy_pixiv_image(source_url: str) -> str:
    return f"https://fixembed.app/proxy/pixiv?url={quote(source_url, safe='')}"


def _trusted_pixiv_image(source_url: Any) -> str:
    if not isinstance(source_url, str) or len(source_url) > 2048:
        return ""
    try:
        parsed = urlparse(source_url)
    except ValueError:
        return ""
    hostname = (parsed.hostname or "").lower()
    if (
        parsed.scheme != "https"
        or (hostname != "i.pximg.net" and not hostname.endswith(".pximg.net"))
        or parsed.username is not None
        or parsed.password is not None
    ):
        return ""
    return source_url


def _artwork_id(source_url: str) -> str:
    match = re.search(r"(?:artworks/|illust_id=)(\d+)", source_url)
    return match.group(1) if match else ""


def _profile_image(payload: Mapping[str, Any], artwork_id: str) -> str:
    artwork = payload.get("body") if isinstance(payload.get("body"), Mapping) else {}
    direct = str(artwork.get("profileImageUrl") or "").strip()
    if direct:
        return direct
    user_illusts = artwork.get("userIllusts")
    if not isinstance(user_illusts, Mapping):
        return ""
    current = user_illusts.get(artwork_id)
    if isinstance(current, Mapping):
        current_image = str(current.get("profileImageUrl") or "").strip()
        if current_image:
            return current_image
    for work in user_illusts.values():
        if isinstance(work, Mapping):
            profile_image = str(work.get("profileImageUrl") or "").strip()
            if profile_image:
                return profile_image
    return ""


def _profile_avatar(payload: Mapping[str, Any]) -> str:
    profile = payload.get("body") if isinstance(payload.get("body"), Mapping) else {}
    return str(profile.get("imageBig") or profile.get("image") or "").strip()


def _creator_user_id(payload: Mapping[str, Any]) -> str:
    artwork = payload.get("body") if isinstance(payload.get("body"), Mapping) else {}
    user_id = str(artwork.get("userId") or "").strip()
    return user_id if user_id.isdigit() else ""


def _merge_creator_identity(
    fallback_data: Mapping[str, Any],
    pixiv_payload: Mapping[str, Any],
) -> dict[str, Any]:
    data = dict(fallback_data)
    artwork = (
        pixiv_payload.get("body")
        if isinstance(pixiv_payload.get("body"), Mapping)
        else {}
    )
    author_name = str(artwork.get("userName") or "").strip()
    author_handle = str(artwork.get("userAccount") or "").strip().lstrip("@")
    author_id = str(artwork.get("userId") or "").strip()
    if author_name:
        data["authorName"] = author_name
    if author_handle:
        data["authorHandle"] = f"@{author_handle}"
    if author_id.isdigit():
        data["authorUrl"] = f"https://www.pixiv.net/en/users/{author_id}"
    return data


def _local_metadata_card(
    payload: Mapping[str, Any], artwork_id: str
) -> dict[str, Any]:
    """Convert validated local Pixiv metadata into the shared card contract."""
    if payload.get("version") != 1 or str(payload.get("id") or "") != artwork_id:
        raise ValueError("Pixiv metadata identity did not match")
    title = str(payload.get("title") or "").strip()
    author_name = str(payload.get("authorName") or "").strip()
    author_id = str(payload.get("authorId") or "").strip()
    images = payload.get("images")
    if (
        not title
        or not author_name
        or not author_id.isdigit()
        or not isinstance(images, list)
        or not images
    ):
        raise ValueError("Pixiv metadata was incomplete")

    trusted_images = [_trusted_pixiv_image(image) for image in images[:10]]
    if not trusted_images or any(not image for image in trusted_images):
        raise ValueError("Pixiv metadata media was untrusted")

    card: dict[str, Any] = {
        "title": title,
        "description": str(payload.get("description") or "").strip(),
        "url": f"https://www.pixiv.net/artworks/{artwork_id}",
        "siteName": "FixEmbed · Pixiv",
        "authorName": author_name,
        "authorUrl": f"https://www.pixiv.net/en/users/{author_id}",
        "images": [_proxy_pixiv_image(image) for image in trusted_images],
        "timestamp": str(payload.get("timestamp") or "").strip() or None,
    }
    author_handle = _clean_handle(payload.get("authorHandle"))
    if author_handle:
        card["authorHandle"] = f"@{author_handle}"
    avatar = _trusted_pixiv_image(payload.get("authorAvatar"))
    if avatar:
        card["authorAvatar"] = _proxy_pixiv_image(avatar)

    stats_payload = payload.get("stats")
    if isinstance(stats_payload, Mapping):
        stat_parts = []
        for key, emoji in (
            ("comments", "💬"),
            ("likes", "❤️"),
            ("views", "👁️"),
            ("bookmarks", "🔖"),
        ):
            value = stats_payload.get(key)
            if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
                stat_parts.append(f"{emoji} {_format_count(value)}")
        if stat_parts:
            card["stats"] = " ".join(stat_parts)
    return card


def build_pixiv_layout(
    payload: Mapping[str, Any],
    converted_url: Optional[str] = None,
    footer_branding: Optional[FooterBranding] = None,
    card_preferences: Optional[CardPreferences] = None,
) -> discord.ui.LayoutView:
    """Build a Pixiv Components V2 card using proxied remote artwork URLs."""
    title = str(payload.get("title") or "Pixiv Artwork").strip()
    preferences = card_preferences or CardPreferences()
    description = _clean_description(payload.get("description"))
    description = apply_caption_preferences(description, preferences)
    if len(description) > 1200:
        description = f"{description[:1197].rstrip()}…"

    author_name = str(payload.get("authorName") or "Pixiv creator").strip().lstrip("@")
    author_handle = _clean_handle(payload.get("authorHandle"))
    author_url = str(payload.get("authorUrl") or "").strip()
    author_avatar = str(payload.get("authorAvatar") or "").strip()
    source_url = str(payload.get("url") or "").strip()

    escaped_author_name = _escape_markdown(author_name)
    escaped_author_handle = _escape_markdown(author_handle)
    if author_url and escaped_author_handle:
        creator_line = f"**{escaped_author_name}** ([@{escaped_author_handle}]({author_url}))"
    elif author_url:
        creator_line = f"**[{escaped_author_name}]({author_url})**"
    elif escaped_author_handle:
        creator_line = f"**{escaped_author_name} (@{escaped_author_handle})**"
    else:
        creator_line = f"**{escaped_author_name}**"
    title_line = f"**[{title}]({source_url})**" if source_url else f"**{title}**"
    header_text = "\n".join(part for part in (creator_line, title_line, description) if part)

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
    if stats and preferences.show_stats:
        children.append(discord.ui.TextDisplay(f"-# {stats}"))

    children.append(discord.ui.Separator())
    children.append(
        discord.ui.TextDisplay(
            build_component_footer(
                fixembed_emoji=f"<:fixembed:{FIXEMBED_EMOJI_ID}>",
                platform_emoji=f"<:pixiv:{PIXIV_EMOJI_ID}>",
                platform_name="Pixiv",
                source_url=source_url,
                converted_url=converted_url,
                timestamp=parse_post_timestamp(payload.get("timestamp")),
                branding=footer_branding,
            )
        )
    )

    view = discord.ui.LayoutView(timeout=None)
    view.add_item(discord.ui.Container(*children, accent_color=preferences.accent_or(PIXIV_COLOR)))
    return view


async def _fetch_pixiv_payload(source_url: str) -> Mapping[str, Any]:
    artwork_id = _artwork_id(source_url)
    if artwork_id and int(artwork_id) <= 0xFFFF_FFFF:
        try:
            local_metadata = await _PIXIV_METADATA_SERVICE.metadata(artwork_id)
            return _local_metadata_card(local_metadata, artwork_id)
        except (
            aiohttp.ClientError,
            TimeoutError,
            UpstreamResponseError,
            ValueError,
        ):
            logging.warning("pixiv_local_metadata_fetch_failed")

    api_url = (
        f"{FIXEMBED_API}?url={quote(source_url, safe='')}"
        "&renderer=components-v2"
    )
    timeout = aiohttp.ClientTimeout(total=15)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.get(api_url) as response:
            response.raise_for_status()
            body = await response.json()

        if not body.get("success") or body.get("platform") != "pixiv":
            raise ValueError("FixEmbed did not return Pixiv metadata")

        data = dict(body.get("data") or {})
        if artwork_id:
            headers = {
                "Accept": "application/json",
                "Referer": f"https://www.pixiv.net/artworks/{artwork_id}",
                "User-Agent": "Mozilla/5.0 (compatible; FixEmbed/1.0; +https://fixembed.app)",
            }
            try:
                async with session.get(
                    f"{PIXIV_ARTWORK_API}/{artwork_id}", headers=headers
                ) as response:
                    if response.ok:
                        pixiv_payload = await response.json()
                        data = _merge_creator_identity(data, pixiv_payload)
                        avatar = _profile_image(pixiv_payload, artwork_id)
                        user_id = _creator_user_id(pixiv_payload)
                        if user_id:
                            try:
                                async with session.get(
                                    f"{PIXIV_USER_API}/{user_id}?full=1&lang=en",
                                    headers=headers,
                                ) as profile_response:
                                    if profile_response.ok:
                                        profile_payload = await profile_response.json()
                                        avatar = _profile_avatar(profile_payload) or avatar
                            except (aiohttp.ClientError, TimeoutError, ValueError):
                                pass
                        if avatar:
                            data["authorAvatar"] = _proxy_pixiv_image(avatar)
            except (aiohttp.ClientError, TimeoutError, ValueError):
                pass

    return data


async def fetch_pixiv_layout(
    source_url: str,
    converted_url: Optional[str] = None,
    footer_branding: Optional[FooterBranding] = None,
    card_preferences: Optional[CardPreferences] = None,
) -> discord.ui.LayoutView:
    """Fetch first-party metadata and return a Pixiv Components V2 card."""
    return build_pixiv_layout(
        await _fetch_pixiv_payload(source_url), converted_url, footer_branding, card_preferences
    )
