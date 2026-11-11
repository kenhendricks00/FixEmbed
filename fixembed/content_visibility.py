"""Resolve server and channel content-visibility settings."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

CHANNEL_VISIBILITY_TABLE = "channel_visibility_settings"


@dataclass(frozen=True)
class ContentVisibility:
    """Effective visibility for source-classified social content."""

    show_nsfw: bool = False
    show_spoilers: bool = False

    def should_spoiler(self, payload: Mapping[str, Any]) -> bool:
        """Return whether Discord should conceal this payload's media."""
        if payload.get("sensitive") is not True:
            return False

        raw_types = payload.get("sensitivityTypes")
        sensitivity_types = {
            value
            for value in raw_types
            if value in {"nsfw", "spoiler"}
        } if isinstance(raw_types, (list, tuple, set, frozenset)) else set()
        if not sensitivity_types:
            sensitivity_types.add("nsfw")

        return (
            ("nsfw" in sensitivity_types and not self.show_nsfw)
            or ("spoiler" in sensitivity_types and not self.show_spoilers)
        )


def resolve_content_visibility(
    guild_settings: Mapping[str, Any],
    channel_override: Mapping[str, Any] | None = None,
    *,
    channel_is_nsfw: bool = False,
) -> ContentVisibility:
    """Apply channel override, NSFW-channel default, then server defaults."""
    show_nsfw = bool(guild_settings.get("show_nsfw", False))
    show_spoilers = bool(guild_settings.get("show_spoilers", False))
    if channel_is_nsfw:
        show_nsfw = True
        show_spoilers = True

    override = channel_override or {}
    if override.get("show_nsfw") is not None:
        show_nsfw = bool(override["show_nsfw"])
    if override.get("show_spoilers") is not None:
        show_spoilers = bool(override["show_spoilers"])

    return ContentVisibility(
        show_nsfw=show_nsfw,
        show_spoilers=show_spoilers,
    )


def is_nsfw_channel(channel: Any) -> bool:
    """Return a channel's NSFW state, including thread parent inheritance."""
    for candidate in (channel, getattr(channel, "parent", None)):
        check = getattr(candidate, "is_nsfw", None)
        if callable(check):
            try:
                if check():
                    return True
            except (AttributeError, TypeError):
                continue
    return False


def channel_visibility_override(
    overrides: Mapping[tuple[int, int], Mapping[str, Any]],
    channel: Any,
) -> Mapping[str, Any] | None:
    """Return a channel override, falling back to a thread's parent."""
    guild_id = getattr(getattr(channel, "guild", None), "id", None)
    for candidate in (channel, getattr(channel, "parent", None)):
        channel_id = getattr(candidate, "id", None)
        override = overrides.get((guild_id, channel_id))
        if override is not None:
            return override
    return None


async def init_content_visibility(db) -> None:
    """Create persistence for nullable per-channel visibility overrides."""
    await db.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {CHANNEL_VISIBILITY_TABLE} (
            guild_id INTEGER NOT NULL,
            channel_id INTEGER NOT NULL,
            show_nsfw BOOLEAN,
            show_spoilers BOOLEAN,
            PRIMARY KEY (guild_id, channel_id)
        )
        """
    )
    await db.commit()


async def load_channel_visibility_overrides(
    db,
) -> dict[tuple[int, int], dict[str, bool | None]]:
    """Load every persisted channel override into a lookup mapping."""
    overrides: dict[tuple[int, int], dict[str, bool | None]] = {}
    async with db.execute(
        f"""
        SELECT guild_id, channel_id, show_nsfw, show_spoilers
        FROM {CHANNEL_VISIBILITY_TABLE}
        """
    ) as cursor:
        async for guild_id, channel_id, show_nsfw, show_spoilers in cursor:
            overrides[(guild_id, channel_id)] = {
                "show_nsfw": None if show_nsfw is None else bool(show_nsfw),
                "show_spoilers": (
                    None if show_spoilers is None else bool(show_spoilers)
                ),
            }
    return overrides


async def set_channel_visibility_override(
    db,
    *,
    guild_id: int,
    channel_id: int,
    show_nsfw: bool | None,
    show_spoilers: bool | None,
) -> None:
    """Persist one channel override, deleting rows that fully inherit."""
    if show_nsfw is None and show_spoilers is None:
        await db.execute(
            f"""
            DELETE FROM {CHANNEL_VISIBILITY_TABLE}
            WHERE guild_id = ? AND channel_id = ?
            """,
            (guild_id, channel_id),
        )
    else:
        await db.execute(
            f"""
            INSERT INTO {CHANNEL_VISIBILITY_TABLE}
                (guild_id, channel_id, show_nsfw, show_spoilers)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(guild_id, channel_id) DO UPDATE SET
                show_nsfw = excluded.show_nsfw,
                show_spoilers = excluded.show_spoilers
            """,
            (guild_id, channel_id, show_nsfw, show_spoilers),
        )
    await db.commit()
