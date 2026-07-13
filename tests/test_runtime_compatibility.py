import unittest
from pathlib import Path


class DiscordRuntimeCompatibilityTests(unittest.TestCase):
    def test_bot_does_not_call_removed_trigger_typing_api(self):
        main_source = Path(__file__).resolve().parents[1].joinpath("main.py").read_text(encoding="utf-8")

        self.assertNotIn("trigger_typing", main_source)

    def test_youtube_application_emoji_is_configured(self):
        main_source = Path(__file__).resolve().parents[1].joinpath("main.py").read_text(encoding="utf-8")

        self.assertIn('"YouTube": 1525579761479450686', main_source)

    def test_instagram_uses_first_party_activity_card_without_uploading_media(self):
        main_source = Path(__file__).resolve().parents[1].joinpath("main.py").read_text(encoding="utf-8")

        self.assertIn("include_fixembed=False", main_source)
        self.assertNotIn("download_instagram_video", main_source)
        self.assertNotIn("video_file = discord.File(", main_source)
        self.assertNotIn("instagram_cards", main_source)


if __name__ == "__main__":
    unittest.main()
