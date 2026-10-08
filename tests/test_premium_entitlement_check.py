"""Premium entitlement lookups are cached for every guild and capped by a timeout (#99)."""

import asyncio
import logging
import time
import unittest
from pathlib import Path
from types import SimpleNamespace

from premium_cache import (
    PREMIUM_CACHE_TTL_SECONDS,
    PREMIUM_CHECK_TIMEOUT_SECONDS,
    record_guild_premium,
    resolve_guild_premium,
    set_cached_premium,
)

MAIN_SOURCE = Path(__file__).resolve().parents[1].joinpath("main.py").read_text(encoding="utf-8")

ROWLESS_GUILD = 4242


def active():
    return SimpleNamespace(deleted=False, is_expired=lambda: False)


class FakeEntitlements:
    """Counts Discord entitlement lookups and returns a fixed answer."""

    def __init__(self, entitlements=(), *, delay=0.0, error=None):
        self.entitlements = list(entitlements)
        self.delay = delay
        self.error = error
        self.calls = 0
        self.cancelled = False

    async def __call__(self):
        self.calls += 1
        try:
            if self.delay:
                await asyncio.sleep(self.delay)
        except asyncio.CancelledError:
            self.cancelled = True
            raise
        if self.error is not None:
            raise self.error
        return list(self.entitlements)


class RowlessGuildCacheTests(unittest.IsolatedAsyncioTestCase):
    async def test_rowless_free_guild_makes_one_lookup_across_messages(self):
        cache = {}
        fetch = FakeEntitlements([])

        results = [await resolve_guild_premium(cache, ROWLESS_GUILD, fetch, now=100.0 + i) for i in range(25)]

        self.assertEqual([False] * 25, results)
        self.assertEqual(1, fetch.calls)
        self.assertIs(False, cache[ROWLESS_GUILD]["is_premium"])

    async def test_rowless_premium_guild_makes_one_lookup_across_messages(self):
        cache = {}
        fetch = FakeEntitlements([active()])

        results = [await resolve_guild_premium(cache, ROWLESS_GUILD, fetch, now=100.0 + i) for i in range(5)]

        self.assertEqual([True] * 5, results)
        self.assertEqual(1, fetch.calls)

    async def test_ttl_expiry_refreshes_once(self):
        cache = {}
        fetch = FakeEntitlements([])
        await resolve_guild_premium(cache, ROWLESS_GUILD, fetch, now=0.0)
        fetch.entitlements = [active()]

        self.assertFalse(await resolve_guild_premium(cache, ROWLESS_GUILD, fetch, now=PREMIUM_CACHE_TTL_SECONDS - 1))
        self.assertTrue(await resolve_guild_premium(cache, ROWLESS_GUILD, fetch, now=PREMIUM_CACHE_TTL_SECONDS + 1))
        self.assertTrue(await resolve_guild_premium(cache, ROWLESS_GUILD, fetch, now=PREMIUM_CACHE_TTL_SECONDS + 2))
        self.assertEqual(2, fetch.calls)

    async def test_unavailable_guild_is_free_and_not_cached(self):
        cache = {}

        async def guild_not_in_client_cache():
            return None

        self.assertFalse(await resolve_guild_premium(cache, ROWLESS_GUILD, guild_not_in_client_cache, now=1.0))
        self.assertNotIn(ROWLESS_GUILD, cache)


class EntitlementTimeoutTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        logging.disable(logging.CRITICAL)
        self.addCleanup(logging.disable, logging.NOTSET)

    def test_timeout_constant_is_short(self):
        self.assertGreaterEqual(PREMIUM_CHECK_TIMEOUT_SECONDS, 2.0)
        self.assertLessEqual(PREMIUM_CHECK_TIMEOUT_SECONDS, 3.0)

    async def test_timeout_returns_quickly_and_cancels_lookup(self):
        cache = {}
        fetch = FakeEntitlements([active()], delay=30.0)

        started = time.monotonic()
        result = await resolve_guild_premium(cache, ROWLESS_GUILD, fetch, timeout=0.05, now=1.0)
        elapsed = time.monotonic() - started

        self.assertFalse(result)
        self.assertLess(elapsed, 1.0)
        self.assertTrue(fetch.cancelled)

    async def test_timeout_with_no_cache_is_not_cached(self):
        cache = {}
        slow = FakeEntitlements([], delay=30.0)

        self.assertFalse(await resolve_guild_premium(cache, ROWLESS_GUILD, slow, timeout=0.05, now=1.0))
        self.assertNotIn(ROWLESS_GUILD, cache)

        # The next message retries Discord, so a paying guild is not pinned to free.
        fast = FakeEntitlements([active()])
        self.assertTrue(await resolve_guild_premium(cache, ROWLESS_GUILD, fast, now=2.0))
        self.assertEqual(1, fast.calls)

    async def test_timeout_uses_stale_cached_value_without_refreshing_it(self):
        cache = {}
        set_cached_premium(cache.setdefault(ROWLESS_GUILD, {}), True, now=0.0)
        slow = FakeEntitlements([], delay=30.0)
        stale_at = PREMIUM_CACHE_TTL_SECONDS + 5

        self.assertTrue(await resolve_guild_premium(cache, ROWLESS_GUILD, slow, timeout=0.05, now=stale_at))
        self.assertEqual(1, slow.calls)
        self.assertEqual(0.0, cache[ROWLESS_GUILD]["is_premium_cached_at"])

    async def test_error_uses_stale_value_or_free_without_caching(self):
        cache = {}
        failing = FakeEntitlements(error=RuntimeError("429 Too Many Requests"))

        self.assertFalse(await resolve_guild_premium(cache, ROWLESS_GUILD, failing, now=1.0))
        self.assertNotIn(ROWLESS_GUILD, cache)

        set_cached_premium(cache.setdefault(ROWLESS_GUILD, {}), True, now=0.0)
        self.assertTrue(
            await resolve_guild_premium(cache, ROWLESS_GUILD, failing, now=PREMIUM_CACHE_TTL_SECONDS + 5)
        )

    async def test_timeout_is_logged(self):
        logging.disable(logging.NOTSET)
        slow = FakeEntitlements([], delay=30.0)

        with self.assertLogs(level="WARNING") as logs:
            await resolve_guild_premium({}, ROWLESS_GUILD, slow, timeout=0.05, now=1.0)

        self.assertIn("timed out", logs.output[0])
        self.assertIn(str(ROWLESS_GUILD), logs.output[0])

    async def test_slow_lookup_does_not_block_other_tasks(self):
        cache = {}
        slow = FakeEntitlements([], delay=30.0)
        other_ran = asyncio.Event()

        async def worker_call():
            other_ran.set()

        await asyncio.gather(
            resolve_guild_premium(cache, ROWLESS_GUILD, slow, timeout=0.05, now=1.0),
            worker_call(),
        )
        self.assertTrue(other_ran.is_set())


class EntitlementEventTests(unittest.IsolatedAsyncioTestCase):
    async def test_create_event_flips_rowless_cached_free_to_premium(self):
        cache = {}
        fetch = FakeEntitlements([])
        self.assertFalse(await resolve_guild_premium(cache, ROWLESS_GUILD, fetch, now=1.0))

        record_guild_premium(cache, ROWLESS_GUILD, True, now=2.0)

        self.assertTrue(await resolve_guild_premium(cache, ROWLESS_GUILD, fetch, now=3.0))
        self.assertEqual(1, fetch.calls)

    async def test_delete_event_flips_rowless_cached_premium_to_free(self):
        cache = {}
        fetch = FakeEntitlements([active()])
        self.assertTrue(await resolve_guild_premium(cache, ROWLESS_GUILD, fetch, now=1.0))

        record_guild_premium(cache, ROWLESS_GUILD, False, now=2.0)

        self.assertFalse(await resolve_guild_premium(cache, ROWLESS_GUILD, fetch, now=3.0))
        self.assertEqual(1, fetch.calls)

    async def test_event_for_uncached_guild_is_cached(self):
        cache = {}
        fetch = FakeEntitlements([])

        record_guild_premium(cache, ROWLESS_GUILD, True, now=1.0)

        self.assertTrue(await resolve_guild_premium(cache, ROWLESS_GUILD, fetch, now=2.0))
        self.assertEqual(0, fetch.calls)


class MainWiringTests(unittest.TestCase):
    def _section(self, start, end_marker="\n@client.event"):
        body = MAIN_SOURCE.split(start, 1)[1]
        return body.split(end_marker, 1)[0]

    def test_is_guild_premium_uses_shared_cache_with_timeout(self):
        section = MAIN_SOURCE.split("async def is_guild_premium(guild_id):", 1)[1].split("\ndef ", 1)[0]
        self.assertIn("if not PREMIUM_SKU_ID:", section)
        self.assertIn("resolve_guild_premium(", section)
        self.assertIn("premium_status_cache", section)
        self.assertIn("timeout=PREMIUM_CHECK_TIMEOUT_SECONDS", section)
        self.assertNotIn("guild_id in bot_settings", section)
        self.assertNotIn("bot_settings.get(guild_id)", section)

    def test_entitlement_events_update_every_guild(self):
        for handler in ("on_entitlement_create", "on_entitlement_update", "on_entitlement_delete"):
            section = self._section(f"async def {handler}(entitlement):")
            self.assertIn("record_guild_premium(premium_status_cache, guild_id,", section, handler)
            self.assertNotIn("guild_id in bot_settings", section, handler)


if __name__ == "__main__":
    unittest.main()
