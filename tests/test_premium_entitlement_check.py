"""Premium entitlement lookups are cached for every guild and capped by a timeout (#99)."""

import ast
import asyncio
import logging
import time
import unittest
from pathlib import Path
from types import MappingProxyType, SimpleNamespace

from card_preferences import preferences_from_settings
from premium_cache import (
    PREMIUM_CACHE_MAX_ENTRIES,
    PREMIUM_CACHE_TTL_SECONDS,
    PREMIUM_CHECK_TIMEOUT_SECONDS,
    PREMIUM_STALE_GRACE_SECONDS,
    PremiumStatusCache,
    record_guild_premium,
    resolve_guild_premium,
    set_cached_premium,
)
from premium_controls import should_skip_automatic

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


class StaleGraceTests(unittest.IsolatedAsyncioTestCase):
    """On timeout/error an expired answer is served only up to TTL + grace."""

    def setUp(self):
        logging.disable(logging.CRITICAL)
        self.addCleanup(logging.disable, logging.NOTSET)

    def cached_premium(self, cached_at=0.0):
        cache = {}
        set_cached_premium(cache.setdefault(ROWLESS_GUILD, {}), True, now=cached_at)
        return cache

    def test_grace_constant_is_one_hour(self):
        self.assertEqual(3600, PREMIUM_STALE_GRACE_SECONDS)

    async def test_stale_premium_within_grace_returns_true(self):
        for age in (PREMIUM_CACHE_TTL_SECONDS + 1, PREMIUM_CACHE_TTL_SECONDS + PREMIUM_STALE_GRACE_SECONDS):
            with self.subTest(age=age):
                cache = self.cached_premium()
                slow = FakeEntitlements([], delay=30.0)
                self.assertTrue(await resolve_guild_premium(cache, ROWLESS_GUILD, slow, timeout=0.05, now=age))
                self.assertEqual(1, slow.calls)

    async def test_stale_premium_past_grace_returns_false_and_is_not_cached(self):
        past = PREMIUM_CACHE_TTL_SECONDS + PREMIUM_STALE_GRACE_SECONDS + 1
        for fetch in (
            FakeEntitlements([], delay=30.0),
            FakeEntitlements(error=RuntimeError("503 Service Unavailable")),
        ):
            with self.subTest(fetch=fetch.error or "timeout"):
                cache = self.cached_premium()
                self.assertFalse(await resolve_guild_premium(cache, ROWLESS_GUILD, fetch, timeout=0.05, now=past))
                # The fallback False is not stored; the old entry is left as it was.
                self.assertEqual({"is_premium": True, "is_premium_cached_at": 0.0}, cache[ROWLESS_GUILD])

                # Discord answering again restores the real status.
                ok = FakeEntitlements([active()])
                self.assertTrue(await resolve_guild_premium(cache, ROWLESS_GUILD, ok, now=past + 1))
                self.assertEqual(past + 1, cache[ROWLESS_GUILD]["is_premium_cached_at"])

    async def test_errors_never_restamp_the_cached_timestamp(self):
        stale_at = PREMIUM_CACHE_TTL_SECONDS + 10
        for fetch in (FakeEntitlements([], delay=30.0), FakeEntitlements(error=RuntimeError("boom"))):
            with self.subTest(fetch=fetch.error or "timeout"):
                cache = self.cached_premium(cached_at=5.0)
                for i in range(3):
                    self.assertTrue(
                        await resolve_guild_premium(cache, ROWLESS_GUILD, fetch, timeout=0.05, now=stale_at + i)
                    )
                self.assertEqual(5.0, cache[ROWLESS_GUILD]["is_premium_cached_at"])
                self.assertEqual(3, fetch.calls)


