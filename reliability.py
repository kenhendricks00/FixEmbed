"""Validated, cached access to FixEmbed's public platform-health report."""

from __future__ import annotations

import asyncio
import json
import logging
import time
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass, replace
from typing import Any, Optional

import aiohttp

from timestamp_utils import parse_post_timestamp


STATUS_URL = "https://fixembed.app/api/status"
SUPPORTED_PLATFORM_NAMES = {
    "Twitter/X": "Twitter",
    "Instagram": "Instagram",
    "Reddit": "Reddit",
    "Threads": "Threads",
    "Pixiv": "Pixiv",
    "Bluesky": "Bluesky",
    "Bilibili": "Bilibili",
    "YouTube": "YouTube",
    "Pinterest": "Pinterest",
}
VALID_STATUSES = {"operational", "degraded", "outage"}
VALID_MODES = {"first-party", "fallback", "unavailable"}
MAX_STATUS_BODY_BYTES = 256 * 1024
STATUS_TIMEOUT_SECONDS = 30


@dataclass(frozen=True)
class PlatformHealth:
    service: str
    status: str
    mode: str
    latency_ms: int
    checked_at: Optional[int]
    response_code: Optional[int]
    notice: str = ""


@dataclass(frozen=True)
class ReliabilityReport:
    overall_status: str
    updated_at: Optional[int]
    platforms: tuple[PlatformHealth, ...] = ()
    stale: bool = False
    error_code: Optional[str] = None

    @property
    def available(self) -> bool:
        return bool(self.platforms)


def _bounded_text(value: Any, limit: int = 180) -> str:
    return " ".join(str(value or "").split())[:limit]


def _bounded_integer(value: Any, *, minimum: int, maximum: int) -> Optional[int]:
    if isinstance(value, bool):
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return parsed if minimum <= parsed <= maximum else None


def parse_reliability_payload(payload: Any) -> ReliabilityReport:
    """Validate the public Worker status response before displaying it."""
    if not isinstance(payload, Mapping):
        raise ValueError("status payload must be an object")

    raw_rows = payload.get("platforms")
    if not isinstance(raw_rows, list):
        raise ValueError("status payload has no platform list")

    rows: list[PlatformHealth] = []
    for raw_row in raw_rows[: len(SUPPORTED_PLATFORM_NAMES)]:
        if not isinstance(raw_row, Mapping):
            continue
        service = SUPPORTED_PLATFORM_NAMES.get(str(raw_row.get("platform") or ""))
        status = str(raw_row.get("status") or "").lower()
        mode = str(raw_row.get("mode") or "").lower()
        latency_ms = _bounded_integer(
            raw_row.get("currentLatencyMs"), minimum=0, maximum=120_000
        )
        if not service or status not in VALID_STATUSES or mode not in VALID_MODES:
            continue
        rows.append(
            PlatformHealth(
                service=service,
                status=status,
                mode=mode,
                latency_ms=latency_ms or 0,
                checked_at=parse_post_timestamp(raw_row.get("checkedAt")),
                response_code=_bounded_integer(
                    raw_row.get("responseCode"), minimum=100, maximum=599
                ),
                notice=_bounded_text(raw_row.get("notice")),
            )
        )

    if not rows:
        raise ValueError("status payload has no supported platform rows")

    overall_status = "operational"
    if any(row.status == "outage" for row in rows):
        overall_status = "outage"
    elif any(row.status == "degraded" for row in rows):
        overall_status = "degraded"

    return ReliabilityReport(
        overall_status=overall_status,
        updated_at=parse_post_timestamp(payload.get("updatedAt")),
        platforms=tuple(rows),
    )


async def _fetch_status_json(url: str) -> Any:
    timeout = aiohttp.ClientTimeout(total=STATUS_TIMEOUT_SECONDS)
    headers = {"User-Agent": "FixEmbedBot/1.4 reliability-check"}
    async with aiohttp.ClientSession(timeout=timeout, headers=headers) as session:
        async with session.get(url) as response:
            response.raise_for_status()
            body = await response.content.read(MAX_STATUS_BODY_BYTES + 1)
            if len(body) > MAX_STATUS_BODY_BYTES:
                raise ValueError("status response too large")
            return json.loads(body)


