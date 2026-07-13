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

    def test_settings_workflow_uses_components_v2_without_legacy_embeds(self):
        main_source = Path(__file__).resolve().parents[1].joinpath("main.py").read_text(encoding="utf-8")
        settings_section = main_source.split("# Components V2 settings implementation used", 1)[1].split(
            "@client.tree.command(name='delivery'", 1
        )[0]

        self.assertIn("class SettingsPageView(ui.LayoutView)", settings_section)
        self.assertIn("class SettingsView(SettingsPageView)", settings_section)
        self.assertIn("render_settings_layout(", settings_section)
        self.assertNotIn("discord.Embed(", settings_section)
        self.assertIn(
            "interaction.response.send_message(view=SettingsView(interaction, guild_settings), ephemeral=True)",
            settings_section,
        )

        alias_section = main_source.split("@client.tree.command(name='delivery'", 1)[1].split(
            "@client.event\nasync def on_message", 1
        )[0]
        self.assertGreaterEqual(alias_section.count("SettingsNoticeView("), 4)
        self.assertNotIn("discord.Embed(", alias_section)
        self.assertIn("view=DebugSettingsView(interaction, settings)", main_source)
        self.assertIn('title=f"{client.user.name} Activated"', main_source)
        self.assertIn('title=f"{client.user.name} Deactivated"', main_source)

    def test_instagram_uses_components_v2_without_uploading_media(self):
        main_source = Path(__file__).resolve().parents[1].joinpath("main.py").read_text(encoding="utf-8")

        self.assertIn("include_fixembed=False", main_source)
        self.assertNotIn("download_instagram_video", main_source)
        self.assertNotIn("video_file = discord.File(", main_source)
        self.assertIn("fetch_instagram_layout", main_source)
        self.assertIn("component_layouts", main_source)
        self.assertIn("view=layout", main_source)
        self.assertIn('if item.service == "Instagram":', main_source)
        self.assertIn("fallback_content=automatic_url", main_source)

    def test_twitter_uses_components_v2_with_existing_link_fallback(self):
        main_source = Path(__file__).resolve().parents[1].joinpath("main.py").read_text(encoding="utf-8")

        self.assertIn("from twitter_embed import fetch_twitter_layout", main_source)
        self.assertIn('elif item.service == "Twitter":', main_source)
        self.assertIn(
            "fetch_twitter_layout(item.canonical_url, item.language, item.mode, fixed_url)",
            main_source,
        )
        self.assertIn("fixed_url = build_fixembed_url(item, media_quality)", main_source)
        self.assertIn("component_layouts.append((layout, automatic_url))", main_source)
        self.assertIn("fallback_content=automatic_url", main_source)

    def test_reddit_uses_components_v2_without_uploading_media(self):
        main_source = Path(__file__).resolve().parents[1].joinpath("main.py").read_text(encoding="utf-8")

        self.assertIn("from reddit_embed import fetch_reddit_layout", main_source)
        self.assertIn('elif item.service == "Reddit":', main_source)
        self.assertIn("fetch_reddit_layout(item.canonical_url)", main_source)
        self.assertIn("component_layouts.append((layout, automatic_url))", main_source)
        self.assertIn("fallback_content=automatic_url", main_source)
        self.assertNotIn("download_reddit", main_source)

    def test_threads_uses_components_v2_without_uploading_media(self):
        main_source = Path(__file__).resolve().parents[1].joinpath("main.py").read_text(encoding="utf-8")

        self.assertIn("from threads_embed import fetch_threads_layout", main_source)
        self.assertIn('elif item.service == "Threads":', main_source)
        self.assertIn("fetch_threads_layout(item.canonical_url, automatic_url)", main_source)
        self.assertIn("component_layouts.append((layout, automatic_url))", main_source)
        self.assertIn("fallback_content=automatic_url", main_source)
        self.assertNotIn("download_threads", main_source)

    def test_bluesky_uses_components_v2_without_uploading_media(self):
        main_source = Path(__file__).resolve().parents[1].joinpath("main.py").read_text(encoding="utf-8")

        self.assertIn("from bluesky_embed import fetch_bluesky_layout", main_source)
        self.assertIn('elif item.service == "Bluesky":', main_source)
        self.assertIn("fetch_bluesky_layout(item.canonical_url, automatic_url)", main_source)
        self.assertIn("component_layouts.append((layout, automatic_url))", main_source)
        self.assertIn("fallback_content=automatic_url", main_source)
        self.assertNotIn("download_bluesky", main_source)


if __name__ == "__main__":
    unittest.main()
