import unittest
from types import SimpleNamespace
from premium_cache import (
    PREMIUM_CACHE_TTL_SECONDS,
    any_entitlement_grants_premium,
    get_cached_premium,
    invalidate_cached_premium,
    set_cached_premium,
)
from premium_roles import entitlement_is_active


class PremiumCacheHelperTests(unittest.TestCase):
    def test_fresh_cache_hit_returns_stored_value(self):
        settings = {}
        set_cached_premium(settings, True, now=100.0)

        self.assertTrue(get_cached_premium(settings, now=100.0 + PREMIUM_CACHE_TTL_SECONDS - 1))
        self.assertEqual(settings["is_premium"], True)

    def test_stale_cache_forces_refresh(self):
        settings = {}
        set_cached_premium(settings, True, now=100.0)

        self.assertIsNone(get_cached_premium(settings, now=100.0 + PREMIUM_CACHE_TTL_SECONDS + 1))
        # Stored value remains until overwritten so callers can still inspect it.
        self.assertTrue(settings["is_premium"])

    def test_legacy_cache_without_timestamp_is_stale(self):
        settings = {"is_premium": True}

        self.assertIsNone(get_cached_premium(settings, now=50.0))

    def test_true_to_false_transition_without_restart(self):
        settings = {}
        set_cached_premium(settings, True, now=10.0)
        self.assertTrue(get_cached_premium(settings, now=11.0))

        # Entitlement delete / expire handler path.
        set_cached_premium(settings, False, now=12.0)
        self.assertFalse(get_cached_premium(settings, now=13.0))

    def test_false_to_true_transition_without_restart(self):
        settings = {}
        set_cached_premium(settings, False, now=10.0)
        self.assertFalse(get_cached_premium(settings, now=11.0))

        # Entitlement create / renew handler path.
        set_cached_premium(settings, True, now=12.0)
        self.assertTrue(get_cached_premium(settings, now=13.0))

    def test_invalidate_clears_cache_for_forced_refetch(self):
        settings = {}
        set_cached_premium(settings, True, now=10.0)
        invalidate_cached_premium(settings)

        self.assertIsNone(get_cached_premium(settings, now=11.0))
        self.assertNotIn("is_premium", settings)
        self.assertNotIn("is_premium_cached_at", settings)

    def test_deleted_entitlement_does_not_grant_premium(self):
        deleted = SimpleNamespace(deleted=True, is_expired=lambda: False)
        active = SimpleNamespace(deleted=False, is_expired=lambda: False)
        expired = SimpleNamespace(deleted=False, is_expired=lambda: True)

        self.assertFalse(entitlement_is_active(deleted))
        self.assertFalse(any_entitlement_grants_premium([deleted, expired]))
        self.assertTrue(any_entitlement_grants_premium([deleted, active]))

    def test_main_uses_ttl_cache_and_entitlement_is_active(self):
        from pathlib import Path

        main_source = Path(__file__).resolve().parents[1].joinpath("main.py").read_text(encoding="utf-8")
        self.assertIn("from premium_cache import", main_source)
        # main.py reaches get_cached_premium / set_cached_premium /
        # any_entitlement_grants_premium through these premium_cache helpers (#99).
        # The status form also feeds /premium's "couldn't confirm" copy (#101).
        self.assertIn("resolve_guild_premium_status(", main_source)
        self.assertIn("record_guild_premium(", main_source)
        cache_source = Path(__file__).resolve().parents[1].joinpath("premium_cache.py").read_text(encoding="utf-8")
        resolver = cache_source.split("async def resolve_guild_premium", 1)[1]
        self.assertIn("get_cached_premium(", resolver)
        self.assertIn("any_entitlement_grants_premium(", resolver)
        self.assertIn("set_cached_premium(", cache_source.split("def record_guild_premium", 1)[1])
        self.assertIn("entitlement_is_active(entitlement)", main_source)
        self.assertNotIn("any(not e.is_expired() for e in entitlements)", main_source)
        self.assertNotIn('bot_settings[guild_id]["is_premium"] = True', main_source)
        self.assertNotIn('bot_settings[guild_id]["is_premium"] = False', main_source)
        self.assertNotIn('bot_settings[guild_id]["is_premium"] = is_active', main_source)
        self.assertNotIn('bot_settings[guild_id]["is_premium"] = is_premium', main_source)


class PremiumCacheRefreshFlowTests(unittest.IsolatedAsyncioTestCase):
    async def test_stale_false_refreshes_to_true_after_new_subscription(self):
        """Simulate missed create event: stale False expires, re-fetch sees active SKU."""
        settings = {}
        set_cached_premium(settings, False, now=0.0)
        self.assertIsNone(get_cached_premium(settings, now=PREMIUM_CACHE_TTL_SECONDS + 1))

        entitlements = [SimpleNamespace(deleted=False, is_expired=lambda: False)]
        is_premium = any_entitlement_grants_premium(entitlements)
        set_cached_premium(settings, is_premium, now=PREMIUM_CACHE_TTL_SECONDS + 2)

        self.assertTrue(get_cached_premium(settings, now=PREMIUM_CACHE_TTL_SECONDS + 3))

    async def test_stale_true_refreshes_to_false_after_cancellation(self):
        """Simulate missed delete event: stale True expires, re-fetch sees ended SKU."""
        settings = {}
        set_cached_premium(settings, True, now=0.0)
        self.assertIsNone(get_cached_premium(settings, now=PREMIUM_CACHE_TTL_SECONDS + 1))

        entitlements = [
            SimpleNamespace(deleted=True, is_expired=lambda: False),
            SimpleNamespace(deleted=False, is_expired=lambda: True),
        ]
        is_premium = any_entitlement_grants_premium(entitlements)
        set_cached_premium(settings, is_premium, now=PREMIUM_CACHE_TTL_SECONDS + 2)

        self.assertFalse(get_cached_premium(settings, now=PREMIUM_CACHE_TTL_SECONDS + 3))


if __name__ == "__main__":
    unittest.main()
