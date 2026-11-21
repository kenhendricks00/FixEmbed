import unittest

from fixembed.platforms.bluesky import build_bluesky_layout, platform_label


class BlueskyEmbedTests(unittest.TestCase):
    def test_components_v2_layout_preserves_identity_carousel_stats_and_links(self):
        payload = {
            "description": "A Bluesky post with a full photo carousel.",
            "url": "https://bsky.app/profile/creator.bsky.social/post/abc123",
            "authorName": "Creator Name",
            "authorHandle": "@creator.bsky.social",
            "authorUrl": "https://bsky.app/profile/creator.bsky.social",
            "authorAvatar": "https://cdn.bsky.app/avatar.jpg",
            "stats": "💬 12  🔁 5  ❤️ 34",
            "timestamp": "2026-07-13T19:00:00.000Z",
            "images": [
                "https://cdn.bsky.app/one.jpg",
                "https://cdn.bsky.app/two.jpg",
                "https://cdn.bsky.app/three.jpg",
            ],
        }
        converted_url = "https://fixembed.app/embed?url=bluesky-post"

        container = build_bluesky_layout(payload, converted_url).to_components()[0]
        header = container["components"][0]
        gallery = container["components"][1]
        stats = container["components"][2]
        footer = container["components"][-1]

        self.assertEqual(container["type"], 17)
        self.assertEqual(container["accent_color"], 0x1185FE)
        self.assertIn("Creator Name", header["components"][0]["content"])
        self.assertIn("[@creator.bsky.social]", header["components"][0]["content"])
        self.assertIn(payload["description"], header["components"][0]["content"])
        self.assertEqual(header["accessory"]["media"]["url"], payload["authorAvatar"])
        self.assertEqual(
            [item["media"]["url"] for item in gallery["items"]],
            payload["images"],
        )
        self.assertIn("<:comment:1526254715250282506> 12", stats["content"])
        self.assertIn("<:repost:1526255036072591450> 5", stats["content"])
        self.assertIn("<:like:1526255244483362866> 34", stats["content"])
        self.assertIn("<:bluesky:1526269663334502544>", footer["content"])
        self.assertIn(f"[FixEmbed]({converted_url})", footer["content"])
        self.assertIn(f"[Bluesky]({payload['url']})", footer["content"])
        self.assertNotIn("View original", footer["content"])
        self.assertNotIn("FixEmbed link", footer["content"])
        self.assertIn("<t:1783969200:R>", footer["content"])

    def test_components_v2_layout_links_back_to_bluesky_compatible_app(self):
        payload = {
            "description": "European tech journalism meets European social media.",
            "url": "https://wsocial.eu/profile/wsocial.eu/post/3mzy5hts2g22i",
            "authorName": "W Social",
            "authorHandle": "@wsocial.eu",
            "authorUrl": "https://wsocial.eu/profile/wsocial.eu",
            "timestamp": "2026-11-10T12:00:00.000Z",
        }

        container = build_bluesky_layout(payload, None).to_components()[0]
        header = container["components"][0]
        footer = container["components"][-1]

        self.assertIn("(https://wsocial.eu/profile/wsocial.eu)", header["content"])
        self.assertIn(f"[AT Protocol]({payload['url']})", footer["content"])
        self.assertIn("<:bluesky:1526269663334502544>", footer["content"])

    def test_platform_label_names_bsky_app_bluesky_and_other_hosts_at_protocol(self):
        self.assertEqual(platform_label("https://bsky.app/profile/a.bsky.social/post/3abc"), "Bluesky")
        self.assertEqual(platform_label(""), "Bluesky")
        self.assertEqual(
            platform_label("https://mu.social/profile/a.bsky.social/post/3mzfkhszhlc2l"),
            "AT Protocol",
        )

    def test_components_v2_layout_preserves_playable_video(self):
        payload = {
            "description": "A Bluesky post with a video.",
            "url": "https://bsky.app/profile/creator.bsky.social/post/abc123",
            "authorName": "Creator Name",
            "authorHandle": "@creator.bsky.social",
            "video": {
                "url": (
                    "https://bsky.social/xrpc/com.atproto.sync.getBlob"
                    "?did=did%3Aplc%3Acreator&cid=bafkreivideo"
                ),
                "thumbnail": "https://video.bsky.app/watch/creator/video/thumbnail.jpg",
                "width": 480,
                "height": 270,
            },
        }

        container = build_bluesky_layout(payload).to_components()[0]
        gallery = container["components"][1]

        self.assertEqual(
            [item["media"]["url"] for item in gallery["items"]],
            [payload["video"]["url"]],
        )

    def test_quote_post_with_video_renders_its_own_video(self):
        # Worker payload for bsky.app/profile/perrydotto.net/post/3n24qxsnkfs2k, a
        # recordWithMedia quote post (own video, quoting an image post).
        video_url = (
            "https://bsky.social/xrpc/com.atproto.sync.getBlob"
            "?did=did%3Aplc%3A24b5qiscvu647kyfrx2lqahv"
            "&cid=bafkreic5x5jbahvxvvg23gpvez3saszdzwrctez4wztevfpero4ikcgpfm"
        )
        for source, label in (
            ("https://bsky.app/profile/perrydotto.net/post/3n24qxsnkfs2k", "Bluesky"),
            ("https://fxbsky.app/profile/perrydotto.net/post/3n24qxsnkfs2k", "AT Protocol"),
        ):
            with self.subTest(source=source):
                payload = {
                    "description": "As a voice actor, I had to test this and, WELL",
                    "url": source,
                    "authorName": "Perrydotto",
                    "authorHandle": "@perrydotto.net",
                    "authorAvatar": "https://cdn.bsky.app/img/avatar/plain/perry",
                    "video": {
                        "url": video_url,
                        "thumbnail": "https://video.bsky.app/watch/perry/thumbnail.jpg",
                        "width": 720,
                        "height": 1280,
                    },
                    "stats": "💬 22 🔁 1.1K ❤️ 2.6K",
                }

                components = build_bluesky_layout(payload).to_components()[0]["components"]
                galleries = [c for c in components if c.get("type") == 12]

                self.assertEqual(len(galleries), 1)
                self.assertEqual(
                    [item["media"]["url"] for item in galleries[0]["items"]],
                    [video_url],
                )
                self.assertIn(label, components[-1]["content"])


if __name__ == "__main__":
    unittest.main()
