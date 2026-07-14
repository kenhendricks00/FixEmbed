import asyncio
import unittest

import aiohttp
import instagram_embed

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


class _FallbackProfileResponse(_ProfileResponse):
    def __init__(self, should_fail=False):
        self.should_fail = should_fail

    def raise_for_status(self):
        if self.should_fail:
            raise aiohttp.ClientError("profile host unavailable")


class _FallbackProfileSession:
    def __init__(self):
        self.requested_urls = []

    def get(self, url, **kwargs):
        self.requested_urls.append(url)
        return _FallbackProfileResponse(should_fail=len(self.requested_urls) == 1)


class _RateLimitedProfileResponse(_ProfileResponse):
    status = 429

    def raise_for_status(self):
        raise aiohttp.ClientError("Too Many Requests")


class _RateLimitedProfileSession:
    def __init__(self):
        self.requested_urls = []

    def get(self, url, **kwargs):
        self.requested_urls.append(url)
        return _RateLimitedProfileResponse()


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

    def test_avatar_upgrade_tries_both_instagram_profile_hosts(self):
        payload = {
            "authorHandle": "@brooke_annm",
            "authorAvatar": (
                "https://scontent.example.cdninstagram.com/avatar.jpg"
                "?stp=dst-jpg_s100x100_tt6"
            ),
        }
        session = _FallbackProfileSession()

        enriched = asyncio.run(_upgrade_instagram_avatar(payload, session))

        self.assertEqual(len(session.requested_urls), 2)
        self.assertIn("www.instagram.com/api/", session.requested_urls[0])
        self.assertIn("i.instagram.com/api/", session.requested_urls[1])
        self.assertIn("s320x320", enriched["authorAvatar"])

    def test_avatar_upgrade_stops_retrying_during_rate_limit_cooldown(self):
        payload = {
            "authorHandle": "@brooke_annm",
            "authorAvatar": (
                "https://scontent.example.cdninstagram.com/avatar.jpg"
                "?stp=dst-jpg_s100x100_tt6"
            ),
        }
        session = _RateLimitedProfileSession()
        instagram_embed._instagram_avatar_blocked_until = 0.0

        try:
            first = asyncio.run(_upgrade_instagram_avatar(payload, session))
            second = asyncio.run(_upgrade_instagram_avatar(payload, session))
        finally:
            instagram_embed._instagram_avatar_blocked_until = 0.0

        self.assertIs(first, payload)
        self.assertIs(second, payload)
        self.assertEqual(len(session.requested_urls), 1)

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

    def test_footer_uses_original_post_timestamp(self):
        embed = build_instagram_embed({
            "authorName": "brooke_annm",
            "timestamp": "2026-05-27T21:03:02.000Z",
        })

        self.assertIsNotNone(embed.timestamp)
        self.assertEqual(int(embed.timestamp.timestamp()), 1779915782)

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
            "timestamp": "2026-05-27T21:03:02.000Z",
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
        self.assertIn(f"[FixEmbed]({converted_url})", footer["content"])
        self.assertIn(f"[Instagram]({payload['url']})", footer["content"])
        self.assertIn("<t:1779915782:R>", footer["content"])
        self.assertNotIn("View original", footer["content"])
        self.assertNotIn("FixEmbed link", footer["content"])


if __name__ == "__main__":
    unittest.main()
