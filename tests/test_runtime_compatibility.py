import unittest
from pathlib import Path


class DiscordRuntimeCompatibilityTests(unittest.TestCase):
    def test_app_command_only_bot_does_not_parse_slash_text_as_a_prefix_command(self):
        main_source = Path(__file__).resolve().parents[1].joinpath("main.py").read_text(encoding="utf-8")

        self.assertNotIn("command_prefix='/'", main_source)
        self.assertNotIn("await client.process_commands(message)", main_source)

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
            "Pinterest": 1526398381415731240,
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
            "view=SettingsView(interaction, guild_settings, premium=premium)",
            settings_section,
        )

        alias_section = main_source.split("@client.tree.command(name='delivery'", 1)[1].split(
            "@client.event\nasync def on_message", 1
        )[0]
        self.assertGreaterEqual(alias_section.count("SettingsNoticeView("), 3)
        self.assertIn("view = ReliabilitySettingsView(", alias_section)
        self.assertNotIn("discord.Embed(", alias_section)
        self.assertIn("view=DebugSettingsView(interaction, settings)", main_source)
        self.assertIn('title=f"{client.user.name} Activated"', main_source)
        self.assertIn('title=f"{client.user.name} Deactivated"', main_source)

    def test_reliability_views_use_live_worker_health_with_refresh_and_dashboard(self):
        main_source = Path(__file__).resolve().parents[1].joinpath("main.py").read_text(encoding="utf-8")

        self.assertIn("from reliability import (", main_source)
        self.assertIn("reliability_client = ReliabilityClient(", main_source)
        self.assertIn('if value == "Reliability Status":', main_source)
        self.assertGreaterEqual(main_source.count("await reliability_client.get_report("), 3)
        self.assertIn('label="Refresh"', main_source)
        self.assertIn('label="Public status"', main_source)
        self.assertIn('url="https://fixembed.app/status"', main_source)
        self.assertIn("format_reliability_status(", main_source)
        status_decorators = main_source.split(
            "@client.tree.command(name='status'", 1
        )[1].split("async def status", 1)[0]
        self.assertIn("@app_commands.guild_only()", status_decorators)

    def test_settings_only_offers_premium_purchase_to_non_subscribers(self):
        main_source = Path(__file__).resolve().parents[1].joinpath("main.py").read_text(encoding="utf-8")
        settings_section = main_source.split("# Components V2 settings implementation used", 1)[1].split(
            "@client.tree.command(name='delivery'", 1
        )[0]

        self.assertIn("if PREMIUM_SKU_ID and not premium:", settings_section)
        self.assertIn("style=discord.ButtonStyle.premium", settings_section)
        self.assertIn("premium = await is_guild_premium(guild_id)", settings_section)
        self.assertIn("SettingsView(interaction, guild_settings, premium=premium)", settings_section)

    def test_premium_footer_branding_is_persisted_and_propagated(self):
        main_source = Path(__file__).resolve().parents[1].joinpath("main.py").read_text(encoding="utf-8")

        self.assertIn("footer_branding_enabled BOOLEAN DEFAULT FALSE", main_source)
        self.assertIn("footer_emoji_id INTEGER DEFAULT NULL", main_source)
        self.assertIn("class FooterBrandingSettingsView(SettingsPageView)", main_source)
        self.assertIn("footer_branding = get_footer_branding(", main_source)
        self.assertGreaterEqual(main_source.count("automatic_url, footer_branding"), 8)
        self.assertIn("payload, fixed_url, footer_branding", main_source)
        self.assertIn("if not premium or not settings.get(\"footer_branding_enabled\"", main_source)

    def test_premium_card_controls_translation_and_exclusions_are_wired(self):
        main_source = Path(__file__).resolve().parents[1].joinpath("main.py").read_text(encoding="utf-8")

        self.assertIn("class CardStyleSettingsView(PremiumControlsPage)", main_source)
        self.assertIn("class TwitterTranslationSettingsView(PremiumControlsPage)", main_source)
        self.assertIn("class ExclusionSettingsView(PremiumControlsPage)", main_source)
        self.assertIn("preferences_from_settings(guild_settings, premium=premium)", main_source)
        self.assertIn("resolve_twitter_language(", main_source)
        self.assertIn("should_skip_automatic(message, guild_settings, premium=premium)", main_source)
        self.assertGreaterEqual(main_source.count("footer_branding, card_preferences"), 9)

    def test_footer_branding_settings_option_is_visibly_premium(self):
        main_source = Path(__file__).resolve().parents[1].joinpath("main.py").read_text(encoding="utf-8")

        self.assertIn('label="Footer Branding"', main_source)
        self.assertIn(
            'description="Use this server\'s identity in social cards (Premium)"',
            main_source,
        )
        self.assertIn('value="Footer Branding",\n                emoji="🏷️"', main_source)

    def test_server_settings_require_manage_server_permission(self):
        main_source = Path(__file__).resolve().parents[1].joinpath("main.py").read_text(encoding="utf-8")
        settings_decorators = main_source.split(
            "@client.tree.command(name='settings'", 1
        )[1].split("async def settings", 1)[0]

        self.assertIn("@app_commands.guild_only()", settings_decorators)
        self.assertIn("@app_commands.default_permissions(manage_guild=True)", settings_decorators)
        self.assertIn("@app_commands.checks.has_permissions(manage_guild=True)", settings_decorators)

    def test_new_guilds_receive_owner_onboarding(self):
        main_source = Path(__file__).resolve().parents[1].joinpath("main.py").read_text(encoding="utf-8")
        join_section = main_source.split("async def on_guild_join(guild):", 1)[1].split(
            "# --- Premium Command ---", 1
        )[0]

        self.assertIn("await send_onboarding_dm(guild)", join_section)

    def test_about_and_help_commands_use_components_v2(self):
        main_source = Path(__file__).resolve().parents[1].joinpath("main.py").read_text(encoding="utf-8")
        info_commands = main_source.split("@client.tree.command(\n    name='about'", 1)[1].split(
            "@client.tree.command(\n    name='fix'", 1
        )[0]

        self.assertNotIn("discord.Embed(", info_commands)
        self.assertGreaterEqual(info_commands.count("CommandInfoView("), 2)
        self.assertGreaterEqual(info_commands.count("interaction.response.send_message(view=view)"), 2)
        self.assertIn("Fallback services & acknowledgements", info_commands)
        self.assertIn("These services are not affiliated with or endorsed by FixEmbed.", info_commands)

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

        self.assertIn("from twitter_embed import build_twitter_layout, fetch_twitter_payload", main_source)
        self.assertIn('elif item.service == "Twitter":', main_source)
        self.assertIn(
            "item.canonical_url, twitter_language, item.mode",
            main_source,
        )
        self.assertIn("fixed_url = build_fixembed_url(item, media_quality)", main_source)
        self.assertIn("component_layouts.append((layout, automatic_url))", main_source)
        self.assertIn("fallback_content=automatic_url", main_source)
        self.assertNotIn("if is_animated_gif(payload):", main_source)

    def test_reddit_uses_components_v2_without_uploading_media(self):
        main_source = Path(__file__).resolve().parents[1].joinpath("main.py").read_text(encoding="utf-8")

        self.assertIn("from reddit_embed import fetch_reddit_layout", main_source)
        self.assertIn('elif item.service == "Reddit":', main_source)
        self.assertIn("fetch_reddit_layout(", main_source)
        self.assertIn("component_layouts.append((layout, automatic_url))", main_source)
        self.assertIn("fallback_content=automatic_url", main_source)
        self.assertNotIn("download_reddit", main_source)

    def test_threads_uses_components_v2_without_uploading_media(self):
        main_source = Path(__file__).resolve().parents[1].joinpath("main.py").read_text(encoding="utf-8")

        self.assertIn("from threads_embed import fetch_threads_layout", main_source)
        self.assertIn('elif item.service == "Threads":', main_source)
        self.assertIn("fetch_threads_layout(", main_source)
        self.assertIn("component_layouts.append((layout, automatic_url))", main_source)
        self.assertIn("fallback_content=automatic_url", main_source)
        self.assertNotIn("download_threads", main_source)

    def test_bluesky_uses_components_v2_without_uploading_media(self):
        main_source = Path(__file__).resolve().parents[1].joinpath("main.py").read_text(encoding="utf-8")

        self.assertIn("from bluesky_embed import fetch_bluesky_layout", main_source)
        self.assertIn('elif item.service == "Bluesky":', main_source)
        self.assertIn("fetch_bluesky_layout(", main_source)
        self.assertIn("component_layouts.append((layout, automatic_url))", main_source)
        self.assertIn("fallback_content=automatic_url", main_source)
        self.assertNotIn("download_bluesky", main_source)

    def test_pixiv_uses_components_v2_without_uploading_media(self):
        main_source = Path(__file__).resolve().parents[1].joinpath("main.py").read_text(encoding="utf-8")

        self.assertIn("from pixiv_embed import fetch_pixiv_layout", main_source)
        self.assertIn('elif item.service == "Pixiv":', main_source)
        self.assertIn("fetch_pixiv_layout(", main_source)
        self.assertIn("component_layouts.append((layout, automatic_url))", main_source)
        self.assertIn("fallback_content=automatic_url", main_source)
        self.assertNotIn("download_pixiv", main_source)

    def test_bilibili_uses_components_v2_without_uploading_media(self):
        main_source = Path(__file__).resolve().parents[1].joinpath("main.py").read_text(encoding="utf-8")

        self.assertIn("from bilibili_embed import fetch_bilibili_layout", main_source)
        self.assertIn('elif item.service == "Bilibili":', main_source)
        self.assertIn("fetch_bilibili_layout(", main_source)
        self.assertIn("component_layouts.append((layout, automatic_url))", main_source)
        self.assertIn("fallback_content=automatic_url", main_source)
        self.assertNotIn("download_bilibili", main_source)

    def test_youtube_community_posts_use_components_v2_without_uploading_media(self):
        main_source = Path(__file__).resolve().parents[1].joinpath("main.py").read_text(encoding="utf-8")

        self.assertIn("from youtube_embed import fetch_youtube_community_layout", main_source)
        self.assertIn('elif item.service == "YouTube":', main_source)
        self.assertIn("fetch_youtube_community_layout(", main_source)
        self.assertIn("component_layouts.append((layout, automatic_url))", main_source)
        self.assertIn("fallback_content=automatic_url", main_source)
        self.assertNotIn("download_youtube", main_source)

    def test_pinterest_pins_use_components_v2_without_uploading_media(self):
        main_source = Path(__file__).resolve().parents[1].joinpath("main.py").read_text(encoding="utf-8")

        self.assertIn("from pinterest_embed import fetch_pinterest_layout", main_source)
        self.assertIn('elif item.service == "Pinterest":', main_source)
        self.assertIn("fetch_pinterest_layout(", main_source)
        self.assertNotIn("download_pinterest", main_source)

    def test_forbidden_channel_errors_keep_discord_context(self):
        main_source = Path(__file__).resolve().parents[1].joinpath("main.py").read_text(encoding="utf-8")

        self.assertIn("except discord.Forbidden as error:", main_source)
        self.assertIn('logging.warning("Missing permissions in channel %s: %s"', main_source)


if __name__ == "__main__":
    unittest.main()
