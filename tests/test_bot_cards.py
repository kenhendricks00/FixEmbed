import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import discord

from fixembed import cards, config
from fixembed.links import SupportedLink, extract_supported_links
from fixembed.presentation.footer import FooterBranding
from fixembed.presentation.preferences import CardPreferences


class BotCardTests(unittest.IsolatedAsyncioTestCase):
    async def test_every_standard_platform_receives_branding_preferences_and_translation(
        self,
    ):
        self.assertEqual(
            set(cards.LAYOUT_FETCHERS) | {"Twitter", "Instagram"},
            set(config.SERVICE_NAMES),
        )
        for platform in cards.LAYOUT_FETCHERS:
            with self.subTest(platform=platform):
                item = SupportedLink(platform, "https://example.com/post", "Post", 0, 1)
                view = discord.ui.LayoutView()
                branding, preferences = (
                    FooterBranding("Example"),
                    CardPreferences(show_stats=False),
                )
                fetch = AsyncMock(return_value=view)
                with patch.dict(cards.LAYOUT_FETCHERS, {platform: fetch}):
                    delivery = await cards.build_components_v2_link(
                        item, {"translation_language": "es"}, branding, preferences
                    )
                fetch.assert_awaited_once_with(
                    item.canonical_url,
                    delivery.fallback_url,
                    branding,
                    preferences,
                    translation_language="es",
                )
                self.assertIs(delivery.view, view)
                self.assertEqual(delivery.files, ())

    async def test_instagram_keeps_attachments(self):
        item = SupportedLink("Instagram", "https://instagram.com/p/abc/", "Post", 0, 1)
        result = SimpleNamespace(layout=discord.ui.LayoutView(), files=(object(),))
        with patch(
            "fixembed.cards.fetch_instagram_delivery", AsyncMock(return_value=result)
        ):
            delivery = await cards.build_components_v2_link(
                item, {}, None, CardPreferences()
            )
        self.assertEqual(delivery.files, result.files)
        self.assertIs(delivery.view, result.layout)

    async def test_twitter_keeps_explicit_language_mode_and_layout(self):
        item = SupportedLink(
            "Twitter",
            "https://x.com/jack/status/20",
            "Post",
            0,
            1,
            language="ja",
            mode="gallery",
        )
        view = discord.ui.LayoutView()
        with (
            patch(
                "fixembed.cards.fetch_twitter_payload",
                AsyncMock(return_value={"title": "Post"}),
            ) as fetch,
            patch("fixembed.cards.build_twitter_layout", return_value=view),
        ):
            delivery = await cards.build_components_v2_link(
                item, {"translation_language": "es"}, None, CardPreferences()
            )
        fetch.assert_awaited_once_with(item.canonical_url, "ja", "gallery")
        self.assertIs(delivery.view, view)

    async def test_fix_command_sends_japanese_and_chinese_suffixes_to_the_worker(self):
        # Issue #129: /fix must pass ja and every zh variant through to the Worker.
        cases = {
            "ja": "ja",
            "zh": "zh",
            "zh-cn": "zh",
            "zh-tw": "zh-tw",
            "zh-hant": "zh-tw",
            "ko": "ko",
            "fr": "fr",
        }
        for suffix, expected in cases.items():
            with self.subTest(suffix=suffix):
                item = extract_supported_links(f"https://x.com/jack/status/20/{suffix}")[0]
                with (
                    patch(
                        "fixembed.cards.fetch_twitter_payload",
                        AsyncMock(return_value={"title": "Post"}),
                    ) as fetch,
                    patch(
                        "fixembed.cards.build_twitter_layout",
                        return_value=discord.ui.LayoutView(),
                    ),
                ):
                    delivery = await cards.build_components_v2_link(
                        item, {}, None, CardPreferences()
                    )
                fetch.assert_awaited_once_with(
                    "https://x.com/jack/status/20", expected, None
                )
                self.assertIn(f"&lang={expected}", delivery.fallback_url)

    async def test_unsupported_platform_is_reported(self):
        item = SupportedLink("Unknown", "https://example.com", "Post", 0, 1)
        with self.assertRaisesRegex(ValueError, "unsupported"):
            await cards.build_components_v2_link(item, {}, None, CardPreferences())
