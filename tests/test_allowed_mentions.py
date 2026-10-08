"""#93: nothing the bot posts may ping from embedded third-party text.

main.py boots the bot on import, so these tests read its source: the client
constructor and every send keyword are checked with ``ast``, and the real
``on_message`` is lifted out and run against fakes with a Reddit comment whose
body says ``@everyone <@123> <@&456>``.
"""

import ast
import re
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import discord

import delivery_policy
import link_utils
from message_context import format_tagged_users, no_mentions, sender_allowed_mentions
from reddit_embed import build_reddit_layout, keeps_native_reddit_og_on_failure


MAIN_SOURCE = Path(__file__).resolve().parents[1].joinpath("main.py").read_text(
    encoding="utf-8"
)
GUILD_ID = 111
CHANNEL_ID = 222
AUTHOR_ID = 1
TAGGED_ID = 777
HOSTILE_TEXT = "@everyone @here <@123> <@!123> <@&456>"
REDDIT_COMMENT = "https://www.reddit.com/r/news/comments/1qr7zs5/_/o2o5rsi/"
SERVICE_NAMES = ["Twitter", "Reddit"]

HOSTILE_REDDIT_PAYLOAD = {
    "title": f"r/news • {HOSTILE_TEXT} thread",
    "description": HOSTILE_TEXT,
    "url": REDDIT_COMMENT,
    "authorName": f"u/{HOSTILE_TEXT}",
    "authorUrl": "https://www.reddit.com/user/post_author/",
    "stats": "💬 1  ❤️ 2",
    "timestamp": "2026-10-08T14:00:00.000Z",
    "sections": [
        {
            "kind": "quote",
            "title": "Comment by u/pinger",
            "body": f"hey {HOSTILE_TEXT}\nsecond line <@&456>",
            "url": REDDIT_COMMENT,
            "authorName": "u/pinger",
            "authorUrl": "https://www.reddit.com/user/pinger/",
        }
    ],
}

MENTION_PATTERN = re.compile(r"@(everyone|here)|<@(!?|&)(\d+)>")


def deliverable_mentions(text, allowed_mentions):
    """Which mentions in ``text`` Discord would deliver under ``allowed_mentions``.

    Mirrors discord.py: a per-call value is merged over the client default
    (``no_mentions()`` per the constructor test below), and an unset per-call
    value falls back to that default.
    """
    effective = no_mentions()
    if allowed_mentions is not None:
        effective = effective.merge(allowed_mentions)
    rules = effective.to_dict()
    parse = set(rules.get("parse", ()))
    users = {str(value) for value in rules.get("users", ())}
    roles = {str(value) for value in rules.get("roles", ())}
    delivered = []
    for match in MENTION_PATTERN.finditer(text or ""):
        everyone, kind, snowflake = match.groups()
        if everyone:
            if "everyone" in parse:
                delivered.append(match.group(0))
        elif kind == "&":
            if "roles" in parse or snowflake in roles:
                delivered.append(match.group(0))
        elif "users" in parse or snowflake in users:
            delivered.append(match.group(0))
    return delivered


def _component_text(components):
    for component in components:
        if not isinstance(component, dict):
            continue
        if isinstance(component.get("content"), str):
            yield component["content"]
        for key in ("components", "accessory"):
            nested = component.get(key)
            if isinstance(nested, list):
                yield from _component_text(nested)
            elif isinstance(nested, dict):
                yield from _component_text([nested])


def _sent_text(send):
    parts = [send.get("content"), send.get("fallback_content")]
    view = send.get("view")
    if view is not None:
        parts.extend(_component_text(view.to_components()))
    return "\n".join(part for part in parts if part)


def _call_name(call):
    func = call.func
    if isinstance(func, ast.Name):
        return func.id
    if isinstance(func, ast.Attribute):
        return func.attr
    return ""


