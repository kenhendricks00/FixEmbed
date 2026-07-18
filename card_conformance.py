"""Bounded Components V2 validation for production embed canaries."""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
import re
from typing import Any
from urllib.parse import urlparse

from bilibili_embed import build_bilibili_layout
from bluesky_embed import build_bluesky_layout
from instagram_embed import build_instagram_layout
from pinterest_embed import build_pinterest_layout
from pixiv_embed import build_pixiv_layout
from reddit_embed import build_reddit_layout
from threads_embed import build_threads_layout
from twitter_embed import build_twitter_layout
from youtube_embed import build_youtube_community_layout
from tiktok_embed import build_tiktok_layout
from tumblr_embed import build_tumblr_layout
from twitch_embed import build_twitch_layout


Builder = Callable[[Mapping[str, Any]], Any]


@dataclass(frozen=True)
class MediaTarget:
    """One remote resource referenced by a rendered Discord card."""

    kind: str
    url: str


BUILDERS: dict[str, Builder] = {
    "twitter": build_twitter_layout,
    "instagram": build_instagram_layout,
    "reddit": build_reddit_layout,
    "threads": build_threads_layout,
    "pixiv": build_pixiv_layout,
    "bluesky": build_bluesky_layout,
    "bilibili": build_bilibili_layout,
    "youtube": build_youtube_community_layout,
    "pinterest": build_pinterest_layout,
    "tiktok": build_tiktok_layout,
    "tumblr": build_tumblr_layout,
    "twitch": build_twitch_layout,
}

CONTAINER = 17
SECTION = 9
TEXT_DISPLAY = 10
THUMBNAIL = 11
MEDIA_GALLERY = 12


def _text_nodes(component: object) -> list[str]:
    if not isinstance(component, Mapping):
        return []
    text = []
    if component.get("type") == TEXT_DISPLAY:
        content = component.get("content")
        if isinstance(content, str) and content.strip():
            text.append(content)
    children = component.get("components")
    if isinstance(children, Sequence) and not isinstance(children, (str, bytes)):
        for child in children:
            text.extend(_text_nodes(child))
    return text


def _gallery_urls(component: object) -> list[str]:
    if not isinstance(component, Mapping):
        return []
    urls = []
    if component.get("type") == MEDIA_GALLERY:
        items = component.get("items")
        if isinstance(items, Sequence) and not isinstance(items, (str, bytes)):
            for item in items:
                if not isinstance(item, Mapping):
                    continue
                media = item.get("media")
                url = media.get("url") if isinstance(media, Mapping) else None
                if isinstance(url, str) and url.strip():
                    urls.append(url.strip())
    children = component.get("components")
    if isinstance(children, Sequence) and not isinstance(children, (str, bytes)):
        for child in children:
            urls.extend(_gallery_urls(child))
    return urls


def _thumbnail_urls(component: object) -> list[str]:
    if not isinstance(component, Mapping):
        return []
    urls = []
    if component.get("type") == SECTION:
        accessory = component.get("accessory")
        if isinstance(accessory, Mapping) and accessory.get("type") == THUMBNAIL:
            media = accessory.get("media")
            url = media.get("url") if isinstance(media, Mapping) else None
            if isinstance(url, str) and url.strip():
                urls.append(url.strip())
    children = component.get("components")
    if isinstance(children, Sequence) and not isinstance(children, (str, bytes)):
        for child in children:
            urls.extend(_thumbnail_urls(child))
    return urls


def extract_media_targets(components: object) -> tuple[MediaTarget, ...]:
    """Return typed, deduplicated remote targets without card text."""
    if not isinstance(components, list):
        return ()
    targets = (
        *(MediaTarget("avatar", url) for root in components for url in _thumbnail_urls(root)),
        *(MediaTarget("media", url) for root in components for url in _gallery_urls(root)),
    )
    deduplicated: dict[str, MediaTarget] = {}
    for target in targets:
        deduplicated.setdefault(target.url, target)
    return tuple(deduplicated.values())


def _normalized(value: object) -> str:
    return " ".join(str(value or "").split()).casefold()


def _is_https_url(value: str) -> bool:
    parsed = urlparse(value)
    return parsed.scheme == "https" and bool(parsed.hostname)


def _expected_media(payload: Mapping[str, Any]) -> list[str]:
    video = payload.get("video")
    if isinstance(video, Mapping):
        url = video.get("url")
        if isinstance(url, str) and url.strip():
            return [url.strip()]
    images = payload.get("images")
    if isinstance(images, list):
        urls = [str(url).strip() for url in images if str(url).strip()]
        if urls:
            return urls[:10]
    image = payload.get("image")
    return [image.strip()] if isinstance(image, str) and image.strip() else []


