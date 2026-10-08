"""/premium and the settings screens say "couldn't confirm" when Discord can't be checked (#101)."""

import ast
import asyncio
import logging
import unittest
from pathlib import Path
from types import SimpleNamespace

from premium_cache import (
    PREMIUM_CACHE_TTL_SECONDS,
    PremiumStatusCache,
    record_guild_premium,
    resolve_guild_premium,
    resolve_guild_premium_status,
    set_cached_premium,
)
from translations import TRANSLATIONS

MAIN_SOURCE = Path(__file__).resolve().parents[1].joinpath("main.py").read_text(encoding="utf-8")
GUILD = 10101


def active():
    return SimpleNamespace(deleted=False, is_expired=lambda: False)


class Lookup:
    def __init__(self, entitlements=(), *, error=None, hang=False):
        self.entitlements = entitlements
        self.error = error
        self.hang = hang
        self.calls = 0

    async def __call__(self):
        self.calls += 1
        if self.hang:
            await asyncio.sleep(10)
        if self.error is not None:
            raise self.error
        return None if self.entitlements is None else list(self.entitlements)


class ResolveStatusTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        logging.disable(logging.CRITICAL)
        self.addCleanup(logging.disable, logging.NOTSET)

    async def status(self, cache, lookup, **options):
        return await resolve_guild_premium_status(cache, GUILD, lookup, now=10.0, **options)

    async def test_failed_check_with_nothing_cached_is_unconfirmed_and_writes_nothing(self):
        for lookup in (Lookup(error=RuntimeError("503")), Lookup(hang=True), Lookup(None)):
            with self.subTest(lookup=vars(lookup)):
                cache = PremiumStatusCache()
                self.assertEqual("unconfirmed", await self.status(cache, lookup, timeout=0.05))
                self.assertNotIn(GUILD, cache)
                # Message handling still treats it as free for that message.
                self.assertFalse(await resolve_guild_premium(cache, GUILD, lookup, now=10.0, timeout=0.05))
                self.assertNotIn(GUILD, cache)

    async def test_confirmed_answers_stay_active_or_inactive(self):
        cache = PremiumStatusCache()
        self.assertEqual("active", await self.status(cache, Lookup([active()])))
        self.assertEqual("active", await self.status(cache, Lookup(error=RuntimeError("cached"))))
        free = PremiumStatusCache()
        self.assertEqual("inactive", await self.status(free, Lookup([])))
        self.assertFalse(free[GUILD]["is_premium"])

    async def test_failed_check_serves_a_recent_cached_answer_instead(self):
        cache = PremiumStatusCache()
        set_cached_premium(cache.setdefault(GUILD, {}), True, now=0.0)
        expired = PREMIUM_CACHE_TTL_SECONDS + 5
        self.assertEqual(
            "active",
            await resolve_guild_premium_status(cache, GUILD, Lookup(error=RuntimeError("503")), now=expired),
        )

    async def test_event_during_an_unchecked_lookup_is_served(self):
        cache = PremiumStatusCache()
        gate = asyncio.Event()

        async def lookup():
            await gate.wait()
            return None

        task = asyncio.create_task(resolve_guild_premium_status(cache, GUILD, lookup, now=10.0))
        await asyncio.sleep(0)
        record_guild_premium(cache, GUILD, True, now=10.0)
        gate.set()
        self.assertEqual("active", await task)


def _function(name):
    tree = ast.parse(MAIN_SOURCE)
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
            return ast.get_source_segment(MAIN_SOURCE, node)
    raise AssertionError(f"{name} not found in main.py")


def _class(name):
    tree = ast.parse(MAIN_SOURCE)
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef) and node.name == name:
            return ast.get_source_segment(MAIN_SOURCE, node)
    raise AssertionError(f"{name} not found in main.py")


class UnconfirmedCopyTests(unittest.TestCase):
    def test_every_language_has_its_own_couldnt_confirm_copy(self):
        for lang, table in TRANSLATIONS.items():
            with self.subTest(lang=lang):
                text = table.get("premium_unconfirmed", "")
                self.assertTrue(text)
                self.assertNotEqual(text, table.get("premium_not_active"))
                self.assertNotIn("not have Premium", text)

    def test_premium_page_state(self):
        namespace = {}
        exec(_function("premium_page_state"), namespace)
        state = namespace["premium_page_state"]
        self.assertEqual((True, False), state("active"))
        self.assertEqual((False, False), state("inactive"))
        self.assertEqual((False, True), state("unconfirmed"))
        self.assertEqual((True, False), state(True))
        self.assertEqual((False, False), state(False))

    def test_premium_command_says_couldnt_confirm_without_a_buy_button(self):
        source = _function("premium_command")
        self.assertIn("guild_premium_status(interaction.guild.id)", source)
        self.assertIn('get_text(lang, "premium_unconfirmed")', source)
        self.assertIn("if PREMIUM_SKU_ID and not premium and not unconfirmed:", source)

    def test_locked_settings_screens_say_couldnt_confirm_without_a_buy_button(self):
        for name in ("PremiumControlsPage", "FooterBrandingSettingsView"):
            with self.subTest(page=name):
                source = _class(name)
                self.assertIn('get_text(self.lang, "premium_unconfirmed")', source)
                self.assertIn("if PREMIUM_SKU_ID and not self.premium_unconfirmed:", source)
                self.assertIn("premium_page_state(", source)
        embed_color = _class("PremiumSettingsView")
        self.assertIn('"premium_unconfirmed" if unconfirmed else "premium_required"', embed_color)
        self.assertIn("if PREMIUM_SKU_ID and not unconfirmed:", embed_color)

    def test_settings_pages_receive_the_status_not_a_bool(self):
        source = _function("open_settings_surface")
        self.assertNotIn("is_guild_premium(", source)
        self.assertEqual(4, source.count("await guild_premium_status(interaction.guild.id)"))
        self.assertIn('unconfirmed=status == "unconfirmed"', source)


if __name__ == "__main__":
    unittest.main()
