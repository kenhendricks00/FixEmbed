"""Masked-link labels and bodies stay valid Discord markdown.

Desk's #95 smoke (Test #0001, Oct 8) showed the title of
https://www.reddit.com/r/discordapp/comments/1ib8uq6/ as raw
``[How do i stop ... @everyone? ...](https://www.reddit.com/...)``: Discord drops
a masked link whose label holds a mention. The same card showed the comment's
``<@&1234567>`` as an @unknown-role pill (#96). Fixes #103.

Labels escape lens's list (``[``, ``]``, ``)``, backslash) and break mentions.
"""

import re
import unittest

from bilibili_embed import build_bilibili_layout
from deviantart_embed import build_deviantart_layout
from markdown_safety import masked_link_label, neutralize_mentions
from platform_embed import PlatformCardSpec, build_platform_layout
from reddit_embed import build_reddit_layout
from twitter_embed import build_twitter_layout


ZWSP = "\u200b"
# No word boundary: Discord also reads ``@everyones`` and ``x@here`` as mentions.
MENTION = re.compile(r"@(everyone|here)|<[@#](?!\u200b)")
# A ``[``, ``]`` or ``)`` after an even run of backslashes, or a trailing
# unpaired backslash, would end or break the masked-link label.
LIVE_LABEL_SPECIAL = re.compile(r"(?<!\\)(?:\\\\)*(?:[\[\])]|\\$)")

POST_TITLE = (
    "How do i stop regular members from using @everyone? "
    "the permission is disabled (see image) but they do it anyway?"
)
POST_URL = (
    "https://www.reddit.com/r/discordapp/comments/1ib8uq6/"
    "how_do_i_stop_regular_members_from_using_everyone/"
)
SAFE_POST_TITLE = (
    f"How do i stop regular members from using @{ZWSP}everyone? "
    "the permission is disabled (see image\\) but they do it anyway?"
)

# Worker payload for comment m9h3a1i, as returned by
# /api/embed?url=...1ib8uq6/comment/m9h3a1i/&lang=en on Oct 8, 2026.
COMMENT_PAYLOAD = {
    "title": f"r/discordapp \u2022 {POST_TITLE}",
    "description": "",
    "url": f"{POST_URL}m9h3a1i/",
    "siteName": "FixEmbed \u2022 \U0001f517 Reddit",
    "authorName": "u/Axedus1",
    "authorUrl": "https://www.reddit.com/user/Axedus1/",
    "authorAvatar": (
        "https://styles.redditmedia.com/t5_388p4/styles/"
        "communityIcon_hlczkoi3mr3d1.jpg?width=256&s=cb227e4282c6223975e8d6612d457432c038e7be"
    ),
    "color": "#FF4500",
    "platform": "reddit",
    "stats": "\U0001f4ac 54 \u2764\ufe0f 13",
    "sensitive": False,
    "sections": [
        {
            "kind": "quote",
            "title": "Comment by u/Cootshk",
            "body": (
                "If you type @everyone, @here, or <@&(role id)> (<@&1234567>) without perms, "
                "it\u2019ll still show like you can ping it but it doesn\u2019t ping\n\n"
                "The message won\u2019t be yellow, meaning it didn\u2019t ping"
            ),
            "authorName": "u/Cootshk",
            "authorUrl": "https://www.reddit.com/user/Cootshk/",
            "url": f"{POST_URL}m9h3a1i/",
        },
        {
            "kind": "quote",
            "title": POST_TITLE,
            "body": "Parent post",
            "url": POST_URL,
            "authorName": "u/Axedus1",
            "authorUrl": "https://www.reddit.com/user/Axedus1/",
        },
    ],
}


def _texts(layout):
    found = []

    def walk(component):
        if component.get("type") == 10:
            found.append(component["content"])
        for child in component.get("components", []):
            walk(child)

    for component in layout.to_components():
        walk(component)
    return found


def _masked_label(line, url):
    match = re.fullmatch(r"(?:### |\*\*)?\[(.*)\]\(" + re.escape(url) + r"\)(?:\*\*)?", line)
    return match.group(1) if match else None


