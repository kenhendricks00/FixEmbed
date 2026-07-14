"""Shared compact footer formatting for Components V2 social cards."""

from __future__ import annotations

from typing import Optional


def build_component_footer(
    *,
    fixembed_emoji: str,
    platform_emoji: str,
    platform_name: str,
    source_url: str,
    converted_url: Optional[str],
    timestamp: Optional[int],
) -> str:
    """Link the two destinations through their existing brand labels."""
    fixembed_label = (
        f"[FixEmbed]({converted_url})" if converted_url else "FixEmbed"
    )
    platform_label = (
        f"[{platform_name}]({source_url})" if source_url else platform_name
    )
    parts = [
        f"{fixembed_emoji} {fixembed_label}",
        f"{platform_emoji} {platform_label}",
    ]
    if timestamp is not None:
        parts.append(f"<t:{timestamp}:R>")
    return "-# " + "  ·  ".join(parts)
