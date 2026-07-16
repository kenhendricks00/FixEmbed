"""Restricted Pixiv metadata relay for the FixEmbed Worker.

The public surface accepts only a numeric artwork ID. It is deliberately not a
general-purpose URL proxy, which keeps the SparkedHost process out of the SSRF
business while giving Cloudflare a network path to Pixiv's public metadata.
"""

from __future__ import annotations

import asyncio
import hashlib
import html
import hmac
import json
import logging
import os
import re
import time
from collections import OrderedDict, deque
from datetime import datetime
from typing import Any, Awaitable, Callable, Mapping
from urllib.parse import urlparse

import aiohttp
from aiohttp import web


PIXIV_ARTWORK_API = "https://www.pixiv.net/ajax/illust"
PIXIV_USER_API = "https://www.pixiv.net/ajax/user"
PIXIV_RELAY_VERSION = 1
MAX_ARTWORK_ID = 0xFFFF_FFFF
MAX_UPSTREAM_BYTES = 1024 * 1024
MAX_CACHE_ENTRIES = 256
CACHE_TTL_SECONDS = 300
RATE_LIMIT_REQUESTS = 120
RATE_LIMIT_WINDOW_SECONDS = 60
AUTHORIZATION_MAX_SKEW_SECONDS = 60

FetchJson = Callable[
    [str, Mapping[str, str], int], Awaitable[Mapping[str, Any]]
]


class UpstreamResponseError(RuntimeError):
    """Raised when Pixiv returns an unusable response."""


def _error_response(status: int, code: str, message: str) -> web.Response:
    return web.json_response(
        {"error": {"code": code, "message": message}},
        status=status,
        headers={"Cache-Control": "no-store"},
    )


def _validated_artwork_id(raw_value: str) -> str | None:
    if not re.fullmatch(r"[1-9]\d{0,9}", raw_value):
        return None
    numeric_id = int(raw_value)
    return raw_value if numeric_id <= MAX_ARTWORK_ID else None


def _bounded_text(value: Any, maximum: int) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip()[:maximum]


def _clean_description(value: Any) -> str:
    description = _bounded_text(value, 20_000)
    description = re.sub(r"<br\s*/?>", "\n", description, flags=re.IGNORECASE)
    description = re.sub(r"</(?:div|p)>", "\n", description, flags=re.IGNORECASE)
    description = re.sub(r"<[^>]+>", "", description)
    description = html.unescape(description)
    description = description.replace("\r\n", "\n").replace("\r", "\n")
    description = re.sub(r"[ \t]+\n", "\n", description)
    return re.sub(r"\n{3,}", "\n\n", description).strip()[:4_000]


def _trusted_pixiv_media_url(value: Any) -> str | None:
    if not isinstance(value, str) or len(value) > 2_048:
        return None
    try:
        parsed = urlparse(value)
    except ValueError:
        return None
    hostname = (parsed.hostname or "").lower()
    trusted_host = hostname == "i.pximg.net" or hostname.endswith(".pximg.net")
    if (
        parsed.scheme != "https"
        or not trusted_host
        or parsed.username is not None
        or parsed.password is not None
    ):
        return None
    return value


def _non_negative_integer(value: Any) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    return value if 0 <= value <= 9_007_199_254_740_991 else None


def _content_length_within_limit(value: str | None, maximum_bytes: int) -> bool:
    if value is None or value == "":
        return True
    try:
        declared_length = int(value)
    except ValueError:
        return False
    return 0 <= declared_length <= maximum_bytes


def _timestamp(value: Any) -> str | None:
    candidate = _bounded_text(value, 64)
    if not candidate:
        return None
    try:
        datetime.fromisoformat(candidate.replace("Z", "+00:00"))
    except ValueError:
        return None
    return candidate


