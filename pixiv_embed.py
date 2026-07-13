"""Build bot-authored Pixiv artwork cards from FixEmbed metadata."""

from __future__ import annotations

from datetime import datetime, timezone
import html
import re
from typing import Any, Mapping, Optional
from urllib.parse import quote

import aiohttp
import discord

from component_emojis import format_component_stats


FIXEMBED_API = "https://fixembed.app/api/embed"
PIXIV_ARTWORK_API = "https://www.pixiv.net/ajax/illust"
PIXIV_USER_API = "https://www.pixiv.net/ajax/user"
PIXIV_COLOR = 0x0096FA
FIXEMBED_EMOJI_ID = 1525580543503106148
PIXIV_EMOJI_ID = 1526268469920792577


def _clean_handle(value: Any) -> str:
    return str(value or "").strip().lstrip("@")


def _artwork_timestamp(value: Any) -> int:
    raw = str(value or "").strip()
    if raw:
        try:
            return int(datetime.fromisoformat(raw.replace("Z", "+00:00")).timestamp())
        except ValueError:
            pass
    return int(datetime.now(timezone.utc).timestamp())


def _clean_description(value: Any) -> str:
    description = re.sub(r"<[^>]+>", "", str(value or ""))
    for _ in range(2):
        description = html.unescape(description)
    return description.strip()


def _proxy_pixiv_image(source_url: str) -> str:
    return f"https://fixembed.app/proxy/pixiv?url={quote(source_url, safe='')}"


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


def build_pixiv_layout(
    payload: Mapping[str, Any],
    converted_url: Optional[str] = None,
) -> discord.ui.LayoutView:
    """Build a Pixiv Components V2 card using proxied remote artwork URLs."""
    title = str(payload.get("title") or "Pixiv Artwork").strip()
    description = _clean_description(payload.get("description"))
    if len(description) > 1200:
        description = f"{description[:1197].rstrip()}…"

    author_name = str(payload.get("authorName") or "Pixiv creator").strip().lstrip("@")
    author_handle = _clean_handle(payload.get("authorHandle"))
    author_url = str(payload.get("authorUrl") or "").strip()
    author_avatar = str(payload.get("authorAvatar") or "").strip()
    source_url = str(payload.get("url") or "").strip()

    creator_label = author_name
    if author_handle and author_handle.casefold() != author_name.casefold():
        creator_label = f"{author_name} (@{author_handle})"
    creator_line = (
        f"**[{creator_label}]({author_url})**" if author_url else f"**{creator_label}**"
    )
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
    if stats:
        children.append(discord.ui.TextDisplay(f"-# {stats}"))

    children.append(discord.ui.Separator())
    footer_parts = [
        f"<:fixembed:{FIXEMBED_EMOJI_ID}> FixEmbed",
        f"<:pixiv:{PIXIV_EMOJI_ID}> Pixiv",
    ]
    if source_url:
        footer_parts.append(f"[View original]({source_url})")
    if converted_url:
        footer_parts.append(f"[FixEmbed link]({converted_url})")
    footer_parts.append(f"<t:{_artwork_timestamp(payload.get('timestamp'))}:R>")
    children.append(discord.ui.TextDisplay(f"-# {'  ·  '.join(footer_parts)}"))

    view = discord.ui.LayoutView(timeout=None)
    view.add_item(discord.ui.Container(*children, accent_color=PIXIV_COLOR))
    return view


async def _fetch_pixiv_payload(source_url: str) -> Mapping[str, Any]:
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
        artwork_id = _artwork_id(source_url)
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
) -> discord.ui.LayoutView:
    """Fetch first-party metadata and return a Pixiv Components V2 card."""
    return build_pixiv_layout(await _fetch_pixiv_payload(source_url), converted_url)