def _assert_valid_label(test, label):
    test.assertIsNotNone(label)
    test.assertIsNone(MENTION.search(label), label)
    test.assertIsNone(LIVE_LABEL_SPECIAL.search(label), label)


class MaskedLinkLabelTests(unittest.TestCase):
    def test_1ib8uq6_title_breaks_the_mention_and_keeps_the_text(self):
        label = masked_link_label(POST_TITLE)
        self.assertEqual(label, SAFE_POST_TITLE)
        self.assertEqual(label.replace(ZWSP, "").replace("\\)", ")"), POST_TITLE)
        _assert_valid_label(self, label)

    def test_brackets_parens_and_backslashes_are_escaped(self):
        self.assertEqual(
            masked_link_label("[Serious] what is [x](y)? a\\b"),
            r"\[Serious\] what is \[x\](y\)? a\\b",
        )
        self.assertEqual(masked_link_label("ends in \\"), "ends in \\\\")
        _assert_valid_label(self, masked_link_label("odd ] ) [ \\"))

    def test_every_mention_form_is_broken(self):
        label = masked_link_label("@everyone @here <@1> <@!1> <@&2> <#3>")
        self.assertEqual(
            label,
            f"@{ZWSP}everyone @{ZWSP}here <@{ZWSP}1> <@{ZWSP}!1> <@{ZWSP}&2> <#{ZWSP}3>",
        )
        _assert_valid_label(self, label)

    def test_ordinary_titles_are_unchanged_byte_for_byte(self):
        for title in (
            "World Cup 2026: Hydration breaks not popular, Fifa will review",
            "PSA - Do not recommend unsafe utilities (",
            "email me at someone@example.com, @heroes and @every one are fine",
            "\u65e5\u672c\u8a9e\u306e\u30bf\u30a4\u30c8\u30eb \U0001f389 <3",
            "",
        ):
            self.assertEqual(masked_link_label(title), title)
            self.assertEqual(neutralize_mentions(title), title)

    def test_mentions_inside_code_spans_in_a_label_are_broken(self):
        # lens nit 1 on #104: backticks in link text don't stop Discord from
        # seeing the mention and dropping the masked link.
        for title, expected in (
            ("Why `@everyone` fails", f"Why `@{ZWSP}everyone` fails"),
            ("``<@&1234567>`` vs `@here`", f"``<@{ZWSP}&1234567>`` vs `@{ZWSP}here`"),
            ("```<#1> <@2>```", f"```<#{ZWSP}1> <@{ZWSP}2>```"),
            ("see https://medium.com/@here/post", f"see https://medium.com/@{ZWSP}here/post"),
        ):
            label = masked_link_label(title)
            self.assertEqual(label, expected)
            self.assertEqual(masked_link_label(label), label)
            _assert_valid_label(self, label)
        self.assertEqual(
            masked_link_label("`a]` @here", escaped=True),
            f"`a\\]` @{ZWSP}here",
        )

    def test_broadcast_mentions_break_whatever_follows_or_precedes(self):
        # lens nit 2 on #104: ``\b`` let ``@everyone_x`` through.
        for text, expected in (
            ("@everyone_x", f"@{ZWSP}everyone_x"),
            ("@everyones @everyoneelse", f"@{ZWSP}everyones @{ZWSP}everyoneelse"),
            ("@hereby @heresy @here2", f"@{ZWSP}hereby @{ZWSP}heresy @{ZWSP}here2"),
            ("foo@here ops@here.com", f"foo@{ZWSP}here ops@{ZWSP}here.com"),
            ("@@everyone", f"@@{ZWSP}everyone"),
        ):
            self.assertEqual(masked_link_label(text), expected)
            self.assertEqual(neutralize_mentions(text), expected)
            self.assertEqual(neutralize_mentions(expected), expected)
            _assert_valid_label(self, masked_link_label(text))

    def test_other_at_text_is_left_alone(self):
        for text in (
            "someone@example.com",
            "@heroes @hero @every one @Everyone",
            "@her e",
        ):
            self.assertEqual(masked_link_label(text), text)
            self.assertEqual(neutralize_mentions(text), text)

    def test_already_escaped_text_is_not_escaped_again(self):
        for text in (
            r"how\_are \*reddit\* \[urls\] \(built\) a\\b",
            f"@{ZWSP}everyone <@{ZWSP}&1>",
        ):
            self.assertEqual(masked_link_label(text, escaped=True), text)
        once = masked_link_label("[a] (b) c\\ @here <@1>")
        self.assertEqual(masked_link_label(once, escaped=True), once)
        self.assertEqual(
            neutralize_mentions(neutralize_mentions("<#1> @here")),
            f"<#{ZWSP}1> @{ZWSP}here",
        )

    def test_escaped_text_still_escapes_what_is_live(self):
        # ``\\[`` is an escaped backslash followed by a live bracket.
        self.assertEqual(
            masked_link_label("a\\\\[b] (c) d\\", escaped=True),
            "a\\\\\\[b\\] (c\\) d\\\\",
        )


