import unittest

from bluesky_embed import build_bluesky_layout


class BlueskyEmbedTests(unittest.TestCase):
    def test_components_v2_layout_preserves_identity_carousel_stats_and_links(self):
        payload = {
            "description": "A Bluesky post with a full photo carousel.",
            "url": "https://bsky.app/profile/creator.bsky.social/post/abc123",
            "authorName": "Creator Name",
            "authorHandle": "@creator.bsky.social",
            "authorUrl": "https://bsky.app/profile/creator.bsky.social",
            "authorAvatar": "https://cdn.bsky.app/avatar.jpg",
            "stats": "💬 12  🔁 5  ❤️ 34",
            "timestamp": "2026-07-13T19:00:00.000Z",
            "images": [
                "https://cdn.bsky.app/one.jpg",
                "https://cdn.bsky.app/two.jpg",
                "https://cdn.bsky.app/three.jpg",
            ],
        }
        converted_url = "https://fixembed.app/embed?url=bluesky-post"

        container = build_bluesky_layout(payload, converted_url).to_components()[0]
        header = container["components"][0]
        gallery = container["components"][1]
        stats = container["components"][2]
        footer = container["components"][-1]

        self.assertEqual(container["type"], 17)
        self.assertEqual(container["accent_color"], 0x1185FE)
        self.assertIn("Creator Name", header["components"][0]["content"])
        self.assertIn("[@creator.bsky.social]", header["components"][0]["content"])
        self.assertIn(payload["description"], header["components"][0]["content"])
        self.assertEqual(header["accessory"]["media"]["url"], payload["authorAvatar"])
        self.assertEqual(
            [item["media"]["url"] for item in gallery["items"]],
            payload["images"],
        )
        self.assertIn("<:comment:1526254715250282506> 12", stats["content"])
        self.assertIn("<:repost:1526255036072591450> 5", stats["content"])
        self.assertIn("<:like:1526255244483362866> 34", stats["content"])
        self.assertIn("<:bluesky:1526269663334502544>", footer["content"])
        self.assertIn("[View original]", footer["content"])
        self.assertIn(f"[FixEmbed link]({converted_url})", footer["content"])
        self.assertIn("<t:1783969200:R>", footer["content"])


if __name__ == "__main__":
    unittest.main()
