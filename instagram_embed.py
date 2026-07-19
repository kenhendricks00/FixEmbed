"""Build exact, bot-authored Instagram cards from FixEmbed metadata."""

from __future__ import annotations

import asyncio
import io
import logging
import time
from dataclasses import dataclass
from typing import Any, Mapping, Optional, Sequence
from urllib.parse import quote, urlsplit

import aiohttp
import discord

from component_emojis import format_component_stats
from embed_footer import FooterBranding, build_component_footer, translated_source_name
from card_preferences import CardPreferences, apply_caption_preferences
from timestamp_utils import parse_post_datetime, parse_post_timestamp


FIXEMBED_API = "https://fixembed.app/api/embed"
FIXEMBED_ORIGIN = "https://fixembed.app"
INSTAGRAM_COLOR = 0xE4405F
FIXEMBED_COLOR = 0x5865F2
FIXEMBED_EMOJI_ID = 1525580543503106148
INSTAGRAM_EMOJI_ID = 1526267158793949435
INSTAGRAM_WEB_APP_ID = "936619743392459"
INSTAGRAM_PROFILE_API_HOSTS = ("www.instagram.com", "i.instagram.com")
INSTAGRAM_HD_AVATAR_COOLDOWN_SECONDS = 30 * 60
INSTAGRAM_AVATAR_ENRICHMENT_TIMEOUT_SECONDS = 1.5
INSTAGRAM_CAROUSEL_DOWNLOAD_TIMEOUT_SECONDS = 6
INSTAGRAM_CAROUSEL_MAX_ITEMS = 10
INSTAGRAM_ATTACHMENT_MAX_FILE_BYTES = 10 * 1024 * 1024
INSTAGRAM_ATTACHMENT_MAX_TOTAL_BYTES = 25 * 1024 * 1024
_instagram_avatar_blocked_until = 0.0


@dataclass(frozen=True)
class InstagramCard:
    embed: discord.Embed
    video_url: Optional[str] = None


@dataclass(frozen=True)
class InstagramDelivery:
    layout: discord.ui.LayoutView
    files: tuple[discord.File, ...] = ()


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


def _is_instagram_avatar_url(value: str) -> bool:
    try:
        parsed = urlsplit(value)
    except ValueError:
        return False
    hostname = (parsed.hostname or "").lower()
    return (
        parsed.scheme == "https"
        and not parsed.username
        and not parsed.password
        and (
            hostname.endswith(".cdninstagram.com")
            or hostname.endswith(".fbcdn.net")
            or hostname in {"cdninstagram.com", "fbcdn.net"}
        )
    )


def _relay_instagram_media_url(value: str) -> str:
    if not _is_instagram_avatar_url(value):
        return value
    return f"{FIXEMBED_ORIGIN}/proxy/instagram?url={quote(value, safe='')}"


async def _upgrade_instagram_avatar(
    payload: Mapping[str, Any],
    session: aiohttp.ClientSession,
) -> Mapping[str, Any]:
    global _instagram_avatar_blocked_until

    avatar = str(payload.get("authorAvatar") or "").strip()
    handle = _clean_handle(payload.get("authorHandle"))
    if not handle or not avatar or not any(size in avatar for size in ("s100x100", "s150x150")):
        return payload
    if time.monotonic() < _instagram_avatar_blocked_until:
        return payload

    failures = []
    for host in INSTAGRAM_PROFILE_API_HOSTS:
        profile_url = (
            f"https://{host}/api/v1/users/web_profile_info/"
            f"?username={quote(handle, safe='')}"
        )
        try:
            async with session.get(
                profile_url,
                headers={
                    "Accept": "application/json, text/plain, */*",
                    "Accept-Language": "en-US,en;q=0.9",
                    "Referer": "https://www.instagram.com/",
                    "User-Agent": (
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/136.0.0.0 Safari/537.36"
                    ),
                    "X-ASBD-ID": "129477",
                    "X-IG-App-ID": INSTAGRAM_WEB_APP_ID,
                    "X-IG-WWW-Claim": "0",
                },
                timeout=aiohttp.ClientTimeout(total=8),
            ) as response:
                if getattr(response, "status", None) == 429:
                    _instagram_avatar_blocked_until = (
                        time.monotonic() + INSTAGRAM_HD_AVATAR_COOLDOWN_SECONDS
                    )
                    logging.warning(
                        "Instagram HD avatar lookup rate limited; pausing enrichment "
                        "for 30 minutes and using metadata avatars"
                    )
                    return payload
                response.raise_for_status()
                body = await response.json(content_type=None)
            candidate = str(
                body.get("data", {}).get("user", {}).get("profile_pic_url_hd") or ""
            )
            if not _is_instagram_avatar_url(candidate):
                failures.append(f"{host}: missing valid profile_pic_url_hd")
                continue
            enriched = dict(payload)
            enriched["authorAvatar"] = candidate
            return enriched
        except (aiohttp.ClientError, TimeoutError, ValueError, TypeError, AttributeError) as error:
            failures.append(f"{host}: {type(error).__name__}: {error}")

    logging.warning(
        "Instagram HD avatar lookup failed for @%s; using metadata avatar: %s",
        handle,
        "; ".join(failures),
    )
    return payload


