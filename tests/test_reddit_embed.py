import unittest

from reddit_embed import build_reddit_layout


class RedditEmbedTests(unittest.TestCase):
    def test_link_post_uses_article_title_image_url_identity_and_stats(self):
        article_url = "https://www.bbc.com/sport/football/articles/c24m30v0gy9o"
        title = (
            "World Cup 2026: Hydration breaks not popular and Fifa will review, "
            "says Arsene Wenger"
        )
        payload = {
            "title": f"r/soccer \u2022 {title}",
            "url": "https://www.reddit.com/r/soccer/comments/1v0mvcg/",
            "authorName": "u/Commonmispelingbot",
            "authorUrl": "https://www.reddit.com/user/Commonmispelingbot/",
            "authorAvatar": "https://styles.redditmedia.com/soccer-icon.png",
            "image": "https://ichef.bbci.co.uk/ace/branded_sport/1200/article.jpg",
            "stats": "\U0001f4ac 318  \u2764\ufe0f 3337",
            "timestamp": "2026-07-19T10:19:44.000Z",
            "sections": [
                {
                    "kind": "link-card",
                    "title": "Open linked article",
                    "body": "bbc.com",
                    "url": article_url,
                }
            ],
        }

        container = build_reddit_layout(payload).to_components()[0]
        header = container["components"][0]
        header_text = header["components"][0]["content"]
        visible_text = [
            component["content"]
            for component in container["components"]
            if component.get("type") == 10
        ]

        self.assertIn(f"### [{title}]({article_url})", header_text)
        self.assertEqual(header["accessory"]["media"]["url"], payload["authorAvatar"])
        self.assertEqual(visible_text[0], article_url)
        self.assertNotIn("Open linked article", "\n".join(visible_text))
        self.assertEqual(
            container["components"][2]["items"][0]["media"]["url"],
            payload["image"],
        )
        self.assertIn("<:comment:1526254715250282506> 318", "\n".join(visible_text))
        self.assertIn("<:upvote:1526256000641007616> 3337", "\n".join(visible_text))

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
        gallery = next(
            component for component in container["components"] if "items" in component
        )
        rendered_text = "\n".join(
            component.get("content", "")
            for component in container["components"]
            if component.get("type") == 10
        )

        self.assertEqual(container["type"], 17)
        self.assertIn("r/MAS_Activator", header["components"][0]["content"])
        self.assertIn("[u/JustAnAveragePirate]", header["components"][0]["content"])
        self.assertIn(
            "[PSA - Do not recommend unsafe utilities](https://example.com/article)",
            header["components"][0]["content"],
        )
        self.assertIn(payload["description"], header["components"][0]["content"])
        self.assertEqual(header["accessory"]["media"]["url"], payload["authorAvatar"])
        self.assertEqual(
            [item["media"]["url"] for item in gallery["items"]],
            payload["images"],
        )
        self.assertIn("<:comment:1526254715250282506> 8", rendered_text)
        self.assertIn("<:upvote:1526256000641007616> 50", rendered_text)
        self.assertNotIn("<:like:", rendered_text)
        self.assertIn("https://example.com/article", rendered_text)
        self.assertNotIn("Open linked article", rendered_text)
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


    def test_comment_permalink_renders_comment_card_not_parent_post_media(self):
        payload = {
            "title": "r/programming • Comment on Parent discussion thread",
            "description": "This is the linked comment body with useful context.",
            "url": "https://www.reddit.com/r/programming/comments/abc123/parent_discussion_thread/def4567/",
            "authorName": "u/comment_author",
            "authorUrl": "https://www.reddit.com/user/comment_author/",
            "authorAvatar": "https://styles.redditmedia.com/programming.png",
            "stats": "❤️ 64",
            "timestamp": "2026-07-13T00:01:40.000Z",
            "image": "https://preview.redd.it/should-not-render.png",
            "sections": [
                {
                    "kind": "quote",
                    "title": "Parent discussion thread",
                    "body": "Parent post",
                    "url": "https://www.reddit.com/r/programming/comments/abc123/parent_discussion_thread/",
                    "authorName": "u/post_author",
                    "authorUrl": "https://www.reddit.com/user/post_author/",
                }
            ],
        }

        container = build_reddit_layout(payload).to_components()[0]
        header = container["components"][0]
        header_text = header["components"][0]["content"]
        rendered_text = "\n".join(
            component.get("content", "")
            for component in container["components"]
            if component.get("type") == 10
        )
        gallery_items = [
            component
            for component in container["components"]
            if "items" in component
        ]

        self.assertIn("Commented by [u/comment_author]", header_text)
        self.assertIn(
            "### Comment on [Parent discussion thread](https://www.reddit.com/r/programming/comments/abc123/parent_discussion_thread/)",
            header_text,
        )
        self.assertIn(payload["description"], header_text)
        self.assertNotIn("Posted by", header_text)
        self.assertEqual(gallery_items, [])
        self.assertIn("<:upvote:1526256000641007616> 64", rendered_text)
        self.assertIn(f"[Reddit]({payload['url']})", rendered_text)
        self.assertNotIn("Parent post\n", rendered_text)


    def test_unavailable_comment_tombstone_renders_failure_card_without_media(self):
        payload = {
            "title": "r/shrimptank • Comment unavailable",
            "description": "This Reddit comment was deleted or is no longer available.",
            "url": "https://www.reddit.com/r/shrimptank/comments/1bqy1n9/_/damfr71/",
            "sections": [
                {
                    "kind": "tombstone",
                    "title": "Comment unavailable",
                    "body": "This Reddit comment was deleted or is no longer available.",
                }
            ],
        }
        converted_url = "https://fixembed.app/embed?url=ama-comment"
        container = build_reddit_layout(payload, converted_url).to_components()[0]
        rendered_text = "\n".join(
            component.get("content", "")
            for component in container["components"]
            if component.get("type") == 10
        )
        gallery_items = [
            component
            for component in container["components"]
            if "items" in component
        ]

        self.assertIn("### Comment unavailable", rendered_text)
        self.assertIn("deleted or is no longer available", rendered_text)
        self.assertIn("r/shrimptank", rendered_text)
        self.assertNotIn("deleted by user", rendered_text.casefold())
        self.assertEqual(gallery_items, [])
        self.assertNotIn("<:upvote:", rendered_text)
        self.assertIn(f"[FixEmbed]({converted_url})", rendered_text)
        self.assertIn(f"[Reddit]({payload['url']})", rendered_text)

    def test_is_reddit_comment_permalink_detects_comment_ids(self):
        from reddit_embed import is_reddit_comment_permalink

        self.assertTrue(
            is_reddit_comment_permalink(
                "https://www.reddit.com/r/reddit/comments/1bqy1n9/im_spez_ama/damfr71/"
            )
        )
        self.assertTrue(
            is_reddit_comment_permalink(
                "https://www.reddit.com/r/programming/comments/abc123/comment/def4567/"
            )
        )
        self.assertTrue(
            is_reddit_comment_permalink(
                "https://old.reddit.com/r/programming/comments/abc123/title/?comment=def4567"
            )
        )
        self.assertFalse(
            is_reddit_comment_permalink(
                "https://www.reddit.com/r/programming/comments/abc123/example_post/"
            )
        )



if __name__ == "__main__":
    unittest.main()