class PixivRelayService:
    def __init__(self, fetch_json: FetchJson | None = None) -> None:
        self._injected_fetch_json = fetch_json
        self._session: aiohttp.ClientSession | None = None
        self._semaphore = asyncio.Semaphore(8)
        self._rate_lock = asyncio.Lock()
        self._request_times: deque[float] = deque()
        self._cache: OrderedDict[str, tuple[float, Mapping[str, Any]]] = OrderedDict()

    async def close(self) -> None:
        if self._session is not None:
            await self._session.close()
            self._session = None

    async def allow_request(self) -> bool:
        now = time.monotonic()
        cutoff = now - RATE_LIMIT_WINDOW_SECONDS
        async with self._rate_lock:
            while self._request_times and self._request_times[0] <= cutoff:
                self._request_times.popleft()
            if len(self._request_times) >= RATE_LIMIT_REQUESTS:
                return False
            self._request_times.append(now)
            return True

    def cached(self, artwork_id: str) -> Mapping[str, Any] | None:
        entry = self._cache.get(artwork_id)
        if entry is None:
            return None
        expires_at, payload = entry
        if expires_at <= time.monotonic():
            self._cache.pop(artwork_id, None)
            return None
        self._cache.move_to_end(artwork_id)
        return payload

    def cache(self, artwork_id: str, payload: Mapping[str, Any]) -> None:
        self._cache[artwork_id] = (time.monotonic() + CACHE_TTL_SECONDS, payload)
        self._cache.move_to_end(artwork_id)
        while len(self._cache) > MAX_CACHE_ENTRIES:
            self._cache.popitem(last=False)

    async def _default_fetch_json(
        self, url: str, headers: Mapping[str, str], maximum_bytes: int
    ) -> Mapping[str, Any]:
        if self._session is None:
            self._session = aiohttp.ClientSession(
                timeout=aiohttp.ClientTimeout(total=8, connect=3, sock_read=5),
                raise_for_status=False,
                trust_env=False,
            )
        async with self._session.get(
            url,
            headers=headers,
            allow_redirects=False,
        ) as response:
            content_type = response.headers.get("Content-Type", "").lower()
            if (
                response.status != 200
                or "application/json" not in content_type
                or not _content_length_within_limit(
                    response.headers.get("Content-Length"), maximum_bytes
                )
            ):
                raise UpstreamResponseError("Pixiv returned an unusable response")
            chunks: list[bytes] = []
            received = 0
            async for chunk in response.content.iter_chunked(64 * 1024):
                received += len(chunk)
                if received > maximum_bytes:
                    raise UpstreamResponseError("Pixiv response exceeded the size limit")
                chunks.append(chunk)
        try:
            payload = json.loads(b"".join(chunks))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise UpstreamResponseError("Pixiv returned invalid JSON") from error
        if not isinstance(payload, Mapping):
            raise UpstreamResponseError("Pixiv returned an invalid payload")
        return payload

    async def _fetch(
        self, url: str, headers: Mapping[str, str]
    ) -> Mapping[str, Any]:
        fetch_json = self._injected_fetch_json or self._default_fetch_json
        return await fetch_json(url, headers, MAX_UPSTREAM_BYTES)

    async def metadata(self, artwork_id: str) -> Mapping[str, Any]:
        cached = self.cached(artwork_id)
        if cached is not None:
            return cached

        headers = {
            "Accept": "application/json",
            "Referer": f"https://www.pixiv.net/artworks/{artwork_id}",
            "User-Agent": "Mozilla/5.0 (compatible; FixEmbed/1.0; +https://fixembed.app)",
        }
        async with self._semaphore:
            artwork_payload = await self._fetch(
                f"{PIXIV_ARTWORK_API}/{artwork_id}", headers
            )
            artwork = artwork_payload.get("body")
            if artwork_payload.get("error") is True or not isinstance(artwork, Mapping):
                raise UpstreamResponseError("Pixiv artwork metadata was unavailable")
            if str(artwork.get("illustId", artwork_id)) != artwork_id:
                raise UpstreamResponseError("Pixiv artwork identity did not match")

            author_id = _bounded_text(artwork.get("userId"), 24)
            if not re.fullmatch(r"[1-9]\d{0,23}", author_id):
                raise UpstreamResponseError("Pixiv creator identity was unavailable")

            pages_payload = await self._fetch(
                f"{PIXIV_ARTWORK_API}/{artwork_id}/pages", headers
            )
            page_body = pages_payload.get("body")
            images: list[str] = []
            if pages_payload.get("error") is not True and isinstance(page_body, list):
                for page in page_body:
                    if not isinstance(page, Mapping):
                        continue
                    urls = page.get("urls")
                    if not isinstance(urls, Mapping):
                        continue
                    image = _trusted_pixiv_media_url(
                        urls.get("regular") or urls.get("original")
                    )
                    if image and image not in images:
                        images.append(image)
                    if len(images) >= 10:
                        break
            if not images:
                artwork_urls = artwork.get("urls")
                if isinstance(artwork_urls, Mapping):
                    image = _trusted_pixiv_media_url(
                        artwork_urls.get("regular") or artwork_urls.get("original")
                    )
                    if image:
                        images.append(image)
            if not images:
                raise UpstreamResponseError("Pixiv artwork media was unavailable")

            avatar = None
            try:
                profile_payload = await self._fetch(
                    f"{PIXIV_USER_API}/{author_id}?full=1&lang=en", headers
                )
                profile = profile_payload.get("body")
                if profile_payload.get("error") is not True and isinstance(profile, Mapping):
                    avatar = _trusted_pixiv_media_url(
                        profile.get("imageBig") or profile.get("image")
                    )
            except (aiohttp.ClientError, asyncio.TimeoutError, UpstreamResponseError):
                logging.warning("pixiv_relay_profile_fetch_failed")

            if avatar is None:
                avatar = _trusted_pixiv_media_url(artwork.get("profileImageUrl"))

            title = _bounded_text(artwork.get("title"), 300)
            author_name = _bounded_text(artwork.get("userName"), 200)
            if not title or not author_name:
                raise UpstreamResponseError("Pixiv card identity was incomplete")

            stats = {
                key: value
                for key, value in {
                    "comments": _non_negative_integer(artwork.get("commentCount")),
                    "likes": _non_negative_integer(artwork.get("likeCount")),
                    "views": _non_negative_integer(artwork.get("viewCount")),
                    "bookmarks": _non_negative_integer(artwork.get("bookmarkCount")),
                }.items()
                if value is not None
            }
            payload: dict[str, Any] = {
                "version": PIXIV_RELAY_VERSION,
                "id": artwork_id,
                "title": title,
                "description": _clean_description(artwork.get("description")),
                "authorName": author_name,
                "authorHandle": _bounded_text(artwork.get("userAccount"), 100),
                "authorId": author_id,
                "authorAvatar": avatar,
                "timestamp": _timestamp(artwork.get("createDate")),
                "stats": stats,
                "images": images,
            }
            payload = {key: value for key, value in payload.items() if value not in (None, "")}
            self.cache(artwork_id, payload)
            return payload


