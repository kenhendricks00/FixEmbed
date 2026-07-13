import unittest

import discord

from command_components import render_settings_layout


class SettingsComponentsTests(unittest.TestCase):
    def test_layout_renders_one_branded_container_with_action_rows(self):
        view = discord.ui.LayoutView(timeout=180)
        select = discord.ui.Select(
            placeholder="Choose a setting",
            options=[discord.SelectOption(label="Services", value="services")],
        )
        button = discord.ui.Button(label="Apply", style=discord.ButtonStyle.primary)

        render_settings_layout(
            view,
            title="FixEmbed Settings",
            description="Configure this server.",
            status="**Delivery:** Suppress embeds",
            controls=((select,), (button,)),
        )

        self.assertEqual(len(view.children), 1)
        container = view.children[0]
        self.assertIsInstance(container, discord.ui.Container)
        self.assertEqual(int(container.accent_color), 0x5865F2)

        text = [item.content for item in container.children if isinstance(item, discord.ui.TextDisplay)]
        self.assertIn("## FixEmbed Settings\nConfigure this server.", text)
        self.assertIn("**Delivery:** Suppress embeds", text)
        self.assertTrue(any("FixEmbed" in item for item in text))

        rows = [item for item in container.children if isinstance(item, discord.ui.ActionRow)]
        self.assertEqual(len(rows), 2)
        self.assertIs(rows[0].children[0], select)
        self.assertIs(rows[1].children[0], button)

    def test_rerender_replaces_previous_layout(self):
        view = discord.ui.LayoutView(timeout=180)
        render_settings_layout(view, title="First", description="Before")
        render_settings_layout(view, title="Second", description="After")

        self.assertEqual(len(view.children), 1)
        container = view.children[0]
        text = [item.content for item in container.children if isinstance(item, discord.ui.TextDisplay)]
        self.assertIn("## Second\nAfter", text)
        self.assertFalse(any("First" in item for item in text))


if __name__ == "__main__":
    unittest.main()
