"""In-memory guild Premium cache with a short TTL.

Discord entitlement events update the cache immediately. A TTL covers missed
events (bot downtime, delivery gaps) so paid/cancelled status cannot stick
forever without a process restart.
"""

from __future__ import annotations

import time
from typing import Any, Mapping, MutableMapping

from premium_roles import entitlement_is_active

# Keep entitlements fresh without hammering Discord on every message.
PREMIUM_CACHE_TTL_SECONDS = 600  # 10 minutes


def get_cached_premium(
    settings: Mapping[str, Any] | None,
    *,
    now: float | None = None,
    ttl_seconds: float = PREMIUM_CACHE_TTL_SECONDS,
) -> bool | None:
    """Return a fresh cached Premium flag, or None when missing/stale."""
    if not settings or "is_premium" not in settings:
        return None
    cached_at = settings.get("is_premium_cached_at")
    if cached_at is None:
        # Legacy entries without a timestamp are treated as stale so they refresh.
        return None
    current = time.monotonic() if now is None else now
    try:
        age = current - float(cached_at)
    except (TypeError, ValueError):
        return None
    if age < 0 or age > float(ttl_seconds):
        return None
    return bool(settings["is_premium"])


def set_cached_premium(
    settings: MutableMapping[str, Any],
    is_premium: bool,
    *,
    now: float | None = None,
) -> None:
    """Store Premium status with a monotonic cache timestamp."""
    settings["is_premium"] = bool(is_premium)
    settings["is_premium_cached_at"] = time.monotonic() if now is None else now


def invalidate_cached_premium(settings: MutableMapping[str, Any]) -> None:
    """Drop cached Premium status so the next check re-queries Discord."""
    settings.pop("is_premium", None)
    settings.pop("is_premium_cached_at", None)


def any_entitlement_grants_premium(entitlements) -> bool:
    """True when any entitlement currently grants guild Premium access."""
    return any(entitlement_is_active(entitlement) for entitlement in entitlements)