class MainSourceAllowedMentionsTests(unittest.TestCase):
    def setUp(self):
        self.tree = ast.parse(MAIN_SOURCE)

    def test_client_is_built_with_no_mentions(self):
        constructor = next(
            node.value
            for node in self.tree.body
            if isinstance(node, ast.Assign)
            and any(isinstance(t, ast.Name) and t.id == "client" for t in node.targets)
        )
        keyword = next(
            (k for k in constructor.keywords if k.arg == "allowed_mentions"), None
        )
        self.assertIsNotNone(keyword, "client must set allowed_mentions")
        self.assertEqual(ast.unparse(keyword.value), "no_mentions()")

    def test_no_send_passes_allowed_mentions_none(self):
        for node in ast.walk(self.tree):
            if isinstance(node, ast.Call):
                for keyword in node.keywords:
                    if keyword.arg == "allowed_mentions":
                        self.assertFalse(
                            isinstance(keyword.value, ast.Constant)
                            and keyword.value.value is None,
                            f"allowed_mentions=None at main.py:{node.lineno}",
                        )
            if isinstance(node, ast.Dict):
                for key, value in zip(node.keys, node.values):
                    if isinstance(key, ast.Constant) and key.value == "allowed_mentions":
                        self.assertNotEqual(ast.unparse(value), "None")
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                args = node.args.args + node.args.kwonlyargs
                defaults = [None] * (len(node.args.args) - len(node.args.defaults))
                defaults += list(node.args.defaults) + list(node.args.kw_defaults)
                for arg, default in zip(args, defaults):
                    if arg.arg == "allowed_mentions":
                        self.assertIsNotNone(default, f"{node.name} needs a default")
                        self.assertEqual(ast.unparse(default), "no_mentions()")

    def test_card_and_link_sends_set_allowed_mentions_explicitly(self):
        checked = 0
        for node in ast.walk(self.tree):
            if not isinstance(node, ast.Call):
                continue
            name = _call_name(node)
            is_followup = (
                name == "send"
                and isinstance(node.func, ast.Attribute)
                and ast.unparse(node.func.value) == "interaction.followup"
            )
            if name != "rate_limited_send" and not is_followup:
                continue
            ephemeral = any(
                k.arg == "ephemeral" and ast.unparse(k.value) == "True"
                for k in node.keywords
            )
            if ephemeral:
                # Only the invoking user sees it; the client default covers it.
                continue
            checked += 1
            source = ast.get_source_segment(MAIN_SOURCE, node) or ""
            has_keyword = any(k.arg == "allowed_mentions" for k in node.keywords)
            has_options = any(k.arg is None for k in node.keywords)
            self.assertTrue(
                has_keyword or has_options,
                f"main.py:{node.lineno} sends without allowed_mentions: {source}",
            )
        self.assertGreaterEqual(checked, 9)

    def test_followup_send_options_carry_no_mentions(self):
        self.assertIn('"allowed_mentions": no_mentions()', MAIN_SOURCE)


class MentionHelperTests(unittest.TestCase):
    def test_no_mentions_parses_nothing(self):
        self.assertEqual(no_mentions().to_dict(), {"parse": []})
        self.assertEqual(deliverable_mentions(HOSTILE_TEXT, no_mentions()), [])

    def test_sender_mentions_only_allow_the_poster(self):
        author = SimpleNamespace(id=AUTHOR_ID)
        allowed = sender_allowed_mentions(author, ping_author=True)
        text = f"Sent by <@{AUTHOR_ID}>\nTagged: <@{TAGGED_ID}> {HOSTILE_TEXT}"
        self.assertEqual(deliverable_mentions(text, allowed), [f"<@{AUTHOR_ID}>"])
        self.assertFalse(allowed.replied_user)

    def test_sender_mentions_off_allow_nobody(self):
        author = SimpleNamespace(id=AUTHOR_ID)
        allowed = sender_allowed_mentions(author, ping_author=False)
        text = f"Sent by poster\nTagged: <@{TAGGED_ID}> {HOSTILE_TEXT}"
        self.assertEqual(deliverable_mentions(text, allowed), [])

    def test_unset_per_call_value_falls_back_to_client_default(self):
        self.assertEqual(deliverable_mentions(HOSTILE_TEXT, None), [])

    def test_reddit_fixture_really_renders_the_mentions(self):
        text = "\n".join(
            _component_text(build_reddit_layout(HOSTILE_REDDIT_PAYLOAD).to_components())
        )
        self.assertIn("@everyone", text)
        self.assertIn("<@123>", text)
        self.assertIn("<@&456>", text)


def _load_on_message(namespace):
    tree = ast.parse(MAIN_SOURCE)
    function = next(
        node
        for node in tree.body
        if isinstance(node, ast.AsyncFunctionDef) and node.name == "on_message"
    )
    function.decorator_list = []
    module = ast.Module(body=[function], type_ignores=[])
    exec(compile(module, "main.py", "exec"), namespace)
    return namespace["on_message"]


class FakeChannel:
    id = CHANNEL_ID

    def permissions_for(self, _member):
        return SimpleNamespace(manage_messages=True)


