import unittest

from youtube_embed import build_youtube_community_layout


class YouTubeCommunityEmbedTests(unittest.TestCase):
    def test_components_v2_layout_preserves_creator_media_stats_and_links(self):
        payload = {
            "title": "Community post",
            "description": "A detailed community update with an image.",
            "url": "https://www.youtube.com/post/UgkxExample123",
            "authorName": "Creator Name",
            "authorUrl": "https://www.youtube.com/@creator",
            "authorAvatar": "https://yt3.example/avatar.jpg",
            "image": "https://yt3.example/full.jpg",
            "stats": "👍 1.2K  💬 34",
            "timestamp": "2026-07-14T00:00:00.000Z",
        }
        converted_url = "https://fixembed.app/embed?url=youtube-community-post"

        container = build_youtube_community_layout(payload, converted_url).to_components()[0]
        header = container["components"][0]
        gallery = container["components"][1]
        stats = container["components"][2]
        footer = container["components"][-1]

        self.assertEqual(container["type"], 17)
        self.assertEqual(container["accent_color"], 0xFF0033)
        self.assertIn("**[Creator Name](https://www.youtube.com/@creator)**", header["components"][0]["content"])
        self.assertIn(payload["description"], header["components"][0]["content"])
        self.assertNotIn("Community post", header["components"][0]["content"])
        self.assertEqual(header["accessory"]["media"]["url"], payload["authorAvatar"])
        self.assertEqual(gallery["items"][0]["media"]["url"], payload["image"])
        self.assertIn("<:like:1526255244483362866> 1.2K", stats["content"])
        self.assertIn("<:comment:1526254715250282506> 34", stats["content"])
        self.assertIn("<:youtube:1526267390592290926>", footer["content"])
        self.assertIn(f"[FixEmbed]({converted_url})", footer["content"])
        self.assertIn(f"[YouTube]({payload['url']})", footer["content"])
        self.assertNotIn("View original", footer["content"])
        self.assertNotIn("FixEmbed link", footer["content"])
        self.assertIn("<t:1783987200:R>", footer["content"])

    def test_components_v2_layout_supports_text_only_posts(self):
        payload = {
            "title": "Community post",
            "description": "A text-only community update.",
            "url": "https://www.youtube.com/post/UgkxTextOnly",
        }

        container = build_youtube_community_layout(payload).to_components()[0]

        self.assertEqual(container["components"][0]["type"], 10)
        self.assertNotIn(12, [component["type"] for component in container["components"]])

    def test_components_v2_layout_keeps_image_only_posts_valid(self):
        payload = {
            "title": "Community post",
            "url": "https://www.youtube.com/post/UgkxImageOnly",
            "image": "https://yt3.example/full.jpg",
        }

        container = build_youtube_community_layout(payload).to_components()[0]

        self.assertEqual(
            container["components"][0]["content"],
            "**YouTube community post**",
        )
        self.assertEqual(
            container["components"][1]["items"][0]["media"]["url"],
            payload["image"],
        )


if __name__ == "__main__":
    unittest.main()
