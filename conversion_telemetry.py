"""Privacy-safe, process-local telemetry for rich social-card builds."""

from __future__ import annotations

import asyncio
import json
import logging
import math
import re
import secrets
import time
from collections import Counter, deque
from collections.abc import Callable
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from typing import Optional


DEFAULT_SUPPORTED_SERVICES = frozenset(
    {
        "Twitter",
        "Instagram",
        "Reddit",
        "Threads",
        "Pixiv",
        "Bluesky",
        "Bilibili",
        "YouTube",
        "Pinterest",
    }
)
FAILURE_LABELS = {
    "timeout": "Timeout",
    "rate_limited": "Rate limited",
    "network": "Network",
    "upstream_4xx": "Upstream 4xx",
    "upstream_5xx": "Upstream 5xx",
    "invalid_response": "Invalid metadata",
    "unexpected": "Unexpected",
}
LOGGER = logging.getLogger("fixembed.conversion")


@dataclass(frozen=True)
class ServiceConversionSnapshot:
    service: str
    attempts: int
    rich: int
    fallbacks: int
    p95_ms: int
    sample_count: int
    primary_failure: Optional[str]


@dataclass(frozen=True)
class ConversionSnapshot:
    total_attempts: int
    total_rich: int
    total_fallbacks: int
    p95_ms: int
    services: tuple[ServiceConversionSnapshot, ...]


class _ServiceState:
    def __init__(self, sample_size: int):
        self.attempts = 0
        self.rich = 0
        self.fallbacks = 0
        self.durations_ms: deque[int] = deque(maxlen=sample_size)
        self.failures: Counter[str] = Counter()


def _bounded_status(error: BaseException) -> Optional[int]:
    value = getattr(error, "status", None)
    if isinstance(value, bool):
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return parsed if 100 <= parsed <= 599 else None


def classify_build_failure(error: BaseException) -> str:
    """Map arbitrary exceptions onto a fixed, low-cardinality category set."""
    if isinstance(error, (asyncio.TimeoutError, TimeoutError)):
        return "timeout"
    status = _bounded_status(error)
    if status == 429:
        return "rate_limited"
    if status is not None and 400 <= status <= 499:
        return "upstream_4xx"
    if status is not None and 500 <= status <= 599:
        return "upstream_5xx"
    if isinstance(error, (ConnectionError, OSError)):
        return "network"
    if isinstance(error, (ValueError, TypeError, KeyError, json.JSONDecodeError)):
        return "invalid_response"
    return "unexpected"


def _percentile_95(values: list[int]) -> int:
    if not values:
        return 0
    ordered = sorted(values)
    return ordered[max(0, math.ceil(len(ordered) * 0.95) - 1)]


def _safe_identifier(value: object, *, limit: int) -> str:
    return re.sub(r"[^A-Za-z0-9_-]", "", str(value or ""))[:limit] or "unknown"


def new_request_id() -> str:
    """Generate a correlation ID that contains no Discord or post identity."""
    return secrets.token_hex(8)


class _BuildObservation(AbstractAsyncContextManager):
    def __init__(
        self,
        telemetry: "ConversionTelemetry",
        service: str,
        request_id: str,
    ):
        self.telemetry = telemetry
        self.service = service
        self.request_id = request_id
        self.started_at = 0.0

    async def __aenter__(self):
        self.started_at = self.telemetry.clock()
        return self

    async def __aexit__(self, error_type, error, traceback):
        if isinstance(error, asyncio.CancelledError):
            return False
        duration_ms = max(
            0,
            min(round((self.telemetry.clock() - self.started_at) * 1000), 120_000),
        )
        self.telemetry._record(
            self.service,
            duration_ms=duration_ms,
            error=error,
            request_id=self.request_id,
        )
        return False


