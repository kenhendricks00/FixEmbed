import unittest

from settings_migrations import (
    NEW_SOCIAL_SERVICE_MIGRATIONS,
    PINTEREST_DEFAULT_MIGRATION,
    add_service_to_serialized_settings,
)


class SettingsMigrationTests(unittest.TestCase):
    def test_pinterest_migration_has_a_stable_unique_name(self):
        self.assertEqual(PINTEREST_DEFAULT_MIGRATION, "enable_pinterest_pins_v1")

    def test_new_service_is_appended_to_existing_settings(self):
        serialized = repr(["Twitter", "Instagram"])

        updated, changed = add_service_to_serialized_settings(serialized, "YouTube")

        self.assertTrue(changed)
        self.assertEqual(updated, repr(["Twitter", "Instagram", "YouTube"]))

    def test_new_social_migrations_have_stable_unique_names(self):
        self.assertEqual(
            NEW_SOCIAL_SERVICE_MIGRATIONS,
            (
                ("TikTok", "enable_tiktok_videos_v1"),
                ("Tumblr", "enable_tumblr_posts_v1"),
                ("Twitch", "enable_twitch_links_v1"),
                ("DeviantArt", "enable_deviantart_deviations_v1"),
            ),
        )

    def test_existing_service_is_not_duplicated(self):
        serialized = repr(["Twitter", "YouTube"])

        updated, changed = add_service_to_serialized_settings(serialized, "YouTube")

        self.assertFalse(changed)
        self.assertEqual(updated, serialized)


if __name__ == "__main__":
    unittest.main()
