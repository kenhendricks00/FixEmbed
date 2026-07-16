import unittest

from delivery_policy import (
    apply_source_message_action,
    format_delivery_mode_status,
    resolve_delivery_mode,
)


class DeliveryPolicyTests(unittest.IsolatedAsyncioTestCase):
    def test_preserves_suppress_and_delete_with_manage_messages(self):
        suppress = resolve_delivery_mode(
            "suppress",
            legacy_delete_original=True,
            can_manage_messages=True,
        )
        delete = resolve_delivery_mode(
            "delete",
            legacy_delete_original=True,
            can_manage_messages=True,
        )

        self.assertEqual(suppress.effective_mode, "suppress")
        self.assertIsNone(suppress.downgrade_reason)
        self.assertEqual(delete.effective_mode, "delete")
        self.assertIsNone(delete.downgrade_reason)

    def test_downgrades_suppress_and_delete_to_reply_without_manage_messages(self):
        for configured_mode in ("suppress", "delete"):
            with self.subTest(configured_mode=configured_mode):
                decision = resolve_delivery_mode(
                    configured_mode,
                    legacy_delete_original=True,
                    can_manage_messages=False,
                )

                self.assertEqual(decision.configured_mode, configured_mode)
                self.assertEqual(decision.effective_mode, "reply")
                self.assertEqual(
                    decision.downgrade_reason,
                    "missing_manage_messages",
                )

    def test_reply_mode_never_requires_manage_messages(self):
        decision = resolve_delivery_mode(
            "reply",
            legacy_delete_original=True,
            can_manage_messages=False,
        )

        self.assertEqual(decision.effective_mode, "reply")
        self.assertIsNone(decision.downgrade_reason)

    def test_legacy_mode_is_normalized_before_permission_fallback(self):
        legacy_delete = resolve_delivery_mode(
            "unknown",
            legacy_delete_original=True,
            can_manage_messages=False,
        )
        legacy_reply = resolve_delivery_mode(
            None,
            legacy_delete_original=False,
            can_manage_messages=False,
        )

        self.assertEqual(legacy_delete.configured_mode, "delete")
        self.assertEqual(legacy_delete.effective_mode, "reply")
        self.assertEqual(legacy_reply.configured_mode, "reply")
        self.assertEqual(legacy_reply.effective_mode, "reply")

    def test_debug_status_explains_permission_recovery(self):
        decision = resolve_delivery_mode(
            "suppress",
            legacy_delete_original=True,
            can_manage_messages=False,
        )

        text = format_delivery_mode_status(decision)

        self.assertIn("**Configured delivery:** Suppress original", text)
        self.assertIn("**Effective delivery:** Keep original and reply", text)
        self.assertIn("Manage Messages is missing", text)

    def test_debug_status_is_compact_when_no_recovery_is_needed(self):
        decision = resolve_delivery_mode(
            "reply",
            legacy_delete_original=False,
            can_manage_messages=False,
        )

        self.assertEqual(
            format_delivery_mode_status(decision),
            "**Effective delivery:** Keep original and reply",
        )

    async def test_source_action_recovers_from_permission_race(self):
        for mode in ("delete", "suppress"):
            with self.subTest(mode=mode):
                calls = []
                recoveries = []

                async def delete_message():
                    calls.append("delete")
                    raise PermissionError()

                async def suppress_message():
                    calls.append("suppress")
                    raise PermissionError()

                await apply_source_message_action(
                    mode,
                    delete_message=delete_message,
                    suppress_message=suppress_message,
                    forbidden_errors=(PermissionError,),
                    on_permission_recovery=recoveries.append,
                )

                self.assertEqual(calls, [mode])
                self.assertEqual(recoveries, ["missing_manage_messages"])

    async def test_reply_source_action_never_mutates_the_original(self):
        calls = []

        async def delete_message():
            calls.append("delete")

        async def suppress_message():
            calls.append("suppress")

        await apply_source_message_action(
            "reply",
            delete_message=delete_message,
            suppress_message=suppress_message,
            forbidden_errors=(PermissionError,),
            on_permission_recovery=lambda reason: calls.append(reason),
        )

        self.assertEqual(calls, [])

    async def test_source_action_does_not_hide_unexpected_discord_errors(self):
        async def delete_message():
            raise RuntimeError("unexpected Discord failure")

        async def suppress_message():
            return None

        with self.assertRaises(RuntimeError):
            await apply_source_message_action(
                "delete",
                delete_message=delete_message,
                suppress_message=suppress_message,
                forbidden_errors=(PermissionError,),
                on_permission_recovery=lambda reason: None,
            )


if __name__ == "__main__":
    unittest.main()
