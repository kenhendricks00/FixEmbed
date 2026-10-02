import unittest
from pathlib import Path

from premium_activation import (
    PAGE_ANALYTICS,
    PAGE_BOT_FIX,
    PAGE_CARD_STYLE,
    PAGE_EMBED_COLOR,
    PAGE_EXCLUSIONS,
    PAGE_FOOTER,
    checklist_settings_targets,
    evaluate_activation_checklist,
)
from translations import TRANSLATIONS, get_text


class PremiumActivationChecklistTests(unittest.TestCase):
    def test_defaults_are_mostly_unconfigured_except_bot_fix(self):
        items = evaluate_activation_checklist({})
        by_key = {item.key: item for item in items}
        self.assertEqual(
            ["color", "footer", "card_style", "exclusions", "analytics", "bot_fix"],
            [item.key for item in items],
        )
        self.assertFalse(by_key["color"].configured)
        self.assertFalse(by_key["footer"].configured)
        self.assertFalse(by_key["card_style"].configured)
        self.assertFalse(by_key["exclusions"].configured)
        self.assertFalse(by_key["analytics"].configured)
        self.assertTrue(by_key["bot_fix"].configured)
        self.assertIsNone(by_key["bot_fix"].settings_page)
        self.assertEqual(PAGE_BOT_FIX, by_key["bot_fix"].settings_page)

    def test_configured_states_and_deep_link_targets(self):
        items = evaluate_activation_checklist(
            {
                "embed_color": "#FF5733",
                "footer_branding_enabled": True,
                "card_show_stats": False,
                "card_show_hashtags": True,
                "card_caption_mode": "full",
                "ignored_user_ids": [1],
                "ignored_role_ids": [],
            },
            analytics_summary=[
                {"service": "Twitter", "rich_count": 2, "fallback_count": 0},
            ],
        )
        by_key = {item.key: item for item in items}
        self.assertTrue(by_key["color"].configured)
        self.assertEqual(PAGE_EMBED_COLOR, by_key["color"].settings_page)
        self.assertTrue(by_key["footer"].configured)
        self.assertEqual(PAGE_FOOTER, by_key["footer"].settings_page)
        self.assertTrue(by_key["card_style"].configured)
        self.assertEqual(PAGE_CARD_STYLE, by_key["card_style"].settings_page)
        self.assertTrue(by_key["exclusions"].configured)
        self.assertEqual(PAGE_EXCLUSIONS, by_key["exclusions"].settings_page)
        self.assertTrue(by_key["analytics"].configured)
        self.assertEqual(PAGE_ANALYTICS, by_key["analytics"].settings_page)

        targets = checklist_settings_targets(items)
        self.assertEqual(5, len(targets))
        self.assertTrue(all(item.settings_page for item in targets))

    def test_card_style_compact_captions_count_as_changed(self):
        items = evaluate_activation_checklist({"card_caption_mode": "compact"})
        self.assertTrue(next(i for i in items if i.key == "card_style").configured)

    def test_empty_analytics_rows_are_not_configured(self):
        items = evaluate_activation_checklist(
            {},
            analytics_summary=[
                {"service": "Twitter", "rich_count": 0, "fallback_count": 0},
            ],
        )
        self.assertFalse(next(i for i in items if i.key == "analytics").configured)

    def test_locale_activation_keys_exist_in_every_language(self):
        required = (
            "premium_checklist_title",
            "premium_checklist_intro",
            "premium_checklist_done",
            "premium_checklist_todo",
            "premium_item_color_done",
            "premium_item_color_todo",
            "premium_item_footer_done",
            "premium_item_footer_todo",
            "premium_item_card_style_done",
            "premium_item_card_style_todo",
            "premium_item_exclusions_done",
            "premium_item_exclusions_todo",
            "premium_item_analytics_done",
            "premium_item_analytics_todo",
            "premium_item_bot_fix_done",
            "premium_item_bot_fix_todo",
            "premium_item_path",
            "premium_configure_placeholder",
            "premium_manage_title",
            "premium_manage_body",
            "premium_need_manage_guild",
        )
        for lang, catalog in TRANSLATIONS.items():
            for key in required:
                self.assertIn(key, catalog, f"{lang} missing {key}")

    def test_manage_billing_copy_points_at_discord_not_in_bot_portal(self):
        body = get_text("en", "premium_manage_body").lower()
        self.assertIn("user settings", body)
        self.assertIn("subscriptions", body)
        self.assertIn("integrations", body)
        self.assertIn("dis.gd/billing", body)
        self.assertNotIn("stripe", body)
        self.assertNotIn("fake", body)
        # Must not invent an in-bot cancel portal.
        self.assertNotIn("/cancel", body)

    def test_non_premium_perk_copy_unchanged_by_activation_strings(self):
        # Guard: packaging PR must not regress #62 perk list.
        perks = TRANSLATIONS["en"]["premium_perks"].splitlines()
        self.assertIn("Custom social card colors", perks)
        self.assertNotRegex(TRANSLATIONS["en"]["premium_perks"], r"(?i)translat")

    def test_main_wires_active_premium_checklist_and_deep_links(self):
        source = Path(__file__).resolve().parents[1].joinpath("main.py").read_text(
            encoding="utf-8"
        )
        self.assertIn("evaluate_activation_checklist", source)
        self.assertIn("format_premium_activation_checklist", source)
        self.assertIn("PremiumActivationDeepLinkSelect", source)
        self.assertIn("premium_manage_body", source)
        self.assertIn("open_settings_surface", source)
        # Non-premium path still advertises perks + SKU subscribe.
        self.assertIn("premium_perks_title", source)
        self.assertIn("ButtonStyle.premium", source)


if __name__ == "__main__":
    unittest.main()
