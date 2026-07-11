"""One-time migrations for persisted FixEmbed guild settings."""

import ast
import logging


YOUTUBE_DEFAULT_MIGRATION = "enable_youtube_community_posts_v1"


def add_service_to_serialized_settings(serialized: str, service: str) -> tuple[str, bool]:
    """Append a new default service to one serialized guild service list."""
    try:
        enabled_services = ast.literal_eval(serialized) if serialized else []
    except (SyntaxError, ValueError):
        logging.warning("Skipped malformed enabled-services setting during migration")
        return serialized, False

    if not isinstance(enabled_services, list) or service in enabled_services:
        return serialized, False
    enabled_services.append(service)
    return repr(enabled_services), True


async def migrate_youtube_service_default(db) -> None:
    """Enable YouTube once for guilds saved before community-post support existed."""
    await db.execute(
        "CREATE TABLE IF NOT EXISTS app_migrations "
        "(name TEXT PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)"
    )
    async with db.execute(
        "SELECT 1 FROM app_migrations WHERE name = ?",
        (YOUTUBE_DEFAULT_MIGRATION,),
    ) as cursor:
        if await cursor.fetchone():
            return

    async with db.execute(
        "SELECT guild_id, enabled_services FROM guild_settings"
    ) as cursor:
        rows = await cursor.fetchall()

    for guild_id, serialized in rows:
        updated, changed = add_service_to_serialized_settings(serialized, "YouTube")
        if changed:
            await db.execute(
                "UPDATE guild_settings SET enabled_services = ? WHERE guild_id = ?",
                (updated, guild_id),
            )

    await db.execute(
        "INSERT INTO app_migrations (name) VALUES (?)",
        (YOUTUBE_DEFAULT_MIGRATION,),
    )
    await db.commit()
