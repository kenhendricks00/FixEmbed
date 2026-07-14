import unittest

from pinterest_embed import build_pinterest_layout


class PinterestEmbedTests(unittest.TestCase):
    def test_components_v2_layout_preserves_pin_metadata_media_and_links(self):
        payload = {
            "title": "Summer trip ideas",
            "description": "Mallorca with friends",
            "url": "https://www.pinterest.com/pin/424605071145119869/",
            "image": "https://i.pinimg.com/736x/example.jpg",
            "timestamp": "2026-05-27T21:03:02.000Z",
            "authorName": "christinabrautaset",
            "authorHandle": "@christinaebrautaset",
            "authorUrl": "https://www.pinterest.com/christinaebrautaset/",
            "authorAvatar": "https://i.pinimg.com/originals/ba/ab/af/avatar.jpg",
        }
        converted_url = "https://fixembed.app/embed?url=pinterest-pin"

        container = build_pinterest_layout(payload, converted_url).to_components()[0]
        header = container["components"][0]
        gallery = container["components"][1]
        footer = container["components"][-1]["content"]

        self.assertEqual(container["type"], 17)
        self.assertEqual(container["accent_color"], 0xE60023)
        header_text = header["components"][0]["content"]
        self.assertTrue(header_text.startswith("**christinabrautaset**"))
        self.assertIn("[@christinaebrautaset]", header_text)
        self.assertIn("**[Summer trip ideas]", header_text)
        self.assertIn("Mallorca with friends", header_text)
        self.assertEqual(
            header["accessory"]["media"]["url"],
            payload["authorAvatar"],
        )
        self.assertEqual(gallery["items"][0]["media"]["url"], payload["image"])
        self.assertIn(f"[FixEmbed]({converted_url})", footer)
        self.assertIn(f"[Pinterest]({payload['url']})", footer)
        self.assertIn("<:pinterest:1526398381415731240>", footer)
        self.assertIn("<t:1779915782:R>", footer)

    def test_components_v2_layout_supports_playable_pin_video(self):
        payload = {
            "title": "Video Pin",
            "description": "A short clip",
            "url": "https://www.pinterest.com/pin/123/",
            "image": "https://i.pinimg.com/736x/poster.jpg",
            "video": {
                "url": "https://v.pinimg.com/videos/example.mp4",
                "thumbnail": "https://i.pinimg.com/736x/poster.jpg",
            },
        }

        container = build_pinterest_layout(payload).to_components()[0]

        self.assertEqual(
            container["components"][1]["items"][0]["media"]["url"],
            payload["video"]["url"],
        )


if __name__ == "__main__":
    unittest.main()
