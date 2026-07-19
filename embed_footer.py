"""Shared compact footer formatting for Components V2 social cards."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Optional

from discord.utils import escape_markdown


@dataclass(frozen=True)
class FooterBranding:
    """Validated guild identity used by Premium component footers."""

    name: str
    emoji: str = ""


def escape_component_text(value: str) -> str:
    """Render untrusted text without markdown links or Discord mentions."""
    return escape_markdown(value.strip()).replace("@", "@\u200b")


def translated_source_name(payload: Mapping[str, Any]) -> Optional[str]:
    """Return the bounded source-language label attached by the Worker."""
    translation = payload.get("translation")
    if not isinstance(translation, Mapping):
        return None
    source_name = escape_component_text(
        str(translation.get("sourceLanguageName") or "")
    )
    return source_name[:50] or None


def build_component_footer(
    *,
    fixembed_emoji: str,
    platform_emoji: str,
    platform_name: str,
    source_url: str,
    converted_url: Optional[str],
    timestamp: Optional[int],
    branding: Optional[FooterBranding] = None,
    translated_from: Optional[str] = None,
) -> str:
    """Link the two destinations through their existing brand labels."""
    fixembed_label = (
        f"[FixEmbed]({converted_url})" if converted_url else "FixEmbed"
    )
    platform_label = (
        f"[{platform_name}]({source_url})" if source_url else platform_name
    )
    if branding is None:
        parts = [
            f"{fixembed_emoji} {fixembed_label}",
            f"{platform_emoji} {platform_label}",
        ]
    else:
        identity = " ".join(
            item
            for item in (branding.emoji, escape_component_text(branding.name) or "Server")
            if item
        )
        parts = [identity, f"{platform_emoji} {platform_label}"]
    if timestamp is not None:
        parts.append(f"<t:{timestamp}:R>")
    if branding is not None:
        parts.append(f"via {fixembed_emoji} {fixembed_label}")
    source_language = escape_component_text(translated_from or "")[:50]
    if source_language:
        parts.append(f"Translated from {source_language}")
        if source_url:
            parts.append(f"[Link]({source_url})")
    return "-# " + "  ·  ".join(parts)
