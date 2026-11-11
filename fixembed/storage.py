"""Persist bot settings and migrate existing SQLite databases in place."""

import ast
import asyncio
import sqlite3

import aiosqlite

from .config import DEFAULT_ENABLED_SERVICES

channel_states = {}
bot_settings = {}
channel_service_rules = {}
channel_visibility_overrides = {}

# Column order is shared by schema creation and writes. Existing database names
# and serialized enabled-service lists remain compatible with earlier releases.
SETTING_COLUMNS = {
    "enabled_services": "TEXT",
    "mention_users": "BOOLEAN DEFAULT TRUE",
    "delete_original": "BOOLEAN DEFAULT TRUE",
    "language": "TEXT DEFAULT 'en'",
    "embed_color": "TEXT DEFAULT NULL",
    "delivery_mode": "TEXT DEFAULT 'suppress'",
    "media_quality": "TEXT DEFAULT 'balanced'",
    "footer_branding_enabled": "BOOLEAN DEFAULT FALSE",
    "footer_emoji_id": "INTEGER DEFAULT NULL",
    "show_nsfw": "BOOLEAN DEFAULT FALSE",
    "show_spoilers": "BOOLEAN DEFAULT FALSE",
}


def default_settings():
    """Return fresh defaults so each guild owns its enabled-service list."""
    return {
        "enabled_services": DEFAULT_ENABLED_SERVICES.copy(),
        "mention_users": True,
        "delete_original": True,
        "language": "en",
        "embed_color": None,
        "delivery_mode": "suppress",
        "media_quality": "balanced",
        "footer_branding_enabled": False,
        "footer_emoji_id": None,
        "show_nsfw": False,
        "show_spoilers": False,
    }


async def init_db(path="fixembed_data.db"):
    db = await aiosqlite.connect(path)
    try:
        await db.execute(
            "CREATE TABLE IF NOT EXISTS channel_states (channel_id INTEGER PRIMARY KEY, state BOOLEAN)"
        )
        columns = ", ".join(
            f"{name} {definition}" for name, definition in SETTING_COLUMNS.items()
        )
        await db.execute(
            f"CREATE TABLE IF NOT EXISTS guild_settings (guild_id INTEGER PRIMARY KEY, {columns})"
        )
        await db.execute(
            "CREATE TABLE IF NOT EXISTS channel_service_rules (guild_id INTEGER, channel_id INTEGER, service TEXT, action TEXT, PRIMARY KEY (guild_id, channel_id, service))"
        )
        async with db.execute("PRAGMA table_info(guild_settings)") as cursor:
            existing = {row[1] for row in await cursor.fetchall()}
        for name, definition in SETTING_COLUMNS.items():
            if name not in existing:
                await db.execute(
                    f"ALTER TABLE guild_settings ADD COLUMN {name} {definition}"
                )
        await db.commit()
        return db
    except BaseException:
        await db.close()
        raise


async def execute_write(db, sql, parameters, *, attempts=5):
    """Commit a write, retrying SQLite contention without hiding exhaustion."""
    if attempts < 1:
        raise ValueError("Write attempts must be positive")
    for attempt in range(attempts):
        try:
            await db.execute(sql, parameters)
            await db.commit()
            return
        except sqlite3.OperationalError as error:
            if "locked" not in str(error).lower() or attempt == attempts - 1:
                raise
            await asyncio.sleep(0.1)


async def save_guild_settings(db, guild_id, settings):
    values = default_settings()
    values.update(settings)
    values["enabled_services"] = repr(values["enabled_services"])
    columns = ", ".join(SETTING_COLUMNS)
    placeholders = ", ".join("?" for _ in range(len(SETTING_COLUMNS) + 1))
    await execute_write(
        db,
        f"INSERT OR REPLACE INTO guild_settings (guild_id, {columns}) VALUES ({placeholders})",
        (guild_id, *(values[column] for column in SETTING_COLUMNS)),
    )


async def update_channel_state(db, channel_id, state):
    await execute_write(
        db,
        "INSERT OR REPLACE INTO channel_states (channel_id, state) VALUES (?, ?)",
        (channel_id, state),
    )


async def load_channel_states(db, guilds=()):
    async with db.execute("SELECT channel_id, state FROM channel_states") as cursor:
        async for row in cursor:
            channel_states[row[0]] = row[1]

    for guild in guilds:
        for channel in guild.text_channels:
            if channel.id not in channel_states:
                channel_states[channel.id] = True


async def load_settings(db):
    columns = ", ".join(SETTING_COLUMNS)
    async with db.execute(f"SELECT guild_id, {columns} FROM guild_settings") as cursor:
        async for row in cursor:
            values = dict(zip(SETTING_COLUMNS, row[1:]))
            defaults = default_settings()
            encoded_services = values["enabled_services"]
            values["enabled_services"] = (
                ast.literal_eval(encoded_services)
                if encoded_services
                else defaults["enabled_services"]
            )
            for key in ("mention_users", "delete_original"):
                if values[key] is None:
                    values[key] = defaults[key]
            for key in ("language", "delivery_mode", "media_quality"):
                values[key] = values[key] or defaults[key]
            for key in ("footer_branding_enabled", "show_nsfw", "show_spoilers"):
                values[key] = bool(values[key])
            bot_settings[row[0]] = values


async def load_channel_service_rules(db):
    async with db.execute(
        "SELECT guild_id, channel_id, service, action FROM channel_service_rules"
    ) as cursor:
        async for guild_id, channel_id, service, action in cursor:
            channel_service_rules[(guild_id, channel_id, service)] = action


async def set_channel_service_rule(db, guild_id, channel_id, service, action):
    await execute_write(
        db,
        "INSERT OR REPLACE INTO channel_service_rules (guild_id, channel_id, service, action) VALUES (?, ?, ?, ?)",
        (guild_id, channel_id, service, action),
    )
    channel_service_rules[(guild_id, channel_id, service)] = action


def get_service_rule(guild_id, channel_id, service, default_enabled=True):
    rule = channel_service_rules.get((guild_id, channel_id, service))
    if rule == "on":
        return True
    if rule == "off":
        return False
    return default_enabled
