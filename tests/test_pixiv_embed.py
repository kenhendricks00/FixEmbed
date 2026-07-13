import unittest

from pixiv_embed import _profile_image, build_pixiv_layout


class PixivEmbedTests(unittest.TestCase):
    def test_profile_image_uses_another_creator_work_when_current_artwork_omits_it(self):
        payload = {
            "body": {
                "userIllusts": {
                    "123": {"title": "Current work"},
                    "122": {"profileImageUrl": "https://i.pximg.net/avatar.jpg"},
                }
            }
        }

        self.assertEqual(
            _profile_image(payload, "123"),
            "https://i.pximg.net/avatar.jpg",
        )

    def test_components_v2_layout_preserves_artwork_identity_gallery_stats_and_links(self):
        payload = {
            "title": "A finished illustration",
            "description": "Artwork caption with the complete creator description.",
            "url": "https://www.pixiv.net/artworks/123456",
            "authorName": "Artist Name",
            "authorHandle": "@artist_account",
            "authorUrl": "https://www.pixiv.net/users/42",
            "authorAvatar": "https://fixembed.app/proxy/pixiv?url=avatar",
            "stats": "💬 12  ❤️ 1.4K  👁️ 28K  🔖 300",
            "timestamp": "2026-07-13T19:00:00.000Z",
            "images": [
                "https://fixembed.app/proxy/pixiv?url=one",
                "https://fixembed.app/proxy/pixiv?url=two",
                "https://fixembed.app/proxy/pixiv?url=three",
            ],
        }
        converted_url = "https://fixembed.app/embed?url=pixiv-artwork"

        container = build_pixiv_layout(payload, converted_url).to_components()[0]
        header = container["components"][0]
        gallery = container["components"][1]
        stats = container["components"][2]
        footer = container["components"][-1]

        self.assertEqual(container["type"], 17)
        self.assertEqual(container["accent_color"], 0x0096FA)
        self.assertIn("A finished illustration", header["components"][0]["content"])
        self.assertIn("[Artist Name (@artist_account)]", header["components"][0]["content"])
        self.assertIn(payload["description"], header["components"][0]["content"])
        self.assertEqual(header["accessory"]["media"]["url"], payload["authorAvatar"])
        self.assertEqual(
            [item["media"]["url"] for item in gallery["items"]],
            payload["images"],
        )
        self.assertIn("<:comment:1526254715250282506> 12", stats["content"])
        self.assertIn("<:like:1526255244483362866> 1.4K", stats["content"])
        self.assertIn("<:views:1526255708683636896> 28K", stats["content"])
        self.assertIn("<:bookmark:1526255813268733962> 300", stats["content"])
        self.assertIn("<:pixiv:1526268469920792577>", footer["content"])
        self.assertIn("[View original]", footer["content"])
        self.assertIn(f"[FixEmbed link]({converted_url})", footer["content"])
        self.assertIn("<t:1783969200:R>", footer["content"])

    def test_components_v2_layout_decodes_and_compacts_long_pixiv_captions(self):
        payload = {
            "title": "Artwork",
            "description": ("Prompt value&amp;#44; with details. " * 100).strip(),
        }

        container = build_pixiv_layout(payload).to_components()[0]
        header_text = container["components"][0]["content"]

        self.assertIn("Prompt value, with details.", header_text)
        self.assertNotIn("&amp;#44;", header_text)
        self.assertLessEqual(len(header_text), 1300)
        self.assertTrue(header_text.endswith("…"))


if __name__ == "__main__":
    unittest.main()