class NeutralizeMentionsTests(unittest.TestCase):
    def test_role_mention_in_body_becomes_text(self):
        self.assertEqual(neutralize_mentions("(<@&1234567>)"), f"(<@{ZWSP}&1234567>)")

    def test_brackets_and_markdown_in_bodies_are_left_alone(self):
        body = r"see [docs](https://example.com/a_b) and how\_are"
        self.assertEqual(neutralize_mentions(body), body)

    def test_code_and_urls_keep_their_bytes(self):
        body = "run `<@123>` then\n```\n@everyone <#1>\n```\nhttps://medium.com/@here/post <@1>"
        self.assertEqual(
            neutralize_mentions(body),
            "run `<@123>` then\n```\n@everyone <#1>\n```\n"
            f"https://medium.com/@here/post <@{ZWSP}1>",
        )

    def test_code_in_bodies_still_keeps_its_bytes_after_label_change(self):
        body = "`@everyone_x` and @everyone_x"
        self.assertEqual(neutralize_mentions(body), f"`@everyone_x` and @{ZWSP}everyone_x")


class RedditCardTests(unittest.TestCase):
    def test_1ib8uq6_comment_card_title_is_a_valid_masked_link(self):
        header = _texts(build_reddit_layout(COMMENT_PAYLOAD))[0]
        title_line = header.splitlines()[1]
        self.assertEqual(title_line, f"### [{SAFE_POST_TITLE}]({POST_URL})")
        _assert_valid_label(self, _masked_label(title_line, POST_URL))
        self.assertNotIn("@everyone", header)

    def test_1ib8uq6_comment_body_mentions_are_plain_text(self):
        quote = _texts(build_reddit_layout(COMMENT_PAYLOAD))[1]
        self.assertIn(f"(<@{ZWSP}&1234567>)", quote)
        self.assertIn(f"<@{ZWSP}&(role id)>", quote)
        self.assertNotIn("<@&", quote)
        self.assertIn(f"If you type @{ZWSP}everyone, @{ZWSP}here, or", quote)
        self.assertIsNone(MENTION.search(quote))
        self.assertIn(
            "> <:quote:1526256046786609164> Comment by "
            "[u/Cootshk](https://www.reddit.com/user/Cootshk/):",
            quote,
        )

    def test_bracketed_post_title_and_section_title_escape_their_brackets(self):
        article = "https://example.com/story"
        payload = {
            "title": "r/news \u2022 [Serious] Is this real? @here",
            "description": "body says <@123> and how\\_are",
            "url": "https://www.reddit.com/r/news/comments/abc123/x/",
            "authorName": "u/poster",
            "authorUrl": "https://www.reddit.com/user/poster/",
            "sections": [
                {"kind": "link-card", "title": "Open linked article", "url": article},
                {
                    "kind": "crosspost",
                    "title": "Crosspost [OC] (2) from @everyone",
                    "url": "https://www.reddit.com/r/pics/comments/def456/",
                    "body": "<#1> ping",
                },
            ],
        }
        texts = _texts(build_reddit_layout(payload))
        header_lines = texts[0].splitlines()
        self.assertEqual(
            header_lines[1],
            f"### [\\[Serious\\] Is this real? @{ZWSP}here]({article})",
        )
        _assert_valid_label(
            self, _masked_label(header_lines[1], article)
        )
        self.assertEqual(header_lines[2], f"body says <@{ZWSP}123> and how\\_are")
        self.assertIn(
            f"### [Crosspost \\[OC\\] (2\\) from @{ZWSP}everyone]"
            "(https://www.reddit.com/r/pics/comments/def456/)\n"
            f"<#{ZWSP}1> ping",
            texts,
        )

    def test_ordinary_post_header_is_unchanged(self):
        article = "https://www.bbc.com/sport/football/articles/c24m30v0gy9o"
        title = "Hydration breaks not popular - Fifa will review, says Wenger"
        payload = {
            "title": f"r/soccer \u2022 {title}",
            "description": "Literal how\\_are and \\*stars\\* stay escaped once.",
            "url": "https://www.reddit.com/r/soccer/comments/1v0mvcg/",
            "authorName": "u/Commonmispelingbot",
            "authorUrl": "https://www.reddit.com/user/Commonmispelingbot/",
            "sections": [
                {"kind": "link-card", "title": "Open linked article", "url": article},
            ],
        }
        self.assertEqual(
            _texts(build_reddit_layout(payload))[0],
            "**r/soccer**  \u00b7  Posted by "
            "[u/Commonmispelingbot](https://www.reddit.com/user/Commonmispelingbot/)\n"
            f"### [{title}]({article})\n"
            "Literal how\\_are and \\*stars\\* stay escaped once.",
        )


