"""A stale premium lookup can't overwrite a fresher entitlement event (#101)."""

import asyncio
import logging
import unittest
from types import SimpleNamespace

from premium_cache import (
    PREMIUM_CACHE_TTL_SECONDS,
    PremiumStatusCache,
    premium_generation,
    record_guild_premium,
    resolve_guild_premium,
    set_cached_premium,
)

GUILD = 9101
OTHER_GUILD = 9102


def active():
    return SimpleNamespace(deleted=False, is_expired=lambda: False)


class GatedEntitlements:
    """An entitlements lookup that stays in flight until the test releases it."""

    def __init__(self, entitlements=(), *, error=None):
        # None stands for a guild that can't be checked (not in the client cache).
        self.entitlements = None if entitlements is None else list(entitlements)
        self.error = error
        self.started = asyncio.Event()
        self.release = asyncio.Event()
        self.calls = 0

    async def __call__(self):
        self.calls += 1
        self.started.set()
        await self.release.wait()
        if self.error is not None:
            raise self.error
        return None if self.entitlements is None else list(self.entitlements)


class StaleLookupRaceTests(unittest.IsolatedAsyncioTestCase):
    async def start_lookup(self, cache, fetch, *, now, timeout=5.0):
        task = asyncio.create_task(resolve_guild_premium(cache, GUILD, fetch, timeout=timeout, now=now))
        await asyncio.wait_for(fetch.started.wait(), timeout=1.0)
        self.assertFalse(task.done())
        return task

    async def test_create_event_during_lookup_wins_free_to_premium(self):
        cache = PremiumStatusCache()
        # Discord's answer was read before the purchase landed: no entitlement.
        stale = GatedEntitlements([])
        lookup = await self.start_lookup(cache, stale, now=10.0)

        record_guild_premium(cache, GUILD, True, now=10.0)  # on_entitlement_create
        stale.release.set()
        result = await lookup

        self.assertIs(True, result)
        self.assertIs(True, cache[GUILD]["is_premium"])
        self.assertEqual(10.0, cache[GUILD]["is_premium_cached_at"])
        # The next message is served the event's value without a new lookup.
        follow_up = GatedEntitlements([])
        self.assertTrue(await resolve_guild_premium(cache, GUILD, follow_up, now=11.0))
        self.assertEqual(0, follow_up.calls)

    async def test_delete_event_during_lookup_wins_premium_to_free(self):
        cache = PremiumStatusCache()
        set_cached_premium(cache.setdefault(GUILD, {}), True, now=0.0)
        expired_at = PREMIUM_CACHE_TTL_SECONDS + 5
        # Discord's answer still shows the entitlement that is about to be removed.
        stale = GatedEntitlements([active()])
        lookup = await self.start_lookup(cache, stale, now=expired_at)

        record_guild_premium(cache, GUILD, False, now=expired_at)  # on_entitlement_delete
        stale.release.set()
        result = await lookup

        self.assertIs(False, result)
        self.assertIs(False, cache[GUILD]["is_premium"])
        self.assertEqual(expired_at, cache[GUILD]["is_premium_cached_at"])
        follow_up = GatedEntitlements([active()])
        self.assertFalse(await resolve_guild_premium(cache, GUILD, follow_up, now=expired_at + 1))
        self.assertEqual(0, follow_up.calls)

    async def test_event_for_another_guild_does_not_drop_the_lookup(self):
        cache = PremiumStatusCache()
        fetch = GatedEntitlements([active()])
        lookup = await self.start_lookup(cache, fetch, now=10.0)

        record_guild_premium(cache, OTHER_GUILD, False, now=10.0)
        fetch.release.set()

        self.assertTrue(await lookup)
        self.assertIs(True, cache[GUILD]["is_premium"])
        self.assertEqual(0, premium_generation(cache, GUILD))

    async def test_dropped_write_returns_lookup_answer_when_event_entry_was_evicted(self):
        cache = PremiumStatusCache(max_entries=1)
        fetch = GatedEntitlements([])
        lookup = await self.start_lookup(cache, fetch, now=10.0)

        record_guild_premium(cache, GUILD, True, now=10.0)
        record_guild_premium(cache, OTHER_GUILD, False, now=10.0)  # evicts GUILD
        self.assertNotIn(GUILD, cache)
        fetch.release.set()

        self.assertIs(False, await lookup)
        # Still dropped: the evicted guild is not re-added with the older answer.
        self.assertNotIn(GUILD, cache)
        self.assertEqual(1, premium_generation(cache, GUILD))

    async def test_create_event_during_unavailable_lookup_is_served(self):
        cache = PremiumStatusCache()
        unavailable = GatedEntitlements(None)
        lookup = await self.start_lookup(cache, unavailable, now=10.0)

        record_guild_premium(cache, GUILD, True, now=10.0)
        unavailable.release.set()

        self.assertIs(True, await lookup)
        self.assertIs(True, cache[GUILD]["is_premium"])
        self.assertEqual(10.0, cache[GUILD]["is_premium_cached_at"])

    async def test_unavailable_lookup_without_event_is_free_and_not_cached(self):
        cache = PremiumStatusCache()
        unavailable = GatedEntitlements(None)
        lookup = await self.start_lookup(cache, unavailable, now=10.0)
        unavailable.release.set()

        self.assertIs(False, await lookup)
        self.assertNotIn(GUILD, cache)


class GenerationTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        logging.disable(logging.CRITICAL)
        self.addCleanup(logging.disable, logging.NOTSET)

    def test_each_entitlement_event_bumps_the_generation(self):
        cache = PremiumStatusCache()
        self.assertEqual(0, premium_generation(cache, GUILD))
        record_guild_premium(cache, GUILD, True, now=1.0)
        record_guild_premium(cache, GUILD, False, now=2.0)
        self.assertEqual(2, premium_generation(cache, GUILD))
        self.assertEqual(0, premium_generation(cache, OTHER_GUILD))

    def test_generation_survives_lru_eviction(self):
        cache = PremiumStatusCache(max_entries=1)
        record_guild_premium(cache, GUILD, True, now=1.0)
        record_guild_premium(cache, OTHER_GUILD, True, now=2.0)
        self.assertNotIn(GUILD, cache)
        self.assertEqual(1, premium_generation(cache, GUILD))

    async def test_successful_lookup_does_not_bump_the_generation(self):
        cache = PremiumStatusCache()
        fetch = GatedEntitlements([active()])
        fetch.release.set()
        self.assertTrue(await resolve_guild_premium(cache, GUILD, fetch, now=1.0))
        self.assertEqual(0, premium_generation(cache, GUILD))

    async def test_timed_out_lookup_leaves_generation_and_cache_unchanged(self):
        cache = PremiumStatusCache()
        record_guild_premium(cache, GUILD, True, now=0.0)
        before = dict(cache[GUILD])
        expired_at = PREMIUM_CACHE_TTL_SECONDS + 5
        never = GatedEntitlements([])

        result = await resolve_guild_premium(cache, GUILD, never, timeout=0.05, now=expired_at)

        self.assertTrue(result)
        self.assertEqual(1, premium_generation(cache, GUILD))
        self.assertEqual(before, cache[GUILD])

    async def test_failed_lookup_leaves_generation_unchanged_and_writes_no_false(self):
        cache = PremiumStatusCache()
        record_guild_premium(cache, GUILD, True, now=0.0)
        before = dict(cache[GUILD])
        failing = GatedEntitlements(error=RuntimeError("503 Service Unavailable"))
        failing.release.set()

        result = await resolve_guild_premium(cache, GUILD, failing, now=PREMIUM_CACHE_TTL_SECONDS + 5)

        self.assertTrue(result)
        self.assertEqual(1, premium_generation(cache, GUILD))
        self.assertEqual(before, cache[GUILD])

    async def test_event_during_timed_out_lookup_is_served(self):
        cache = PremiumStatusCache()
        never = GatedEntitlements([])
        task = asyncio.create_task(resolve_guild_premium(cache, GUILD, never, timeout=0.2, now=10.0))
        await asyncio.wait_for(never.started.wait(), timeout=1.0)

        record_guild_premium(cache, GUILD, True, now=10.0)

        self.assertIs(True, await task)
        self.assertIs(True, cache[GUILD]["is_premium"])
        self.assertEqual(1, premium_generation(cache, GUILD))


class LookupErrorLogTests(unittest.IsolatedAsyncioTestCase):
    async def test_error_log_names_the_guild(self):
        failing = GatedEntitlements(error=RuntimeError("429 Too Many Requests"))
        failing.release.set()

        with self.assertLogs(level="ERROR") as logs:
            self.assertFalse(await resolve_guild_premium(PremiumStatusCache(), GUILD, failing, now=1.0))

        self.assertEqual(1, len(logs.output))
        self.assertIn(f"guild {GUILD}", logs.output[0])
        self.assertIn("429 Too Many Requests", logs.output[0])


if __name__ == "__main__":
    unittest.main()
