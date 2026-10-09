"""In-memory guild Premium cache with a short TTL.

Discord entitlement events update the cache immediately. A TTL covers missed
events (bot downtime, delivery gaps) so paid/cancelled status cannot stick
forever without a process restart.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections import OrderedDict
from typing import Any, Awaitable, Callable, Iterable, Literal, Mapping, MutableMapping

from premium_roles import entitlement_is_active

# Keep entitlements fresh without hammering Discord on every message.
PREMIUM_CACHE_TTL_SECONDS = 600  # 10 minutes

# Upper bound on one Discord entitlements lookup. The check runs before the
# card is built, so a slow or rate-limited lookup must not hold the embed up.
PREMIUM_CHECK_TIMEOUT_SECONDS = 2.5

# When a lookup times out or fails, an expired cached answer is still served for
# up to this long past the TTL. Older answers fall back to free for that message.
PREMIUM_STALE_GRACE_SECONDS = 3600  # 1 hour

# After a failed lookup, a guild's lookups skip Discord for this long and use
# the last cached answer or "unconfirmed" instead (#101).
PREMIUM_FAILURE_BACKOFF_SECONDS = 45

# Upper bound on guilds held in a PremiumStatusCache; least recently used go first.
PREMIUM_CACHE_MAX_ENTRIES = 10000


class PremiumStatusCache(OrderedDict):
    """Per-guild Premium cache entries, bounded and evicted least recently used.

    ``generations`` counts entitlement events per guild (#101). It lives beside
    the LRU entries, not inside them, so evicting a guild's entry can never
    reset its generation while a lookup for that guild is still in flight. It
    only gains a key when a guild gets an entitlement event, so it holds one
    int per guild that subscribed, renewed or cancelled since the bot started.

    ``in_flight`` holds the one running entitlements lookup per guild, so a
    burst of messages from a guild with nothing cached makes a single Discord
    call (#101). ``backoff_until`` holds, per guild, when the next lookup may run
    after a failed one, so an outage costs each guild one timeout, not one per
    message. Both drop a guild's key as soon as it no longer applies.
    """

    def __init__(self, max_entries: int = PREMIUM_CACHE_MAX_ENTRIES):
        super().__init__()
        self.max_entries = int(max_entries)
        self.generations: dict[Any, int] = {}
        self.in_flight: dict[Any, asyncio.Future] = {}
        self.backoff_until: dict[Any, float] = {}


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


def last_cached_premium(
    settings: Mapping[str, Any] | None,
    *,
    now: float | None = None,
    max_age_seconds: float = PREMIUM_CACHE_TTL_SECONDS + PREMIUM_STALE_GRACE_SECONDS,
) -> bool | None:
    """Return the last stored Premium flag, even if past its TTL, while it is
    at most ``max_age_seconds`` old. None when never stored or too old."""
    if not settings or "is_premium" not in settings:
        return None
    return get_cached_premium(settings, now=now, ttl_seconds=max_age_seconds)


def _touch(cache: MutableMapping[Any, Any], guild_id: Any) -> None:
    move_to_end = getattr(cache, "move_to_end", None)
    if move_to_end is not None and guild_id in cache:
        move_to_end(guild_id)


def premium_generation(cache: Mapping[Any, Any], guild_id: Any) -> int:
    """How many entitlement events this guild has had (0 when none).

    Plain mappings without a ``generations`` attribute report 0 always, so they
    get no stale-lookup protection; the bot's cache is a PremiumStatusCache.
    """
    generations = getattr(cache, "generations", None)
    if generations is None:
        return 0
    return generations.get(guild_id, 0)


def _bump_premium_generation(cache: Mapping[Any, Any], guild_id: Any) -> None:
    generations = getattr(cache, "generations", None)
    if generations is not None:
        generations[guild_id] = generations.get(guild_id, 0) + 1


def _enforce_premium_cache_bound(cache: MutableMapping[Any, Any]) -> None:
    max_entries = getattr(cache, "max_entries", None)
    if max_entries is not None:
        while len(cache) > max(int(max_entries), 1):
            cache.popitem(last=False)


def record_guild_premium(
    cache: MutableMapping[Any, MutableMapping[str, Any]],
    guild_id: Any,
    is_premium: bool,
    *,
    now: float | None = None,
) -> None:
    """Store Premium status for any guild, with or without a settings row.

    Entitlement create/update/delete events call this so a subscription change
    replaces the cached value right away for every guild. The guild's generation
    is bumped before the write, so any lookup already in flight for this guild
    drops its older answer instead of overwriting this one (#101).
    """
    _bump_premium_generation(cache, guild_id)
    # Discord just answered for this guild, so a failure backoff no longer applies.
    getattr(cache, "backoff_until", {}).pop(guild_id, None)
    set_cached_premium(cache.setdefault(guild_id, {}), is_premium, now=now)
    _touch(cache, guild_id)
    _enforce_premium_cache_bound(cache)


PremiumStatus = Literal["active", "inactive", "unconfirmed"]


def _status(is_premium: bool) -> PremiumStatus:
    return "active" if is_premium else "inactive"


async def resolve_guild_premium(
    cache: MutableMapping[Any, MutableMapping[str, Any]],
    guild_id: Any,
    fetch_entitlements: Callable[[], Awaitable[Iterable[Any] | None]],
    **options: Any,
) -> bool:
    """True when the guild is Premium; see ``resolve_guild_premium_status``.

    Message handling uses this plain answer: anything not confirmed active,
    including ``unconfirmed``, is treated as free for that message.
    """
    return await resolve_guild_premium_status(cache, guild_id, fetch_entitlements, **options) == "active"


async def resolve_guild_premium_status(
    cache: MutableMapping[Any, MutableMapping[str, Any]],
    guild_id: Any,
    fetch_entitlements: Callable[[], Awaitable[Iterable[Any] | None]],
    *,
    timeout: float = PREMIUM_CHECK_TIMEOUT_SECONDS,
    now: float | None = None,
    ttl_seconds: float = PREMIUM_CACHE_TTL_SECONDS,
    stale_grace_seconds: float = PREMIUM_STALE_GRACE_SECONDS,
    failure_backoff_seconds: float = PREMIUM_FAILURE_BACKOFF_SECONDS,
) -> PremiumStatus:
    """Return a guild's Premium status, caching every answer Discord gives.

    ``unconfirmed`` means Discord could not be asked and nothing usable was
    cached (#101). /premium and the settings screens say "couldn't confirm"
    for it instead of "not active" or locked, because that is the moment a
    subscriber starts wondering whether their payment went through.

    - A fresh cached value (premium or not) is returned without a lookup.
    - Otherwise ``fetch_entitlements`` runs with a ``timeout`` cap. Its answer is
      cached for ``ttl_seconds`` whether or not the guild is Premium.
    - ``fetch_entitlements`` returning None means the guild cannot be checked
      right now (for example it is not in the client cache): ``unconfirmed``,
      not cached.
    - On timeout or error the last cached value is returned even if past its
      TTL, as long as it is at most ``ttl_seconds + stale_grace_seconds`` old.
      Its timestamp is never refreshed, so the next call retries Discord. With
      no usable cached value the answer is ``unconfirmed`` (free for that one
      message) and nothing is cached, so a paying guild is never pinned to free.
    - Every fallback answer is in memory only; this function never persists.
    - The guild's generation is read before the lookup starts. If an
      entitlement event bumped it while the lookup was in flight, the lookup's
      answer is older than the event's, so it is not written. The event's
      cached value is returned instead (or the lookup's answer if that entry
      has since been evicted). This holds when ``fetch_entitlements`` returned
      None too, so that call is served the event's value, not False. A lookup
      never bumps the generation itself, so a timeout or error leaves it
      unchanged (#101).
    - Concurrent calls for one guild share a single lookup, and after a timeout
      or error the guild's calls skip Discord for ``failure_backoff_seconds``,
      answering from the last cached value or ``unconfirmed`` (#101). Plain
      mappings without ``in_flight``/``backoff_until`` get neither.
    """
    entry = cache.get(guild_id)
    cached = get_cached_premium(entry, now=now, ttl_seconds=ttl_seconds)
    if cached is not None:
        _touch(cache, guild_id)
        return _status(cached)
    stale_limit = ttl_seconds + stale_grace_seconds
    clock = time.monotonic() if now is None else now
    backoff = getattr(cache, "backoff_until", None)
    if backoff is not None and backoff.get(guild_id, float("-inf")) > clock:
        fallback = last_cached_premium(cache.get(guild_id), now=now, max_age_seconds=stale_limit)
        return "unconfirmed" if fallback is None else _status(fallback)

    lookup = lambda: _lookup_guild_premium(  # noqa: E731
        cache,
        guild_id,
        fetch_entitlements,
        timeout=timeout,
        now=now,
        ttl_seconds=ttl_seconds,
        stale_limit=stale_limit,
        failure_backoff_seconds=failure_backoff_seconds,
    )
    in_flight = getattr(cache, "in_flight", None)
    if in_flight is None:
        return await lookup()
    shared = in_flight.get(guild_id)
    if shared is None:
        shared = asyncio.ensure_future(lookup())
        in_flight[guild_id] = shared

        def _done(task: asyncio.Future) -> None:
            if in_flight.get(guild_id) is task:
                del in_flight[guild_id]

        shared.add_done_callback(_done)
    # shield: a caller that gives up never cancels the lookup others await.
    return await asyncio.shield(shared)


async def _lookup_guild_premium(
    cache: MutableMapping[Any, MutableMapping[str, Any]],
    guild_id: Any,
    fetch_entitlements: Callable[[], Awaitable[Iterable[Any] | None]],
    *,
    timeout: float,
    now: float | None,
    ttl_seconds: float,
    stale_limit: float,
    failure_backoff_seconds: float,
) -> PremiumStatus:
    """One entitlements lookup for ``resolve_guild_premium_status``."""
    # An entitlement event may have landed between the call and this start.
    cached = get_cached_premium(cache.get(guild_id), now=now, ttl_seconds=ttl_seconds)
    if cached is not None:
        return _status(cached)
    backoff = getattr(cache, "backoff_until", None)

    def back_off() -> None:
        if backoff is None or failure_backoff_seconds <= 0:
            return
        clock = time.monotonic() if now is None else now
        for expired in [key for key, until in backoff.items() if until <= clock]:
            del backoff[expired]
        backoff[guild_id] = clock + failure_backoff_seconds

    generation = premium_generation(cache, guild_id)
    try:
        entitlements = await asyncio.wait_for(fetch_entitlements(), timeout=timeout)
    except asyncio.TimeoutError:
        back_off()
        # Re-read the entry: an entitlement event may have landed meanwhile.
        fallback = last_cached_premium(cache.get(guild_id), now=now, max_age_seconds=stale_limit)
        logging.warning(
            "Premium entitlement check for guild %s timed out after %ss; using %s",
            guild_id,
            timeout,
            "last cached value" if fallback is not None else "free for this message",
        )
        return "unconfirmed" if fallback is None else _status(fallback)
    except Exception as e:
        back_off()
        fallback = last_cached_premium(cache.get(guild_id), now=now, max_age_seconds=stale_limit)
        logging.error(
            "Premium entitlement check for guild %s failed: %s; using %s",
            guild_id,
            e,
            "last cached value" if fallback is not None else "free for this message",
        )
        return "unconfirmed" if fallback is None else _status(fallback)
    if backoff is not None:
        backoff.pop(guild_id, None)
    raced = premium_generation(cache, guild_id) != generation
    if raced:
        # An entitlement event landed mid-lookup; its value is fresher.
        newer = get_cached_premium(cache.get(guild_id), now=now, ttl_seconds=ttl_seconds)
        if newer is not None:
            return _status(newer)
    if entitlements is None:
        # The guild can't be checked right now (not in the client cache).
        return "unconfirmed"
    is_premium = any_entitlement_grants_premium(entitlements)
    if raced:
        # The event's entry was evicted; don't re-add the guild with the older answer.
        return _status(is_premium)
    # Same write as record_guild_premium, minus the generation bump.
    set_cached_premium(cache.setdefault(guild_id, {}), is_premium, now=now)
    _touch(cache, guild_id)
    _enforce_premium_cache_bound(cache)
    return _status(is_premium)