class ReliabilityClient:
    """Fetch live health once per cache window and preserve recent good data."""

    def __init__(
        self,
        *,
        status_url: str = STATUS_URL,
        fetch_json: Callable[[str], Awaitable[Any]] = _fetch_status_json,
        clock: Callable[[], float] = time.monotonic,
        cache_ttl_seconds: float = 30,
        stale_ttl_seconds: float = 300,
        retry_delay_seconds: float = 15,
    ):
        self.status_url = status_url
        self.fetch_json = fetch_json
        self.clock = clock
        self.cache_ttl_seconds = cache_ttl_seconds
        self.stale_ttl_seconds = stale_ttl_seconds
        self.retry_delay_seconds = retry_delay_seconds
        self._cached_report: Optional[ReliabilityReport] = None
        self._cached_at = float("-inf")
        self._failure_report: Optional[ReliabilityReport] = None
        self._next_retry_at = float("-inf")
        self._refresh_generation = 0
        self._lock = asyncio.Lock()

    async def get_report(self, *, force: bool = False) -> ReliabilityReport:
        requested_at = self.clock()
        requested_generation = self._refresh_generation
        age = requested_at - self._cached_at
        if not force and self._cached_report and age < self.cache_ttl_seconds:
            return self._cached_report
        if self._failure_report and requested_at < self._next_retry_at:
            return self._failure_report

        async with self._lock:
            now = self.clock()
            age = now - self._cached_at
            if self._failure_report and now < self._next_retry_at:
                return self._failure_report
            if self._cached_report and (
                (not force and age < self.cache_ttl_seconds)
                or (force and self._refresh_generation != requested_generation)
            ):
                return self._cached_report

            try:
                report = parse_reliability_payload(
                    await self.fetch_json(self.status_url)
                )
            except Exception as error:
                logging.warning(
                    "reliability_status_fetch_failed",
                    extra={
                        "event": "reliability_status_fetch_failed",
                        "error_type": type(error).__name__,
                    },
                )
                if self._cached_report and age <= self.stale_ttl_seconds:
                    failure_report = replace(
                        self._cached_report,
                        stale=True,
                        error_code="status_refresh_failed",
                    )
                else:
                    failure_report = ReliabilityReport(
                        overall_status="unavailable",
                        updated_at=None,
                        error_code="status_unavailable",
                    )
                self._failure_report = failure_report
                self._next_retry_at = self.clock() + self.retry_delay_seconds
                return failure_report

            self._cached_report = report
            self._cached_at = self.clock()
            self._failure_report = None
            self._next_retry_at = float("-inf")
            self._refresh_generation += 1
            return report


def format_reliability_status(
    report: ReliabilityReport,
    *,
    local_stats: Mapping[str, Any],
    pending_sends: int,
    icon_for_service: Callable[[str], str],
) -> str:
    """Build bounded Discord markdown for the Reliability Components V2 card."""
    status_labels = {
        "operational": "✅ Operational",
        "degraded": "⚠️ Degraded",
        "outage": "❌ Outage",
        "unavailable": "⚪ Unavailable",
    }
    mode_labels = {
        "first-party": "First-party",
        "fallback": "Fallback",
        "unavailable": "Unavailable",
    }

    lines = [
        f"**Live platform health:** {status_labels.get(report.overall_status, '⚪ Unavailable')}"
    ]
    if report.updated_at:
        lines[0] += f" · Updated <t:{report.updated_at}:R>"

    if report.available:
        for row in report.platforms:
            lines.append(
                f"{icon_for_service(row.service)} **{row.service}:** "
                f"{status_labels[row.status]} · {mode_labels[row.mode]} · "
                f"{row.latency_ms}ms"
            )
        if report.stale:
            lines.append("-# Live refresh failed; showing recent verified data.")
    else:
        lines.append("-# Live health is temporarily unavailable; local counters remain below.")

    total_fixed = _bounded_integer(
        local_stats.get("total_fixed"), minimum=0, maximum=1_000_000_000
    ) or 0
    total_failed = _bounded_integer(
        local_stats.get("total_failed"), minimum=0, maximum=1_000_000_000
    ) or 0
    pending = _bounded_integer(
        pending_sends, minimum=0, maximum=1_000_000
    ) or 0
    lines.extend(
        (
            "",
            f"**This bot process:** {total_fixed} fixed · {total_failed} failed · {pending} pending",
        )
    )
    return "\n".join(lines)
