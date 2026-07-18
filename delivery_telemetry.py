"""Privacy-safe, process-local telemetry for Discord message delivery."""

from __future__ import annotations

import asyncio
import json
import logging
import math
import re
import secrets
import time
from collections import Counter, deque
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Literal, Optional


DELIVERY_KINDS = frozenset({"card", "link"})
DOWNGRADE_REASONS = frozenset({"missing_manage_messages"})
DEFAULT_CARD_DELIVERY_ATTEMPT_TIMEOUT_SECONDS = 15.0
DEFAULT_LINK_DELIVERY_ATTEMPT_TIMEOUT_SECONDS = 15.0
FAILURE_LABELS = {
    "timeout": "Timeout",
    "forbidden": "Missing permissions",
    "not_found": "Channel unavailable",
    "rate_limited": "Rate limited",
    "network": "Network",
    "discord_4xx": "Discord 4xx",
    "discord_5xx": "Discord 5xx",
    "unexpected": "Unexpected",
}
LOGGER = logging.getLogger("fixembed.delivery")


@dataclass
class DeliveryTicket:
    request_id: str
    kind: str
    enqueued_at: float
    completed: bool = False


@dataclass(frozen=True)
class DeliverySnapshot:
    total_queued: int
    direct_deliveries: int
    link_rescues: int
    failed: int
    p95_ms: int
    sample_count: int
    primary_failure: Optional[str]
    mode_downgrades: int
    primary_downgrade: Optional[str]

    @property
    def completed(self) -> int:
        return self.direct_deliveries + self.link_rescues + self.failed


def _bounded_status(error: BaseException) -> Optional[int]:
    value = getattr(error, "status", None)
    if isinstance(value, bool):
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return parsed if 100 <= parsed <= 599 else None


def classify_delivery_failure(error: BaseException) -> str:
    """Map Discord/send errors onto fixed operational categories."""
    if isinstance(error, (asyncio.TimeoutError, TimeoutError)):
        return "timeout"
    status = _bounded_status(error)
    if status == 403:
        return "forbidden"
    if status == 404:
        return "not_found"
    if status == 429:
        return "rate_limited"
    if status is not None and 400 <= status <= 499:
        return "discord_4xx"
    if status is not None and 500 <= status <= 599:
        return "discord_5xx"
    if isinstance(error, (ConnectionError, OSError)):
        return "network"
    return "unexpected"


def _percentile_95(values: list[int]) -> int:
    if not values:
        return 0
    ordered = sorted(values)
    return ordered[max(0, math.ceil(len(ordered) * 0.95) - 1)]


def _safe_identifier(value: object, *, limit: int) -> str:
    return re.sub(r"[^A-Za-z0-9_-]", "", str(value or ""))[:limit] or "unknown"


class DeliveryTelemetry:
    """Track bounded aggregate Discord delivery health for this process."""

    def __init__(
        self,
        *,
        clock: Callable[[], float] = time.monotonic,
        sample_size: int = 200,
    ):
        self.clock = clock
        self.sample_size = max(1, min(int(sample_size), 1_000))
        self._total_queued = 0
        self._direct_deliveries = 0
        self._link_rescues = 0
        self._failed = 0
        self._durations_ms: deque[int] = deque(maxlen=self.sample_size)
        self._rescued_failures: Counter[str] = Counter()
        self._fatal_failures: Counter[str] = Counter()
        self._mode_downgrades: Counter[str] = Counter()

    def queued(self, kind: object) -> DeliveryTicket:
        candidate = str(kind or "")
        kind_label = candidate if candidate in DELIVERY_KINDS else "other"
        self._total_queued += 1
        return DeliveryTicket(
            request_id=secrets.token_hex(8),
            kind=kind_label,
            enqueued_at=self.clock(),
        )

    def delivered(self, ticket: DeliveryTicket) -> None:
        if not self._complete(ticket):
            return
        self._direct_deliveries += 1

    def link_rescued(self, ticket: DeliveryTicket, error: BaseException) -> None:
        if not self._complete(ticket):
            return
        self._link_rescues += 1
        category = classify_delivery_failure(error)
        self._rescued_failures[category] += 1
        self._log(
            logging.WARNING,
            event="discord_delivery_link_rescued",
            ticket=ticket,
            category=category,
            error=error,
        )

    def failed(self, ticket: DeliveryTicket, error: BaseException) -> None:
        if not self._complete(ticket):
            return
        self._failed += 1
        category = classify_delivery_failure(error)
        self._fatal_failures[category] += 1
        self._log(
            logging.ERROR,
            event="discord_delivery_failed",
            ticket=ticket,
            category=category,
            error=error,
        )

    def mode_downgraded(self, reason: object) -> None:
        candidate = str(reason or "")
        reason_label = candidate if candidate in DOWNGRADE_REASONS else "other"
        self._mode_downgrades[reason_label] += 1

    def _complete(self, ticket: DeliveryTicket) -> bool:
        if ticket.completed:
            return False
        ticket.completed = True
        duration_ms = max(
            0,
            min(round((self.clock() - ticket.enqueued_at) * 1000), 120_000),
        )
        self._durations_ms.append(duration_ms)
        return True

    def _log(
        self,
        level: int,
        *,
        event: str,
        ticket: DeliveryTicket,
        category: str,
        error: BaseException,
    ) -> None:
        duration_ms = self._durations_ms[-1] if self._durations_ms else 0
        payload = {
            "event": event,
            "request_id": _safe_identifier(ticket.request_id, limit=32),
            "kind": ticket.kind,
            "category": category,
            "error_type": _safe_identifier(type(error).__name__, limit=64),
            "duration_ms": duration_ms,
        }
        LOGGER.log(level, json.dumps(payload, separators=(",", ":"), sort_keys=True))

    def snapshot(self) -> DeliverySnapshot:
        failures = self._fatal_failures or self._rescued_failures
        primary_failure = (
            max(failures.items(), key=lambda item: (item[1], item[0]))[0]
            if failures
            else None
        )
        primary_downgrade = (
            max(
                self._mode_downgrades.items(),
                key=lambda item: (
                    item[1],
                    item[0] == "missing_manage_messages",
                ),
            )[0]
            if self._mode_downgrades
            else None
        )
        return DeliverySnapshot(
            total_queued=self._total_queued,
            direct_deliveries=self._direct_deliveries,
            link_rescues=self._link_rescues,
            failed=self._failed,
            p95_ms=_percentile_95(list(self._durations_ms)),
            sample_count=len(self._durations_ms),
            primary_failure=primary_failure,
            mode_downgrades=sum(self._mode_downgrades.values()),
            primary_downgrade=primary_downgrade,
        )


