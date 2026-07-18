import unittest
from pathlib import Path


class UserCommandComponentsTests(unittest.TestCase):
    def test_user_install_commands_use_components_v2_with_link_fallback(self):
        main_source = Path(__file__).resolve().parents[1].joinpath("main.py").read_text(encoding="utf-8")
        user_commands = main_source.split(
            "@client.tree.command(\n    name='fix'", 1
        )[1].split("async def debug_info", 1)[0]

        self.assertGreaterEqual(user_commands.count("send_components_v2_links(interaction, links)"), 2)
        self.assertNotIn("fixed_links =", user_commands)

        delivery_helper = main_source.split("async def send_components_v2_links(", 1)[1].split(
            "@client.tree.command(\n    name='fix'", 1
        )[0]
        self.assertIn("await interaction.response.defer()", delivery_helper)
        self.assertIn('send_options = {"view": delivery.view}', delivery_helper)
        self.assertIn('send_options["files"] = list(delivery.files)', delivery_helper)
        self.assertNotIn("files=None", delivery_helper)
        self.assertIn("await interaction.followup.send(**send_options)", delivery_helper)
        self.assertIn("await interaction.followup.send(fallback_url)", delivery_helper)
        self.assertIn("await interaction.followup.send(delivery.fallback_url)", delivery_helper)


if __name__ == "__main__":
    unittest.main()
