import unittest

from settings_migrations import add_service_to_serialized_settings


class SettingsMigrationTests(unittest.TestCase):
    def test_new_service_is_appended_to_existing_settings(self):
        serialized = repr(["Twitter", "Instagram"])

        updated, changed = add_service_to_serialized_settings(serialized, "YouTube")

        self.assertTrue(changed)
        self.assertEqual(updated, repr(["Twitter", "Instagram", "YouTube"]))

    def test_existing_service_is_not_duplicated(self):
        serialized = repr(["Twitter", "YouTube"])

        updated, changed = add_service_to_serialized_settings(serialized, "YouTube")

        self.assertFalse(changed)
        self.assertEqual(updated, serialized)


if __name__ == "__main__":
    unittest.main()