class OtherBuilderLabelTests(unittest.TestCase):
    def test_platform_card_title_with_mention_keeps_its_link(self):
        spec = PlatformCardSpec("tumblr", "Tumblr", 0x001935, "<:tumblr:1>")
        url = "https://www.tumblr.com/example/1"
        payload = {
            "title": "[art] (wip) for @everyone",
            "url": url,
            "authorName": "Example",
            "authorUrl": "https://www.tumblr.com/example",
        }
        header = _texts(build_platform_layout(payload, spec))[0]
        title_line = header.splitlines()[1]
        self.assertEqual(title_line, f"### [\\[art\\] (wip\\) for @{ZWSP}everyone]({url})")
        _assert_valid_label(self, _masked_label(title_line, url))

    def test_deviantart_escaped_title_is_not_escaped_twice(self):
        url = "https://www.deviantart.com/team/art/example-123"
        payload = {
            "title": "snake_case (v2) @here",
            "url": url,
            "authorName": "Team",
            "authorUrl": "https://www.deviantart.com/team",
        }
        header = _texts(build_deviantart_layout(payload))[0]
        title_line = header.splitlines()[1]
        self.assertEqual(title_line, f"### [snake\\_case (v2\\) @{ZWSP}here]({url})")
        _assert_valid_label(self, _masked_label(title_line, url))

    def test_bilibili_title_and_author_labels(self):
        url = "https://www.bilibili.com/video/BV1xx"
        payload = {
            "title": "\u3010\u5b98\u65b9\u3011[MV] @here",
            "url": url,
            "authorName": "<@&1> uploader",
            "authorUrl": "https://space.bilibili.com/1",
        }
        header = _texts(build_bilibili_layout(payload))[0]
        self.assertIn(f"**[<@{ZWSP}&1> uploader](https://space.bilibili.com/1)**", header)
        self.assertIn(f"**[\u3010\u5b98\u65b9\u3011\\[MV\\] @{ZWSP}here]({url})**", header)

    def test_twitter_handle_named_here_keeps_its_link(self):
        payload = {
            "title": "Here (@here)",
            "description": "hello",
            "url": "https://x.com/here/status/1",
            "authorName": "Here",
            "authorHandle": "here",
            "authorUrl": "https://x.com/here",
        }
        header = "\n".join(_texts(build_twitter_layout(payload)))
        self.assertIn(f"([@{ZWSP}here](https://x.com/here))", header)


if __name__ == "__main__":
    unittest.main()
