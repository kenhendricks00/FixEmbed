"""#80 follow-up: a Reddit outage link must survive in a multi-link message.

main.py boots the bot on import, so this lifts the real ``on_message`` out of
the source and runs it against fakes plus the real link and delivery helpers.
"""

import ast
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import discord

import delivery_policy
import link_utils
from message_context import format_tagged_users, no_mentions, sender_allowed_mentions
from reddit_embed import keeps_native_reddit_og_on_failure


MAIN_SOURCE = Path(__file__).resolve().parents[1].joinpath("main.py").read_text(
    encoding="utf-8"
)
GUILD_ID = 111
CHANNEL_ID = 222
REDDIT_COMMENT = "https://www.reddit.com/r/news/comments/1qr7zs5/_/o2o5rsi/"
TWEET = "https://x.com/jack/status/20"
SERVICE_NAMES = ["Twitter", "Reddit"]


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

    def __init__(self, manage_messages=True):
        self.manage_messages = manage_messages

    def permissions_for(self, _member):
        return SimpleNamespace(manage_messages=self.manage_messages)


def _message(content, *, manage_messages=True):
    return SimpleNamespace(
        content=content,
        author=SimpleNamespace(
            bot=False,
            id=1,
            mention="<@1>",
            display_name="poster",
        ),
        guild=SimpleNamespace(id=GUILD_ID, me=object()),
        channel=FakeChannel(manage_messages),
        mentions=[],
        delete=mock.AsyncMock(),
        edit=mock.AsyncMock(),
    )


class OnMessageRedditOutageTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.sent = []
        self.card_builds = []
        self.processed_link_cache = {}
        self.logger = mock.MagicMock()
        self.telemetry = mock.MagicMock()
        self.settings = {
            "enabled_services": SERVICE_NAMES,
            "mention_users": True,
            "delete_original": True,
            "delivery_mode": "suppress",
        }

        async def build_components_v2_link(item, *_args, **_kwargs):
            self.card_builds.append(item.canonical_url)
            if item.service == "Reddit":
                raise RuntimeError("Reddit is temporarily unavailable")
            return SimpleNamespace(
                view=object(),
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
            "delivery_telemetry": self.telemetry,
            "rate_limited_send": rate_limited_send,
            "chunk_lines": link_utils.chunk_lines,
            "format_tagged_users": format_tagged_users,
            "no_mentions": no_mentions,
            "sender_allowed_mentions": sender_allowed_mentions,
            "discord": discord,
        }
        self.on_message = _load_on_message(namespace)

    async def run_message(self, message):
        await self.on_message(message)
        # on_message swallows every exception into logging.error; a harness
        # gap (missing global) or a real crash must fail the test instead.
        self.logger.error.assert_not_called()
        return message

    def assert_kept_native_preview_logged(self):
        logged = " ".join(
            str(arg) for call in self.logger.info.call_args_list for arg in call.args
        )
        self.assertIn("kept_native_preview", logged)

    async def test_suppress_mode_replies_and_keeps_source_preview(self):
        message = await self.run_message(_message(f"{REDDIT_COMMENT} {TWEET}"))

        self.assertEqual(len(self.sent), 1)
        self.assertIn("view", self.sent[0])
        message.edit.assert_not_awaited()
        message.delete.assert_not_awaited()
        self.assert_kept_native_preview_logged()
        self.telemetry.mode_downgraded.assert_not_called()

    async def test_delete_mode_replies_and_keeps_source_message(self):
        self.settings["delivery_mode"] = "delete"
        message = await self.run_message(_message(f"{TWEET}\n{REDDIT_COMMENT}"))

        self.assertEqual(len(self.sent), 1)
        self.assertIn("view", self.sent[0])
        # Reply mode posts no "Sent by" line: the source stays.
        self.assertNotIn("content", self.sent[0])
        message.delete.assert_not_awaited()
        message.edit.assert_not_awaited()
        self.assert_kept_native_preview_logged()

    async def test_normal_link_alone_still_suppresses(self):
        message = await self.run_message(_message(TWEET))

        self.assertEqual(len(self.sent), 1)
        message.edit.assert_awaited_once_with(suppress=True)
        message.delete.assert_not_awaited()

    async def test_normal_link_alone_still_deletes(self):
        self.settings["delivery_mode"] = "delete"
        message = await self.run_message(_message(TWEET))

        message.delete.assert_awaited_once()
        message.edit.assert_not_awaited()

    async def test_reddit_outage_alone_posts_nothing(self):
        message = await self.run_message(_message(REDDIT_COMMENT))

        self.assertEqual(self.sent, [])
        message.edit.assert_not_awaited()
        message.delete.assert_not_awaited()

    async def test_missing_permissions_still_counts_as_permission_downgrade(self):
        message = await self.run_message(
            _message(f"{REDDIT_COMMENT} {TWEET}", manage_messages=False)
        )

        message.edit.assert_not_awaited()
        self.telemetry.mode_downgraded.assert_called_once_with(
            "missing_manage_messages"
        )

    async def test_outage_link_is_not_marked_processed(self):
        await self.run_message(_message(f"{REDDIT_COMMENT} {TWEET}"))

        self.assertNotIn((CHANNEL_ID, REDDIT_COMMENT), self.processed_link_cache)
        self.assertIn((CHANNEL_ID, TWEET), self.processed_link_cache)

    async def test_retry_inside_dedup_window_rebuilds_the_reddit_card(self):
        await self.run_message(_message(REDDIT_COMMENT))
        await self.run_message(_message(REDDIT_COMMENT))

        self.assertEqual(self.card_builds, [REDDIT_COMMENT, REDDIT_COMMENT])


class KeepSourcePreviewPolicyTests(unittest.TestCase):
    def test_destructive_modes_fall_back_to_reply(self):
        for mode in ("suppress", "delete"):
            with self.subTest(mode=mode):
                decision = delivery_policy.resolve_delivery_mode(
                    mode,
                    legacy_delete_original=True,
                    can_manage_messages=True,
                    keep_source_preview=True,
                )
                self.assertEqual(decision.configured_mode, mode)
                self.assertEqual(decision.effective_mode, "reply")
                self.assertEqual(decision.downgrade_reason, "kept_native_preview")

    def test_reply_mode_is_not_a_downgrade(self):
        decision = delivery_policy.resolve_delivery_mode(
            "reply",
            legacy_delete_original=True,
            can_manage_messages=True,
            keep_source_preview=True,
        )
        self.assertEqual(decision.effective_mode, "reply")
        self.assertIsNone(decision.downgrade_reason)

    def test_missing_permissions_reason_wins(self):
        decision = delivery_policy.resolve_delivery_mode(
            "suppress",
            legacy_delete_original=True,
            can_manage_messages=False,
            keep_source_preview=True,
        )
        self.assertEqual(decision.downgrade_reason, "missing_manage_messages")

    def test_default_keeps_configured_mode(self):
        decision = delivery_policy.resolve_delivery_mode(
            "suppress",
            legacy_delete_original=True,
            can_manage_messages=True,
        )
        self.assertEqual(decision.effective_mode, "suppress")
        self.assertIsNone(decision.downgrade_reason)


if __name__ == "__main__":
    unittest.main()
