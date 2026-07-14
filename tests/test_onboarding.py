import unittest
from types import SimpleNamespace

import discord

from onboarding import SUPPORT_SERVER_URL, build_onboarding_view, send_onboarding_dm


class _Owner:
    def __init__(self, error=None):
        self.error = error
        self.sent = []

    async def send(self, **kwargs):
        if self.error:
            raise self.error
        self.sent.append(kwargs)


class OnboardingTests(unittest.IsolatedAsyncioTestCase):
    def test_onboarding_view_is_components_v2_and_has_setup_guidance(self):
        view = build_onboarding_view("Test @everyone [Server]")

        self.assertIsInstance(view, discord.ui.LayoutView)
        container = view.children[0]
        self.assertIsInstance(container, discord.ui.Container)
        text = "\n".join(
            item.content
            for item in container.children
            if isinstance(item, discord.ui.TextDisplay)
        )
        self.assertIn("Thanks for adding FixEmbed", text)
        self.assertIn("/settings", text)
        self.assertIn("/help", text)
        self.assertIn("Debug", text)
        self.assertIn("@\u200beveryone", text)
        self.assertNotIn("Premium", text)

        buttons = [
            child
            for item in container.children
            if isinstance(item, discord.ui.ActionRow)
            for child in item.children
        ]
        self.assertTrue(any(button.url == SUPPORT_SERVER_URL for button in buttons))

    async def test_onboarding_dm_is_sent_once_to_the_known_owner(self):
        owner = _Owner()
        guild = SimpleNamespace(owner=owner, owner_id=10, name="Test Server")

        sent = await send_onboarding_dm(guild)

        self.assertTrue(sent)
        self.assertEqual(len(owner.sent), 1)
        self.assertIsInstance(owner.sent[0]["view"], discord.ui.LayoutView)

    async def test_closed_owner_dms_are_silently_ignored(self):
        response = SimpleNamespace(status=403, reason="Forbidden")
        owner = _Owner(discord.Forbidden(response, "DMs closed"))
        guild = SimpleNamespace(owner=owner, owner_id=10, name="Test Server")

        self.assertFalse(await send_onboarding_dm(guild))