def _message(content):
    return SimpleNamespace(
        content=content,
        author=SimpleNamespace(
            bot=False,
            id=AUTHOR_ID,
            mention=f"<@{AUTHOR_ID}>",
            display_name="poster",
        ),
        guild=SimpleNamespace(id=GUILD_ID, me=object()),
        channel=FakeChannel(),
        mentions=[SimpleNamespace(id=TAGGED_ID)],
        delete=mock.AsyncMock(),
        edit=mock.AsyncMock(),
    )


class OnMessageMentionTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.sent = []
        self.processed_link_cache = {}
        self.logger = mock.MagicMock()
        self.settings = {
            "enabled_services": SERVICE_NAMES,
            "mention_users": True,
            "delete_original": True,
            "delivery_mode": "suppress",
        }

        async def build_components_v2_link(item, *_args, **_kwargs):
            return SimpleNamespace(
                view=build_reddit_layout(HOSTILE_REDDIT_PAYLOAD),
                files=(),
                fallback_url=f"https://fixembed.app/{item.canonical_url}",
            )

        async def rate_limited_send(channel, **kwargs):
            self.sent.append(kwargs)
            return "direct"

        async def no_op(*_args, **_kwargs):
            return None

        async def not_premium(_guild_id):
            return False

        namespace = {
            "bot_settings": {GUILD_ID: self.settings},
            "DEFAULT_ENABLED_SERVICES": SERVICE_NAMES,
            "is_guild_premium": not_premium,
            "should_skip_automatic": lambda *_args, **_kwargs: False,
            "get_footer_branding": lambda *_args: None,
            "effective_content_visibility": lambda *_args: None,
            "preferences_from_settings": lambda *_args, **_kwargs: None,
            "client": SimpleNamespace(user=object(), db=None),
            "channel_states": {},
            "extract_supported_links": link_utils.extract_supported_links,
            "get_service_rule": lambda _g, _c, _s, default: default,
            "processed_link_cache": self.processed_link_cache,
            "DEDUP_WINDOW_SECONDS": 10,
            "time": __import__("time"),
            "os": __import__("os"),
            "with_translation_language": lambda item, _settings: item,
            "build_automatic_url": link_utils.build_automatic_url,
            "SERVICE_NAMES": SERVICE_NAMES,
            "build_components_v2_link": build_components_v2_link,
            "keeps_native_reddit_og_on_failure": keeps_native_reddit_og_on_failure,
            "record_processing_outcome": no_op,
            "logging": self.logger,
            "resolve_delivery_mode": delivery_policy.resolve_delivery_mode,
            "should_apply_source_message_action": (
                delivery_policy.should_apply_source_message_action
            ),
            "apply_source_message_action": delivery_policy.apply_source_message_action,
            "delivery_telemetry": mock.MagicMock(),
            "rate_limited_send": rate_limited_send,
            "chunk_lines": link_utils.chunk_lines,
            "format_tagged_users": format_tagged_users,
            "no_mentions": no_mentions,
            "sender_allowed_mentions": sender_allowed_mentions,
            "discord": discord,
        }
        self.on_message = _load_on_message(namespace)

    async def deliver(self, mode, *, mention_users=True):
        self.settings["delivery_mode"] = mode
        self.settings["mention_users"] = mention_users
        self.processed_link_cache.clear()
        await self.on_message(_message(f"{HOSTILE_TEXT} {REDDIT_COMMENT}"))
        self.logger.error.assert_not_called()
        self.assertTrue(self.sent, "nothing was sent")
        return [
            (send, deliverable_mentions(_sent_text(send), send.get("allowed_mentions")))
            for send in self.sent
        ]

    async def test_reply_and_suppress_cards_deliver_no_mentions(self):
        for mode in ("reply", "suppress"):
            with self.subTest(mode=mode):
                self.sent.clear()
                for send, delivered in await self.deliver(mode):
                    self.assertIn("@everyone", _sent_text(send))
                    self.assertEqual(delivered, [])

    async def test_delete_mode_only_pings_the_poster_in_sent_by(self):
        results = await self.deliver("delete")
        card_sends = [send for send, _ in results if send.get("view") is not None]
        text_sends = [(send, d) for send, d in results if send.get("view") is None]
        self.assertTrue(card_sends)
        for send, delivered in results:
            if send.get("view") is not None:
                self.assertEqual(delivered, [], "card must not ping")
        self.assertTrue(text_sends)
        for _send, delivered in text_sends:
            self.assertEqual(delivered, [f"<@{AUTHOR_ID}>"])

    async def test_delete_mode_with_mentions_off_pings_nobody(self):
        for _send, delivered in await self.deliver("delete", mention_users=False):
            self.assertEqual(delivered, [])


if __name__ == "__main__":
    unittest.main()
