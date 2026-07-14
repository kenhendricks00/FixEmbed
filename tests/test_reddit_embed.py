import unittest

from reddit_embed import build_reddit_layout


class RedditEmbedTests(unittest.TestCase):
    def test_components_v2_layout_preserves_identity_text_gallery_stats_and_footer(self):
        payload = {
            "title": "r/MAS_Activator • PSA - Do not recommend unsafe utilities",
            "description": "Use tools only when you understand what they change.",
            "url": "https://www.reddit.com/r/MAS_Activator/comments/abc123/example/",
            "authorName": "u/JustAnAveragePirate",
            "authorUrl": "https://www.reddit.com/user/JustAnAveragePirate/",
            "authorAvatar": "https://styles.redditmedia.com/subreddit-icon.png",
            "stats": "💬 8  ❤️ 50",
            "timestamp": "2026-07-13T00:00:00.000Z",
            "images": [
                "https://preview.redd.it/one.png",
                "https://preview.redd.it/two.png",
            ],
            "sections": [
                {
                    "kind": "link-card",
                    "title": "Open linked article",
                    "body": "example.com",
                    "url": "https://example.com/article",
                }
            ],
        }

        converted_url = "https://fixembed.app/embed?url=reddit-post"
        container = build_reddit_layout(payload, converted_url).to_components()[0]
        header = container["components"][0]
        gallery = container["components"][1]
        rendered_text = "\n".join(
            component.get("content", "")
            for component in container["components"]
            if component.get("type") == 10
        )

        self.assertEqual(container["type"], 17)
        self.assertIn("r/MAS_Activator", header["components"][0]["content"])
        self.assertIn("[u/JustAnAveragePirate]", header["components"][0]["content"])
        self.assertIn("PSA - Do not recommend unsafe utilities", header["components"][0]["content"])
        self.assertIn(payload["description"], header["components"][0]["content"])
        self.assertEqual(header["accessory"]["media"]["url"], payload["authorAvatar"])
        self.assertEqual(
            [item["media"]["url"] for item in gallery["items"]],
            payload["images"],
        )
        self.assertIn("<:comment:1526254715250282506> 8", rendered_text)
        self.assertIn("<:upvote:1526256000641007616> 50", rendered_text)
        self.assertNotIn("<:like:", rendered_text)
        self.assertIn("[Open linked article]", rendered_text)
        self.assertIn("<:reddit:1526267589808881684>", rendered_text)
        self.assertIn(f"[FixEmbed]({converted_url})", rendered_text)
        self.assertIn(f"[Reddit]({payload['url']})", rendered_text)
        self.assertNotIn("View original", rendered_text)
        self.assertNotIn("FixEmbed link", rendered_text)
        self.assertIn("<t:1783900800:R>", rendered_text)

    def test_components_v2_layout_keeps_remote_video_playable(self):
        payload = {
            "title": "r/videos • A playable Reddit video",
            "description": "",
            "authorName": "u/example",
            "video": {
                "url": "https://v.redd.it/example/DASH_720.mp4",
                "thumbnail": "https://preview.redd.it/example.jpg",
            },
        }

        container = build_reddit_layout(payload).to_components()[0]

        self.assertEqual(
            container["components"][1]["items"][0]["media"]["url"],
            payload["video"]["url"],
        )


if __name__ == "__main__":
    unittest.main()
