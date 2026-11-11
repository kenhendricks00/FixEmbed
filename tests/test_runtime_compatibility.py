import asyncio
import importlib
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import discord

from fixembed import atproto, cards, config, events, runtime, settings, storage
from fixembed.telemetry.reliability import ReliabilityReport


def interaction():
    channel = Mock(
        spec=discord.TextChannel,
        id=22,
        mention="<#22>",
        name="general",
        parent_id=None,
        is_nsfw=lambda: False,
        permissions_for=lambda _: discord.Permissions.all(),
    )
    channel.name = "general"
    guild = SimpleNamespace(
        id=11,
        name="Example",
        shard_id=0,
        emojis=[],
        text_channels=[channel],
        me=object(),
        get_emoji=lambda _: None,
        get_channel_or_thread=lambda _: channel,
        get_channel=lambda _: channel,
    )
    return SimpleNamespace(
        guild=guild,
        channel=channel,
        user=SimpleNamespace(id=33),
        response=SimpleNamespace(
            send_message=AsyncMock(),
            edit_message=AsyncMock(),
            send_modal=AsyncMock(),
            defer=AsyncMock(),
        ),
        followup=SimpleNamespace(send=AsyncMock()),
        edit_original_response=AsyncMock(),
    )


class DiscordRuntimeCompatibilityTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        importlib.import_module("fixembed.commands")
        self.interaction = interaction()
        self.settings = storage.default_settings()
        runtime.client.launch_time = discord.utils.utcnow()
        self.addCleanup(storage.bot_settings.clear)
        self.addCleanup(storage.channel_states.clear)
        self.addCleanup(storage.channel_service_rules.clear)
        self.addCleanup(storage.channel_visibility_overrides.clear)
        self.addCleanup(runtime.processed_link_cache.clear)

    def test_importing_entry_point_never_starts_discord(self):
        with patch("fixembed.app.run") as run:
            import main

            importlib.reload(main)
        run.assert_not_called()

    def test_all_commands_are_registered_once(self):
        names = [command.name for command in runtime.client.tree.get_commands()]
        self.assertCountEqual(
            names,
            [
                "activate",
                "deactivate",
                "about",
                "help",
                "invite",
                "fix",
                "Fix Embed",
                "settings",
                "delivery",
                "quality",
                "rule",
                "status",
                "premium",
            ],
        )
        self.assertEqual(len(names), len(set(names)))

    def test_server_settings_require_manage_server(self):
        command = runtime.client.tree.get_command("settings")
        self.assertTrue(command.guild_only)
        self.assertTrue(command.default_permissions.manage_guild)
        self.assertTrue(command.checks)

    def test_personal_commands_support_user_installs_and_private_contexts(self):
        for name in ("about", "help", "invite", "fix", "premium"):
            with self.subTest(command=name):
                command = runtime.client.tree.get_command(name)
                self.assertTrue(command.allowed_installs.user)
                self.assertTrue(command.allowed_contexts.dm_channel)
                self.assertTrue(command.allowed_contexts.private_channel)

    def test_every_supported_platform_has_an_application_emoji(self):
        self.assertEqual(set(config.SERVICE_NAMES), set(config.SERVICE_EMOJI_IDS))
        for name in config.SERVICE_NAMES:
            emoji = runtime.get_service_select_emoji(self.interaction.guild, name)
            self.assertEqual(emoji.id, config.SERVICE_EMOJI_IDS[name])

    def test_settings_use_components_v2_and_only_non_subscribers_see_purchase(self):
        with patch.object(runtime.client, "premium_sku_id", "12345"):
            for premium in (False, True):
                view = settings.SettingsView(
                    self.interaction, self.settings, premium=premium
                )
                self.assertIsInstance(view, discord.ui.LayoutView)
                self.assertEqual(view.children[0].type, discord.ComponentType.container)
                purchases = [
                    item
                    for item in view.walk_children()
                    if isinstance(item, discord.ui.Button)
                    and item.style == discord.ButtonStyle.premium
                ]
                self.assertEqual(len(purchases), 0 if premium else 1)

    async def test_navigation_opens_every_settings_page(self):
        menu = settings.SettingsDropdown(self.interaction, self.settings)
        with (
            patch(
                "fixembed.settings.navigation.is_guild_premium",
                AsyncMock(return_value=False),
            ),
            patch(
                "fixembed.settings.navigation.reliability_client.get_report",
                AsyncMock(return_value=ReliabilityReport("operational", None)),
            ),
        ):
            for option in menu.options:
                with self.subTest(page=option.value):
                    menu._values = [option.value]
                    self.interaction.response.send_message.reset_mock()
                    await menu.callback(self.interaction)
                    send = (
                        self.interaction.followup.send
                        if option.value == "Reliability Status"
                        else self.interaction.response.send_message
                    )
                    view = send.call_args.kwargs["view"]
                    self.assertIsInstance(view, discord.ui.LayoutView)

    def test_channel_visibility_uses_native_channel_selection(self):
        view = settings.ChannelVisibilitySettingsView(self.interaction, self.settings)
        self.assertTrue(
            any(
                isinstance(item, discord.ui.ChannelSelect)
                for item in view.walk_children()
            )
        )

    def test_premium_footer_branding_resolves_the_current_guild(self):
        self.settings["footer_branding_enabled"] = True
        self.assertIsNone(
            runtime.get_footer_branding(self.interaction.guild, self.settings, False)
        )
        branding = runtime.get_footer_branding(
            self.interaction.guild, self.settings, True
        )
        self.assertEqual(branding.name, "Example")

    async def test_public_info_commands_render_cards_with_install_controls(self):
        with patch.object(
            runtime.client._connection, "user", SimpleNamespace(name="FixEmbed")
        ):
            for name in ("about", "help", "invite"):
                self.interaction.response.send_message.reset_mock()
                await runtime.client.tree.get_command(name).callback(self.interaction)
                kwargs = self.interaction.response.send_message.call_args.kwargs
                self.assertNotIn("embed", kwargs)
                view = kwargs["view"]
                self.assertIsInstance(view, discord.ui.LayoutView)
                urls = [
                    item.url
                    for item in view.walk_children()
                    if isinstance(item, discord.ui.Button)
                ]
                self.assertGreaterEqual(len(urls), 2)

    async def test_onboarding_is_sent_when_a_guild_joins(self):
        with (
            patch("fixembed.events.save_guild_settings", AsyncMock()) as save,
            patch(
                "fixembed.events.send_onboarding_dm", AsyncMock(return_value=True)
            ) as onboard,
        ):
            await events.on_guild_join(self.interaction.guild)
        save.assert_awaited_once()
        onboard.assert_awaited_once_with(self.interaction.guild)

    async def test_reconnects_initialize_once_even_when_ready_events_overlap(self):
        async def initialize():
            await asyncio.sleep(0)

        with (
            patch.object(runtime.client, "initialized", False),
            patch("fixembed.events._ready_lock", asyncio.Lock()),
            patch(
                "fixembed.events.initialize_runtime", AsyncMock(side_effect=initialize)
            ) as start,
        ):
            await asyncio.gather(
                events.on_ready(), events.on_ready(), events.on_ready()
            )
        start.assert_awaited_once()

    async def test_failed_initialization_can_retry(self):
        with (
            patch.object(runtime.client, "initialized", False),
            patch("fixembed.events._ready_lock", asyncio.Lock()),
            patch(
                "fixembed.events.initialize_runtime",
                AsyncMock(side_effect=[RuntimeError("db busy"), None]),
            ) as start,
        ):
            with self.assertRaises(RuntimeError):
                await events.on_ready()
            await events.on_ready()
            self.assertTrue(runtime.client.initialized)
        self.assertEqual(start.await_count, 2)

    async def test_shutdown_closes_database_and_discord_even_if_relay_cleanup_fails(
        self,
    ):
        database = SimpleNamespace(close=AsyncMock())
        relay = SimpleNamespace(
            cleanup=AsyncMock(side_effect=RuntimeError("relay cleanup"))
        )
        with (
            patch.object(runtime.client, "db", database),
            patch.object(runtime.client, "pixiv_relay_runner", relay),
            patch("discord.ext.commands.AutoShardedBot.close", AsyncMock()) as close,
        ):
            with self.assertRaisesRegex(RuntimeError, "relay cleanup"):
                await runtime.client.close()
            self.assertIsNone(runtime.client.db)
            self.assertIsNone(runtime.client.pixiv_relay_runner)
        database.close.assert_awaited_once()
        close.assert_awaited_once()

    async def test_source_message_changes_only_after_successful_replacement(self):
        for mode, manage, outcome, expected in [
            ("delete", True, "direct", "delete"),
            ("suppress", True, "direct", "suppress"),
            ("reply", True, "direct", None),
            ("delete", False, "direct", None),
            ("delete", True, "failed", None),
            ("suppress", True, "failed", None),
        ]:
            with self.subTest(mode=mode, manage=manage, outcome=outcome):
                runtime.processed_link_cache.clear()
                storage.bot_settings[11] = {**self.settings, "delivery_mode": mode}
                channel = self.interaction.channel
                channel.permissions_for = lambda _: SimpleNamespace(
                    manage_messages=manage
                )
                message = SimpleNamespace(
                    guild=self.interaction.guild,
                    channel=channel,
                    author=SimpleNamespace(
                        id=33,
                        bot=False,
                        display_name="Author",
                        mention="<@33>",
                        roles=[],
                    ),
                    content="https://x.com/jack/status/20",
                    mentions=[],
                    delete=AsyncMock(),
                    edit=AsyncMock(),
                )
                delivery = cards.ComponentsV2Delivery(
                    discord.ui.LayoutView(), "https://fixembed.app/embed?url=x"
                )
                with (
                    patch(
                        "fixembed.events.is_guild_premium",
                        AsyncMock(return_value=False),
                    ),
                    patch(
                        "fixembed.events.build_components_v2_link",
                        AsyncMock(return_value=delivery),
                    ),
                    patch(
                        "fixembed.events.rate_limited_send",
                        AsyncMock(return_value=outcome),
                    ) as send,
                ):
                    await events.on_message(message)
                self.assertGreater(send.await_count, 0)
                self.assertEqual(message.delete.await_count, int(expected == "delete"))
                self.assertEqual(message.edit.await_count, int(expected == "suppress"))

    async def test_card_build_failure_delivers_the_existing_link_fallback(self):
        message = SimpleNamespace(
            guild=self.interaction.guild,
            channel=self.interaction.channel,
            author=SimpleNamespace(id=33, bot=False, roles=[]),
            content="https://x.com/jack/status/20",
            mentions=[],
            delete=AsyncMock(),
            edit=AsyncMock(),
        )
        with (
            patch("fixembed.events.is_guild_premium", AsyncMock(return_value=False)),
            patch(
                "fixembed.events.build_components_v2_link",
                AsyncMock(side_effect=ValueError("bad payload")),
            ),
            patch(
                "fixembed.events.rate_limited_send", AsyncMock(return_value="direct")
            ) as send,
        ):
            await events.on_message(message)
        self.assertIn("https://", send.call_args.kwargs["content"])
        message.edit.assert_awaited_once_with(suppress=True)

    def atproto_message(self, content):
        return SimpleNamespace(
            guild=self.interaction.guild,
            channel=self.interaction.channel,
            author=SimpleNamespace(id=33, bot=False, roles=[]),
            content=content,
            mentions=[],
            delete=AsyncMock(),
            edit=AsyncMock(),
        )

    async def test_unverified_atproto_link_is_ignored_silently(self):
        # Issue #128: a non-AT site with the AT Protocol path shape gets no card,
        # no fallback link, and no change to the source message.
        atproto.clear_caches()
        self.addCleanup(atproto.clear_caches)
        message = self.atproto_message(
            "https://news.example-blog.com/profile/someone.example-blog.com/post/3mzy5hts2g22i"
        )
        lookup = AsyncMock(return_value=(400, {"error": "InvalidRequest"}))
        with (
            patch("fixembed.atproto._fetch_json", lookup),
            patch("fixembed.events.is_guild_premium", AsyncMock(return_value=False)),
            patch("fixembed.events.build_components_v2_link", AsyncMock()) as build,
            patch("fixembed.events.rate_limited_send", AsyncMock()) as send,
        ):
            await events.on_message(message)
        lookup.assert_awaited_once()
        build.assert_not_awaited()
        send.assert_not_awaited()
        message.edit.assert_not_awaited()
        message.delete.assert_not_awaited()

    async def test_verified_atproto_link_gets_a_card_on_its_own_host(self):
        atproto.clear_caches()
        self.addCleanup(atproto.clear_caches)
        message = self.atproto_message(
            "https://mu.social/profile/elenarossini.com/post/3mzfkhszhlc2l"
        )
        did = "did:plc:vggsjzvhakoa7l2m2mguqv4w"
        uri = f"at://{did}/app.bsky.feed.post/3mzfkhszhlc2l"

        async def appview(session, url):
            if "resolveHandle" in url:
                return 200, {"did": did}
            return 200, {"posts": [{"uri": uri}]}

        delivery = cards.ComponentsV2Delivery(
            discord.ui.LayoutView(), "https://fixembed.app/embed?url=x"
        )
        with (
            patch("fixembed.atproto._fetch_json", appview),
            patch("fixembed.events.is_guild_premium", AsyncMock(return_value=False)),
            patch(
                "fixembed.events.build_components_v2_link",
                AsyncMock(return_value=delivery),
            ) as build,
            patch(
                "fixembed.events.rate_limited_send", AsyncMock(return_value="direct")
            ) as send,
        ):
            await events.on_message(message)
        item = build.await_args.args[0]
        self.assertEqual(item.service, "Bluesky")
        self.assertEqual(
            item.canonical_url,
            "https://mu.social/profile/elenarossini.com/post/3mzfkhszhlc2l",
        )
        send.assert_awaited()

    async def test_atproto_link_is_not_looked_up_when_bluesky_is_disabled(self):
        atproto.clear_caches()
        self.addCleanup(atproto.clear_caches)
        storage.bot_settings[11] = {
            **self.settings,
            "enabled_services": [
                service for service in config.SERVICE_NAMES if service != "Bluesky"
            ],
        }
        message = self.atproto_message(
            "https://mu.social/profile/elenarossini.com/post/3mzfkhszhlc2l"
        )
        lookup = AsyncMock()
        with (
            patch("fixembed.atproto._fetch_json", lookup),
            patch("fixembed.events.is_guild_premium", AsyncMock(return_value=False)),
            patch("fixembed.events.rate_limited_send", AsyncMock()) as send,
        ):
            await events.on_message(message)
        lookup.assert_not_awaited()
        send.assert_not_awaited()

    async def test_fix_command_treats_unverified_atproto_link_as_unsupported(self):
        atproto.clear_caches()
        self.addCleanup(atproto.clear_caches)
        fix = runtime.client.tree.get_command("fix")
        url = "https://news.example-blog.com/profile/someone.example-blog.com/post/3mzy5hts2g22i"
        with (
            patch(
                "fixembed.atproto._fetch_json",
                AsyncMock(return_value=(400, {"error": "InvalidRequest"})),
            ),
            patch("fixembed.commands.send_components_v2_links", AsyncMock()) as send,
        ):
            await fix.callback(self.interaction, link=url)
        send.assert_not_awaited()
        self.interaction.response.send_message.assert_awaited_once()
        self.assertTrue(
            self.interaction.response.send_message.await_args.kwargs.get("ephemeral")
        )

    async def test_fix_command_converts_verified_atproto_link(self):
        atproto.clear_caches()
        self.addCleanup(atproto.clear_caches)
        fix = runtime.client.tree.get_command("fix")
        did = "did:plc:e3bwgswz6lniwjadqqfno3c4"
        url = f"https://wsocial.eu/profile/{did}/post/3mzy5hts2g22i"
        uri = f"at://{did}/app.bsky.feed.post/3mzy5hts2g22i"
        with (
            patch(
                "fixembed.atproto._fetch_json",
                AsyncMock(return_value=(200, {"posts": [{"uri": uri}]})),
            ),
            patch("fixembed.commands.send_components_v2_links", AsyncMock()) as send,
        ):
            await fix.callback(self.interaction, link=url)
        links = send.await_args.args[1]
        self.assertEqual([link.canonical_url for link in links], [url])

    async def test_test_instance_only_converts_links_in_its_guild(self):
        for test_guild, expected_sends in (("999", 0), ("11", 1)):
            runtime.processed_link_cache.clear()
            message = SimpleNamespace(
                guild=self.interaction.guild,
                channel=self.interaction.channel,
                author=SimpleNamespace(id=33, bot=False, roles=[]),
                content="https://www.reddit.com/r/aww/s/uTcEAsBqTj",
                mentions=[],
                delete=AsyncMock(),
                edit=AsyncMock(),
            )
            with (
                self.subTest(test_guild=test_guild),
                patch.dict("os.environ", {"FIXEMBED_TEST_GUILD_ID": test_guild}),
                patch("fixembed.events.is_guild_premium", AsyncMock(return_value=False)),
                patch(
                    "fixembed.events.build_components_v2_link",
                    AsyncMock(side_effect=ValueError("bad payload")),
                ),
                patch(
                    "fixembed.events.rate_limited_send", AsyncMock(return_value="direct")
                ) as send,
            ):
                await events.on_message(message)
            self.assertEqual(send.await_count, expected_sends)

    async def test_test_instance_never_sends_onboarding_dms(self):
        for test_guild, expected_saves in (("999", 0), ("11", 1)):
            storage.bot_settings.clear()
            with (
                self.subTest(test_guild=test_guild),
                patch.dict("os.environ", {"FIXEMBED_TEST_GUILD_ID": test_guild}),
                patch("fixembed.events.save_guild_settings", AsyncMock()) as save,
                patch(
                    "fixembed.events.send_onboarding_dm", AsyncMock(return_value=True)
                ) as onboard,
            ):
                await events.on_guild_join(self.interaction.guild)
            self.assertEqual(save.await_count, expected_saves)
            onboard.assert_not_awaited()

    async def test_test_instance_skips_support_server_role_reconciliation(self):
        for environ, expected_calls in (({}, 1), ({"FIXEMBED_TEST_GUILD_ID": "11"}, 0)):
            startup = {
                name: AsyncMock(
                    return_value={}
                    if name in {"load_premium_controls", "load_channel_visibility_overrides"}
                    else None
                )
                for name in (
                    "init_content_visibility",
                    "init_premium_controls",
                    "migrate_youtube_service_default",
                    "migrate_pinterest_service_default",
                    "migrate_new_social_services_default",
                    "load_channel_states",
                    "load_settings",
                    "load_premium_controls",
                    "load_channel_service_rules",
                    "load_channel_visibility_overrides",
                )
            }
            with (
                self.subTest(environ=environ),
                patch.dict("os.environ", environ),
                patch.multiple("fixembed.events", **startup),
                patch("fixembed.events.resolve_premium_sku", AsyncMock(return_value="123")),
                patch("fixembed.events.reconcile_supporter_roles", AsyncMock()) as reconcile,
                patch.object(events.change_status, "is_running", return_value=True),
                patch.object(runtime.client, "db", object()),
                patch.object(runtime.client, "send_task", Mock(done=lambda: False)),
                patch.object(runtime.client.tree, "sync", AsyncMock(return_value=[])),
            ):
                if not environ:
                    import os

                    os.environ.pop("FIXEMBED_TEST_GUILD_ID", None)
                await events.initialize_runtime()
            self.assertEqual(reconcile.await_count, expected_calls)


if __name__ == "__main__":
    unittest.main()
