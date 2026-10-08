"""In-memory guild Premium cache with a short TTL.

Discord entitlement events update the cache immediately. A TTL covers missed
events (bot downtime, delivery gaps) so paid/cancelled status cannot stick
forever without a process restart.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Awaitable, Callable, Iterable, Mapping, MutableMapping

from premium_roles import entitlement_is_active

# Keep entitlements fresh without hammering Discord on every message.
PREMIUM_CACHE_TTL_SECONDS = 600  # 10 minutes

# Upper bound on one Discord entitlements lookup. The check runs before the
# card is built, so a slow or rate-limited lookup must not hold the embed up.
PREMIUM_CHECK_TIMEOUT_SECONDS = 2.5


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


def last_cached_premium(settings: Mapping[str, Any] | None) -> bool | None:
    """Return the last stored Premium flag even when stale, or None when never stored."""
    if not settings or "is_premium" not in settings:
        return None
    return bool(settings["is_premium"])


def record_guild_premium(
    cache: MutableMapping[Any, MutableMapping[str, Any]],
    guild_id: Any,
    is_premium: bool,
    *,
    now: float | None = None,
) -> None:
    """Store Premium status for any guild, with or without a settings row.

    Entitlement create/update/delete events call this so a subscription change
    replaces the cached value right away for every guild.
    """
    set_cached_premium(cache.setdefault(guild_id, {}), is_premium, now=now)


async def resolve_guild_premium(
    cache: MutableMapping[Any, MutableMapping[str, Any]],
    guild_id: Any,
    fetch_entitlements: Callable[[], Awaitable[Iterable[Any] | None]],
    *,
    timeout: float = PREMIUM_CHECK_TIMEOUT_SECONDS,
    now: float | None = None,
    ttl_seconds: float = PREMIUM_CACHE_TTL_SECONDS,
) -> bool:
    """Return a guild's Premium status, caching every answer Discord gives.

    - A fresh cached value (premium or not) is returned without a lookup.
    - Otherwise ``fetch_entitlements`` runs with a ``timeout`` cap. Its answer is
      cached for ``ttl_seconds`` whether or not the guild is Premium.
    - ``fetch_entitlements`` returning None means the guild cannot be checked
      right now (for example it is not in the client cache): False, not cached.
    - On timeout or error the last cached value is returned even if stale. With
      no cached value the guild is treated as free for this call only and
      nothing is cached, so a paying guild is never pinned to free.
    """
    entry = cache.get(guild_id)
    cached = get_cached_premium(entry, now=now, ttl_seconds=ttl_seconds)
    if cached is not None:
        return cached
    try:
        entitlements = await asyncio.wait_for(fetch_entitlements(), timeout=timeout)
    except asyncio.TimeoutError:
        fallback = last_cached_premium(entry)
        logging.warning(
            "Premium entitlement check for guild %s timed out after %ss; using %s",
            guild_id,
            timeout,
            "last cached value" if fallback is not None else "free for this message",
        )
        return bool(fallback)
    except Exception as e:
        fallback = last_cached_premium(entry)
        logging.error(f"Error checking premium status: {e}")
        return bool(fallback)
    if entitlements is None:
        return False
    is_premium = any_entitlement_grants_premium(entitlements)
    record_guild_premium(cache, guild_id, is_premium, now=now)
    return is_premium
