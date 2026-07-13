import unittest

from bilibili_embed import build_bilibili_layout


class BilibiliEmbedTests(unittest.TestCase):
    def test_components_v2_layout_preserves_creator_media_stats_and_links(self):
        payload = {
            "title": "A modern Bilibili video",
            "description": "The complete video description.",
            "url": "https://www.bilibili.com/video/BV1xx411c7mD",
            "authorName": "Creator",
            "authorUrl": "https://space.bilibili.com/42",
            "authorAvatar": "https://i0.hdslb.com/avatar.jpg",
            "image": "https://i0.hdslb.com/video.jpg",
            "stats": "💬 321 ❤️ 5K 👁️ 98.8K 🔖 1K 🔁 42",
            "timestamp": "2026-07-14T00:00:00.000Z",
        }
        converted_url = "https://fixembed.app/embed?url=bilibili-video"

        container = build_bilibili_layout(payload, converted_url).to_components()[0]
        header = container["components"][0]
        gallery = container["components"][1]
        stats = container["components"][2]
        footer = container["components"][-1]

        self.assertEqual(container["type"], 17)
        self.assertEqual(container["accent_color"], 0x00A1D6)
        self.assertIn("**[Creator](https://space.bilibili.com/42)**", header["components"][0]["content"])
        self.assertIn("[A modern Bilibili video]", header["components"][0]["content"])
        self.assertIn(payload["description"], header["components"][0]["content"])
        self.assertEqual(header["accessory"]["media"]["url"], payload["authorAvatar"])
        self.assertEqual(gallery["items"][0]["media"]["url"], payload["image"])
        self.assertIn("<:comment:1526254715250282506> 321", stats["content"])
        self.assertIn("<:like:1526255244483362866> 5K", stats["content"])
        self.assertIn("<:views:1526255708683636896> 98.8K", stats["content"])
        self.assertIn("<:bookmark:1526255813268733962> 1K", stats["content"])
        self.assertIn("<:repost:1526255036072591450> 42", stats["content"])
        self.assertIn("<:bilibili:1526271150739423304> Bilibili", footer["content"])
        self.assertIn("[View original]", footer["content"])
        self.assertIn("[FixEmbed link]", footer["content"])
        self.assertIn("<t:1783987200:R>", footer["content"])

    def test_components_v2_layout_keeps_remote_video_playable(self):
        payload = {
            "title": "Playable video",
            "url": "https://www.bilibili.com/video/BV1xx411c7mD",
            "video": {"url": "https://fixembed.app/proxy/bilibili?url=video"},
            "image": "https://i0.hdslb.com/video.jpg",
        }

        container = build_bilibili_layout(payload).to_components()[0]
        gallery = container["components"][1]

        self.assertEqual(
            gallery["items"][0]["media"]["url"],
            payload["video"]["url"],
        )


if __name__ == "__main__":
    unittest.main()
