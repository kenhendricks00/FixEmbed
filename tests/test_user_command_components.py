import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import discord

from fixembed import cards
from fixembed.links import extract_supported_links


class UserCommandComponentsTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.interaction = SimpleNamespace(
            guild=None,
            channel=None,
            response=SimpleNamespace(defer=AsyncMock()),
            followup=SimpleNamespace(send=AsyncMock()),
        )
        self.links = extract_supported_links("https://x.com/jack/status/20")

    async def test_user_commands_send_components_and_attachments(self):
        file = object()
        delivery = cards.ComponentsV2Delivery(
            discord.ui.LayoutView(), "https://fallback.test", (file,)
        )
        with patch(
            "fixembed.cards.build_components_v2_link", AsyncMock(return_value=delivery)
        ):
            await cards.send_components_v2_links(self.interaction, self.links)
        self.interaction.response.defer.assert_awaited_once()
        self.interaction.followup.send.assert_awaited_once_with(
            view=delivery.view, files=[file]
        )

    async def test_files_are_omitted_for_cards_without_attachments(self):
        delivery = cards.ComponentsV2Delivery(
            discord.ui.LayoutView(), "https://fallback.test"
        )
        with patch(
            "fixembed.cards.build_components_v2_link", AsyncMock(return_value=delivery)
        ):
            await cards.send_components_v2_links(self.interaction, self.links)
        self.interaction.followup.send.assert_awaited_once_with(view=delivery.view)

    async def test_card_build_failure_uses_a_link(self):
        with patch(
            "fixembed.cards.build_components_v2_link",
            AsyncMock(side_effect=ValueError("missing media")),
        ):
            await cards.send_components_v2_links(self.interaction, self.links)
        args = self.interaction.followup.send.call_args.args
        self.assertTrue(args[0].startswith("https://"))

    async def test_discord_card_rejection_uses_the_delivery_fallback(self):
        delivery = cards.ComponentsV2Delivery(
            discord.ui.LayoutView(), "https://fallback.test"
        )
        error = discord.HTTPException(
            SimpleNamespace(status=400, reason="Bad request"), "bad card"
        )
        self.interaction.followup.send.side_effect = [error, None]
        with patch(
            "fixembed.cards.build_components_v2_link", AsyncMock(return_value=delivery)
        ):
            await cards.send_components_v2_links(self.interaction, self.links)
        self.assertEqual(self.interaction.followup.send.await_count, 2)
        self.assertEqual(
            self.interaction.followup.send.call_args.args, (delivery.fallback_url,)
        )
