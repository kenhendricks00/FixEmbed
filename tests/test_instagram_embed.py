import asyncio
import unittest

from instagram_embed import (
    _upgrade_instagram_avatar,
    build_instagram_card,
    build_instagram_embed,
    build_instagram_layout,
)


class _ProfileResponse:
    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        return False

    def raise_for_status(self):
        return None

    async def json(self, content_type=None):
        return {
            "data": {
                "user": {
                    "profile_pic_url_hd": (
                        "https://scontent.example.cdninstagram.com/avatar.jpg"
                        "?stp=dst-jpg_s320x320_tt6"
                    )
                }
            }
        }


class _ProfileSession:
    def __init__(self):
        self.requested_url = None

    def get(self, url, **kwargs):
        self.requested_url = url
        return _ProfileResponse()


class InstagramEmbedTests(unittest.TestCase):
    def test_low_resolution_avatar_is_upgraded_from_instagram_profile_metadata(self):
        payload = {
            "authorHandle": "@brooke_annm",
            "authorAvatar": (
                "https://scontent.example.cdninstagram.com/avatar.jpg"
                "?stp=dst-jpg_s100x100_tt6"
            ),
        }
        session = _ProfileSession()

        enriched = asyncio.run(_upgrade_instagram_avatar(payload, session))

        self.assertIn("username=brooke_annm", session.requested_url)
        self.assertIn("s320x320", enriched["authorAvatar"])
        self.assertIn("s100x100", payload["authorAvatar"])

    def test_author_uses_name_and_handle_without_fixembed_domain(self):
        payload = {
            "title": "A caption",
            "url": "https://www.instagram.com/reel/example/",
            "authorName": "brooke_annm",
            "authorHandle": "@brooke_annm",
            "authorUrl": "https://www.instagram.com/brooke_annm/",
            "authorAvatar": "https://cdn.example/avatar.jpg",
            "stats": "💬 133",
            "image": "https://cdn.example/post.jpg",
        }

        embed = build_instagram_embed(payload, "https://cdn.example/fixembed.png")

        self.assertEqual(embed.author.name, "brooke_annm (@brooke_annm)")
        self.assertNotIn("fixembed.app", embed.author.name)
        self.assertEqual(embed.author.icon_url, payload["authorAvatar"])
        self.assertEqual(embed.author.url, payload["authorUrl"])

    def test_caption_stats_media_and_fixembed_footer_are_preserved(self):
        payload = {
            "title": "A caption",
            "description": "",
            "url": "https://www.instagram.com/reel/example/",
            "authorName": "Creator",
            "authorHandle": "creator",
            "stats": "💬 2  ❤️ 10",
            "video": {
                "url": "https://fixembed.app/video/instagram?url=video",
                "thumbnail": "https://cdn.example/poster.jpg",
            },
        }

        embed = build_instagram_embed(payload, "https://cdn.example/fixembed.png")

        self.assertEqual(embed.description, "A caption\n\n💬 2  ❤️ 10")
        self.assertEqual(embed.image.url, payload["video"]["thumbnail"])
        self.assertEqual(embed.footer.text, "FixEmbed • 📷 Instagram")
        self.assertEqual(embed.footer.icon_url, "https://cdn.example/fixembed.png")
        self.assertEqual(embed.url, payload["url"])

    def test_duplicate_handle_is_not_repeated_in_caption(self):
        payload = {
            "title": "brooke_annm\n\nActual caption",
            "authorName": "brooke_annm",
            "authorHandle": "@brooke_annm",
        }

        embed = build_instagram_embed(payload)

        self.assertEqual(embed.description, "Actual caption")

    def test_footer_includes_a_discord_timestamp(self):
        embed = build_instagram_embed({"authorName": "brooke_annm"})

        self.assertIsNotNone(embed.timestamp)
        self.assertEqual(embed.timestamp.utcoffset().total_seconds(), 0)

    def test_video_card_preserves_the_playable_video_url(self):
        payload = {
            "authorName": "brooke_annm",
            "video": {
                "url": "https://fixembed.app/video/instagram?url=video",
                "thumbnail": "https://cdn.example/poster.jpg",
            },
        }

        card = build_instagram_card(payload)

        self.assertEqual(card.video_url, payload["video"]["url"])
        self.assertEqual(card.embed.image.url, payload["video"]["thumbnail"])

    def test_components_v2_layout_uses_plain_username_and_remote_video(self):
        payload = {
            "title": "A reel caption that was truncated",
            "caption": "The complete reel caption with @cota_official and #f1",
            "url": "https://www.instagram.com/reel/example/",
            "authorName": "Brooke",
            "authorHandle": "@brooke_annm",
            "authorUrl": "https://www.instagram.com/brooke_annm/",
            "authorAvatar": "https://cdn.example/avatar.jpg",
            "stats": "💬 133",
            "video": {
                "url": "https://fixembed.app/video/instagram?url=video",
                "thumbnail": "https://cdn.example/poster.jpg",
            },
        }

        converted_url = "https://fixembed.app/embed?url=https%3A%2F%2Fwww.instagram.com%2Freel%2Fexample%2F&v=154"
        components = build_instagram_layout(payload, converted_url).to_components()
        container = components[0]
        header = container["components"][0]
        gallery = container["components"][1]
        stats = container["components"][2]
        footer = container["components"][-1]

        self.assertEqual(container["type"], 17)
        self.assertEqual(container["accent_color"], 0x5865F2)
        self.assertIn("[brooke_annm]", header["components"][0]["content"])
        self.assertNotIn("@brooke_annm", header["components"][0]["content"])
        self.assertEqual(header["accessory"]["media"]["url"], payload["authorAvatar"])
        self.assertIn(payload["caption"], header["components"][0]["content"])
        self.assertNotIn(payload["title"], header["components"][0]["content"])
        self.assertIn("<:comment:1526254715250282506> 133", stats["content"])
        self.assertNotIn("\U0001f4ac", stats["content"])
        self.assertEqual(gallery["items"][0]["media"]["url"], payload["video"]["url"])
        self.assertIn("FixEmbed", footer["content"])
        self.assertIn("Instagram", footer["content"])
        self.assertIn("<:instagram:1526267158793949435>", footer["content"])
        self.assertTrue(stats["content"].startswith("-# "))
        self.assertTrue(footer["content"].startswith("-# "))
        self.assertIn("[View original]", footer["content"])
        self.assertIn(f"[FixEmbed link]({converted_url})", footer["content"])


if __name__ == "__main__":
    unittest.main()
