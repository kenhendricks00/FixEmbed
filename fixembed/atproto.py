"""Recognize and verify Bluesky-compatible (AT Protocol) app post links.

bsky.app links are trusted by host. Any other HTTPS host whose path looks like
an AT Protocol app post (``/profile/<handle-or-did>/post/<rkey>``) is only a
candidate: it becomes a supported link after the public AT Protocol AppView
confirms the handle or DID and the post. Lookups are cached, time-bounded, and
capped per message, and a failed check drops the link silently.
"""

from __future__ import annotations

import asyncio
import ipaddress
import logging
import re
import time
from collections import OrderedDict
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote, unquote, urlparse

import aiohttp

logger = logging.getLogger(__name__)

PUBLIC_APPVIEW = "https://public.api.bsky.app"

# Hosts with their own direct path to Bluesky; these never need verification.
BLUESKY_HOSTS = {"bsky.app": "https://bsky.app", "bskyx.app": "https://bsky.app"}

# Large sites that are not AT Protocol apps. Links on these hosts (and their
# subdomains) are skipped without any network lookup.
NON_ATPROTO_DOMAINS = frozenset(
    {
        "amazon.com",
        "apple.com",
        "baidu.com",
        "bilibili.com",
        "bing.com",
        "deviantart.com",
        "discord.com",
        "discord.gg",
        "discordapp.com",
        "facebook.com",
        "fandom.com",
        "fixembed.app",
        "github.com",
        "gitlab.com",
        "google.com",
        "imgur.com",
        "instagram.com",
        "linkedin.com",
        "medium.com",
        "microsoft.com",
        "naver.com",
        "patreon.com",
        "pinterest.com",
        "pixiv.net",
        "quora.com",
        "reddit.com",
        "roblox.com",
        "snapchat.com",
        "spotify.com",
        "stackoverflow.com",
        "steamcommunity.com",
        "substack.com",
        "t.me",
        "threads.com",
        "threads.net",
        "tiktok.com",
        "tumblr.com",
        "twitch.tv",
        "twitter.com",
        "vk.com",
        "weibo.com",
        "wikipedia.org",
        "x.com",
        "yahoo.com",
        "youtu.be",
        "youtube.com",
    }
)

# AT Protocol handle syntax (https://atproto.com/specs/handle).
_HANDLE = re.compile(
    r"(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?"
)
# TLDs the handle spec forbids for real accounts.
_DISALLOWED_HANDLE_TLDS = frozenset(
    {"alt", "arpa", "example", "internal", "invalid", "local", "localhost", "onion"}
)
_DID_PLC = re.compile(r"did:plc:[a-z2-7]{24}")
# Post records are keyed by TIDs (https://atproto.com/specs/tid).
_TID = re.compile(r"[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}")

# Limits for unknown hosts.
MAX_LOOKUPS_PER_MESSAGE = 3
REQUEST_TIMEOUT_SECONDS = 2.0
# Whole-message budget. It stays under Discord's 3-second interaction deadline
# so /fix can still answer after verifying.
VERIFY_DEADLINE_SECONDS = 2.5

HIT_TTL_SECONDS = 60 * 60
MISS_TTL_SECONDS = 10 * 60
TRANSIENT_TTL_SECONDS = 60
MAX_CACHE_ENTRIES = 2048


@dataclass(frozen=True)
class AtprotoPost:
    """An AT Protocol app post link: original origin, actor, and record key."""

    origin: str
    actor: str
    rkey: str

    @property
    def is_did(self) -> bool:
        return self.actor.startswith("did:")


def valid_handle(value: str) -> bool:
    handle = value.lower()
    if len(handle) > 253 or not _HANDLE.fullmatch(handle):
        return False
    return handle.rsplit(".", 1)[-1] not in _DISALLOWED_HANDLE_TLDS


def valid_did(value: str) -> bool:
    if _DID_PLC.fullmatch(value):
        return True
    if value.startswith("did:web:"):
        # AT Protocol only supports hostname-level did:web, without ports or paths.
        return valid_handle(value[len("did:web:"):])
    return False


def valid_tid(value: str) -> bool:
    return bool(_TID.fullmatch(value))


