"""Safe, bounded reachability probes for rendered Discord card media."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from typing import Optional
from urllib.parse import urljoin, urlparse

import aiohttp

from card_conformance import MediaTarget


MAX_MEDIA_TARGETS = 16
MAX_MEDIA_REDIRECTS = 3
MEDIA_PROBE_HEADERS = {
    "Accept": "image/*, video/*;q=0.9, */*;q=0.1",
    "Range": "bytes=0-0",
    "User-Agent": "FixEmbed-Conformance/1.0",
}
MEDIA_HOST_SUFFIXES = {
    "twitter": frozenset({"twimg.com", "fxtwitter.com"}),
    "instagram": frozenset({"cdninstagram.com", "fbcdn.net", "fixembed.app"}),
    "reddit": frozenset({"redd.it", "redditmedia.com"}),
    "threads": frozenset({"cdninstagram.com", "fbcdn.net"}),
    "pixiv": frozenset({"pximg.net", "fixembed.app"}),
    "bluesky": frozenset({"bsky.app"}),
    "youtube": frozenset({"googleusercontent.com", "ggpht.com", "ytimg.com"}),
    "bilibili": frozenset(
        {"hdslb.com", "bilivideo.com", "vxbilibili.com", "fixembed.app"}
    ),
    "pinterest": frozenset({"pinimg.com"}),
    "tiktok": frozenset(
        {
            "tiktokcdn.com",
            "tiktokcdn-us.com",
            "muscdn.com",
            "byteoversea.com",
            "ibytedtos.com",
            "tiktok.com",
            "tnktok.com",
        }
    ),
    "tumblr": frozenset({"media.tumblr.com", "assets.tumblr.com"}),
    "twitch": frozenset({"jtvnw.net", "cloudfront.net"}),
    "deviantart": frozenset({"wixmp.com", "deviantart.net", "deviantart.com"}),
}


@dataclass(frozen=True)
class MediaFetchResponse:
    status_code: int
    content_type: str
    location: Optional[str]


def _media_host_allowed(platform: str, url: str) -> bool:
    try:
        parsed = urlparse(url)
        host = (parsed.hostname or "").casefold()
        port = parsed.port
    except ValueError:
        return False
    if parsed.scheme != "https" or not host or port not in {None, 443}:
        return False
    return any(
        host == suffix or host.endswith(f".{suffix}")
        for suffix in MEDIA_HOST_SUFFIXES.get(platform, ())
    )


async def fetch_media_prefix_with_session(
    session: aiohttp.ClientSession,
    url: str,
    timeout_seconds: float,
) -> MediaFetchResponse:
    timeout = aiohttp.ClientTimeout(total=timeout_seconds)
    async with session.get(
        url,
        allow_redirects=False,
        timeout=timeout,
    ) as response:
        await response.content.read(1)
        return MediaFetchResponse(
            response.status,
            (response.headers.get("Content-Type") or "").split(";", 1)[0].casefold(),
            response.headers.get("Location"),
        )


async def fetch_media_prefix(url: str, timeout_seconds: float) -> MediaFetchResponse:
    """Fetch at most the first media byte without following an unchecked redirect."""
    async with aiohttp.ClientSession(
        headers=MEDIA_PROBE_HEADERS,
        auto_decompress=False,
    ) as session:
        return await fetch_media_prefix_with_session(session, url, timeout_seconds)


def _media_failure_code(target: MediaTarget, reason: str) -> str:
    prefix = "avatar" if target.kind == "avatar" else "media"
    return f"{prefix}-{reason}"


async def _probe_media_target(
    platform: str,
    target: MediaTarget,
    *,
    fetch_media: Callable[[str, float], Awaitable[MediaFetchResponse]],
    timeout_seconds: float,
) -> tuple[str, ...]:
    """Probe one target, retrying once when the failure looks transient (#76).

    A carousel probes several CDN images at once, so a single timeout, dropped
    connection, 429 or 5xx used to fail a healthy multi-image post. Those get
    one more try; a 403, 404, wrong content type or rejected host never do.
    """
    codes, transient = await _probe_media_target_once(
        platform, target, fetch_media=fetch_media, timeout_seconds=timeout_seconds
    )
    if codes and transient:
        codes, _ = await _probe_media_target_once(
            platform, target, fetch_media=fetch_media, timeout_seconds=timeout_seconds
        )
    return codes


async def _probe_media_target_once(
    platform: str,
    target: MediaTarget,
    *,
    fetch_media: Callable[[str, float], Awaitable[MediaFetchResponse]],
    timeout_seconds: float,
) -> tuple[tuple[str, ...], bool]:
    """Codes for one probe, and whether a failure is worth one retry."""
    current_url = target.url
    for redirect_count in range(MAX_MEDIA_REDIRECTS + 1):
        if not _media_host_allowed(platform, current_url):
            return (_media_failure_code(target, "host-rejected"),), False
        try:
            response = await fetch_media(current_url, timeout_seconds)
        except asyncio.TimeoutError:
            return (_media_failure_code(target, "timeout"),), True
        except (aiohttp.ClientError, OSError):
            return (_media_failure_code(target, "probe-failed"),), True
        except Exception:
            return (_media_failure_code(target, "probe-failed"),), True

        if response.status_code in {301, 302, 303, 307, 308}:
            if not response.location:
                return (_media_failure_code(target, "http-failed"),), False
            if redirect_count == MAX_MEDIA_REDIRECTS:
                return (_media_failure_code(target, "redirect-limit"),), False
            try:
                current_url = urljoin(current_url, response.location)
            except (TypeError, ValueError):
                return (_media_failure_code(target, "host-rejected"),), False
            continue
        if response.status_code not in {200, 206}:
            transient = response.status_code == 429 or response.status_code >= 500
            return (_media_failure_code(target, "http-failed"),), transient

        content_type = response.content_type.split(";", 1)[0].strip().casefold()
        valid_type = content_type.startswith("image/")
        if target.kind != "avatar":
            valid_type = valid_type or content_type.startswith("video/")
            if (
                platform == "twitch"
                and content_type in {"application/octet-stream", "binary/octet-stream"}
                and urlparse(current_url).path.casefold().endswith(".mp4")
            ):
                # Twitch's signed CloudFront clip URLs serve valid MP4 bytes with
                # a generic binary content type even though Discord can play them.
                valid_type = True
        if not valid_type:
            return (_media_failure_code(target, "type-invalid"),), False
        return (), False
    return (_media_failure_code(target, "redirect-limit"),), False


async def probe_media_targets(
    platform: str,
    targets: Sequence[MediaTarget],
    *,
    fetch_media: Callable[[str, float], Awaitable[MediaFetchResponse]] = fetch_media_prefix,
    timeout_seconds: float,
) -> tuple[str, ...]:
    """Probe a rendered card's remote targets and return bounded outcome codes."""
    if len(targets) > MAX_MEDIA_TARGETS:
        return ("media-probe-limit",)
    results = await asyncio.gather(
        *(
            _probe_media_target(
                platform,
                target,
                fetch_media=fetch_media,
                timeout_seconds=timeout_seconds,
            )
            for target in targets
        )
    )
    return tuple(dict.fromkeys(code for codes in results for code in codes))
