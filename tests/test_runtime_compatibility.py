import unittest
from pathlib import Path


class DiscordRuntimeCompatibilityTests(unittest.TestCase):
    def test_bot_does_not_call_removed_trigger_typing_api(self):
        main_source = Path(__file__).resolve().parents[1].joinpath("main.py").read_text(encoding="utf-8")

        self.assertNotIn("trigger_typing", main_source)

    def test_platform_application_emojis_are_configured(self):
        main_source = Path(__file__).resolve().parents[1].joinpath("main.py").read_text(encoding="utf-8")

        expected_ids = {
            "YouTube": 1526267390592290926,
            "Pixiv": 1526268469920792577,
            "Threads": 1526267848924725399,
            "Reddit": 1526267589808881684,
            "Instagram": 1526267158793949435,
            "Twitter": 1526268173589155921,
            "Bluesky": 1526269663334502544,
            "Bilibili": 1526271150739423304,
        }
        for service, emoji_id in expected_ids.items():
            with self.subTest(service=service):
                self.assertIn(f'"{service}": {emoji_id}', main_source)

    def test_automatic_queue_sends_are_silent(self):
        main_source = Path(__file__).resolve().parents[1].joinpath("main.py").read_text(encoding="utf-8")

        self.assertGreaterEqual(main_source.count("silent=True"), 2)

    def test_instagram_uses_components_v2_without_uploading_media(self):
        main_source = Path(__file__).resolve().parents[1].joinpath("main.py").read_text(encoding="utf-8")

        self.assertIn("include_fixembed=False", main_source)
        self.assertNotIn("download_instagram_video", main_source)
        self.assertNotIn("video_file = discord.File(", main_source)
        self.assertIn("fetch_instagram_layout", main_source)
        self.assertIn("instagram_layouts", main_source)
        self.assertIn("view=layout", main_source)
        self.assertIn('if item.service == "Instagram":', main_source)
        self.assertIn("fallback_content=automatic_url", main_source)


if __name__ == "__main__":
    unittest.main()