PIXIV_RELAY_KEY: web.AppKey[PixivRelayService] = web.AppKey(
    "pixiv_relay", PixivRelayService
)
PIXIV_RELAY_SECRET_KEY: web.AppKey[bytes] = web.AppKey("pixiv_relay_secret", bytes)


async def _health(_request: web.Request) -> web.Response:
    return web.json_response(
        {"ok": True},
        headers={"Cache-Control": "no-store"},
    )


async def _pixiv_metadata(request: web.Request) -> web.Response:
    artwork_id = _validated_artwork_id(request.match_info["artwork_id"])
    if artwork_id is None:
        return _error_response(
            400,
            "INVALID_ARTWORK_ID",
            "Artwork ID must be a positive integer",
        )
    timestamp = request.headers.get("X-FixEmbed-Timestamp", "")
    authorization = request.headers.get("X-FixEmbed-Authorization", "")
    try:
        timestamp_value = int(timestamp)
    except ValueError:
        timestamp_value = 0
    expected_signature = hmac.new(
        request.app[PIXIV_RELAY_SECRET_KEY],
        f"{timestamp}:pixiv:{artwork_id}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    supplied_signature = authorization.removeprefix("v1=")
    authorized = (
        authorization.startswith("v1=")
        and len(supplied_signature) == 64
        and abs(int(time.time()) - timestamp_value) <= AUTHORIZATION_MAX_SKEW_SECONDS
        and hmac.compare_digest(supplied_signature.lower(), expected_signature)
    )
    if not authorized:
        return _error_response(401, "UNAUTHORIZED", "Request authentication failed")
    service = request.app[PIXIV_RELAY_KEY]
    if not await service.allow_request():
        response = _error_response(429, "RATE_LIMITED", "Try again later")
        response.headers["Retry-After"] = str(RATE_LIMIT_WINDOW_SECONDS)
        return response
    try:
        payload = await service.metadata(artwork_id)
    except (aiohttp.ClientError, asyncio.TimeoutError, UpstreamResponseError):
        logging.warning("pixiv_relay_metadata_fetch_failed")
        return _error_response(502, "UPSTREAM_UNAVAILABLE", "Pixiv metadata unavailable")
    raw_payload = json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    signature = hmac.new(
        request.app[PIXIV_RELAY_SECRET_KEY], raw_payload, hashlib.sha256
    ).hexdigest()
    return web.Response(
        body=raw_payload,
        content_type="application/json",
        headers={
            "Cache-Control": f"private, max-age={CACHE_TTL_SECONDS}",
            "X-FixEmbed-Signature": f"v1={signature}",
        },
    )


@web.middleware
async def _security_headers(
    request: web.Request, handler: Callable[[web.Request], Awaitable[web.StreamResponse]]
) -> web.StreamResponse:
    response = await handler(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


def create_pixiv_relay_app(
    fetch_json: FetchJson | None = None,
    signing_secret: str | None = None,
) -> web.Application:
    configured_secret = signing_secret or os.getenv("PIXIV_RELAY_SECRET", "")
    if len(configured_secret.encode("utf-8")) < 32:
        raise RuntimeError("PIXIV_RELAY_SECRET must contain at least 32 bytes")
    app = web.Application(
        middlewares=[_security_headers],
        client_max_size=1_024,
    )
    service = PixivRelayService(fetch_json=fetch_json)
    app[PIXIV_RELAY_KEY] = service
    app[PIXIV_RELAY_SECRET_KEY] = configured_secret.encode("utf-8")
    app.router.add_get("/health", _health)
    app.router.add_get("/pixiv/{artwork_id}", _pixiv_metadata)

    async def close_service(_app: web.Application) -> None:
        await service.close()

    app.on_cleanup.append(close_service)
    return app


async def start_pixiv_relay(
    host: str = "0.0.0.0", port: int | None = None
) -> web.AppRunner:
    configured_port = port
    if configured_port is None:
        configured_port = int(os.getenv("PIXIV_RELAY_PORT", os.getenv("SERVER_PORT", "26000")))
    runner = web.AppRunner(create_pixiv_relay_app(), access_log=None)
    await runner.setup()
    try:
        await web.TCPSite(runner, host, configured_port).start()
    except Exception:
        await runner.cleanup()
        raise
    logging.info("pixiv_relay_started host=%s port=%s", host, configured_port)
    return runner