def _section_is_rendered(
    section_kind: str,
    payload: Mapping[str, Any],
    rendered_text: str,
) -> bool:
    sections = payload.get("sections")
    if not isinstance(sections, list):
        return False
    for section in sections:
        if not isinstance(section, Mapping) or section.get("kind") != section_kind:
            continue
        for field in ("body", "title"):
            marker = _normalized(section.get(field))
            if marker and marker[:80] in rendered_text:
                return True
    return False


def validate_serialized_card(
    payload: Mapping[str, Any],
    components: object,
    *,
    requires: frozenset[str],
    media_type: str | None,
    section_kinds: frozenset[str],
) -> tuple[str, ...]:
    """Validate user-visible card invariants without returning post content."""
    if (
        not isinstance(components, list)
        or len(components) != 1
        or not isinstance(components[0], Mapping)
        or components[0].get("type") != CONTAINER
    ):
        return ("card-missing-container",)

    root = components[0]
    root_children = root.get("components")
    if not isinstance(root_children, list) or not root_children:
        return ("card-missing-container",)

    codes: list[str] = []
    text_nodes = _text_nodes(root)
    rendered_text = _normalized("\n".join(text_nodes))
    header_nodes = _text_nodes(root_children[0])
    raw_header_text = "\n".join(header_nodes)
    header_text = _normalized(raw_header_text)
    identity_markers = (
        _normalized(payload.get("authorName")),
        _normalized(payload.get("authorHandle")),
        _normalized(payload.get("title")),
    )
    if "author" in requires and not any(
        marker and marker in header_text for marker in identity_markers
    ):
        codes.append("card-missing-header")

    header_thumbnails = _thumbnail_urls(root_children[0])
    if (
        "avatar" in requires
        or ("author" in requires and str(payload.get("authorAvatar") or "").strip())
    ):
        if not header_thumbnails:
            codes.append("card-missing-avatar")
    if "author-link" in requires:
        author_url = str(payload.get("authorUrl") or "").strip()
        if not author_url or author_url not in raw_header_text:
            codes.append("card-missing-author-link")

    gallery_urls = _gallery_urls(root)
    if any(not _is_https_url(url) for url in (*header_thumbnails, *gallery_urls)):
        codes.append("card-unsafe-media")
    expected_media = _expected_media(payload)
    if "media" in requires:
        if not gallery_urls or not any(url in gallery_urls for url in expected_media):
            codes.append("card-missing-media")
        elif media_type == "carousel" and len(gallery_urls) < 2:
            codes.append("card-missing-media")

    if "stats" in requires:
        stats_text = str(payload.get("stats") or "")
        stat_tokens = re.findall(r"\d[\d.,]*(?:[KMB])?", stats_text, re.IGNORECASE)
        stats_rows = (
            text
            for text in text_nodes
            if text.lstrip().startswith("-#") and "fixembed" not in text.casefold()
        )
        rendered_stats = re.sub(
            r"<a?:[^:>]+:\d+>",
            "",
            "\n".join(stats_rows),
        )
        rendered_stat_tokens = {
            token.casefold()
            for token in re.findall(
                r"\d[\d.,]*(?:[KMB])?",
                rendered_stats,
                re.IGNORECASE,
            )
        }
        if not stat_tokens or not {
            token.casefold() for token in stat_tokens
        }.issubset(rendered_stat_tokens):
            codes.append("card-missing-stats")

    if any(
        not _section_is_rendered(kind, payload, rendered_text)
        for kind in section_kinds
    ):
        codes.append("card-missing-section")

    footer = next(
        (text for text in reversed(text_nodes) if "fixembed" in text.casefold()),
        "",
    )
    source_url = str(payload.get("url") or "").strip()
    if not footer or not source_url or source_url not in footer:
        codes.append("card-missing-footer")
    if "timestamp" in requires and "<t:" not in footer:
        codes.append("card-missing-timestamp")
    if "translation" in requires and "translation (" not in rendered_text:
        codes.append("card-missing-translation")

    return tuple(dict.fromkeys(codes))


def evaluate_components_v2(
    platform: str,
    payload: Mapping[str, Any],
    *,
    requires: frozenset[str],
    media_type: str | None,
    section_kinds: frozenset[str],
) -> tuple[str, ...]:
    """Build the real bot card and return bounded conformance failure codes."""
    builder = BUILDERS.get(platform)
    if builder is None:
        return ("card-render-failed",)
    try:
        components = builder(payload).to_components()
        return validate_serialized_card(
            payload,
            components,
            requires=requires,
            media_type=media_type,
            section_kinds=section_kinds,
        )
    except Exception:
        return ("card-render-failed",)


def rendered_media_targets(
    platform: str,
    payload: Mapping[str, Any],
) -> tuple[MediaTarget, ...]:
    """Build the production card and expose only its remote media targets."""
    builder = BUILDERS.get(platform)
    if builder is None:
        raise ValueError("unsupported renderer platform")
    return extract_media_targets(builder(payload).to_components())
