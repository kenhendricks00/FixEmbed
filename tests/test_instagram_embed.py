import unittest

from instagram_embed import build_instagram_embed


class InstagramEmbedTests(unittest.TestCase):
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

        self.assertEqual(embed.description, "💬 2  ❤️ 10\n\nA caption")
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


if __name__ == "__main__":
    unittest.main()
