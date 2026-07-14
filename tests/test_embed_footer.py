import unittest

from embed_footer import FooterBranding, build_component_footer


class EmbedFooterTests(unittest.TestCase):
    def test_footer_links_brand_and_platform_without_redundant_labels(self):
        footer = build_component_footer(
            fixembed_emoji="<:fixembed:1>",
            platform_emoji="<:instagram:2>",
            platform_name="Instagram",
            source_url="https://www.instagram.com/p/example/",
            converted_url="https://fixembed.app/embed?url=example",
            timestamp=1783987200,
        )

        self.assertEqual(
            footer,
            "-# <:fixembed:1> [FixEmbed](https://fixembed.app/embed?url=example)"
            "  ·  <:instagram:2> [Instagram](https://www.instagram.com/p/example/)"
            "  ·  <t:1783987200:R>",
        )
        self.assertNotIn("View original", footer)
        self.assertNotIn("FixEmbed link", footer)

    def test_premium_footer_uses_server_identity_with_fixembed_attribution(self):
        footer = build_component_footer(
            fixembed_emoji="<:fixembed:1>",
            platform_emoji="<:twitter:2>",
            platform_name="X",
            source_url="https://x.com/example/status/1",
            converted_url="https://fixembed.app/embed?url=example",
            timestamp=1783987200,
            branding=FooterBranding(name="Test Server", emoji="<:server:3>"),
        )

        self.assertEqual(
            footer,
            "-# <:server:3> Test Server"
            "  \N{MIDDLE DOT}  <:twitter:2> [X](https://x.com/example/status/1)"
            "  \N{MIDDLE DOT}  <t:1783987200:R>"
            "  \N{MIDDLE DOT}  via <:fixembed:1> [FixEmbed](https://fixembed.app/embed?url=example)",
        )

    def test_premium_footer_escapes_untrusted_server_name(self):
        footer = build_component_footer(
            fixembed_emoji="<:fixembed:1>",
            platform_emoji="<:reddit:2>",
            platform_name="Reddit",
            source_url="https://reddit.com/r/test/comments/1",
            converted_url=None,
            timestamp=None,
            branding=FooterBranding(
                name="@everyone <@123> <@&456> [Click](https://bad.example)"
            ),
        )

        self.assertIn("@\u200beveryone", footer)
        self.assertIn("<@\u200b123>", footer)
        self.assertIn("<@\u200b&456>", footer)
        self.assertIn(r"\[Click]", footer)
        self.assertTrue(footer.endswith("via <:fixembed:1> FixEmbed"))


if __name__ == "__main__":
    unittest.main()
