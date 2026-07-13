import unittest

from twitter_embed import build_twitter_layout


class TwitterEmbedTests(unittest.TestCase):
    def test_components_v2_layout_preserves_identity_text_video_stats_and_footer(self):
        payload = {
            "description": "Introducing a new robot hand.",
            "url": "https://x.com/BerntBornich/status/123",
            "authorName": "Bernt Bornich",
            "authorHandle": "@BerntBornich",
            "authorUrl": "https://x.com/BerntBornich",
            "authorAvatar": "https://pbs.twimg.com/profile_images/123/avatar_normal.jpg",
            "stats": "💬 1.2K  🔁 2.9K  ❤️ 23.8K  👁️ 8.39M",
            "timestamp": "2026-07-09T16:20:00.000Z",
            "video": {
                "url": "https://video.twimg.com/post.mp4",
                "thumbnail": "https://pbs.twimg.com/post.jpg",
            },
        }
        converted_url = "https://fixembed.app/embed?url=x-post"

        components = build_twitter_layout(payload, converted_url).to_components()
        container = components[0]
        header = container["components"][0]
        gallery = container["components"][1]
        stats = container["components"][2]
        footer = container["components"][-1]

        self.assertEqual(container["type"], 17)
        self.assertEqual(container["accent_color"], 0x5865F2)
        self.assertIn("Bernt Bornich", header["components"][0]["content"])
        self.assertIn("[@BerntBornich]", header["components"][0]["content"])
        self.assertIn(payload["description"], header["components"][0]["content"])
        self.assertEqual(
            header["accessory"]["media"]["url"],
            "https://pbs.twimg.com/profile_images/123/avatar.jpg",
        )
        self.assertEqual(gallery["items"][0]["media"]["url"], payload["video"]["url"])
        self.assertIn("<:comment:1526254715250282506> 1.2K", stats["content"])
        self.assertIn("<:repost:1526255036072591450> 2.9K", stats["content"])
        self.assertIn("<:like:1526255244483362866> 23.8K", stats["content"])
        self.assertIn("<:views:1526255708683636896> 8.39M", stats["content"])
        self.assertIn("<:twitter:1526268173589155921>", footer["content"])
        self.assertIn("[View original]", footer["content"])
        self.assertIn(f"[FixEmbed link]({converted_url})", footer["content"])
        self.assertIn("<t:1783614000:R>", footer["content"])

    def test_components_v2_layout_preserves_photo_carousel_and_structured_sections(self):
        payload = {
            "description": "Flight hardware moved to the pad.",
            "authorName": "SpaceX",
            "authorHandle": "@SpaceX",
            "images": [
                "https://pbs.twimg.com/one.jpg",
                "https://pbs.twimg.com/two.jpg",
                "https://pbs.twimg.com/three.jpg",
            ],
            "sections": [
                {"kind": "quote", "title": "Quoted @NASA", "body": "Ready for launch."},
                {"kind": "community-note", "title": "Community Note", "body": "Additional context.", "url": "https://x.com/i/birdwatch/n/1"},
            ],
        }

        components = build_twitter_layout(payload).to_components()
        container = components[0]
        gallery = container["components"][1]
        text = "\n".join(
            component.get("content", "")
            for component in container["components"]
            if component.get("type") == 10
        )

        self.assertEqual(
            [item["media"]["url"] for item in gallery["items"]],
            payload["images"],
        )
        self.assertIn("Quoted @NASA", text)
        self.assertIn("Ready for launch.", text)
        self.assertIn("[Community Note]", text)
        self.assertIn("Additional context.", text)

    def test_components_v2_footer_accepts_native_x_timestamp_format(self):
        payload = {
            "description": "A post with a native X timestamp.",
            "authorName": "Primary Author",
            "authorHandle": "@primary",
            "timestamp": "Sun Jul 12 00:00:00 +0000 2026",
        }

        container = build_twitter_layout(payload).to_components()[0]

        self.assertIn("<t:1783814400:R>", container["components"][-1]["content"])


if __name__ == "__main__":
    unittest.main()
