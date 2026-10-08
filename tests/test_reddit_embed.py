import unittest
from types import SimpleNamespace

import discord

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


    def test_comment_permalink_renders_embedded_style_quote_block(self):
        payload = {
            "title": "r/programming • Parent discussion thread",
            "description": "",
            "url": "https://www.reddit.com/r/programming/comments/abc123/parent_discussion_thread/def4567/",
            "authorName": "u/post_author",
            "authorUrl": "https://www.reddit.com/user/post_author/",
            "authorAvatar": "https://styles.redditmedia.com/programming.png",
            "stats": "💬 12  ❤️ 64",
            "timestamp": "2026-07-13T00:01:40.000Z",
            "image": "https://preview.redd.it/parent-thumb.png",
            "sections": [
                {
                    "kind": "quote",
                    "title": "Comment by u/comment_author",
                    "body": "This is the linked comment body with useful context.",
                    "url": "https://www.reddit.com/r/programming/comments/abc123/parent_discussion_thread/def4567/",
                    "authorName": "u/comment_author",
                    "authorUrl": "https://www.reddit.com/user/comment_author/",
                },
                {
                    "kind": "quote",
                    "title": "Parent discussion thread",
                    "body": "Parent post",
                    "url": "https://www.reddit.com/r/programming/comments/abc123/parent_discussion_thread/",
                    "authorName": "u/post_author",
                    "authorUrl": "https://www.reddit.com/user/post_author/",
                },
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
        gallery = next(
            component for component in container["components"] if "items" in component
        )

        self.assertIn("Posted by [u/post_author]", header_text)
        self.assertNotIn("Commented by", header_text)
        self.assertIn(
            "### [Parent discussion thread](https://www.reddit.com/r/programming/comments/abc123/parent_discussion_thread/)",
            header_text,
        )
        self.assertNotIn("Comment on", header_text)
        self.assertNotIn(payload["sections"][0]["body"], header_text)
        self.assertIn("Comment by [u/comment_author](https://www.reddit.com/user/comment_author/):", rendered_text)
        self.assertIn("> This is the linked comment body with useful context.", rendered_text)
        self.assertIn("<:quote:", rendered_text)
        self.assertEqual(
            gallery["items"][0]["media"]["url"],
            payload["image"],
        )
        self.assertIs(gallery["items"][0]["spoiler"], False)
        self.assertIn("<:upvote:1526256000641007616> 64", rendered_text)
        self.assertIn("<:comment:1526254715250282506> 12", rendered_text)
        self.assertIn(f"[Reddit]({payload['url']})", rendered_text)
        self.assertNotIn("Parent post\n", rendered_text)
        self.assertIn("<t:1783900900:R>", rendered_text)

    def test_comment_quote_renders_worker_markdown_once_and_keeps_card_formatting(self):
        """#87: the Worker escapes Reddit text once; the bot must not escape it again."""
        comment_url = (
            "https://www.reddit.com/r/redditdev/comments/e62riz/"
            "how_are_reddit_urls_constructed/f9ncp3g/"
        )
        # The f9ncp3g body as the Worker returns it (same markdown as Reddit's JSON).
        body = (
            "You're close. Let's take a look at the permalink to this comment as an example:\n\n"
            f"{comment_url}\n\n"
            "e62riz is the *post* ID, not a \"root comment\"\n\n"
            "'how\\_are\\_reddit\\_urls\\_constructed' is a title slug. When fetching data, "
            "you can replace it with any text (you'll often see `_` used as a placeholder "
            "when constructing URLs from an existing ID)."
        )
        payload = {
            "title": "r/redditdev \u2022 How are reddit urls constructed?",
            "url": comment_url,
            "authorName": "u/milisis",
            "authorUrl": "https://www.reddit.com/user/milisis/",
            "sections": [
                {
                    "kind": "quote",
                    "title": "Comment by u/kemitche",
                    "body": body,
                    "url": comment_url,
                    "authorName": "u/kemitche",
                    "authorUrl": "https://www.reddit.com/user/kemitche/",
                },
                {
                    "kind": "quote",
                    "title": "How are reddit urls constructed?",
                    "body": "Parent post",
                    "url": "https://www.reddit.com/r/redditdev/comments/e62riz/how_are_reddit_urls_constructed/",
                    "authorName": "u/milisis",
                    "authorUrl": "https://www.reddit.com/user/milisis/",
                },
            ],
        }

        container = build_reddit_layout(payload).to_components()[0]
        texts = [
            component.get("content", "")
            for component in container["components"]
            if component.get("type") == 10
        ]
        header_text = texts[0]
        quote_text = next(text for text in texts if "Comment by" in text)

        # Our own formatting is untouched.
        self.assertTrue(header_text.startswith("**r/redditdev**  \u00b7  Posted by [u/milisis]("))
        self.assertIn(
            "### [How are reddit urls constructed?](https://www.reddit.com/r/redditdev/comments/e62riz/how_are_reddit_urls_constructed/)",
            header_text,
        )
        self.assertRegex(
            quote_text,
            r"^> <:quote:\d+> Comment by \[u/kemitche\]\(https://www\.reddit\.com/user/kemitche/\):\n> \u200b\n",
        )
        # User text appears exactly as the Worker escaped it, inside the quote block.
        self.assertIn(
            "> 'how\\_are\\_reddit\\_urls\\_constructed' is a title slug.",
            quote_text,
        )
        self.assertNotIn("\\\\", quote_text)
        self.assertIn("you'll often see `_` used as a placeholder", quote_text)
        self.assertIn(f"> {comment_url}\n", quote_text)
        self.assertIn("e62riz is the *post* ID", quote_text)
        for line in quote_text.splitlines():
            self.assertTrue(line.startswith("> "), line)

    def test_comment_card_has_no_translated_footer_when_source_matches_target(self):
        """#88: f9ncp3g came back with en -> en metadata and showed "Translated from English"."""
        comment_url = (
            "https://www.reddit.com/r/redditdev/comments/e62riz/"
            "how_are_reddit_urls_constructed/f9ncp3g/"
        )

        def footer_for(translation):
            payload = {
                "title": "r/redditdev \u2022 How are reddit urls constructed?",
                "url": comment_url,
                "authorName": "u/milisis",
                "authorUrl": "https://www.reddit.com/user/milisis/",
                "translation": translation,
                "sections": [
                    {
                        "kind": "quote",
                        "title": "Comment by u/kemitche",
                        "body": "You're close. Let's take a look at the permalink.",
                        "url": comment_url,
                        "authorName": "u/kemitche",
                        "authorUrl": "https://www.reddit.com/user/kemitche/",
                    },
                    {
                        "kind": "quote",
                        "title": "How are reddit urls constructed?",
                        "body": "Parent Post",
                        "url": "https://www.reddit.com/r/redditdev/comments/e62riz/how_are_reddit_urls_constructed/",
                    },
                ],
            }
            container = build_reddit_layout(payload).to_components()[0]
            return [
                component.get("content", "")
                for component in container["components"]
                if component.get("type") == 10
            ][-1]

        same_language = footer_for(
            {
                "sourceLanguage": "en",
                "sourceLanguageName": "English",
                "targetLanguage": "en",
                "originalUrl": comment_url,
            }
        )
        self.assertNotIn("Translated from", same_language)
        self.assertIn(f"[Reddit]({comment_url})", same_language)

        translated = footer_for(
            {
                "sourceLanguage": "ja",
                "sourceLanguageName": "Japanese",
                "targetLanguage": "en",
                "originalUrl": comment_url,
            }
        )
        self.assertTrue(translated.endswith("Translated from Japanese"), translated)

    def test_comment_card_omits_parent_thumbnail_when_absent(self):
        payload = {
            "title": "r/programming • Parent discussion thread",
            "description": "",
            "url": "https://www.reddit.com/r/programming/comments/abc123/parent_discussion_thread/def4567/",
            "authorName": "u/post_author",
            "authorUrl": "https://www.reddit.com/user/post_author/",
            "stats": "❤️ 64",
            "sections": [
                {
                    "kind": "quote",
                    "title": "Comment by u/comment_author",
                    "body": "Short comment.",
                    "authorName": "u/comment_author",
                    "authorUrl": "https://www.reddit.com/user/comment_author/",
                },
                {
                    "kind": "quote",
                    "title": "Parent discussion thread",
                    "body": "Parent post",
                    "url": "https://www.reddit.com/r/programming/comments/abc123/parent_discussion_thread/",
                    "authorName": "u/post_author",
                    "authorUrl": "https://www.reddit.com/user/post_author/",
                },
            ],
        }

        container = build_reddit_layout(payload).to_components()[0]
        gallery_items = [
            component
            for component in container["components"]
            if "items" in component
        ]
        self.assertEqual(gallery_items, [])

    def test_comment_card_spoilers_nsfw_parent_image(self):
        payload = {
            "title": "r/gonewild • NSFW parent",
            "description": "",
            "url": "https://www.reddit.com/r/gonewild/comments/abc123/nsfw_parent/def4567/",
            "authorName": "u/post_author",
            "authorUrl": "https://www.reddit.com/user/post_author/",
            "image": "https://i.redd.it/nsfw-parent.png",
            "sensitive": True,
            "sensitivityTypes": ["nsfw", "spoiler"],
            "sections": [
                {
                    "kind": "quote",
                    "title": "Comment by u/comment_author",
                    "body": "Comment on an NSFW parent.",
                    "authorName": "u/comment_author",
                    "authorUrl": "https://www.reddit.com/user/comment_author/",
                },
                {
                    "kind": "quote",
                    "title": "NSFW parent",
                    "body": "Parent post",
                    "url": "https://www.reddit.com/r/gonewild/comments/abc123/nsfw_parent/",
                    "authorName": "u/post_author",
                    "authorUrl": "https://www.reddit.com/user/post_author/",
                },
            ],
        }

        container = build_reddit_layout(payload).to_components()[0]
        gallery = next(
            component for component in container["components"] if "items" in component
        )
        self.assertEqual(
            gallery["items"][0]["media"]["url"],
            payload["image"],
        )
        self.assertIs(gallery["items"][0]["spoiler"], True)


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

    def test_keeps_native_reddit_og_on_failure_only_for_reddit_comment_permalinks(self):
        from reddit_embed import keeps_native_reddit_og_on_failure

        comment_urls = (
            "https://www.reddit.com/r/redditdev/comments/e62riz/how_are_reddit_urls_constructed/f9ncp3g/",
            "https://www.reddit.com/r/programming/comments/abc123/comment/def4567/",
            "https://old.reddit.com/r/programming/comments/abc123/title/?comment=def4567",
        )
        for url in comment_urls:
            with self.subTest(url=url):
                self.assertTrue(keeps_native_reddit_og_on_failure("Reddit", url))

        self.assertFalse(
            keeps_native_reddit_og_on_failure(
                "Reddit",
                "https://www.reddit.com/r/programming/comments/abc123/example_post/",
            )
        )
        self.assertFalse(
            keeps_native_reddit_og_on_failure(
                "Twitter",
                "https://www.reddit.com/r/redditdev/comments/e62riz/how_are_reddit_urls_constructed/f9ncp3g/",
            )
        )
        self.assertFalse(
            keeps_native_reddit_og_on_failure(
                "Twitter",
                "https://x.com/someone/status/1234567890",
            )
        )


class RedditTombstoneDeliveryTests(unittest.IsolatedAsyncioTestCase):
    """A real deletion is a success:true tombstone card, so it goes through normal delivery."""

    TOMBSTONE_PAYLOAD = {
        "title": "r/shrimptank \u2022 Comment unavailable",
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

    def _tombstone_card_text(self):
        container = build_reddit_layout(
            self.TOMBSTONE_PAYLOAD,
            "https://fixembed.app/embed?url=ama-comment",
        ).to_components()[0]
        return "\n".join(
            component.get("content", "")
            for component in container["components"]
            if component.get("type") == 10
        )

    async def _deliver(self, *, can_manage_messages, suppress_error=None):
        from delivery_policy import (
            apply_source_message_action,
            resolve_delivery_mode,
            should_apply_source_message_action,
        )

        calls = []
        recoveries = []

        async def delete_message():
            calls.append("delete")

        async def suppress_message():
            calls.append("suppress")
            if suppress_error is not None:
                raise suppress_error

        decision = resolve_delivery_mode(
            "suppress",
            legacy_delete_original=False,
            can_manage_messages=can_manage_messages,
        )
        mode = decision.effective_mode
        if mode == "reply" or should_apply_source_message_action(mode, ("direct",)):
            await apply_source_message_action(
                mode,
                delete_message=delete_message,
                suppress_message=suppress_message,
                forbidden_errors=(discord.Forbidden,),
                on_permission_recovery=recoveries.append,
            )
        return decision, calls, recoveries

    async def test_tombstone_card_suppresses_source_with_manage_messages(self):
        self.assertIn("### Comment unavailable", self._tombstone_card_text())

        decision, calls, recoveries = await self._deliver(can_manage_messages=True)

        self.assertEqual(decision.effective_mode, "suppress")
        self.assertIsNone(decision.downgrade_reason)
        self.assertEqual(calls, ["suppress"])
        self.assertEqual(recoveries, [])

    async def test_tombstone_card_replies_without_manage_messages(self):
        self.assertIn("### Comment unavailable", self._tombstone_card_text())

        decision, calls, recoveries = await self._deliver(can_manage_messages=False)

        self.assertEqual(decision.configured_mode, "suppress")
        self.assertEqual(decision.effective_mode, "reply")
        self.assertEqual(decision.downgrade_reason, "missing_manage_messages")
        self.assertNotIn("suppress", calls)
        self.assertEqual(calls, [])
        self.assertEqual(recoveries, [])

    async def test_tombstone_card_recovers_when_manage_messages_is_revoked_mid_send(self):
        forbidden = discord.Forbidden(
            SimpleNamespace(status=403, reason="Forbidden"),
            "Missing Permissions",
        )

        decision, calls, recoveries = await self._deliver(
            can_manage_messages=True,
            suppress_error=forbidden,
        )

        self.assertEqual(decision.effective_mode, "suppress")
        self.assertEqual(calls, ["suppress"])
        self.assertEqual(recoveries, ["missing_manage_messages"])


if __name__ == "__main__":
    unittest.main()
