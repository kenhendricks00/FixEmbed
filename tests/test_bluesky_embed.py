import unittest

from bluesky_embed import build_bluesky_layout


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


if __name__ == "__main__":
    unittest.main()


class UnavailableBlueskyPostTests(unittest.TestCase):
    """A deleted Bluesky post (or a gone account) gets a FixEmbed card."""

    @staticmethod
    def texts(layout):
        container = layout.to_components()[0]
        return container, [c.get("content", "") for c in container["components"] if c.get("type") == 10]

    def test_worker_unavailable_payload_renders_a_clean_card(self):
        url = "https://bsky.app/profile/creator.bsky.social/post/3aaaaaaaaaaaa"
        reason = "The account for this post no longer exists or changed its handle."
        container, (header, footer) = self.texts(build_bluesky_layout({
            "title": "Post unavailable",
            "description": reason,
            "url": url,
            "platform": "bluesky",
            "sections": [{"kind": "tombstone", "title": "Post unavailable", "body": reason}],
        }))
        self.assertEqual(header, f"**Bluesky**\n### Post unavailable\n{reason}")
        self.assertIn(url, footer)
        self.assertEqual(container["accent_color"], 0x1185FE)

    def test_normal_post_is_not_mistaken_for_unavailable(self):
        _, texts = self.texts(build_bluesky_layout({
            "authorName": "Creator",
            "authorHandle": "creator.bsky.social",
            "description": "hello",
            "url": "https://bsky.app/profile/creator.bsky.social/post/3abc",
        }))
        self.assertNotIn("### Post unavailable", "\n".join(texts))
