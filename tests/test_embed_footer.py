import unittest

from embed_footer import build_component_footer


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


if __name__ == "__main__":
    unittest.main()