def build_instagram_card(
    payload: Mapping[str, Any],
    footer_icon_url: Optional[str] = None,
) -> InstagramCard:
    """Convert FixEmbed's Instagram API payload into a Discord-native card."""
    name = str(payload.get("authorName") or "Instagram").strip().lstrip("@")
    handle = _clean_handle(payload.get("authorHandle")) or name
    author_text = f"{name} (@{handle})" if handle else name

    caption = str(
        payload.get("caption")
        or payload.get("description")
        or payload.get("title")
        or ""
    )
    caption = _remove_redundant_identity(caption, name, handle)
    stats = str(payload.get("stats") or "").strip()
    description = "\n\n".join(part for part in (caption, stats) if part)
    if len(description) > 4096:
        description = f"{description[:4093].rstrip()}…"

    embed = discord.Embed(
        description=description or None,
        url=str(payload.get("url") or "") or None,
        color=INSTAGRAM_COLOR,
        timestamp=parse_post_datetime(payload.get("timestamp")),
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


def build_instagram_layout(
    payload: Mapping[str, Any],
    converted_url: Optional[str] = None,
    footer_branding: Optional[FooterBranding] = None,
    card_preferences: Optional[CardPreferences] = None,
    gallery_media_urls: Optional[Sequence[str]] = None,
) -> discord.ui.LayoutView:
    """Build an Embedded-style Components V2 card with remotely unfurled media."""
    name = str(payload.get("authorName") or "Instagram").strip().lstrip("@")
    handle = _clean_handle(payload.get("authorHandle")) or name
    author_url = str(payload.get("authorUrl") or "").strip()
    author_avatar = str(payload.get("authorAvatar") or "").strip()
    source_url = str(payload.get("url") or "").strip()

    preferences = card_preferences or CardPreferences()
    caption = str(
        payload.get("caption")
        or payload.get("description")
        or payload.get("title")
        or ""
    )
    caption = _remove_redundant_identity(caption, name, handle)
    caption = apply_caption_preferences(caption, preferences)
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
    if gallery_media_urls is not None:
        media_urls = [str(url) for url in gallery_media_urls if url]
    else:
        media_urls = [video_url] if video_url else [str(url) for url in image_urls if url]
        if not media_urls and fallback_image:
            media_urls = [fallback_image]
        media_urls = [_relay_instagram_media_url(url) for url in media_urls]
    if media_urls:
        media_kind = "video" if video_url and gallery_media_urls is None else "image"
        total_media = len(media_urls)
        for start in range(0, len(media_urls), 10):
            children.append(
                discord.ui.MediaGallery(
                    *(
                        discord.MediaGalleryItem(
                            url,
                            description=(
                                f"Instagram {media_kind} {index + 1} of {total_media}"
                            ),
                            spoiler=payload.get("sensitive") is True,
                        )
                        for index, url in enumerate(
                            media_urls[start:start + 10],
                            start=start,
                        )
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
                platform_emoji=f"<:instagram:{INSTAGRAM_EMOJI_ID}>",
                platform_name="Instagram",
                source_url=source_url,
                converted_url=converted_url,
                timestamp=parse_post_timestamp(payload.get("timestamp")),
                branding=footer_branding,
                translated_from=translated_source_name(payload),
            )
        )
    )

    view = discord.ui.LayoutView(timeout=None)
    view.add_item(discord.ui.Container(*children, accent_color=preferences.accent_or(FIXEMBED_COLOR)))
    return view


def build_instagram_delivery(
    payload: Mapping[str, Any],
    downloaded_images: Sequence[tuple[bytes, str]],
    converted_url: Optional[str] = None,
    footer_branding: Optional[FooterBranding] = None,
    card_preferences: Optional[CardPreferences] = None,
) -> InstagramDelivery:
    """Build a V2 gallery backed by message attachments."""
    image_urls = payload.get("images") if isinstance(payload.get("images"), list) else []
    if len(downloaded_images) != len(image_urls):
        raise ValueError("downloaded Instagram image count does not match carousel")

    extensions = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
        "image/gif": "gif",
    }
    files = []
    attachment_urls = []
    total_bytes = 0
    for index, (content, content_type) in enumerate(downloaded_images, start=1):
        extension = extensions.get(content_type.lower().split(";", 1)[0].strip())
        if not content or extension is None:
            raise ValueError("Instagram carousel returned an unsupported image")
        if len(content) > INSTAGRAM_ATTACHMENT_MAX_FILE_BYTES:
            raise ValueError("Instagram carousel image exceeds the attachment limit")
        total_bytes += len(content)
        if total_bytes > INSTAGRAM_ATTACHMENT_MAX_TOTAL_BYTES:
            raise ValueError("Instagram carousel exceeds the attachment limit")
        filename = f"instagram-{index:02d}.{extension}"
        files.append(discord.File(io.BytesIO(content), filename=filename))
        attachment_urls.append(f"attachment://{filename}")

    return InstagramDelivery(
        layout=build_instagram_layout(
            payload,
            converted_url,
            footer_branding,
            card_preferences,
            gallery_media_urls=attachment_urls,
        ),
        files=tuple(files),
    )