class ConversionTelemetry:
    """Maintain bounded aggregate card-build quality for the current process."""

    def __init__(
        self,
        *,
        clock: Callable[[], float] = time.monotonic,
        sample_size: int = 200,
        supported_services=DEFAULT_SUPPORTED_SERVICES,
    ):
        self.clock = clock
        self.sample_size = max(1, min(int(sample_size), 1_000))
        self.supported_services = frozenset(
            str(service)
            for service in tuple(supported_services)[:50]
            if isinstance(service, str) and 0 < len(service) <= 50
        )
        self._states: dict[str, _ServiceState] = {}

    def observe(self, service: object, request_id: object) -> _BuildObservation:
        candidate = str(service or "")
        service_label = (
            candidate if candidate in self.supported_services else "Unknown"
        )
        return _BuildObservation(
            self,
            service_label,
            _safe_identifier(request_id, limit=32),
        )

    def _record(
        self,
        service: str,
        *,
        duration_ms: int,
        error: Optional[BaseException],
        request_id: str,
    ) -> None:
        state = self._states.setdefault(service, _ServiceState(self.sample_size))
        state.attempts += 1
        state.durations_ms.append(duration_ms)
        if error is None:
            state.rich += 1
            return

        category = classify_build_failure(error)
        state.fallbacks += 1
        state.failures[category] += 1
        event = {
            "event": "conversion_card_fallback",
            "request_id": request_id,
            "service": service,
            "category": category,
            "error_type": _safe_identifier(type(error).__name__, limit=64),
            "duration_ms": duration_ms,
        }
        LOGGER.warning(json.dumps(event, separators=(",", ":"), sort_keys=True))

    def snapshot(self) -> ConversionSnapshot:
        services = tuple(
            ServiceConversionSnapshot(
                service=service,
                attempts=state.attempts,
                rich=state.rich,
                fallbacks=state.fallbacks,
                p95_ms=_percentile_95(list(state.durations_ms)),
                sample_count=len(state.durations_ms),
                primary_failure=(
                    max(
                        state.failures.items(),
                        key=lambda item: (item[1], item[0]),
                    )[0]
                    if state.failures
                    else None
                ),
            )
            for service, state in self._states.items()
        )
        all_durations = [
            duration
            for state in self._states.values()
            for duration in state.durations_ms
        ]
        return ConversionSnapshot(
            total_attempts=sum(service.attempts for service in services),
            total_rich=sum(service.rich for service in services),
            total_fallbacks=sum(service.fallbacks for service in services),
            p95_ms=_percentile_95(all_durations),
            services=services,
        )


def format_local_conversion_health(
    snapshot: ConversionSnapshot,
    *,
    icon_for_service: Callable[[str], str],
) -> str:
    """Render a compact, bounded summary for the Reliability page."""
    if snapshot.total_attempts:
        rich_rate = snapshot.total_rich / snapshot.total_attempts * 100
        lines = [
            f"**Local card quality:** {snapshot.total_rich} rich · "
            f"{snapshot.total_fallbacks} link fallbacks",
            f"**Recent rich-card rate:** {rich_rate:.1f}% · p95 {snapshot.p95_ms}ms",
        ]
        degraded = sorted(
            (service for service in snapshot.services if service.fallbacks),
            key=lambda service: (
                service.fallbacks / max(service.attempts, 1),
                service.fallbacks,
                service.p95_ms,
            ),
            reverse=True,
        )
        if degraded:
            lines.append("**Needs attention**")
            for service in degraded[:3]:
                label = FAILURE_LABELS.get(service.primary_failure or "", "Unknown")
                lines.append(
                    f"{icon_for_service(service.service)} **{service.service}:** "
                    f"{service.fallbacks}/{service.attempts} fallbacks · {label} · "
                    f"p95 {service.p95_ms}ms"
                )
    else:
        lines = ["**Local card quality:** No builds yet"]
    lines.append("-# Process-scoped aggregates; no links, posts, or member data retained.")
    return "\n".join(lines)
