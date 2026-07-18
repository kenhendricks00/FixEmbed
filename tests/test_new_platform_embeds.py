import unittest
from unittest.mock import AsyncMock, patch

from deviantart_embed import (
    build_deviantart_layout,
    fetch_deviantart_layout,
    normalize_deviantart_oembed_payload,
)
from tiktok_embed import build_tiktok_layout
from tumblr_embed import build_tumblr_layout
from twitch_embed import build_twitch_layout


def serialized_container(layout):
    components = layout.to_components()
    if len(components) != 1:
        raise AssertionError("expected one Components V2 container")
    return components[0]


class NewPlatformEmbedTests(unittest.TestCase):
    def test_deviantart_card_keeps_artist_artwork_stats_time_and_spoiler(self):
        payload = {
            "title": "Fella Celebrates 100k",
            "description": "A milestone artwork.",
            "url": "https://www.deviantart.com/team/art/Fella-Celebrates-100k-971957229",
            "authorName": "DeviantArt Team",
            "authorHandle": "@team",
            "authorUrl": "https://www.deviantart.com/team",
            "image": "https://images-wixmp-ed30a86b8c4ca887773594c2.wixmp.com/fella.png?token=signed",
            "stats": "👁️ 1.2K views  ❤️ 56 favorites  💬 7 comments  ⬇️ 8 downloads",
            "context": "© 2023 team",
            "timestamp": "2023-08-08T12:34:56Z",
            "sensitive": True,
        }

        container = serialized_container(build_deviantart_layout(payload))
        rendered = str(container)
        header = str(container["components"][0])
        gallery = container["components"][1]

        self.assertIn("DeviantArt Team", header)
        self.assertIn("@team", header)
        self.assertIn("Fella Celebrates 100k", header)
        self.assertIn("A milestone artwork.", header)
        self.assertIn("<:views:1526255708683636896> 1.2K views", rendered)
        self.assertIn("<:like:1526255244483362866> 56 favorites", rendered)
        self.assertIn("<:comment:1526254715250282506> 7 comments", rendered)
        self.assertIn("© 2023 team", rendered)
        self.assertIn("<:deviantart:1528150711089500180>", rendered)
        self.assertIn("<t:", rendered)
        self.assertEqual(gallery["items"][0]["media"]["url"], payload["image"])
        self.assertTrue(gallery["items"][0]["spoiler"])

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
            "title": "Linus is gonna retire soon",
            "url": "https://clips.twitch.tv/GoodGoodWaffleTwitchRaid",
            "authorName": "LinusTech",
            "authorHandle": "@linustech",
            "authorUrl": "https://www.twitch.tv/linustech",
            "authorAvatar": "https://static-cdn.jtvnw.net/profile.png",
            "video": {
                "url": "https://d1ndex63qxojbr.cloudfront.net/clip/index.mp4",
                "width": 1280,
                "height": 720,
                "thumbnail": "https://static-cdn.jtvnw.net/clip.jpg",
            },
            "context": "Talk Shows & Podcasts · Clipped by Nugrun · 30s",
            "stats": "\U0001f441\ufe0f 228.2K views",
            "timestamp": "2019-10-01T20:15:47Z",
        }

        container = serialized_container(build_twitch_layout(payload))
        header = container["components"][0]["components"][0]["content"]
        gallery = container["components"][1]
        footer = container["components"][-1]["content"]

        self.assertIn(
            "**[LinusTech](https://www.twitch.tv/linustech)**",
            header,
        )
        self.assertNotIn("@linustech", header)
        self.assertNotIn("Talk Shows & Podcasts", header)
        self.assertEqual(
            container["components"][2]["content"],
            "-# <:views:1526255708683636896> 228.2K views · "
            "Talk Shows & Podcasts · Clipped by Nugrun · 30s",
        )
        self.assertIn("<:twitch:1527868614269468852>", footer)
        self.assertNotIn("\U0001f7e3", footer)
        self.assertEqual(
            gallery["items"][0]["media"]["url"],
            payload["video"]["url"],
        )


class DeviantArtRetrievalTests(unittest.IsolatedAsyncioTestCase):
    async def test_fetches_directly_without_depending_on_the_blocked_worker(self):
        source_url = (
            "https://www.deviantart.com/team/art/"
            "Fella-Celebrates-100k-971957229"
        )
        payload = {
            "title": "Fella Celebrates 100k",
            "description": "A milestone artwork.",
            "url": source_url,
            "authorName": "Team",
            "authorHandle": "@team",
            "authorUrl": "https://www.deviantart.com/team",
            "image": (
                "https://images-wixmp-ed30a86b8c4ca887773594c2.wixmp.com/"
                "fella.png?token=signed"
            ),
            "timestamp": "2023-07-14T21:32:03+00:00",
            "platform": "deviantart",
        }

        direct_fetch = AsyncMock(return_value=payload)
        with patch(
            "deviantart_embed.fetch_deviantart_payload",
            direct_fetch,
        ):
            layout = await fetch_deviantart_layout(source_url)

        direct_fetch.assert_awaited_once_with(source_url)
        rendered = str(serialized_container(layout))
        self.assertIn("Fella Celebrates 100k", rendered)
        self.assertIn("<:deviantart:1528150711089500180>", rendered)

    def test_normalizes_signed_media_stats_timestamp_and_safety(self):
        source_url = (
            "https://www.deviantart.com/team/art/"
            "Fella-Celebrates-100k-971957229"
        )
        signed_image = (
            "https://images-wixmp-ed30a86b8c4ca887773594c2.wixmp.com/"
            "fella.png?token=signed-value"
        )
        signed_avatar = (
            "https://a.deviantart.net/avatars/t/e/team.gif?cache=version"
        )
        payload = normalize_deviantart_oembed_payload(
            source_url,
            {
                "type": "photo",
                "title": "Fella Celebrates 100k",
                "description": "A milestone artwork.",
                "url": signed_image,
                "author_name": "Team",
                "author_url": "https://www.deviantart.com/team",
                "safety": "mature",
                "pubdate": "2023-07-14T14:32:03-07:00",
                "community": {
                    "statistics": {
                        "_attributes": {
                            "views": "632165",
                            "favorites": "1315",
                            "comments": "354",
                        }
                    }
                },
            },
            author_avatar_url=signed_avatar,
        )

        self.assertEqual(payload["image"], signed_image)
        self.assertEqual(payload["authorAvatar"], signed_avatar)
        self.assertEqual(payload["authorHandle"], "@team")
        self.assertIn("632.2K views", payload["stats"])
        self.assertEqual(payload["timestamp"], "2023-07-14T21:32:03+00:00")
        self.assertTrue(payload["sensitive"])
        self.assertIn(signed_avatar, str(serialized_container(
            build_deviantart_layout(payload)
        )))