def _hostname(parsed) -> str:
    return (parsed.hostname or "").lower().rstrip(".")


def _site(host: str) -> str:
    return host.removeprefix("www.")


def _is_non_atproto_host(host: str) -> bool:
    return any(host == domain or host.endswith(f".{domain}") for domain in NON_ATPROTO_DOMAINS)


def _plausible_public_host(parsed) -> bool:
    try:
        if (
            parsed.scheme.lower() != "https"
            or parsed.username is not None
            or parsed.password is not None
            or parsed.port not in {None, 443}
        ):
            return False
    except ValueError:
        return False
    host = _hostname(parsed)
    if not host or "." not in host:
        return False
    try:
        ipaddress.ip_address(host.strip("[]"))
        return False
    except ValueError:
        pass
    return valid_handle(host)


def parse_atproto_post_url(url: str) -> AtprotoPost | None:
    """Return a strictly validated candidate post on a non-Bluesky host, or None."""
    parsed = urlparse(url)
    if not _plausible_public_host(parsed):
        return None
    host = _hostname(parsed)
    if _site(host) in BLUESKY_HOSTS or _is_non_atproto_host(_site(host)):
        return None

    segments = [segment for segment in parsed.path.split("/") if segment]
    # W Social, for one, also serves posts under /public/profile/...
    if segments[:1] == ["public"]:
        segments = segments[1:]
    if len(segments) != 4 or segments[0] != "profile" or segments[2] != "post":
        return None

    actor = unquote(segments[1])
    rkey = segments[3]
    if actor.startswith("did:"):
        if not valid_did(actor):
            return None
    elif valid_handle(actor):
        actor = actor.lower()
    else:
        return None
    if not valid_tid(rkey):
        return None
    return AtprotoPost(origin=f"https://{host}", actor=actor, rkey=rkey)


class _TTLCache:
    """Small LRU cache whose entries carry their own expiry."""

    def __init__(self, max_entries: int = MAX_CACHE_ENTRIES):
        self._entries: OrderedDict[str, tuple[float, Any]] = OrderedDict()
        self._max_entries = max_entries

    def get(self, key: str) -> tuple[bool, Any]:
        entry = self._entries.get(key)
        if entry is None:
            return False, None
        expires_at, value = entry
        if expires_at <= time.monotonic():
            del self._entries[key]
            return False, None
        self._entries.move_to_end(key)
        return True, value

    def set(self, key: str, value: Any, ttl_seconds: float) -> None:
        self._entries[key] = (time.monotonic() + ttl_seconds, value)
        self._entries.move_to_end(key)
        while len(self._entries) > self._max_entries:
            self._entries.popitem(last=False)

    def clear(self) -> None:
        self._entries.clear()


_did_cache = _TTLCache()
_post_cache = _TTLCache()

# Lookup outcomes. TRANSIENT covers timeouts, network errors and 5xx responses.
FOUND, MISSING, TRANSIENT = "found", "missing", "transient"
_TTL_BY_OUTCOME = {
    FOUND: HIT_TTL_SECONDS,
    MISSING: MISS_TTL_SECONDS,
    TRANSIENT: TRANSIENT_TTL_SECONDS,
}


def clear_caches() -> None:
    _did_cache.clear()
    _post_cache.clear()


async def _fetch_json(
    session: aiohttp.ClientSession, url: str
) -> tuple[int, dict | None]:
    """GET a public AppView endpoint and return (status, JSON body or None)."""
    timeout = aiohttp.ClientTimeout(total=REQUEST_TIMEOUT_SECONDS)
    async with session.get(
        url, timeout=timeout, headers={"Accept": "application/json"}
    ) as response:
        try:
            body = await response.json(content_type=None)
        except (aiohttp.ContentTypeError, ValueError):
            body = None
        return response.status, body if isinstance(body, dict) else None


async def _lookup(
    session: aiohttp.ClientSession, url: str, found: Callable[[dict], Any]
) -> tuple[str, Any]:
    try:
        status, body = await _fetch_json(session, url)
    except (aiohttp.ClientError, asyncio.TimeoutError):
        return TRANSIENT, None
    if status >= 500 or status == 429:
        return TRANSIENT, None
    if status != 200 or body is None:
        return MISSING, None
    value = found(body)
    return (FOUND, value) if value else (MISSING, None)


