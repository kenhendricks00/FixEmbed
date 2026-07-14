import unittest

from card_preferences import (
    CardPreferences,
    apply_caption_preferences,
    preferences_from_settings,
)


class CardPreferencesTests(unittest.TestCase):
    def test_defaults_preserve_caption_and_platform_accent(self):
        preferences = CardPreferences()

        self.assertEqual(
            apply_caption_preferences("A full caption #news", preferences),
            "A full caption #news",
        )
        self.assertEqual(preferences.accent_or(0x123456), 0x123456)
        self.assertTrue(preferences.show_stats)

    def test_compact_caption_hides_hashtags_and_truncates_cleanly(self):
        preferences = CardPreferences(
            show_hashtags=False,
            caption_mode="compact",
        )
        caption = "A" * 300 + " #news #updates"

        result = apply_caption_preferences(caption, preferences)

        self.assertEqual(len(result), 280)
        self.assertTrue(result.endswith("…"))
        self.assertNotIn("#news", result)

    def test_invalid_caption_mode_uses_full_output(self):
        preferences = CardPreferences(caption_mode="unexpected")

        self.assertEqual(
            apply_caption_preferences("Caption", preferences),
            "Caption",
        )

    def test_premium_settings_resolve_color_and_card_controls(self):
        preferences = preferences_from_settings(
            {
                "embed_color": "#123456",
                "card_show_stats": False,
                "card_show_hashtags": False,
                "card_caption_mode": "compact",
            },
            premium=True,
        )

        self.assertEqual(preferences.accent_color, 0x123456)
        self.assertFalse(preferences.show_stats)
        self.assertFalse(preferences.show_hashtags)
        self.assertEqual(preferences.caption_mode, "compact")

    def test_non_premium_and_invalid_values_use_safe_defaults(self):
        settings = {
            "embed_color": "javascript:red",
            "card_show_stats": False,
            "card_show_hashtags": False,
            "card_caption_mode": "hidden",
        }

        self.assertEqual(preferences_from_settings(settings, premium=False), CardPreferences())
        self.assertEqual(
            preferences_from_settings(settings, premium=True),
            CardPreferences(show_stats=False, show_hashtags=False),
        )


if __name__ == "__main__":
    unittest.main()
