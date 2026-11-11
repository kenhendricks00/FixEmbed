import sqlite3
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fixembed import storage


class BotStorageTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.db = await storage.init_db(":memory:")
        self.addAsyncCleanup(self.db.close)
        self.addCleanup(storage.bot_settings.clear)
        self.addCleanup(storage.channel_states.clear)
        self.addCleanup(storage.channel_service_rules.clear)

    async def test_all_settings_survive_round_trip(self):
        values = storage.default_settings()
        values.update(
            enabled_services=["Twitter", "Pixiv"],
            mention_users=False,
            delete_original=False,
            language="ja",
            embed_color="#123456",
            delivery_mode="reply",
            media_quality="highest",
            footer_branding_enabled=True,
            footer_emoji_id=123456789,
            show_nsfw=True,
            show_spoilers=True,
        )
        await storage.save_guild_settings(self.db, 123, values)
        await storage.load_settings(self.db)
        self.assertEqual(storage.bot_settings[123], values)

    async def test_defaults_do_not_share_mutable_service_lists(self):
        first, second = storage.default_settings(), storage.default_settings()
        first["enabled_services"].clear()
        self.assertTrue(second["enabled_services"])

    async def test_legacy_database_migration_preserves_existing_preferences(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "legacy.db"
            with sqlite3.connect(path) as db:
                db.execute(
                    "CREATE TABLE guild_settings (guild_id INTEGER PRIMARY KEY, enabled_services TEXT)"
                )
                db.execute(
                    "INSERT INTO guild_settings VALUES (?, ?)", (9, "['Reddit']")
                )
            db.close()
            for _ in range(2):
                migrated = await storage.init_db(path)
                try:
                    await storage.load_settings(migrated)
                    self.assertEqual(
                        storage.bot_settings[9]["enabled_services"], ["Reddit"]
                    )
                    self.assertEqual(storage.bot_settings[9]["language"], "en")
                    self.assertFalse(storage.bot_settings[9]["show_nsfw"])
                finally:
                    await migrated.close()

    async def test_disabled_channels_and_service_rules_survive_reload(self):
        await storage.update_channel_state(self.db, 22, False)
        await storage.set_channel_service_rule(self.db, 11, 22, "Twitter", "off")
        await storage.load_channel_states(
            self.db,
            [
                SimpleNamespace(
                    text_channels=[SimpleNamespace(id=22), SimpleNamespace(id=23)]
                )
            ],
        )
        storage.channel_service_rules.clear()
        await storage.load_channel_service_rules(self.db)
        self.assertFalse(storage.channel_states[22])
        self.assertTrue(storage.channel_states[23])
        self.assertFalse(storage.get_service_rule(11, 22, "Twitter"))
        self.assertTrue(storage.get_service_rule(11, 23, "Twitter"))

    async def test_lock_contention_retries_and_then_commits(self):
        db = SimpleNamespace(
            execute=AsyncMock(
                side_effect=[sqlite3.OperationalError("database is locked"), None]
            ),
            commit=AsyncMock(),
        )
        with patch("fixembed.storage.asyncio.sleep", AsyncMock()):
            await storage.update_channel_state(db, 22, True)
        self.assertEqual(db.execute.await_count, 2)
        db.commit.assert_awaited_once()

    async def test_exhausted_lock_retries_are_reported(self):
        db = SimpleNamespace(
            execute=AsyncMock(
                side_effect=sqlite3.OperationalError("database is locked")
            ),
            commit=AsyncMock(),
        )
        with (
            patch("fixembed.storage.asyncio.sleep", AsyncMock()),
            self.assertRaises(sqlite3.OperationalError),
        ):
            await storage.save_guild_settings(db, 11, storage.default_settings())
        self.assertEqual(db.execute.await_count, 5)
        db.commit.assert_not_awaited()

    async def test_unrelated_database_errors_are_not_retried(self):
        db = SimpleNamespace(
            execute=AsyncMock(side_effect=sqlite3.OperationalError("no such table")),
            commit=AsyncMock(),
        )
        with self.assertRaises(sqlite3.OperationalError):
            await storage.update_channel_state(db, 22, True)
        db.execute.assert_awaited_once()
