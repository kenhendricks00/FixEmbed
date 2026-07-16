"""Capability-aware policy for automatic social-card delivery modes."""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from typing import Optional


DELIVERY_MODES = frozenset({"delete", "suppress", "reply"})
DELIVERY_MODE_LABELS = {
    "delete": "Delete original",
    "suppress": "Suppress original",
    "reply": "Keep original and reply",
}
SUCCESSFUL_DELIVERY_OUTCOMES = frozenset({"direct", "rescued"})


@dataclass(frozen=True)
class DeliveryModeDecision:
    configured_mode: str
    effective_mode: str
    downgrade_reason: Optional[str] = None


def resolve_delivery_mode(
    configured_mode: object,
    *,
    legacy_delete_original: bool,
    can_manage_messages: bool,
) -> DeliveryModeDecision:
    """Choose a mode that preserves delivery when destructive access is absent."""
    candidate = str(configured_mode or "")
    normalized = (
        candidate
        if candidate in DELIVERY_MODES
        else ("delete" if legacy_delete_original else "reply")
    )
    if normalized in {"delete", "suppress"} and not can_manage_messages:
        return DeliveryModeDecision(
            configured_mode=normalized,
            effective_mode="reply",
            downgrade_reason="missing_manage_messages",
        )
    return DeliveryModeDecision(
        configured_mode=normalized,
        effective_mode=normalized,
    )


def format_delivery_mode_status(decision: DeliveryModeDecision) -> str:
    """Explain the effective delivery behavior without exposing channel identity."""
    effective_label = DELIVERY_MODE_LABELS[decision.effective_mode]
    if not decision.downgrade_reason:
        return f"**Effective delivery:** {effective_label}"

    configured_label = DELIVERY_MODE_LABELS[decision.configured_mode]
    lines = [
        f"**Configured delivery:** {configured_label}",
        f"**Effective delivery:** {effective_label}",
    ]
    if decision.downgrade_reason == "missing_manage_messages":
        lines.append(
            "-# Manage Messages is missing, so FixEmbed will keep the original "
            "message and reply with the fixed card."
        )
    return "\n".join(lines)


def should_apply_source_message_action(
    mode: str,
    delivery_outcomes: Sequence[str],
) -> bool:
    """Mutate the source only after every replacement reached Discord."""
    if mode == "reply":
        return False
    if mode not in {"delete", "suppress"}:
        raise ValueError("unsupported delivery mode")
    return bool(delivery_outcomes) and all(
        outcome in SUCCESSFUL_DELIVERY_OUTCOMES
        for outcome in delivery_outcomes
    )


async def apply_source_message_action(
    mode: str,
    *,
    delete_message: Callable[[], Awaitable[object]],
    suppress_message: Callable[[], Awaitable[object]],
    forbidden_errors: tuple[type[BaseException], ...],
    on_permission_recovery: Callable[[str], None],
) -> None:
    """Apply a source-message action while making permission races non-fatal."""
    if mode == "reply":
        return
    actions = {
        "delete": delete_message,
        "suppress": suppress_message,
    }
    try:
        action = actions[mode]
    except KeyError as error:
        raise ValueError("unsupported delivery mode") from error
    try:
        await action()
    except forbidden_errors:
        on_permission_recovery("missing_manage_messages")