async def _download_instagram_image(
    session: aiohttp.ClientSession,
    source_url: str,
) -> tuple[bytes, str]:
    if not _is_instagram_avatar_url(source_url):
        raise ValueError("Instagram carousel returned an untrusted image URL")

    async with session.get(_relay_instagram_media_url(source_url)) as response:
        response.raise_for_status()
        content_type = str(response.headers.get("Content-Type") or "")
        normalized_type = content_type.lower().split(";", 1)[0].strip()
        if normalized_type not in {"image/jpeg", "image/png", "image/webp", "image/gif"}:
            raise ValueError("Instagram carousel returned an unsupported image")
        if (
            response.content_length is not None
            and response.content_length > INSTAGRAM_ATTACHMENT_MAX_FILE_BYTES
        ):
            raise ValueError("Instagram carousel image exceeds the attachment limit")

        content = bytearray()
        async for chunk in response.content.iter_chunked(64 * 1024):
            content.extend(chunk)
            if len(content) > INSTAGRAM_ATTACHMENT_MAX_FILE_BYTES:
                raise ValueError("Instagram carousel image exceeds the attachment limit")
        return bytes(content), normalized_type


async def _download_instagram_carousel(
    image_urls: Sequence[str],
) -> tuple[tuple[bytes, str], ...]:
    if not 2 <= len(image_urls) <= INSTAGRAM_CAROUSEL_MAX_ITEMS:
        raise ValueError("Instagram carousel attachment count is unsupported")

    timeout = aiohttp.ClientTimeout(
        total=INSTAGRAM_CAROUSEL_DOWNLOAD_TIMEOUT_SECONDS,
    )
    async with aiohttp.ClientSession(timeout=timeout) as session:
        downloads = await asyncio.gather(
            *(
                _download_instagram_image(session, str(image_url))
                for image_url in image_urls
            )
        )

    if sum(len(content) for content, _ in downloads) > INSTAGRAM_ATTACHMENT_MAX_TOTAL_BYTES:
        raise ValueError("Instagram carousel exceeds the attachment limit")
    return tuple(downloads)


async def _fetch_instagram_payload(
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

        if not body.get("success") or body.get("platform") != "instagram":
            raise ValueError("FixEmbed did not return Instagram metadata")
        payload = body.get("data") or {}
        try:
            return await asyncio.wait_for(
                _upgrade_instagram_avatar(payload, session),
                timeout=INSTAGRAM_AVATAR_ENRICHMENT_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError:
            logging.warning(
                "Instagram HD avatar lookup exceeded %.1fs; using metadata avatar",
                INSTAGRAM_AVATAR_ENRICHMENT_TIMEOUT_SECONDS,
            )
            return payload



async def fetch_instagram_card(
    source_url: str,
    footer_icon_url: Optional[str] = None,
    *,
    translation_language: Optional[str] = None,
) -> InstagramCard:
    """Fetch first-party metadata and return an exact Instagram card."""
    return build_instagram_card(
        await _fetch_instagram_payload(source_url, translation_language),
        footer_icon_url,
    )


async def fetch_instagram_layout(
    source_url: str,
    converted_url: Optional[str] = None,
    footer_branding: Optional[FooterBranding] = None,
    card_preferences: Optional[CardPreferences] = None,
    *,
    translation_language: Optional[str] = None,
) -> discord.ui.LayoutView:
    """Fetch first-party metadata and return a playable Components V2 card."""
    return build_instagram_layout(
        await _fetch_instagram_payload(source_url, translation_language),
        converted_url,
        footer_branding,
        card_preferences,
    )


async def fetch_instagram_delivery(
    source_url: str,
    converted_url: Optional[str] = None,
    footer_branding: Optional[FooterBranding] = None,
    card_preferences: Optional[CardPreferences] = None,
    *,
    translation_language: Optional[str] = None,
) -> InstagramDelivery:
    """Fetch Instagram metadata and prepare a fast Components V2 delivery."""
    payload = await _fetch_instagram_payload(source_url, translation_language)
    video = payload.get("video")
    video_url = str(video.get("url") or "") if isinstance(video, Mapping) else ""
    raw_image_urls = payload.get("images")
    image_urls = (
        [str(url) for url in raw_image_urls if url]
        if isinstance(raw_image_urls, list)
        else []
    )
    if (
        not video_url
        and 2 <= len(image_urls) <= INSTAGRAM_CAROUSEL_MAX_ITEMS
    ):
        downloads = await _download_instagram_carousel(tuple(image_urls))
        return build_instagram_delivery(
            payload,
            downloads,
            converted_url,
            footer_branding,
            card_preferences,
        )

    return InstagramDelivery(
        layout=build_instagram_layout(
            payload,
            converted_url,
            footer_branding,
            card_preferences,
        )
    )


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
