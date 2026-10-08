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


def normalize_language_code(value: Any) -> str:
    """Primary language subtag, casefolded: ``en``, ``EN``, ``en-US`` -> ``en``."""
    return str(value or "").strip().replace("_", "-").split("-", 1)[0].casefold()


_TRADITIONAL_CHINESE_SUBTAGS = {"hant", "tw", "hk", "mo"}


def _chinese_script(value: Any) -> str:
    """``hant`` for zh-TW/zh-HK/zh-MO/zh-Hant tags, ``hans`` for other zh tags."""
    subtags = str(value or "").strip().replace("_", "-").casefold().split("-")[1:]
    return "hant" if _TRADITIONAL_CHINESE_SUBTAGS.intersection(subtags) else "hans"


def is_same_language_translation(translation: Mapping[str, Any]) -> bool:
    """True when the source and target languages match, so nothing was translated.

    Chinese also compares the script: the Worker converts Simplified posts for a
    Traditional (``zh-TW``) target and reports ``zh-Hans`` -> ``zh-TW`` (#97).
    """
    source_tag = translation.get("sourceLanguage")
    target_tag = translation.get("targetLanguage")
    source = normalize_language_code(source_tag)
    target = normalize_language_code(target_tag)
    if not source or source != target:
        return False
    return source != "zh" or _chinese_script(source_tag) == _chinese_script(target_tag)


def translated_source_name(payload: Mapping[str, Any]) -> Optional[str]:
    """Return the bounded source-language label attached by the Worker."""
    translation = payload.get("translation")
    if not isinstance(translation, Mapping):
        return None
    if is_same_language_translation(translation):
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
    return "-# " + "  ·  ".join(parts)
