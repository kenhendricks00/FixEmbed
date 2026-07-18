"""Retrieve and normalize public DeviantArt metadata for bot-authored cards."""

from __future__ import annotations

import asyncio
from collections import OrderedDict
from datetime import datetime, timezone
from html.parser import HTMLParser
import json
import re
import time
from typing import Any, Mapping, Optional
from urllib.parse import urlparse

import aiohttp

DEVIANTART_OEMBED_URL = "https://backend.deviantart.com/oembed"
MAX_OEMBED_BYTES = 512_000
MAX_PROFILE_METADATA_BYTES = 256_000
MAX_CACHE_ENTRIES = 256
CACHE_TTL_SECONDS = 300
NEGATIVE_CACHE_TTL_SECONDS = 30
DEFAULT_RATE_LIMIT_SECONDS = 60
MAX_RATE_LIMIT_SECONDS = 900
MEDIA_HOST_SUFFIXES = ("wixmp.com", "deviantart.net", "deviantart.com")

_payload_cache: OrderedDict[str, tuple[float, Mapping[str, Any]]] = OrderedDict()
_negative_cache: OrderedDict[str, tuple[float, str]] = OrderedDict()
_inflight: dict[str, asyncio.Task[Mapping[str, Any]]] = {}
_rate_limited_until = float("-inf")


class DeviantArtSourceError(RuntimeError):
    """Raised when DeviantArt cannot provide safe public metadata."""


class DeviantArtRateLimitError(DeviantArtSourceError):
    """Raised with a bounded cooldown when public oEmbed is throttled."""

    def __init__(self, retry_after_seconds: int):
        super().__init__("DeviantArt rate limited metadata retrieval")
        self.retry_after_seconds = retry_after_seconds


class _ProfileMetadataParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.avatar_url: Optional[str] = None

    def handle_starttag(
        self,
        tag: str,
        attrs: list[tuple[str, Optional[str]]],
    ) -> None:
        if self.avatar_url is not None or tag.casefold() != "meta":
            return
        values = {
            name.casefold(): value
            for name, value in attrs
            if value is not None
        }
        metadata_name = values.get("property") or values.get("name") or ""
        if metadata_name.casefold() in {"og:image", "twitter:image"}:
            self.avatar_url = values.get("content")


def _bounded_text(value: Any, maximum: int) -> str:
    return value.strip()[:maximum] if isinstance(value, str) else ""


def _source_identity(source_url: str) -> tuple[str, Optional[str]]:
    try:
        parsed = urlparse(source_url)
        host = (parsed.hostname or "").lower()
        if host.startswith("www."):
            host = host[4:]
        if (
            parsed.scheme != "https"
            or parsed.username is not None
            or parsed.password is not None
            or parsed.port not in {None, 443}
        ):
            raise DeviantArtSourceError("Invalid DeviantArt URL")
    except ValueError as error:
        raise DeviantArtSourceError("Invalid DeviantArt URL") from error

    segments = [segment for segment in parsed.path.split("/") if segment]
    if (
        host == "deviantart.com"
        and len(segments) == 3
        and segments[1].casefold() == "art"
        and all(
            re.fullmatch(r"[A-Za-z0-9_-]+", segment)
            for segment in (segments[0], segments[2])
        )
    ):
        return (
            f"https://www.deviantart.com/{segments[0]}/art/{segments[2]}",
            segments[0],
        )
    if (
        host == "sta.sh"
        and len(segments) == 1
        and re.fullmatch(r"[A-Za-z0-9_-]+", segments[0])
    ):
        return f"https://sta.sh/{segments[0]}", None
    raise DeviantArtSourceError("Invalid DeviantArt URL")


def _trusted_url(value: Any, *, media: bool) -> Optional[str]:
    raw = _bounded_text(value, 4_096)
    if not raw:
        return None
    try:
        parsed = urlparse(raw)
        host = (parsed.hostname or "").lower()
        if (
            parsed.scheme != "https"
            or parsed.username is not None
            or parsed.password is not None
            or parsed.port not in {None, 443}
        ):
            return None
    except ValueError:
        return None
    if media:
        trusted = any(
            host == suffix or host.endswith(f".{suffix}")
            for suffix in MEDIA_HOST_SUFFIXES
        )
    else:
        trusted = host in {"deviantart.com", "www.deviantart.com"}
    return raw if trusted else None


