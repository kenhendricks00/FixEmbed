import unittest
from unittest.mock import AsyncMock, patch

import pixiv_embed
from pixiv_embed import _profile_image, build_pixiv_layout


class PixivEmbedTests(unittest.TestCase):
    def test_profile_avatar_prefers_the_larger_pixiv_user_image(self):
        payload = {
            "body": {
                "image": "https://i.pximg.net/user-profile/avatar_50.png",
                "imageBig": "https://i.pximg.net/user-profile/avatar_170.png",
            }
        }

        self.assertEqual(
            pixiv_embed._profile_avatar(payload),
            "https://i.pximg.net/user-profile/avatar_170.png",
        )

    def test_creator_identity_uses_numeric_pixiv_user_id_for_profile_url(self):
        fallback_data = {
            "authorName": "aion21",
            "authorUrl": "https://www.pixiv.net/users/aion21",
        }
        pixiv_payload = {
            "body": {
                "userId": "3565666",
                "userName": "aion21",
                "userAccount": "aion21",
            }
        }

        identity = pixiv_embed._merge_creator_identity(fallback_data, pixiv_payload)

        self.assertEqual(identity["authorName"], "aion21")
        self.assertEqual(identity["authorHandle"], "@aion21")
        self.assertEqual(
            identity["authorUrl"],
            "https://www.pixiv.net/en/users/3565666",
        )

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
            "authorName": "aion21",
            "authorHandle": "@master_nj_aion",
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
        self.assertIn(
            "**aion21** ([@master\\_nj\\_aion](https://www.pixiv.net/users/42))",
            header["components"][0]["content"],
        )
        self.assertNotIn("[aion21 (", header["components"][0]["content"])
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
        self.assertIn(f"[FixEmbed]({converted_url})", footer["content"])
        self.assertIn(f"[Pixiv]({payload['url']})", footer["content"])
        self.assertNotIn("View original", footer["content"])
        self.assertNotIn("FixEmbed link", footer["content"])
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

    def test_local_metadata_card_rejects_media_outside_pixiv_hosts(self):
        metadata = {
            "version": 1,
            "id": "123456",
            "title": "Artwork",
            "authorName": "Creator",
            "authorId": "42",
            "images": ["https://evil.example/image.jpg"],
        }

        with self.assertRaisesRegex(ValueError, "media"):
            pixiv_embed._local_metadata_card(metadata, "123456")


class PixivEmbedFetchTests(unittest.IsolatedAsyncioTestCase):
    async def test_local_first_party_metadata_builds_a_complete_card_without_worker_data(self):
        metadata = {
            "version": 1,
            "id": "101844438",
            "title": "Demon ladies",
            "description": "Complete artwork caption.",
            "authorName": "aion21",
            "authorHandle": "master_nj_aion",
            "authorId": "3565666",
            "authorAvatar": "https://i.pximg.net/user-profile/avatar_170.jpg",
            "timestamp": "2022-10-09T10:30:00+00:00",
            "stats": {
                "comments": 12,
                "likes": 345,
                "views": 6789,
                "bookmarks": 234,
            },
            "images": [
                "https://i.pximg.net/img-original/one.jpg",
                "https://i.pximg.net/img-original/two.jpg",
            ],
        }
        with patch.object(
            pixiv_embed._PIXIV_METADATA_SERVICE,
            "metadata",
            AsyncMock(return_value=metadata),
        ):
            payload = await pixiv_embed._fetch_pixiv_payload(
                "https://www.pixiv.net/artworks/101844438"
            )

        self.assertEqual(payload["title"], "Demon ladies")
        self.assertEqual(payload["authorName"], "aion21")
        self.assertEqual(payload["authorHandle"], "@master_nj_aion")
        self.assertEqual(
            payload["authorUrl"],
            "https://www.pixiv.net/en/users/3565666",
        )
        self.assertIn("avatar_170.jpg", payload["authorAvatar"])
        self.assertEqual(len(payload["images"]), 2)
        self.assertEqual(payload["timestamp"], "2022-10-09T10:30:00+00:00")
        self.assertEqual(payload["stats"], "💬 12 ❤️ 345 👁️ 6.8K 🔖 234")


if __name__ == "__main__":
    unittest.main()
