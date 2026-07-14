import unittest

from threads_embed import build_threads_layout


class ThreadsEmbedTests(unittest.TestCase):
    def test_components_v2_layout_preserves_creator_text_video_stats_and_links(self):
        payload = {
            "caption": "A full Threads post that should not be reduced to its title.",
            "url": "https://www.threads.net/@creator/post/ABC123",
            "authorName": "@creator",
            "authorHandle": "@creator",
            "authorUrl": "https://www.threads.net/@creator",
            "authorAvatar": "https://cdn.example/avatar.jpg",
            "stats": "💬 34  ❤️ 1.2K",
            "video": {
                "url": "https://fixembed.app/video/threads?url=video",
                "thumbnail": "https://cdn.example/post.jpg",
            },
        }
        converted_url = "https://fixembed.app/embed?url=threads-post"

        container = build_threads_layout(payload, converted_url).to_components()[0]
        header = container["components"][0]
        gallery = container["components"][1]
        stats = container["components"][2]
        footer = container["components"][-1]

        self.assertEqual(container["type"], 17)
        self.assertEqual(container["accent_color"], 0x5865F2)
        self.assertIn("[@creator]", header["components"][0]["content"])
        self.assertIn(payload["caption"], header["components"][0]["content"])
        self.assertEqual(header["accessory"]["media"]["url"], payload["authorAvatar"])
        self.assertEqual(gallery["items"][0]["media"]["url"], payload["video"]["url"])
        self.assertIn("<:comment:1526254715250282506> 34", stats["content"])
        self.assertIn("<:like:1526255244483362866> 1.2K", stats["content"])
        self.assertIn("<:threads:1526267848924725399>", footer["content"])
        self.assertIn(f"[FixEmbed]({converted_url})", footer["content"])
        self.assertIn(f"[Threads]({payload['url']})", footer["content"])
        self.assertNotIn("View original", footer["content"])
        self.assertNotIn("FixEmbed link", footer["content"])

    def test_components_v2_layout_preserves_photo_carousels(self):
        payload = {
            "description": "Three photos from today.",
            "authorName": "@creator",
            "images": [
                "https://cdn.example/one.jpg",
                "https://cdn.example/two.jpg",
                "https://cdn.example/three.jpg",
            ],
        }

        container = build_threads_layout(payload).to_components()[0]
        gallery = container["components"][1]

        self.assertEqual(
            [item["media"]["url"] for item in gallery["items"]],
            payload["images"],
        )


if __name__ == "__main__":
    unittest.main()
