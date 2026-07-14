import unittest

from card_preferences import CardPreferences
from twitter_embed import build_twitter_layout


class TwitterEmbedTests(unittest.TestCase):
    def test_premium_card_preferences_change_accent_caption_and_stats(self):
        payload = {
            "description": "A long post #announcement",
            "authorName": "Creator",
            "stats": "💬 12 ❤️ 34",
        }
        preferences = CardPreferences(
            accent_color=0x123456,
            show_stats=False,
            show_hashtags=False,
        )

        container = build_twitter_layout(
            payload, card_preferences=preferences
        ).to_components()[0]
        text = "\n".join(
            component.get("content", "")
            for component in container["components"]
            if component.get("type") == 10
        )

        self.assertEqual(container["accent_color"], 0x123456)
        self.assertNotIn("#announcement", text)
        self.assertNotIn("12", text)
        self.assertNotIn("34", text)

    def test_components_v2_uses_real_gif_media_without_video_controls(self):
        payload = {
            "authorName": "GIF Author",
            "video": {
                "url": "https://gif.fxtwitter.com/tweet_video/reaction.gif",
                "mediaType": "gif",
            },
        }

        components = build_twitter_layout(payload).to_components()
        gallery = components[0]["components"][1]

        self.assertEqual(
            gallery["items"][0]["media"]["url"],
            "https://gif.fxtwitter.com/tweet_video/reaction.gif",
        )

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
        self.assertIn(f"[FixEmbed]({converted_url})", footer["content"])
        self.assertIn(f"[X]({payload['url']})", footer["content"])
        self.assertNotIn("View original", footer["content"])
        self.assertNotIn("FixEmbed link", footer["content"])
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
        self.assertIn("Quote from **NASA**", text)
        self.assertIn("Ready for launch.", text)
        self.assertIn("[Community Note]", text)
        self.assertIn("Additional context.", text)

    def test_components_v2_layout_keeps_video_and_photos_in_mixed_media_order(self):
        payload = {
            "description": "A post with mixed media.",
            "authorName": "Creator",
            "authorHandle": "@creator",
            "video": {
                "url": "https://video.twimg.com/post.mp4",
                "thumbnail": "https://pbs.twimg.com/post-thumbnail.jpg",
                "mediaType": "video",
            },
            "images": [
                "https://pbs.twimg.com/one.jpg",
                "https://pbs.twimg.com/two.jpg",
            ],
        }

        container = build_twitter_layout(payload).to_components()[0]
        gallery = container["components"][1]

        self.assertEqual(
            [item["media"]["url"] for item in gallery["items"]],
            [
                payload["video"]["url"],
                *payload["images"],
            ],
        )

    def test_components_v2_layout_renders_quoted_identity_avatar_text_and_media(self):
        payload = {
            "description": "Main post context.",
            "authorName": "Primary Author",
            "authorHandle": "@primary",
            "mediaOrigin": "quote",
            "images": ["https://pbs.twimg.com/quoted-one.jpg"],
            "video": {
                "url": "https://video.twimg.com/quoted-gif.mp4",
                "thumbnail": "https://pbs.twimg.com/quoted-gif.jpg",
                "mediaType": "gif",
            },
            "sections": [
                {
                    "kind": "quote",
                    "title": "Quoted post",
                    "body": "The quoted post body.\n\nSecond quoted paragraph.",
                    "url": "https://x.com/quoted/status/456",
                    "authorName": "Quoted Author",
                    "authorHandle": "@quoted",
                    "authorUrl": "https://x.com/quoted",
                    "authorAvatar": "https://pbs.twimg.com/profile_images/456/avatar_normal.jpg",
                    "images": ["https://pbs.twimg.com/quoted-one.jpg"],
                    "video": {
                        "url": "https://video.twimg.com/quoted-gif.mp4",
                        "thumbnail": "https://pbs.twimg.com/quoted-gif.jpg",
                        "mediaType": "gif",
                    },
                },
            ],
        }

        container = build_twitter_layout(payload).to_components()[0]
        quote_header = container["components"][2]
        quote_gallery = container["components"][3]
        quote_text = quote_header["components"][0]["content"]

        self.assertIn(
            "> <:quote:1526256046786609164> [Quote from](https://x.com/quoted/status/456) "
            "**Quoted Author** ([@quoted](https://x.com/quoted))",
            quote_text,
        )
        self.assertIn("> The quoted post body.", quote_text)
        self.assertNotIn("\n>\n", quote_text)
        self.assertIn(
            "**Quoted Author** ([@quoted](https://x.com/quoted))\n> \u200b\n"
            "> The quoted post body.\n> \u200b\n> Second quoted paragraph.",
            quote_text,
        )
        self.assertNotIn("[Quoted post]", quote_text)
        self.assertEqual(
            quote_header["accessory"]["media"]["url"],
            "https://pbs.twimg.com/profile_images/456/avatar.jpg",
        )
        self.assertEqual(
            [item["media"]["url"] for item in quote_gallery["items"]],
            [
                "https://video.twimg.com/quoted-gif.mp4",
                "https://pbs.twimg.com/quoted-one.jpg",
            ],
        )
        self.assertEqual(
            quote_gallery["items"][0]["description"],
            "Animated GIF from Quoted Author",
        )

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
