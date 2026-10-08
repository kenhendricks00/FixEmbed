"""Activation checklist helpers for active FixEmbed Premium subscribers.

Packaging only: evaluates whether existing Premium perks have been configured
and builds deep-link targets into matching /settings surfaces. Does not add
new paywalled features.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Sequence


# SettingsDropdown / page keys used for deep-links.
PAGE_EMBED_COLOR = "Embed Color"
PAGE_FOOTER = "Footer Branding"
PAGE_CARD_STYLE = "Card Style"
PAGE_EXCLUSIONS = "Exclusions"
PAGE_ANALYTICS = "Analytics"

# Bot/webhook auto-fix has no toggle — it is always on while Premium is active.
PAGE_BOT_FIX = None


@dataclass(frozen=True)
class ActivationItem:
    """One Premium perk row on the /premium activation checklist."""

    key: str
    configured: bool
    settings_page: str | None
    """SettingsDropdown value, or None when the perk has no configure surface."""


def _analytics_nonempty(summary: Sequence[Mapping[str, Any]] | None) -> bool:
    if not summary:
        return False
    for row in summary:
        rich = int(row.get("rich_count") or 0)
        fallback = int(row.get("fallback_count") or 0)
        if rich + fallback > 0:
            return True
    return False


def _card_style_changed(settings: Mapping[str, Any]) -> bool:
    show_stats = bool(settings.get("card_show_stats", True))
    show_hashtags = bool(settings.get("card_show_hashtags", True))
    caption_mode = settings.get("card_caption_mode") or "full"
    if caption_mode not in {"full", "compact"}:
        caption_mode = "full"
    return (not show_stats) or (not show_hashtags) or caption_mode != "full"


def _exclusions_configured(settings: Mapping[str, Any]) -> bool:
    users = settings.get("ignored_user_ids") or []
    roles = settings.get("ignored_role_ids") or []
    return bool(users) or bool(roles)


def evaluate_activation_checklist(
    settings: Mapping[str, Any],
    *,
    analytics_summary: Sequence[Mapping[str, Any]] | None = None,
) -> list[ActivationItem]:
    """Return configured-vs-available status for the six activation checklist perks."""
    return [
        ActivationItem(
            key="color",
            configured=bool(settings.get("embed_color")),
            settings_page=PAGE_EMBED_COLOR,
        ),
        ActivationItem(
            key="footer",
            configured=bool(settings.get("footer_branding_enabled", False)),
            settings_page=PAGE_FOOTER,
        ),
        ActivationItem(
            key="card_style",
            configured=_card_style_changed(settings),
            settings_page=PAGE_CARD_STYLE,
        ),
        ActivationItem(
            key="exclusions",
            configured=_exclusions_configured(settings),
            settings_page=PAGE_EXCLUSIONS,
        ),
        ActivationItem(
            key="analytics",
            configured=_analytics_nonempty(analytics_summary),
            settings_page=PAGE_ANALYTICS,
        ),
        ActivationItem(
            key="bot_fix",
            # Always enabled for Premium guilds; no separate toggle exists.
            configured=True,
            settings_page=PAGE_BOT_FIX,
        ),
    ]




def harden_settings_path(path: str) -> str:
    """Keep a /settings path on one Discord line (no mid-path wraps).

    Discord TextDisplay rows wrap at ordinary spaces, and mobile clients can
    even split after `/` when only part of the path is in inline code. Wrap the
    whole `/settings → Page` target in one code span and replace spaces with
    NBSP so the path stays a single non-breaking token on desktop and mobile.
    """
    text = (path or "").strip()
    if text.startswith("`") and text.endswith("`") and text.count("`") == 2:
        inner = text[1:-1]
    else:
        inner = text.replace("`", "")
    # Collapse any odd whitespace, then freeze breaks with NBSP.
    inner = " ".join(inner.split())
    return f"`{inner.replace(' ', '\u00a0')}`"


def format_checklist_row(mark: str, label: str, path: str | None = None) -> str:
    """Render one checklist row; settings path sits on its own line when present."""
    if path:
        return f"{mark} {label}\n{harden_settings_path(path)}"
    return f"{mark} {label}"


def checklist_settings_targets(items: Sequence[ActivationItem]) -> list[ActivationItem]:
    """Items that deep-link into a /settings page (excludes always-on bot-fix)."""
    return [item for item in items if item.settings_page]
