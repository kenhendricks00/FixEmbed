import unittest

from tiktok_embed import build_tiktok_layout
from tumblr_embed import build_tumblr_layout
from twitch_embed import build_twitch_layout


def serialized_container(layout):
    components = layout.to_components()
    if len(components) != 1:
        raise AssertionError("expected one Components V2 container")
    return components[0]


class NewPlatformEmbedTests(unittest.TestCase):
    def test_tiktok_card_keeps_creator_caption_thumbnail_and_spoiler(self):
        payload = {
            "title": "A TikTok caption",
            "description": "A TikTok caption",
            "url": "https://www.tiktok.com/@creator/video/7421234567890123456",
            "authorName": "Creator Name",
            "authorHandle": "@creator",
            "authorUrl": "https://www.tiktok.com/@creator",
            "authorAvatar": "https://p16-sign.tiktokcdn-us.com/avatar.jpeg",
            "image": "https://p16-sign.tiktokcdn-us.com/cover.jpeg",
            "video": {
                "url": "https://v16-webapp-prime.us.tiktok.com/video.mp4",
                "width": 576,
                "height": 1024,
            },
            "stats": "❤️ 25.5M 💬 251.4K 🔁 3.3M",
            "timestamp": "2024-07-16T12:30:00Z",
            "sensitive": True,
        }

        container = serialized_container(build_tiktok_layout(payload))
        rendered = str(container)
        header = str(container["components"][0])
        gallery = container["components"][1]

        self.assertIn("Creator Name", rendered)
        self.assertIn("@creator", rendered)
        self.assertIn("A TikTok caption", rendered)
        self.assertNotIn("###", header)
        self.assertIn("1527868616215629954", rendered)
        self.assertIn("<:share:1527880479305498744> 3.3M", rendered)
        self.assertIn("<t:", rendered)
        self.assertEqual(
            gallery["items"][0]["media"]["url"],
            "https://v16-webapp-prime.us.tiktok.com/video.mp4",
        )
        self.assertTrue(gallery["items"][0]["spoiler"])

    def test_tumblr_card_keeps_blog_context_gallery_notes_and_timestamp(self):
        payload = {
            "title": "TitleKnown",
            "description": "A complete Tumblr post summary.",
            "url": "https://titleknown.tumblr.com/post/801061841418780672",
            "authorName": "TitleKnown",
            "authorHandle": "@titleknown",
            "authorUrl": "https://titleknown.tumblr.com/",
            "authorAvatar": "https://64.media.tumblr.com/avatar.pnj",
            "images": [
                "https://64.media.tumblr.com/first.jpg",
                "https://64.media.tumblr.com/second.jpg",
            ],
            "stats": "\U0001f4dd 887 notes",
            "context": "#writing #classics #jokes",
            "timestamp": "2026-05-29T18:34:20Z",
        }

        container = serialized_container(build_tumblr_layout(payload))
        rendered = str(container)
        header = container["components"][0]["components"][0]["content"]
        gallery = container["components"][1]

        self.assertIn(
            "**[TitleKnown](https://titleknown.tumblr.com/)**",
            header,
        )
        self.assertNotIn("@titleknown", header)
        self.assertIn("A complete Tumblr post summary.", header)
        self.assertNotIn("###", header)
        self.assertIn("<:note:1527889882746323094> 887 notes", rendered)
        self.assertIn("#writing #classics #jokes", container["components"][2]["content"])
        self.assertIn("1527868615393546400", rendered)
        self.assertIn("<t:", rendered)
        self.assertEqual(
            [item["media"]["url"] for item in gallery["items"]],
            payload["images"],
        )
    def test_twitch_clip_card_keeps_game_clip_credit_stats_and_playable_media(self):
        payload = {
            "title": "We go crazy with the flick for the win :)",
            "description": "Apex Legends · Clipped by TSoonami · 30s",
            "url": "https://clips.twitch.tv/GoodGoodWaffleTwitchRaid",
            "authorName": "TSoonami",
            "authorHandle": "@tsoonami",
            "authorUrl": "https://www.twitch.tv/tsoonami",
            "authorAvatar": "https://static-cdn.jtvnw.net/profile.png",
            "video": {
                "url": "https://d1ndex63qxojbr.cloudfront.net/clip/index.mp4",
                "width": 1280,
                "height": 720,
                "thumbnail": "https://static-cdn.jtvnw.net/clip.jpg",
            },
            "stats": "224 views",
            "timestamp": "2019-10-01T20:15:47Z",
        }

        container = serialized_container(build_twitch_layout(payload))
        rendered = str(container)
        header = container["components"][0]["components"][0]["content"]
        gallery = container["components"][1]
        footer = container["components"][-1]["content"]

        self.assertIn(
            "**[TSoonami](https://www.twitch.tv/tsoonami)**",
            header,
        )
        self.assertNotIn("@tsoonami", header)
        self.assertIn("Apex Legends", rendered)
        self.assertIn("Clipped by TSoonami", rendered)
        self.assertIn("224", rendered)
        self.assertIn("<:twitch:1527868614269468852>", footer)
        self.assertNotIn("\U0001f7e3", footer)
        self.assertEqual(
            gallery["items"][0]["media"]["url"],
            payload["video"]["url"],
        )
