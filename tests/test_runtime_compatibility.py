import unittest
from pathlib import Path


class DiscordRuntimeCompatibilityTests(unittest.TestCase):
    def test_bot_does_not_call_removed_trigger_typing_api(self):
        main_source = Path(__file__).resolve().parents[1].joinpath("main.py").read_text(encoding="utf-8")

        self.assertNotIn("trigger_typing", main_source)

    def test_youtube_application_emoji_is_configured(self):
        main_source = Path(__file__).resolve().parents[1].joinpath("main.py").read_text(encoding="utf-8")

        self.assertIn('"YouTube": 1525579761479450686', main_source)

    def test_instagram_video_preview_is_not_uploaded_as_an_attachment(self):
        main_source = Path(__file__).resolve().parents[1].joinpath("main.py").read_text(encoding="utf-8")

        self.assertNotIn("video_file = discord.File(", main_source)
        self.assertNotIn("card.embed.set_image(url=None)", main_source)
        self.assertIn("instagram_cards.append(card.embed)", main_source)


if __name__ == "__main__":
    unittest.main()