class BoundedCacheTests(unittest.IsolatedAsyncioTestCase):
    def test_default_bound(self):
        self.assertEqual(10000, PREMIUM_CACHE_MAX_ENTRIES)
        self.assertEqual(PREMIUM_CACHE_MAX_ENTRIES, PremiumStatusCache().max_entries)

    def test_insert_past_max_evicts_oldest(self):
        cache = PremiumStatusCache(max_entries=3)
        for guild_id in (1, 2, 3, 4):
            record_guild_premium(cache, guild_id, False, now=10.0)

        self.assertEqual([2, 3, 4], list(cache))

    def test_updating_existing_guild_does_not_evict(self):
        cache = PremiumStatusCache(max_entries=2)
        record_guild_premium(cache, 1, False, now=1.0)
        record_guild_premium(cache, 2, False, now=1.0)
        record_guild_premium(cache, 1, True, now=2.0)

        self.assertEqual([2, 1], list(cache))
        self.assertTrue(cache[1]["is_premium"])

    async def test_cache_hit_marks_guild_recently_used(self):
        cache = PremiumStatusCache(max_entries=3)
        for guild_id in (1, 2, 3):
            await resolve_guild_premium(cache, guild_id, FakeEntitlements([]), now=10.0)

        self.assertFalse(await resolve_guild_premium(cache, 1, FakeEntitlements([active()]), now=11.0))
        await resolve_guild_premium(cache, 4, FakeEntitlements([]), now=12.0)

        self.assertEqual([3, 1, 4], list(cache))
        self.assertNotIn(2, cache)

    async def test_evicted_guild_refetches_once(self):
        cache = PremiumStatusCache(max_entries=1)
        first = FakeEntitlements([active()])
        await resolve_guild_premium(cache, 1, first, now=1.0)
        await resolve_guild_premium(cache, 2, FakeEntitlements([]), now=2.0)
        self.assertNotIn(1, cache)

        self.assertTrue(await resolve_guild_premium(cache, 1, first, now=3.0))
        self.assertTrue(await resolve_guild_premium(cache, 1, first, now=4.0))
        self.assertEqual(2, first.calls)
        self.assertEqual(1, len(cache))

    def test_main_uses_bounded_cache(self):
        self.assertIn("premium_status_cache = PremiumStatusCache()", MAIN_SOURCE)


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
        section = MAIN_SOURCE.split("async def guild_premium_status(guild_id):", 1)[1].split("\nasync def ", 1)[0]
        self.assertIn("if not PREMIUM_SKU_ID:", section)
        self.assertIn("resolve_guild_premium_status(", section)
        self.assertIn("premium_status_cache", section)
        self.assertIn("timeout=PREMIUM_CHECK_TIMEOUT_SECONDS", section)
        self.assertNotIn("guild_id in bot_settings", section)
        self.assertNotIn("bot_settings.get(guild_id)", section)
        # Message handling's plain answer is the same check (#101).
        wrapper = MAIN_SOURCE.split("async def is_guild_premium(guild_id):", 1)[1].split("\ndef ", 1)[0]
        self.assertIn('return await guild_premium_status(guild_id) == "active"', wrapper)

    def test_entitlement_events_update_every_guild(self):
        for handler in ("on_entitlement_create", "on_entitlement_update", "on_entitlement_delete"):
            section = self._section(f"async def {handler}(entitlement):")
            self.assertIn("record_guild_premium(premium_status_cache, guild_id,", section, handler)
            self.assertNotIn("guild_id in bot_settings", section, handler)


def _call_name(node):
    func = node.func
    if isinstance(func, ast.Name):
        return func.id
    if isinstance(func, ast.Attribute):
        return func.attr
    return None


# Calls that persist state (SQLite or settings saves).
WRITE_CALLS = {
    "update_setting",
    "save",
    "save_premium",
    "save_premium_controls",
    "save_translation",
    "record_processing_outcome",
    "update_channel_state",
    "set_channel_visibility_override",
    "execute",
    "executemany",
    "commit",
}

# Every function in main.py that awaits a Premium check, and how a False,
# "inactive" or "unconfirmed" (possibly a fallback) answer is kept from writing.
PREMIUM_CHECKS = {"is_guild_premium", "guild_premium_status", "confirm_premium", "recheck_premium"}
READ_ONLY = "read_only"  # no writes anywhere in the function
PREMIUM_BRANCH = "premium_branch"  # writes only inside `if premium:`
EARLY_RETURN = "early_return"  # `if not await <check>: ... return` before any write
PREMIUM_CALLERS = {
    "is_guild_premium": READ_ONLY,
    "send_components_v2_links": READ_ONLY,
    "open_settings_surface": READ_ONLY,
    "settings": READ_ONLY,
    "premium_command": READ_ONLY,
    "PremiumControlsPage.confirm_premium": READ_ONLY,
    "FooterBrandingSettingsView.recheck_premium": READ_ONLY,
    "on_message": PREMIUM_BRANCH,
    "FooterEmojiSelect.callback": EARLY_RETURN,
    "FooterBrandingSettingsView.toggle": EARLY_RETURN,
    "CaptionModeSelect.callback": EARLY_RETURN,
    "CardStyleSettingsView.toggle_stats": EARLY_RETURN,
    "CardStyleSettingsView.toggle_hashtags": EARLY_RETURN,
    "IgnoredUsersSelect.callback": EARLY_RETURN,
    "IgnoredRolesSelect.callback": EARLY_RETURN,
}


