"""Shared, backwards-compatible presentation controls for social cards."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Mapping

from fixembed.content_visibility import ContentVisibility

_HASHTAG_RE = re.compile(r"(?<!\w)#[\w]+", re.UNICODE)
_COMPACT_CAPTION_LIMIT = 280


@dataclass(frozen=True)
class CardPreferences:
    """Presentation values resolved after the Premium entitlement check."""

    accent_color: int | None = None
    show_stats: bool = True
    show_hashtags: bool = True
    caption_mode: str = "full"
    content_visibility: ContentVisibility = ContentVisibility()

    def accent_or(self, platform_color: int) -> int:
        return self.accent_color if self.accent_color is not None else platform_color


def apply_caption_preferences(text: str, preferences: CardPreferences) -> str:
    """Apply safe text-only presentation changes to an already-clean caption."""
    result = str(text or "").strip()
    if not preferences.show_hashtags:
        result = _HASHTAG_RE.sub("", result)
        result = "\n".join(" ".join(line.split()) for line in result.splitlines()).strip()
    if preferences.caption_mode == "compact" and len(result) > _COMPACT_CAPTION_LIMIT:
        result = f"{result[:_COMPACT_CAPTION_LIMIT - 1].rstrip()}…"
    return result


def preferences_from_settings(
    settings: Mapping[str, Any],
    *,
    premium: bool,
    content_visibility: ContentVisibility | None = None,
) -> CardPreferences:
    """Resolve untrusted persisted settings only after entitlement validation."""
    visibility = content_visibility or ContentVisibility()
    if not premium:
        return CardPreferences(content_visibility=visibility)
    accent_color = None
    color = settings.get("embed_color")
    if isinstance(color, str) and re.fullmatch(r"#[0-9A-Fa-f]{6}", color):
        accent_color = int(color[1:], 16)
    caption_mode = settings.get("card_caption_mode")
    if caption_mode not in {"full", "compact"}:
        caption_mode = "full"
    return CardPreferences(
        accent_color=accent_color,
        show_stats=bool(settings.get("card_show_stats", True)),
        show_hashtags=bool(settings.get("card_show_hashtags", True)),
        caption_mode=caption_mode,
        content_visibility=visibility,
    )
