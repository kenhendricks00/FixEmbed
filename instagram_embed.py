"""Build exact, bot-authored Instagram cards from FixEmbed metadata."""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Mapping, Optional
from urllib.parse import quote, urlsplit

import aiohttp
import discord

from component_emojis import format_component_stats
from embed_footer import FooterBranding, build_component_footer
from card_preferences import CardPreferences, apply_caption_preferences


FIXEMBED_API = "https://fixembed.app/api/embed"
INSTAGRAM_COLOR = 0xE4405F
FIXEMBED_COLOR = 0x5865F2
FIXEMBED_EMOJI_ID = 1525580543503106148
INSTAGRAM_EMOJI_ID = 1526267158793949435
INSTAGRAM_WEB_APP_ID = "936619743392459"
INSTAGRAM_PROFILE_API_HOSTS = ("www.instagram.com", "i.instagram.com")
INSTAGRAM_HD_AVATAR_COOLDOWN_SECONDS = 30 * 60
_instagram_avatar_blocked_until = 0.0


@dataclass(frozen=True)
class InstagramCard:
    embed: discord.Embed
    video_url: Optional[str] = None


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
    return parsed.scheme == "https" and (
        hostname.endswith(".cdninstagram.com")
        or hostname.endswith(".fbcdn.net")
    )


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
        timestamp=datetime.now(timezone.utc),
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
    media_urls = [video_url] if video_url else [str(url) for url in image_urls if url]
    if not media_urls and fallback_image:
        media_urls = [fallback_image]
    if media_urls:
        description = caption[:1024] or None
        children.append(
            discord.ui.MediaGallery(
                *(discord.MediaGalleryItem(url, description=description) for url in media_urls[:10])
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
                timestamp=int(datetime.now(timezone.utc).timestamp()),
                branding=footer_branding,
            )
        )
    )

    view = discord.ui.LayoutView(timeout=None)
    view.add_item(discord.ui.Container(*children, accent_color=preferences.accent_or(FIXEMBED_COLOR)))
    return view


async def _fetch_instagram_payload(source_url: str) -> Mapping[str, Any]:
    api_url = f"{FIXEMBED_API}?url={quote(source_url, safe='')}"
    timeout = aiohttp.ClientTimeout(total=15)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.get(api_url) as response:
            response.raise_for_status()
            body = await response.json()

        if not body.get("success") or body.get("platform") != "instagram":
            raise ValueError("FixEmbed did not return Instagram metadata")
        return await _upgrade_instagram_avatar(body.get("data") or {}, session)



async def fetch_instagram_card(
    source_url: str,
    footer_icon_url: Optional[str] = None,
) -> InstagramCard:
    """Fetch first-party metadata and return an exact Instagram card."""
    return build_instagram_card(await _fetch_instagram_payload(source_url), footer_icon_url)


async def fetch_instagram_layout(
    source_url: str,
    converted_url: Optional[str] = None,
    footer_branding: Optional[FooterBranding] = None,
    card_preferences: Optional[CardPreferences] = None,
) -> discord.ui.LayoutView:
    """Fetch first-party metadata and return a playable Components V2 card."""
    return build_instagram_layout(
        await _fetch_instagram_payload(source_url), converted_url, footer_branding, card_preferences
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
