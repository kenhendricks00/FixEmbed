"""One-time migrations for persisted FixEmbed guild settings."""

import ast
import logging


YOUTUBE_DEFAULT_MIGRATION = "enable_youtube_community_posts_v1"
PINTEREST_DEFAULT_MIGRATION = "enable_pinterest_pins_v1"
NEW_SOCIAL_SERVICE_MIGRATIONS = (
    ("TikTok", "enable_tiktok_videos_v1"),
    ("Tumblr", "enable_tumblr_posts_v1"),
    ("Twitch", "enable_twitch_links_v1"),
)


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


async def migrate_service_default(db, service: str, migration_name: str) -> None:
    """Enable one newly supported service for guilds with persisted settings."""
    await db.execute(
        "CREATE TABLE IF NOT EXISTS app_migrations "
        "(name TEXT PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)"
    )
    async with db.execute(
        "SELECT 1 FROM app_migrations WHERE name = ?",
        (migration_name,),
    ) as cursor:
        if await cursor.fetchone():
            return

    async with db.execute(
        "SELECT guild_id, enabled_services FROM guild_settings"
    ) as cursor:
        rows = await cursor.fetchall()

    for guild_id, serialized in rows:
        updated, changed = add_service_to_serialized_settings(serialized, service)
        if changed:
            await db.execute(
                "UPDATE guild_settings SET enabled_services = ? WHERE guild_id = ?",
                (updated, guild_id),
            )

    await db.execute(
        "INSERT INTO app_migrations (name) VALUES (?)",
        (migration_name,),
    )
    await db.commit()


async def migrate_youtube_service_default(db) -> None:
    """Enable YouTube once for guilds saved before community-post support existed."""
    await migrate_service_default(db, "YouTube", YOUTUBE_DEFAULT_MIGRATION)


async def migrate_pinterest_service_default(db) -> None:
    """Enable Pinterest once for guilds saved before Pin support existed."""
    await migrate_service_default(db, "Pinterest", PINTEREST_DEFAULT_MIGRATION)


async def migrate_new_social_services_default(db) -> None:
    """Enable TikTok, Tumblr, and Twitch once for existing guilds."""
    for service, migration_name in NEW_SOCIAL_SERVICE_MIGRATIONS:
        await migrate_service_default(db, service, migration_name)
