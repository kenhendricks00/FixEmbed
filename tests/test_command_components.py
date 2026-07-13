import unittest

import discord

from command_components import render_command_layout
from translations import TRANSLATIONS


class CommandComponentsTests(unittest.TestCase):
    def test_help_lists_every_supported_service_in_each_language(self):
        services = (
            "Twitter",
            "Instagram",
            "Reddit",
            "Threads",
            "Pixiv",
            "Bluesky",
            "Bilibili",
            "YouTube",
        )

        for language, strings in TRANSLATIONS.items():
            with self.subTest(language=language):
                supported = strings["supported_services_value"]
                for service in services:
                    self.assertIn(service, supported)

    def test_layout_renders_branded_sections_and_link_buttons(self):
        view = discord.ui.LayoutView(timeout=180)
        invite = discord.ui.Button(
            label="Invite FixEmbed",
            style=discord.ButtonStyle.link,
            url="https://discord.com/oauth2/authorize?client_id=1173820242305224764",
        )
        support = discord.ui.Button(
            label="Support Server",
            style=discord.ButtonStyle.link,
            url="https://discord.gg/QFxTAmtZdn",
        )

        render_command_layout(
            view,
            title="About FixEmbed",
            description="Better social embeds for Discord.",
            sections=(
                ("Credits", "Built with open-source services."),
                ("License", "AGPL-3.0-or-later"),
            ),
            controls=((invite, support),),
            footer="About",
        )

        self.assertEqual(len(view.children), 1)
        container = view.children[0]
        self.assertIsInstance(container, discord.ui.Container)
        self.assertEqual(int(container.accent_color), 0x5865F2)

        text = [item.content for item in container.children if isinstance(item, discord.ui.TextDisplay)]
        self.assertIn("## About FixEmbed\nBetter social embeds for Discord.", text)
        self.assertIn("### Credits\nBuilt with open-source services.", text)
        self.assertIn("### License\nAGPL-3.0-or-later", text)
        self.assertTrue(any("<:fixembed:1525580543503106148> FixEmbed  ·  About" in item for item in text))

        rows = [item for item in container.children if isinstance(item, discord.ui.ActionRow)]
        self.assertEqual(len(rows), 1)
        self.assertIs(rows[0].children[0], invite)
        self.assertIs(rows[0].children[1], support)

    def test_layout_omits_blank_sections_and_empty_control_rows(self):
        view = discord.ui.LayoutView(timeout=180)

        render_command_layout(
            view,
            title="Commands",
            description="Available commands.",
            sections=(("Visible", "Content"), ("Blank", "  ")),
            controls=((),),
            footer="Help",
        )

        container = view.children[0]
        text = [item.content for item in container.children if isinstance(item, discord.ui.TextDisplay)]
        self.assertIn("### Visible\nContent", text)
        self.assertFalse(any("Blank" in item for item in text))
        self.assertFalse(any(isinstance(item, discord.ui.ActionRow) for item in container.children))


if __name__ == "__main__":
    unittest.main()
