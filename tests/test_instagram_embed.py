import asyncio
import unittest
from unittest.mock import AsyncMock, patch
from urllib.parse import parse_qs, urlsplit

import aiohttp
import instagram_embed

from instagram_embed import (
    _upgrade_instagram_avatar,
    build_instagram_card,
    build_instagram_delivery,
    build_instagram_embed,
    build_instagram_layout,
    fetch_instagram_delivery,
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

    def test_components_v2_layout_relays_all_nine_carousel_images(self):
        image_urls = [
            f"https://scontent.example.cdninstagram.com/carousel-{index}.jpg"
            for index in range(1, 10)
        ]
        payload = {
            "caption": "Nine-image carousel",
            "url": "https://www.instagram.com/p/NineImages/",
            "authorHandle": "@creator",
            "images": image_urls,
        }

        components = build_instagram_layout(payload).to_components()
        gallery = components[0]["components"][1]

        relayed_urls = [item["media"]["url"] for item in gallery["items"]]
        parsed_urls = [urlsplit(url) for url in relayed_urls]

        self.assertEqual(len(relayed_urls), 9)
        self.assertTrue(all(parsed.scheme == "https" for parsed in parsed_urls))
        self.assertTrue(all(parsed.netloc == "fixembed.app" for parsed in parsed_urls))
        self.assertTrue(all(parsed.path == "/proxy/instagram" for parsed in parsed_urls))
        self.assertEqual(
            [parse_qs(parsed.query)["url"][0] for parsed in parsed_urls],
            image_urls,
        )

    def test_components_v2_delivery_uploads_complete_carousels_as_attachments(self):
        payload = {
            "caption": "A long caption that must not be repeated for every image.",
            "url": "https://www.instagram.com/p/TenImages/",
            "authorHandle": "@creator",
            "images": [
                f"https://scontent.example.cdninstagram.com/carousel-{index}.jpg"
                for index in range(1, 11)
            ],
        }
        downloads = [
            (f"image-{index}".encode(), "image/jpeg")
            for index in range(1, 11)
        ]

        delivery = build_instagram_delivery(payload, downloads)
        components = delivery.layout.to_components()
        gallery = components[0]["components"][1]

        self.assertEqual(len(delivery.files), 10)
        self.assertEqual(
            [file.filename for file in delivery.files],
            [f"instagram-{index:02d}.jpg" for index in range(1, 11)],
        )
        self.assertEqual(
            [item["media"]["url"] for item in gallery["items"]],
            [f"attachment://instagram-{index:02d}.jpg" for index in range(1, 11)],
        )
        self.assertEqual(
            [item["description"] for item in gallery["items"]],
            [f"Instagram image {index} of 10" for index in range(1, 11)],
        )
        self.assertNotIn(payload["caption"], gallery["items"][0]["description"])

    def test_fetch_delivery_preserves_extracted_carousel_order(self):
        image_urls = [
            f"https://scontent.example.cdninstagram.com/carousel-{index}.jpg"
            for index in range(1, 11)
        ]
        payload = {
            "caption": "Ten-image carousel",
            "url": "https://www.instagram.com/p/Da5rB1BFp7l/",
            "authorHandle": "@creator",
            "images": image_urls,
        }
        downloads = tuple(
            (f"image-{index}".encode(), "image/jpeg")
            for index in range(1, 11)
        )

        with (
            patch(
                "instagram_embed._fetch_instagram_payload",
                AsyncMock(return_value=payload),
            ),
            patch(
                "instagram_embed._download_instagram_carousel",
                AsyncMock(return_value=downloads),
            ) as download_carousel,
        ):
            delivery = asyncio.run(
                fetch_instagram_delivery(payload["url"])
            )

        download_carousel.assert_awaited_once_with(tuple(image_urls))
        gallery = delivery.layout.to_components()[0]["components"][1]
        self.assertEqual(
            [item["media"]["url"] for item in gallery["items"]],
            [f"attachment://instagram-{index:02d}.jpg" for index in range(1, 11)],
        )

    def test_fetch_delivery_preserves_single_image_remote_delivery(self):
        image_url = "https://scontent.example.cdninstagram.com/single.jpg"
        payload = {
            "url": "https://www.instagram.com/p/SingleImage/",
            "authorHandle": "@creator",
            "image": image_url,
        }

        with (
            patch(
                "instagram_embed._fetch_instagram_payload",
                AsyncMock(return_value=payload),
            ),
            patch(
                "instagram_embed._download_instagram_carousel",
                AsyncMock(),
            ) as download_carousel,
        ):
            delivery = asyncio.run(
                fetch_instagram_delivery(payload["url"])
            )

        download_carousel.assert_not_awaited()
        self.assertEqual(delivery.files, ())
        gallery = delivery.layout.to_components()[0]["components"][1]
        self.assertEqual(len(gallery["items"]), 1)
        self.assertTrue(
            gallery["items"][0]["media"]["url"].startswith(
                "https://fixembed.app/proxy/instagram?"
            )
        )

    def test_fetch_delivery_preserves_affected_reel_as_remote_video(self):
        reel_url = "https://www.instagram.com/reel/DWm-w02iSXP/"
        video_url = (
            "https://fixembed.app/video/instagram?"
            "url=https%3A%2F%2Fkkinstagram.com%2Freel%2FDWm-w02iSXP%2F"
        )
        poster_url = "https://scontent.example.cdninstagram.com/reel-poster.jpg"
        payload = {
            "url": reel_url,
            "authorHandle": "@creator",
            "video": {
                "url": video_url,
                "thumbnail": poster_url,
            },
            "images": [
                poster_url,
                "https://scontent.example.cdninstagram.com/alternate-poster.jpg",
            ],
        }

        with (
            patch(
                "instagram_embed._fetch_instagram_payload",
                AsyncMock(return_value=payload),
            ),
            patch(
                "instagram_embed._download_instagram_carousel",
                AsyncMock(),
            ) as download_carousel,
        ):
            delivery = asyncio.run(
                fetch_instagram_delivery(payload["url"])
            )

        download_carousel.assert_not_awaited()
        self.assertEqual(delivery.files, ())
        gallery = delivery.layout.to_components()[0]["components"][1]
        self.assertEqual(
            [item["media"]["url"] for item in gallery["items"]],
            [video_url],
        )
        self.assertNotIn(poster_url, [item["media"]["url"] for item in gallery["items"]])

    def test_components_v2_layout_splits_twenty_images_across_discord_galleries(self):
        image_urls = [
            f"https://scontent.example.cdninstagram.com/carousel-{index}.jpg"
            for index in range(1, 21)
        ]
        payload = {
            "caption": "Twenty-image carousel",
            "url": "https://www.instagram.com/p/TwentyImages/",
            "authorHandle": "@creator",
            "images": image_urls,
        }

        components = build_instagram_layout(payload).to_components()
        galleries = [
            component
            for component in components[0]["components"]
            if component["type"] == 12
        ]

        self.assertEqual([len(gallery["items"]) for gallery in galleries], [10, 10])
        relayed_urls = [
            item["media"]["url"]
            for gallery in galleries
            for item in gallery["items"]
        ]
        self.assertEqual(
            [
                parse_qs(urlsplit(url).query)["url"][0]
                for url in relayed_urls
            ],
            image_urls,
        )
        self.assertTrue(
            all(url.startswith("https://fixembed.app/proxy/instagram?") for url in relayed_urls)
        )


if __name__ == "__main__":
    unittest.main()