class FallbackWritesNothingTests(unittest.TestCase):
    """A False premium answer (including a timeout fallback) never persists anything."""

    @classmethod
    def setUpClass(cls):
        cls.tree = ast.parse(MAIN_SOURCE)
        cls.parents = {}
        for node in ast.walk(cls.tree):
            for child in ast.iter_child_nodes(node):
                cls.parents[child] = node
        cls.functions = {}
        for node in ast.walk(cls.tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                cls.functions[cls._qualname(cls, node)] = node

    def _qualname(self, node):
        names = [node.name]
        current = node
        while current in self.parents:
            current = self.parents[current]
            if isinstance(current, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                names.append(current.name)
        return ".".join(reversed(names))

    def _enclosing_function(self, node):
        current = node
        while current in self.parents:
            current = self.parents[current]
            if isinstance(current, (ast.FunctionDef, ast.AsyncFunctionDef)):
                return self._qualname(current)
        return None

    def _writes(self, node):
        return [n for n in ast.walk(node) if isinstance(n, ast.Call) and _call_name(n) in WRITE_CALLS]

    def test_every_premium_caller_is_audited(self):
        callers = {
            self._enclosing_function(node)
            for node in ast.walk(self.tree)
            if isinstance(node, ast.Call) and _call_name(node) in PREMIUM_CHECKS
        }
        # A new caller must be added to PREMIUM_CALLERS with its write guard.
        self.assertEqual(set(PREMIUM_CALLERS), callers)

    def test_read_only_callers_never_write(self):
        for name, kind in PREMIUM_CALLERS.items():
            if kind == READ_ONLY:
                with self.subTest(caller=name):
                    self.assertEqual([], self._writes(self.functions[name]))

    def test_on_message_writes_only_inside_if_premium(self):
        writes = self._writes(self.functions["on_message"])
        self.assertTrue(writes)
        for call in writes:
            with self.subTest(call=_call_name(call), line=call.lineno):
                guarded = False
                child, current = call, self.parents[call]
                while current is not self.functions["on_message"]:
                    if (
                        isinstance(current, ast.If)
                        and isinstance(current.test, ast.Name)
                        and current.test.id == "premium"
                        and child in current.body
                    ):
                        guarded = True
                        break
                    child, current = current, self.parents[current]
                self.assertTrue(guarded, "write in on_message outside `if premium:`")

    def test_mutating_callers_return_before_writing_when_not_premium(self):
        for name, kind in PREMIUM_CALLERS.items():
            if kind != EARLY_RETURN:
                continue
            with self.subTest(caller=name):
                function = self.functions[name]
                guard = function.body[0]
                self.assertIsInstance(guard, ast.If)
                self.assertIsInstance(guard.test, ast.UnaryOp)
                self.assertIsInstance(guard.test.op, ast.Not)
                self.assertIsInstance(guard.test.operand, ast.Await)
                self.assertIn(_call_name(guard.test.operand.value), PREMIUM_CHECKS)
                self.assertIsInstance(guard.body[-1], ast.Return)
                self.assertEqual([], self._writes(guard))
                self.assertTrue(self._writes(function), "expected a guarded write")

    def test_free_answer_does_not_mutate_settings(self):
        settings = MappingProxyType({
            "embed_color": "#FF5733",
            "card_caption_mode": "compact",
            "ignored_user_ids": [1],
            "ignored_role_ids": [2],
            "footer_branding_enabled": True,
        })
        message = SimpleNamespace(author=SimpleNamespace(id=1, roles=[SimpleNamespace(id=2)]))

        # Read-only mapping: any write would raise TypeError.
        self.assertFalse(should_skip_automatic(message, settings, premium=False))
        preferences = preferences_from_settings(settings, premium=False)
        self.assertIsNone(preferences.accent_color)
        self.assertEqual("#FF5733", settings["embed_color"])

    def test_fallback_leaves_cache_untouched(self):
        async def run():
            cache = PremiumStatusCache()
            set_cached_premium(cache.setdefault(1, {}), True, now=0.0)
            before = {key: dict(value) for key, value in cache.items()}
            past = PREMIUM_CACHE_TTL_SECONDS + PREMIUM_STALE_GRACE_SECONDS + 1
            result = await resolve_guild_premium(
                cache, 1, FakeEntitlements(error=RuntimeError("boom")), now=past
            )
            result_missing = await resolve_guild_premium(
                cache, 2, FakeEntitlements(error=RuntimeError("boom")), now=past
            )
            return result, result_missing, before, cache

        logging.disable(logging.CRITICAL)
        self.addCleanup(logging.disable, logging.NOTSET)
        result, result_missing, before, cache = asyncio.run(run())
        self.assertFalse(result)
        self.assertFalse(result_missing)
        self.assertEqual(before, {key: dict(value) for key, value in cache.items()})


if __name__ == "__main__":
    unittest.main()
