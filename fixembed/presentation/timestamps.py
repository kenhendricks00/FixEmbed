"""Parse upstream publication times without inventing delivery timestamps."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional


def parse_post_timestamp(value: Any) -> Optional[int]:
    """Return a UTC epoch for a valid upstream post time, otherwise ``None``."""
    if value is None or isinstance(value, bool):
        return None

    if isinstance(value, (int, float)):
        seconds = float(value)
        if seconds >= 100_000_000_000:
            seconds /= 1000
        if seconds <= 0:
            return None
        try:
            timestamp = int(seconds)
            datetime.fromtimestamp(timestamp, timezone.utc)
            return timestamp
        except (OverflowError, OSError, ValueError):
            return None

    raw = str(value).strip()
    if not raw:
        return None
    if raw.isdigit():
        return parse_post_timestamp(int(raw))

    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return int(parsed.timestamp())
    except (OverflowError, OSError, ValueError):
        try:
            return int(datetime.strptime(raw, "%a %b %d %H:%M:%S %z %Y").timestamp())
        except (OverflowError, OSError, ValueError):
            return None


def parse_post_datetime(value: Any) -> Optional[datetime]:
    """Return an aware UTC datetime for Discord's legacy embed timestamp."""
    timestamp = parse_post_timestamp(value)
    if timestamp is None:
        return None
    return datetime.fromtimestamp(timestamp, timezone.utc)
