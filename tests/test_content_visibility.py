import unittest

import aiosqlite

from fixembed.content_visibility import (
    ContentVisibility,
    channel_visibility_override,
    init_content_visibility,
    is_nsfw_channel,
    load_channel_visibility_overrides,
    resolve_content_visibility,
    set_channel_visibility_override,
)


class ContentVisibilityPolicyTests(unittest.TestCase):
    def test_channel_override_wins_over_nsfw_default_and_server_setting(self):
        visibility = resolve_content_visibility(
            {"show_nsfw": False, "show_spoilers": False},
            {"show_nsfw": False, "show_spoilers": None},
            channel_is_nsfw=True,
        )

        self.assertEqual(
            visibility,
            ContentVisibility(show_nsfw=False, show_spoilers=True),
        )

    def test_nsfw_and_spoiler_controls_are_independent(self):
        visibility = ContentVisibility(show_nsfw=True, show_spoilers=False)

        self.assertFalse(
            visibility.should_spoiler(
                {"sensitive": True, "sensitivityTypes": ["nsfw"]}
            )
        )
        self.assertTrue(
            visibility.should_spoiler(
                {"sensitive": True, "sensitivityTypes": ["spoiler"]}
            )
        )

    def test_content_with_both_classifications_stays_hidden_until_both_are_shown(self):
        payload = {
            "sensitive": True,
            "sensitivityTypes": ["nsfw", "spoiler"],
        }

        self.assertTrue(
            ContentVisibility(show_nsfw=True, show_spoilers=False).should_spoiler(
                payload
            )
        )
        self.assertFalse(
            ContentVisibility(show_nsfw=True, show_spoilers=True).should_spoiler(
                payload
            )
        )

    def test_thread_inherits_nsfw_state_from_its_parent_channel(self):
        class Channel:
            def __init__(self, nsfw=False, parent=None):
                self.parent = parent
                self._nsfw = nsfw

            def is_nsfw(self):
                return self._nsfw

        self.assertTrue(
            is_nsfw_channel(Channel(parent=Channel(nsfw=True)))
        )

    def test_thread_inherits_visibility_override_from_its_parent_channel(self):
        class Item:
            def __init__(self, item_id, *, guild=None, parent=None):
                self.id = item_id
                self.guild = guild
                self.parent = parent

        guild = Item(10)
        parent = Item(20, guild=guild)
        thread = Item(30, guild=guild, parent=parent)
        overrides = {
            (10, 20): {"show_nsfw": False, "show_spoilers": True},
        }

        self.assertEqual(
            channel_visibility_override(overrides, thread),
            overrides[(10, 20)],
        )


class ChannelVisibilityPersistenceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.db = await aiosqlite.connect(":memory:")
        await init_content_visibility(self.db)

    async def asyncTearDown(self):
        await self.db.close()

    async def test_channel_override_round_trips_independent_nullable_values(self):
        await set_channel_visibility_override(
            self.db,
            guild_id=10,
            channel_id=20,
            show_nsfw=False,
            show_spoilers=True,
        )

        overrides = await load_channel_visibility_overrides(self.db)

        self.assertEqual(
            overrides[(10, 20)],
            {"show_nsfw": False, "show_spoilers": True},
        )

    async def test_inheriting_both_settings_removes_the_channel_override(self):
        await set_channel_visibility_override(
            self.db,
            guild_id=10,
            channel_id=20,
            show_nsfw=True,
            show_spoilers=False,
        )

        await set_channel_visibility_override(
            self.db,
            guild_id=10,
            channel_id=20,
            show_nsfw=None,
            show_spoilers=None,
        )

        self.assertEqual(await load_channel_visibility_overrides(self.db), {})


if __name__ == "__main__":
    unittest.main()
