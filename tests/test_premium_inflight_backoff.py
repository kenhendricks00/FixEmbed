"""One shared entitlements lookup per guild, and a short backoff after a failed one (#101)."""

import asyncio
import logging
import unittest
from types import SimpleNamespace

from premium_cache import (
    PREMIUM_CACHE_TTL_SECONDS,
    PREMIUM_FAILURE_BACKOFF_SECONDS,
    PremiumStatusCache,
    record_guild_premium,
    resolve_guild_premium,
    resolve_guild_premium_status,
    set_cached_premium,
)

GUILD = 20101
OTHER = 20102


def active():
    return SimpleNamespace(deleted=False, is_expired=lambda: False)


class GatedLookup:
    def __init__(self, entitlements=(), *, error=None):
        self.entitlements = list(entitlements)
        self.error = error
        self.release = asyncio.Event()
        self.calls = 0

    async def __call__(self):
        self.calls += 1
        await self.release.wait()
        if self.error is not None:
            raise self.error
        return list(self.entitlements)


class SharedLookupTests(unittest.IsolatedAsyncioTestCase):
    async def test_concurrent_messages_from_one_guild_make_one_call(self):
        cache = PremiumStatusCache()
        lookup = GatedLookup([active()])
        burst = [
            asyncio.create_task(resolve_guild_premium(cache, GUILD, lookup, now=10.0))
            for _ in range(5)
        ]
        await asyncio.sleep(0.01)
        self.assertEqual(1, lookup.calls)
        self.assertIn(GUILD, cache.in_flight)
        lookup.release.set()
        self.assertEqual([True] * 5, await asyncio.gather(*burst))
        self.assertEqual(1, lookup.calls)
        self.assertEqual({}, cache.in_flight)

    async def test_other_guilds_get_their_own_lookup(self):
        cache = PremiumStatusCache()
        first, second = GatedLookup([active()]), GatedLookup([])
        a = asyncio.create_task(resolve_guild_premium_status(cache, GUILD, first, now=10.0))
        b = asyncio.create_task(resolve_guild_premium_status(cache, OTHER, second, now=10.0))
        await asyncio.sleep(0.01)
        first.release.set()
        second.release.set()
        self.assertEqual(["active", "inactive"], [await a, await b])
        self.assertEqual((1, 1), (first.calls, second.calls))

    async def test_a_caller_giving_up_does_not_cancel_the_shared_lookup(self):
        cache = PremiumStatusCache()
        lookup = GatedLookup([active()])
        quitter = asyncio.create_task(resolve_guild_premium(cache, GUILD, lookup, now=10.0))
        stayer = asyncio.create_task(resolve_guild_premium(cache, GUILD, lookup, now=10.0))
        await asyncio.sleep(0.01)
        quitter.cancel()
        lookup.release.set()
        self.assertTrue(await stayer)
        self.assertTrue(cache[GUILD]["is_premium"])
        self.assertEqual(1, lookup.calls)


class FailureBackoffTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        logging.disable(logging.CRITICAL)
        self.addCleanup(logging.disable, logging.NOTSET)

    async def fail(self, cache, now, guild=GUILD):
        failing = GatedLookup(error=RuntimeError("503 Service Unavailable"))
        failing.release.set()
        return await resolve_guild_premium_status(cache, guild, failing, now=now), failing

    async def test_a_failed_call_suppresses_retries_for_the_backoff_window(self):
        cache = PremiumStatusCache()
        status, failing = await self.fail(cache, now=100.0)
        self.assertEqual("unconfirmed", status)
        self.assertEqual(1, failing.calls)

        later = GatedLookup([active()])
        later.release.set()
        inside = 100.0 + PREMIUM_FAILURE_BACKOFF_SECONDS - 1
        self.assertEqual("unconfirmed", await resolve_guild_premium_status(cache, GUILD, later, now=inside))
        self.assertEqual(0, later.calls)
        # Another guild is not held back.
        other = GatedLookup([active()])
        other.release.set()
        self.assertEqual("active", await resolve_guild_premium_status(cache, OTHER, other, now=inside))

        after = 100.0 + PREMIUM_FAILURE_BACKOFF_SECONDS + 1
        self.assertEqual("active", await resolve_guild_premium_status(cache, GUILD, later, now=after))
        self.assertEqual(1, later.calls)
        self.assertNotIn(GUILD, cache.backoff_until)

    async def test_backoff_serves_the_recent_cached_answer(self):
        cache = PremiumStatusCache()
        set_cached_premium(cache.setdefault(GUILD, {}), True, now=0.0)
        expired = PREMIUM_CACHE_TTL_SECONDS + 5
        status, _ = await self.fail(cache, now=expired)
        self.assertEqual("active", status)
        untouched = GatedLookup([])
        untouched.release.set()
        self.assertTrue(await resolve_guild_premium(cache, GUILD, untouched, now=expired + 1))
        self.assertEqual(0, untouched.calls)

    async def test_an_entitlement_event_ends_the_backoff(self):
        cache = PremiumStatusCache()
        await self.fail(cache, now=100.0)
        record_guild_premium(cache, GUILD, True, now=101.0)
        self.assertNotIn(GUILD, cache.backoff_until)
        self.assertEqual("active", await resolve_guild_premium_status(cache, GUILD, GatedLookup(), now=102.0))

    async def test_timeouts_back_off_and_expired_entries_are_pruned(self):
        cache = PremiumStatusCache()
        hanging = GatedLookup()
        self.assertEqual(
            "unconfirmed",
            await resolve_guild_premium_status(cache, GUILD, hanging, timeout=0.05, now=10.0),
        )
        self.assertIn(GUILD, cache.backoff_until)
        # A later failure for another guild drops GUILD's expired entry.
        await self.fail(cache, now=10.0 + PREMIUM_FAILURE_BACKOFF_SECONDS + 1, guild=OTHER)
        self.assertEqual([OTHER], list(cache.backoff_until))

    async def test_zero_backoff_and_plain_dicts_keep_retrying(self):
        cache = PremiumStatusCache()
        failing = GatedLookup(error=RuntimeError("boom"))
        failing.release.set()
        for _ in range(2):
            await resolve_guild_premium_status(cache, GUILD, failing, now=10.0, failure_backoff_seconds=0)
        self.assertEqual(2, failing.calls)
        plain = {}
        for _ in range(2):
            await resolve_guild_premium_status(plain, GUILD, failing, now=10.0)
        self.assertEqual(4, failing.calls)


if __name__ == "__main__":
    unittest.main()