async def deliver_with_fallback(
    ticket: DeliveryTicket,
    *,
    telemetry: DeliveryTelemetry,
    primary_send: Callable[[], Awaitable[object]],
    fallback_send: Optional[Callable[[], Awaitable[object]]],
    attempt_timeout_seconds: Optional[float] = None,
) -> Literal["direct", "rescued", "failed"]:
    """Run one queued send and record exactly one terminal delivery outcome."""
    if attempt_timeout_seconds is None:
        primary_timeout_seconds = (
            DEFAULT_CARD_DELIVERY_ATTEMPT_TIMEOUT_SECONDS
            if ticket.kind == "card"
            else DEFAULT_LINK_DELIVERY_ATTEMPT_TIMEOUT_SECONDS
        )
        fallback_timeout_seconds = DEFAULT_LINK_DELIVERY_ATTEMPT_TIMEOUT_SECONDS
    else:
        if (
            not math.isfinite(attempt_timeout_seconds)
            or attempt_timeout_seconds <= 0
        ):
            raise ValueError("delivery attempt timeout must be positive and finite")
        primary_timeout_seconds = attempt_timeout_seconds
        fallback_timeout_seconds = attempt_timeout_seconds
    try:
        await asyncio.wait_for(primary_send(), timeout=primary_timeout_seconds)
    except Exception as error:
        if fallback_send is None:
            telemetry.failed(ticket, error)
            return "failed"
        try:
            await asyncio.wait_for(
                fallback_send(),
                timeout=fallback_timeout_seconds,
            )
        except Exception as fallback_error:
            telemetry.failed(ticket, fallback_error)
            return "failed"
        else:
            telemetry.link_rescued(ticket, error)
            return "rescued"
    else:
        telemetry.delivered(ticket)
        return "direct"


def format_delivery_health(snapshot: DeliverySnapshot, *, pending: int) -> str:
    """Render bounded Discord delivery health for the Reliability page."""
    try:
        pending_count = max(0, min(int(pending), 1_000_000))
    except (TypeError, ValueError, OverflowError):
        pending_count = 0

    if snapshot.completed:
        rescue_label = "link rescue" if snapshot.link_rescues == 1 else "link rescues"
        lines = [
            f"**Discord delivery:** {snapshot.direct_deliveries} direct · "
            f"{snapshot.link_rescues} {rescue_label} · {snapshot.failed} failed · "
            f"{pending_count} pending",
        ]
        successful = snapshot.direct_deliveries + snapshot.link_rescues
        delivery_rate = successful / snapshot.completed * 100
        lines.append(
            f"**Recent delivery rate:** {delivery_rate:.1f}% · p95 {snapshot.p95_ms}ms"
        )
        if snapshot.primary_failure:
            label = FAILURE_LABELS.get(snapshot.primary_failure, "Unknown")
            lines.append(f"**Primary delivery issue:** {label}")
    else:
        lines = [
            f"**Discord delivery:** No completed sends yet · {pending_count} pending"
        ]
    if snapshot.mode_downgrades:
        downgrade_label = (
            "reply downgrade" if snapshot.mode_downgrades == 1 else "reply downgrades"
        )
        reason_label = (
            "Missing Manage Messages"
            if snapshot.primary_downgrade == "missing_manage_messages"
            else "Unavailable configured capability"
        )
        lines.append(
            f"**Automatic permission recovery:** {snapshot.mode_downgrades} "
            f"{downgrade_label} · {reason_label}"
        )
    lines.append("-# Process-scoped aggregates; no channel, message, or member data retained.")
    return "\n".join(lines)
