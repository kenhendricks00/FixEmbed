import unittest
import sqlite3
from types import SimpleNamespace

from premium_controls import (
    DEFAULT_PREMIUM_CONTROLS,
    fetch_analytics_summary,
    init_premium_controls,
    load_premium_controls,
    record_processing_outcome,
    resolve_translation_language,
    save_premium_controls,
    should_skip_automatic,
)


class _AsyncCursor:
    def __init__(self, cursor):
        self.cursor = cursor

    async def fetchall(self):
        return self.cursor.fetchall()


class _AsyncSQLite:
    def __init__(self):
        self.connection = sqlite3.connect(":memory:")

    async def execute(self, sql, parameters=()):
        return _AsyncCursor(self.connection.execute(sql, parameters))

    async def commit(self):
        self.connection.commit()

    async def close(self):
        self.connection.close()


class PremiumControlsTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.db = _AsyncSQLite()
        await init_premium_controls(self.db)

    async def asyncTearDown(self):
        await self.db.close()

    async def test_controls_round_trip_with_normalized_values(self):
        await save_premium_controls(
            self.db,
            123,
            {
                "card_show_stats": False,
                "card_show_hashtags": False,
                "card_caption_mode": "compact",
                "translation_language": "ES",
                "ignored_user_ids": [9, "8", "bad"],
                "ignored_role_ids": [7, "6"],
            },
        )

        loaded = await load_premium_controls(self.db)

        self.assertEqual(
            loaded[123],
            {
                "card_show_stats": False,
                "card_show_hashtags": False,
                "card_caption_mode": "compact",
                "translation_language": "es",
                "ignored_user_ids": [9, 8],
                "ignored_role_ids": [7, 6],
            },
        )

    async def test_missing_controls_use_safe_defaults(self):
        loaded = await load_premium_controls(self.db)

        self.assertEqual(loaded, {})
        self.assertTrue(DEFAULT_PREMIUM_CONTROLS["card_show_stats"])
        self.assertIsNone(DEFAULT_PREMIUM_CONTROLS["translation_language"])

    def test_translation_prefers_explicit_link_and_is_free(self):
        settings = {"translation_language": "es"}

        self.assertEqual(resolve_translation_language("fr", settings), "fr")
        self.assertEqual(resolve_translation_language(None, settings), "es")

    async def test_legacy_twitter_language_is_migrated(self):
        legacy_db = _AsyncSQLite()
        await legacy_db.execute(
            """CREATE TABLE guild_premium_controls (
                guild_id INTEGER PRIMARY KEY,
                card_show_stats BOOLEAN NOT NULL DEFAULT TRUE,
                card_show_hashtags BOOLEAN NOT NULL DEFAULT TRUE,
                card_caption_mode TEXT NOT NULL DEFAULT 'full',
                twitter_language TEXT DEFAULT NULL,
                ignored_user_ids TEXT NOT NULL DEFAULT '[]',
                ignored_role_ids TEXT NOT NULL DEFAULT '[]'
            )"""
        )
        await legacy_db.execute(
            """INSERT INTO guild_premium_controls (
                guild_id, twitter_language
            ) VALUES (?, ?)""",
            (456, "ja"),
        )

        try:
            await init_premium_controls(legacy_db)
            loaded = await load_premium_controls(legacy_db)
            await save_premium_controls(
                legacy_db,
                456,
                {**loaded[456], "translation_language": None},
            )
            await init_premium_controls(legacy_db)
            reloaded = await load_premium_controls(legacy_db)
        finally:
            await legacy_db.close()

        self.assertEqual(loaded[456]["translation_language"], "ja")
        self.assertIsNone(reloaded[456]["translation_language"])

    def test_member_or_role_exclusion_requires_premium(self):
        message = SimpleNamespace(
            author=SimpleNamespace(
                id=10,
                roles=[SimpleNamespace(id=20), SimpleNamespace(id=30)],
            )
        )
        settings = {"ignored_user_ids": [10], "ignored_role_ids": [30]}

        self.assertTrue(should_skip_automatic(message, settings, premium=True))
        self.assertFalse(should_skip_automatic(message, settings, premium=False))

    async def test_analytics_are_aggregated_and_isolated_by_guild(self):
        today = __import__("datetime").date.today().isoformat()
        await record_processing_outcome(self.db, 123, "Twitter", rich=True, day=today)
        await record_processing_outcome(self.db, 123, "Twitter", rich=False, day=today)
        await record_processing_outcome(self.db, 999, "Twitter", rich=True, day=today)

        summary = await fetch_analytics_summary(self.db, 123)

        self.assertEqual(
            summary,
            [{"service": "Twitter", "rich_count": 1, "fallback_count": 1}],
        )


if __name__ == "__main__":
    unittest.main()
    record_processing_outcome,