async def resolve_did(session: aiohttp.ClientSession, handle: str) -> str | None:
    cached, did = _did_cache.get(handle)
    if cached:
        return did
    outcome, did = await _lookup(
        session,
        f"{PUBLIC_APPVIEW}/xrpc/com.atproto.identity.resolveHandle"
        f"?handle={quote(handle, safe='')}",
        lambda body: body.get("did") if valid_did(str(body.get("did") or "")) else None,
    )
    _did_cache.set(handle, did, _TTL_BY_OUTCOME[outcome])
    return did


async def post_exists(session: aiohttp.ClientSession, did: str, rkey: str) -> bool:
    uri = f"at://{did}/app.bsky.feed.post/{rkey}"
    cached, exists = _post_cache.get(uri)
    if cached:
        return bool(exists)
    outcome, _ = await _lookup(
        session,
        f"{PUBLIC_APPVIEW}/xrpc/app.bsky.feed.getPosts?uris={quote(uri, safe='')}",
        lambda body: any(
            isinstance(post, dict) and post.get("uri") == uri
            for post in body.get("posts") or []
        ),
    )
    _post_cache.set(uri, outcome == FOUND, _TTL_BY_OUTCOME[outcome])
    return outcome == FOUND


async def verify_post(session: aiohttp.ClientSession, post: AtprotoPost) -> bool:
    """Confirm the actor resolves and the post exists on the AT Protocol network."""
    did = post.actor if post.is_did else await resolve_did(session, post.actor)
    return bool(did) and await post_exists(session, did, post.rkey)


def _cached_result(post: AtprotoPost) -> bool | None:
    """Return a cached verdict for a post, or None when a lookup is still needed."""
    did = post.actor
    if not post.is_did:
        cached, did = _did_cache.get(post.actor)
        if not cached:
            return None
        if not did:
            return False
    cached, exists = _post_cache.get(f"at://{did}/app.bsky.feed.post/{post.rkey}")
    return bool(exists) if cached else None


async def verify_atproto_links(
    links: Iterable[Any],
    *,
    session_factory: Callable[[], Awaitable[aiohttp.ClientSession]] | None = None,
) -> list[Any]:
    """Drop AT Protocol link candidates that fail verification, keeping order.

    Links without ``atproto_post`` are returned unchanged. At most
    ``MAX_LOOKUPS_PER_MESSAGE`` posts without a cached verdict are looked up;
    later uncached candidates are dropped, as are any still pending at the
    deadline.
    """
    links = list(links)
    verdicts: dict[AtprotoPost, bool] = {}
    pending: list[AtprotoPost] = []
    for link in links:
        post = getattr(link, "atproto_post", None)
        if post is None or post in verdicts or post in pending:
            continue
        cached = _cached_result(post)
        if cached is not None:
            verdicts[post] = cached
        elif len(pending) < MAX_LOOKUPS_PER_MESSAGE:
            pending.append(post)
        else:
            verdicts[post] = False

    if pending:
        session = (
            await session_factory()
            if session_factory
            else aiohttp.ClientSession(headers={"User-Agent": "FixEmbed/1.5"})
        )
        tasks = {post: asyncio.ensure_future(verify_post(session, post)) for post in pending}
        try:
            done, not_done = await asyncio.wait(
                tasks.values(), timeout=VERIFY_DEADLINE_SECONDS
            )
            for task in not_done:
                task.cancel()
            if not_done:
                await asyncio.gather(*not_done, return_exceptions=True)
            for post, task in tasks.items():
                verdicts[post] = task in done and not task.cancelled() and (
                    task.exception() is None and bool(task.result())
                )
        finally:
            await session.close()
        failed = sum(1 for post in pending if not verdicts[post])
        if failed:
            logger.debug("Skipped %d unverified AT Protocol link(s)", failed)

    return [
        link
        for link in links
        if getattr(link, "atproto_post", None) is None or verdicts.get(link.atproto_post)
    ]

