"""Persistence and entitlement-gated policy helpers for Premium controls."""

from __future__ import annotations

import json
import re
from datetime import date, timedelta
from typing import Any, Mapping


DEFAULT_PREMIUM_CONTROLS = {
    "card_show_stats": True,
    "card_show_hashtags": True,
    "card_caption_mode": "full",
    "translation_language": None,
    "ignored_user_ids": [],
    "ignored_role_ids": [],
}


def _normalize_ids(values: Any) -> list[int]:
    result = []
    for value in values if isinstance(values, (list, tuple, set)) else ():
        try:
            identifier = int(value)
        except (TypeError, ValueError):
            continue
        if identifier > 0 and identifier not in result:
            result.append(identifier)
        if len(result) == 25:
            break
    return result


def normalize_premium_controls(settings: Mapping[str, Any]) -> dict[str, Any]:
    caption_mode = settings.get("card_caption_mode")
    if caption_mode not in {"full", "compact"}:
        caption_mode = "full"
    language = settings.get(
        "translation_language",
        settings.get("twitter_language"),
    )
    if isinstance(language, str):
        language = language.strip().lower()
    if not isinstance(language, str) or not re.fullmatch(r"[a-z]{2}", language):
        language = None
    return {
        "card_show_stats": bool(settings.get("card_show_stats", True)),
        "card_show_hashtags": bool(settings.get("card_show_hashtags", True)),
        "card_caption_mode": caption_mode,
        "translation_language": language,
        "ignored_user_ids": _normalize_ids(settings.get("ignored_user_ids")),
        "ignored_role_ids": _normalize_ids(settings.get("ignored_role_ids")),
    }


async def init_premium_controls(db) -> None:
    await db.execute(
        """CREATE TABLE IF NOT EXISTS guild_premium_controls (
            guild_id INTEGER PRIMARY KEY,
            card_show_stats BOOLEAN NOT NULL DEFAULT TRUE,
            card_show_hashtags BOOLEAN NOT NULL DEFAULT TRUE,
            card_caption_mode TEXT NOT NULL DEFAULT 'full',
            translation_language TEXT DEFAULT NULL,
            ignored_user_ids TEXT NOT NULL DEFAULT '[]',
            ignored_role_ids TEXT NOT NULL DEFAULT '[]'
        )"""
    )
    columns = {
        str(row[1])
        for row in await (await db.execute(
            "PRAGMA table_info(guild_premium_controls)"
        )).fetchall()
    }
    if "translation_language" not in columns:
        await db.execute(
            "ALTER TABLE guild_premium_controls "
            "ADD COLUMN translation_language TEXT DEFAULT NULL"
        )
        if "twitter_language" in columns:
            await db.execute(
                "UPDATE guild_premium_controls "
                "SET translation_language = twitter_language "
                "WHERE translation_language IS NULL"
            )
    await db.execute(
        """CREATE TABLE IF NOT EXISTS guild_daily_analytics (
            guild_id INTEGER NOT NULL,
            day TEXT NOT NULL,
            service TEXT NOT NULL,
            rich_count INTEGER NOT NULL DEFAULT 0,
            fallback_count INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (guild_id, day, service)
        )"""
    )
    cutoff = (date.today() - timedelta(days=90)).isoformat()
    await db.execute("DELETE FROM guild_daily_analytics WHERE day < ?", (cutoff,))
    await db.commit()


async def save_premium_controls(db, guild_id: int, settings: Mapping[str, Any]) -> None:
    controls = normalize_premium_controls(settings)
    await db.execute(
        """INSERT INTO guild_premium_controls (
            guild_id, card_show_stats, card_show_hashtags, card_caption_mode,
            translation_language, ignored_user_ids, ignored_role_ids
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(guild_id) DO UPDATE SET
            card_show_stats = excluded.card_show_stats,
            card_show_hashtags = excluded.card_show_hashtags,
            card_caption_mode = excluded.card_caption_mode,
            translation_language = excluded.translation_language,
            ignored_user_ids = excluded.ignored_user_ids,
            ignored_role_ids = excluded.ignored_role_ids""",
        (
            int(guild_id),
            controls["card_show_stats"],
            controls["card_show_hashtags"],
            controls["card_caption_mode"],
            controls["translation_language"],
            json.dumps(controls["ignored_user_ids"]),
            json.dumps(controls["ignored_role_ids"]),
        ),
    )
    await db.commit()


async def load_premium_controls(db) -> dict[int, dict[str, Any]]:
    cursor = await db.execute(
        """SELECT guild_id, card_show_stats, card_show_hashtags,
        card_caption_mode, translation_language, ignored_user_ids, ignored_role_ids
        FROM guild_premium_controls"""
    )
    rows = await cursor.fetchall()
    result = {}
    for row in rows:
        try:
            users = json.loads(row[5] or "[]")
        except (TypeError, ValueError, json.JSONDecodeError):
            users = []
        try:
            roles = json.loads(row[6] or "[]")
        except (TypeError, ValueError, json.JSONDecodeError):
            roles = []
        result[int(row[0])] = normalize_premium_controls(
            {
                "card_show_stats": row[1],
                "card_show_hashtags": row[2],
                "card_caption_mode": row[3],
                "translation_language": row[4],
                "ignored_user_ids": users,
                "ignored_role_ids": roles,
            }
        )
    return result


def resolve_translation_language(
    explicit_language: str | None,
    settings: Mapping[str, Any],
) -> str | None:
    if explicit_language:
        return explicit_language.lower()
    return normalize_premium_controls(settings)["translation_language"]


def should_skip_automatic(message, settings: Mapping[str, Any], *, premium: bool) -> bool:
    if not premium:
        return False
    controls = normalize_premium_controls(settings)
    if int(message.author.id) in controls["ignored_user_ids"]:
        return True
    role_ids = {int(role.id) for role in getattr(message.author, "roles", ())}
    return bool(role_ids.intersection(controls["ignored_role_ids"]))


async def record_processing_outcome(
    db,
    guild_id: int,
    service: str,
    *,
    rich: bool,
    day: str | None = None,
) -> None:
    """Record one aggregate outcome without retaining message or link content."""
    service = str(service or "Unknown")[:50]
    event_day = day or date.today().isoformat()
    rich_increment = 1 if rich else 0
    fallback_increment = 0 if rich else 1
    await db.execute(
        """INSERT INTO guild_daily_analytics (
            guild_id, day, service, rich_count, fallback_count
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(guild_id, day, service) DO UPDATE SET
            rich_count = rich_count + excluded.rich_count,
            fallback_count = fallback_count + excluded.fallback_count""",
        (int(guild_id), event_day, service, rich_increment, fallback_increment),
    )
    await db.commit()


async def fetch_analytics_summary(db, guild_id: int, *, days: int = 30) -> list[dict[str, Any]]:
    """Return per-service aggregate outcomes for the requested retention window."""
    window = min(max(int(days), 1), 90)
    cutoff = (date.today() - timedelta(days=window - 1)).isoformat()
    cursor = await db.execute(
        """SELECT service, SUM(rich_count), SUM(fallback_count)
        FROM guild_daily_analytics
        WHERE guild_id = ? AND day >= ?
        GROUP BY service
        ORDER BY SUM(rich_count) + SUM(fallback_count) DESC, service ASC""",
        (int(guild_id), cutoff),
    )
    rows = await cursor.fetchall()
    return [
        {
            "service": str(row[0]),
            "rich_count": int(row[1] or 0),
            "fallback_count": int(row[2] or 0),
        }
        for row in rows
    ]