def _compact_number(value: Any) -> Optional[str]:
    try:
        count = int(value)
    except (TypeError, ValueError):
        return None
    if count < 0:
        return None
    for threshold, suffix in ((1_000_000_000, "B"), (1_000_000, "M"), (1_000, "K")):
        if count >= threshold:
            rendered = f"{count / threshold:.1f}".rstrip("0").rstrip(".")
            return f"{rendered}{suffix}"
    return str(count)


def _statistics(payload: Mapping[str, Any]) -> Optional[str]:
    community = payload.get("community")
    statistics = community.get("statistics") if isinstance(community, Mapping) else None
    attributes = (
        statistics.get("_attributes") if isinstance(statistics, Mapping) else None
    )
    if not isinstance(attributes, Mapping):
        return None
    rendered = []
    for key, icon, label in (
        ("views", "👁️", "views"),
        ("favorites", "❤️", "favorites"),
        ("comments", "💬", "comments"),
        ("downloads", "⬇️", "downloads"),
    ):
        count = _compact_number(attributes.get(key))
        if count is not None:
            rendered.append(f"{icon} {count} {label}")
    return "  ".join(rendered) or None


def _publication_time(value: Any) -> Optional[str]:
    raw = _bounded_text(value, 64)
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat()


def _copyright_context(payload: Mapping[str, Any]) -> Optional[str]:
    copyright_value = payload.get("copyright")
    attributes = (
        copyright_value.get("_attributes")
        if isinstance(copyright_value, Mapping)
        else None
    )
    if not isinstance(attributes, Mapping):
        return None
    year = _bounded_text(attributes.get("year"), 8)
    owner = _bounded_text(attributes.get("owner"), 100)
    value = " ".join(part for part in (year, owner) if part)
    return f"© {value}" if value else None


def normalize_deviantart_oembed_payload(
    source_url: str,
    payload: Mapping[str, Any],
    *,
    author_avatar_url: Optional[str] = None,
) -> Mapping[str, Any]:
    """Normalize one official oEmbed response for the shared V2 renderer."""
    canonical_url, artist = _source_identity(source_url)
    kind = _bounded_text(payload.get("type"), 32).casefold()
    author_url = _trusted_url(payload.get("author_url"), media=False)
    author_name = _bounded_text(payload.get("author_name"), 100) or artist
    handle = artist
    if author_url:
        author_segments = [
            segment for segment in urlparse(author_url).path.split("/") if segment
        ]
        if author_segments:
            handle = author_segments[0]
    media_value = payload.get("url") if kind == "photo" else payload.get("thumbnail_url")
    image = _trusted_url(media_value, media=True)
    safety = _bounded_text(payload.get("safety"), 32).casefold()
    normalized: dict[str, Any] = {
        "title": _bounded_text(payload.get("title"), 300) or "DeviantArt deviation",
        "description": _bounded_text(payload.get("description"), 4_000),
        "url": canonical_url,
        "authorName": author_name or "DeviantArt artist",
        "authorHandle": f"@{handle}" if handle else None,
        "authorUrl": author_url,
        "authorAvatar": _trusted_url(author_avatar_url, media=True),
        "image": image,
        "timestamp": _publication_time(payload.get("pubdate")),
        "platform": "deviantart",
        "stats": _statistics(payload),
        "context": _copyright_context(payload),
        "sensitive": bool(
            safety and safety not in {"clean", "safe", "nonadult"}
        ),
    }
    return {key: value for key, value in normalized.items() if value is not None}


async def _read_oembed_response(response: aiohttp.ClientResponse) -> Mapping[str, Any]:
    if response.status == 429:
        try:
            retry_after = int(response.headers.get("Retry-After", ""))
        except (TypeError, ValueError):
            retry_after = DEFAULT_RATE_LIMIT_SECONDS
        raise DeviantArtRateLimitError(
            min(MAX_RATE_LIMIT_SECONDS, max(1, retry_after))
        )
    if response.status != 200:
        raise DeviantArtSourceError(f"DeviantArt returned {response.status}")
    try:
        declared_length = int(response.headers.get("Content-Length", "0"))
    except ValueError as error:
        raise DeviantArtSourceError("DeviantArt returned an invalid response") from error
    if declared_length < 0 or declared_length > MAX_OEMBED_BYTES:
        raise DeviantArtSourceError("DeviantArt response too large")

    chunks: list[bytes] = []
    received = 0
    async for chunk in response.content.iter_chunked(64 * 1024):
        received += len(chunk)
        if received > MAX_OEMBED_BYTES:
            raise DeviantArtSourceError("DeviantArt response too large")
        chunks.append(chunk)
    try:
        payload = json.loads(b"".join(chunks))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise DeviantArtSourceError("DeviantArt returned invalid metadata") from error
    if not isinstance(payload, Mapping):
        raise DeviantArtSourceError("DeviantArt metadata unavailable")
    return payload


async def _request_deviantart_oembed_payload(
    source_url: str,
) -> Mapping[str, Any]:
    canonical_url, _ = _source_identity(source_url)
    timeout = aiohttp.ClientTimeout(total=8, connect=3, sock_read=5)
    async with aiohttp.ClientSession(
        timeout=timeout,
        raise_for_status=False,
        trust_env=False,
        headers={
            "Accept": "application/json",
            "User-Agent": "FixEmbed/1.0 (+https://fixembed.app)",
        },
    ) as session:
        async with session.get(
            DEVIANTART_OEMBED_URL,
            params={"url": canonical_url, "maxwidth": "1200"},
            allow_redirects=False,
        ) as response:
            payload = await _read_oembed_response(response)
        avatar_url = await _fetch_deviantart_profile_avatar(
            session,
            payload.get("author_url"),
        )
    return normalize_deviantart_oembed_payload(
        canonical_url,
        payload,
        author_avatar_url=avatar_url,
    )


async def _fetch_deviantart_profile_avatar(
    session: aiohttp.ClientSession,
    author_url_value: Any,
) -> Optional[str]:
    author_url = _trusted_url(author_url_value, media=False)
    if author_url is None:
        return None
    try:
        async with session.get(author_url, allow_redirects=False) as response:
            if response.status != 200:
                return None
            content_type = response.headers.get("Content-Type", "").casefold()
            if "text/html" not in content_type:
                return None
            parser = _ProfileMetadataParser()
            received = 0
            async for chunk in response.content.iter_chunked(32 * 1024):
                received += len(chunk)
                if received > MAX_PROFILE_METADATA_BYTES:
                    break
                parser.feed(chunk.decode("utf-8", errors="ignore"))
                avatar_url = _trusted_url(parser.avatar_url, media=True)
                if avatar_url is not None:
                    return avatar_url
    except (aiohttp.ClientError, asyncio.TimeoutError):
        return None
    return None


async def _fetch_deviantart_oembed_payload(
    source_url: str,
) -> Mapping[str, Any]:
    global _rate_limited_until

    canonical_url, _ = _source_identity(source_url)
    cached = _payload_cache.get(canonical_url)
    if cached is not None:
        expires_at, payload = cached
        if expires_at > time.monotonic():
            _payload_cache.move_to_end(canonical_url)
            return payload
        _payload_cache.pop(canonical_url, None)

    now = time.monotonic()
    if now < _rate_limited_until:
        raise DeviantArtRateLimitError(
            max(1, int(_rate_limited_until - now))
        )

    cached_error = _negative_cache.get(canonical_url)
    if cached_error is not None:
        expires_at, message = cached_error
        if expires_at > time.monotonic():
            _negative_cache.move_to_end(canonical_url)
            raise DeviantArtSourceError(message)
        _negative_cache.pop(canonical_url, None)

    pending = _inflight.get(canonical_url)
    if pending is None:
        pending = asyncio.create_task(
            _request_deviantart_oembed_payload(canonical_url)
        )
        _inflight[canonical_url] = pending
    try:
        payload = await pending
    except (aiohttp.ClientError, asyncio.TimeoutError, DeviantArtSourceError) as error:
        error_ttl = NEGATIVE_CACHE_TTL_SECONDS
        if isinstance(error, DeviantArtRateLimitError):
            error_ttl = error.retry_after_seconds
            _rate_limited_until = max(
                _rate_limited_until,
                time.monotonic() + error_ttl,
            )
        _negative_cache[canonical_url] = (
            time.monotonic() + error_ttl,
            str(error),
        )
        _negative_cache.move_to_end(canonical_url)
        while len(_negative_cache) > MAX_CACHE_ENTRIES:
            _negative_cache.popitem(last=False)
        raise
    finally:
        if _inflight.get(canonical_url) is pending:
            _inflight.pop(canonical_url, None)

    _negative_cache.pop(canonical_url, None)
    _payload_cache[canonical_url] = (
        time.monotonic() + CACHE_TTL_SECONDS,
        payload,
    )
    _payload_cache.move_to_end(canonical_url)
    while len(_payload_cache) > MAX_CACHE_ENTRIES:
        _payload_cache.popitem(last=False)
    return payload


async def fetch_deviantart_payload(source_url: str) -> Mapping[str, Any]:
    """Return normalized public metadata without depending on Worker egress."""
    return await _fetch_deviantart_oembed_payload(source_url)
