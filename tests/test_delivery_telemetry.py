import asyncio
import json
import unittest

from delivery_telemetry import (
    DeliveryTelemetry,
    classify_delivery_failure,
    deliver_with_fallback,
    format_delivery_health,
)


class MutableClock:
    def __init__(self):
        self.value = 20.0

    def __call__(self):
        return self.value


class ResponseError(Exception):
    def __init__(self, status, message="private channel https://discord.com/channels/1/2"):
        super().__init__(message)
        self.status = status


class DeliveryTelemetryTests(unittest.IsolatedAsyncioTestCase):
    def test_classifies_discord_delivery_failures_into_bounded_categories(self):
        self.assertEqual(classify_delivery_failure(asyncio.TimeoutError()), "timeout")
        self.assertEqual(classify_delivery_failure(ResponseError(403)), "forbidden")
        self.assertEqual(classify_delivery_failure(ResponseError(404)), "not_found")
        self.assertEqual(classify_delivery_failure(ResponseError(429)), "rate_limited")
        self.assertEqual(classify_delivery_failure(ResponseError(502)), "discord_5xx")
        self.assertEqual(classify_delivery_failure(ConnectionError()), "network")
        self.assertEqual(classify_delivery_failure(RuntimeError()), "unexpected")

    def test_records_direct_delivery_and_bounded_recent_p95(self):
        clock = MutableClock()
        telemetry = DeliveryTelemetry(clock=clock, sample_size=3)

        for duration_ms in (100, 300, 200, 900):
            ticket = telemetry.queued("card")
            clock.value += duration_ms / 1000
            telemetry.delivered(ticket)

        snapshot = telemetry.snapshot()
        self.assertEqual(snapshot.total_queued, 4)
        self.assertEqual(snapshot.direct_deliveries, 4)
        self.assertEqual(snapshot.link_rescues, 0)
        self.assertEqual(snapshot.failed, 0)
        self.assertEqual(snapshot.sample_count, 3)
        self.assertEqual(snapshot.p95_ms, 900)

    def test_link_rescue_log_is_structured_and_excludes_sensitive_details(self):
        clock = MutableClock()
        telemetry = DeliveryTelemetry(clock=clock)
        ticket = telemetry.queued("card")
        clock.value += 0.25

        with self.assertLogs("fixembed.delivery", level="WARNING") as captured:
            telemetry.link_rescued(ticket, ResponseError(403))

        event = json.loads(captured.records[0].getMessage())
        snapshot = telemetry.snapshot()
        self.assertEqual(event["event"], "discord_delivery_link_rescued")
        self.assertEqual(event["kind"], "card")
        self.assertEqual(event["category"], "forbidden")
        self.assertRegex(event["request_id"], r"^[a-f0-9]{16}$")
        self.assertEqual(event["duration_ms"], 250)
        self.assertNotIn("message", event)
        self.assertNotIn("url", event)
        self.assertNotIn("discord.com", captured.output[0])
        self.assertEqual(snapshot.link_rescues, 1)
        self.assertEqual(snapshot.primary_failure, "forbidden")

    def test_complete_failure_is_counted_once_and_logs_final_category(self):
        telemetry = DeliveryTelemetry()
        ticket = telemetry.queued("link")

        with self.assertLogs("fixembed.delivery", level="ERROR") as captured:
            telemetry.failed(ticket, ResponseError(429))

        event = json.loads(captured.records[0].getMessage())
        snapshot = telemetry.snapshot()
        self.assertEqual(event["event"], "discord_delivery_failed")
        self.assertEqual(event["category"], "rate_limited")
        self.assertEqual(snapshot.total_queued, 1)
        self.assertEqual(snapshot.failed, 1)
        self.assertEqual(snapshot.completed, 1)

    def test_unknown_kinds_are_folded_into_a_bounded_label(self):
        telemetry = DeliveryTelemetry()
        ticket = telemetry.queued("attacker-controlled-kind")
        telemetry.delivered(ticket)

        self.assertEqual(ticket.kind, "other")

    def test_one_ticket_cannot_be_counted_twice(self):
        telemetry = DeliveryTelemetry()
        ticket = telemetry.queued("card")

        telemetry.delivered(ticket)
        telemetry.failed(ticket, ResponseError(503))

        snapshot = telemetry.snapshot()
        self.assertEqual(snapshot.completed, 1)
        self.assertEqual(snapshot.direct_deliveries, 1)
        self.assertEqual(snapshot.failed, 0)

    def test_format_separates_delivery_health_from_pending_queue_depth(self):
        telemetry = DeliveryTelemetry()
        telemetry.delivered(telemetry.queued("card"))
        telemetry.link_rescued(telemetry.queued("card"), ResponseError(403))
        telemetry.failed(telemetry.queued("link"), ResponseError(429))

        text = format_delivery_health(telemetry.snapshot(), pending=2)

        self.assertIn("**Discord delivery:** 1 direct · 1 link rescue · 1 failed · 2 pending", text)
        self.assertIn("**Recent delivery rate:** 66.7%", text)
        self.assertIn("**Primary delivery issue:** Rate limited", text)
        self.assertIn("Process-scoped", text)

    def test_empty_format_does_not_claim_delivery_success(self):
        text = format_delivery_health(DeliveryTelemetry().snapshot(), pending=4)

        self.assertIn("No completed sends yet · 4 pending", text)
        self.assertNotIn("100.0%", text)

    def test_permission_mode_downgrades_are_bounded_and_visible(self):
        telemetry = DeliveryTelemetry()
        telemetry.mode_downgraded("missing_manage_messages")
        telemetry.mode_downgraded("attacker-controlled-reason")

        snapshot = telemetry.snapshot()
        text = format_delivery_health(snapshot, pending=0)

        self.assertEqual(snapshot.mode_downgrades, 2)
        self.assertEqual(snapshot.primary_downgrade, "missing_manage_messages")
        self.assertIn("**Automatic permission recovery:** 2 reply downgrades", text)
        self.assertIn("Missing Manage Messages", text)
        self.assertNotIn("attacker-controlled", text)

    async def test_delivery_orchestrator_records_direct_success(self):
        telemetry = DeliveryTelemetry()
        ticket = telemetry.queued("card")
        calls = []

        async def primary_send():
            calls.append("primary")

        async def fallback_send():
            calls.append("fallback")

        await deliver_with_fallback(
            ticket,
            telemetry=telemetry,
            primary_send=primary_send,
            fallback_send=fallback_send,
        )

        self.assertEqual(calls, ["primary"])
        self.assertEqual(telemetry.snapshot().direct_deliveries, 1)

    async def test_delivery_orchestrator_rescues_failed_component_with_link(self):
        telemetry = DeliveryTelemetry()
        ticket = telemetry.queued("card")

        async def primary_send():
            raise ResponseError(400)

        async def fallback_send():
            return None

        with self.assertLogs("fixembed.delivery", level="WARNING"):
            await deliver_with_fallback(
                ticket,
                telemetry=telemetry,
                primary_send=primary_send,
                fallback_send=fallback_send,
            )

        snapshot = telemetry.snapshot()
        self.assertEqual(snapshot.link_rescues, 1)
        self.assertEqual(snapshot.failed, 0)

    async def test_delivery_orchestrator_records_final_fallback_failure(self):
        telemetry = DeliveryTelemetry()
        ticket = telemetry.queued("card")

        async def primary_send():
            raise ResponseError(400)

        async def fallback_send():
            raise ResponseError(403)

        with self.assertLogs("fixembed.delivery", level="ERROR"):
            await deliver_with_fallback(
                ticket,
                telemetry=telemetry,
                primary_send=primary_send,
                fallback_send=fallback_send,
            )

        snapshot = telemetry.snapshot()
        self.assertEqual(snapshot.link_rescues, 0)
        self.assertEqual(snapshot.failed, 1)
        self.assertEqual(snapshot.primary_failure, "forbidden")

    async def test_delivery_orchestrator_records_failure_without_fallback(self):
        telemetry = DeliveryTelemetry()
        ticket = telemetry.queued("link")

        async def primary_send():
            raise ResponseError(404)

        with self.assertLogs("fixembed.delivery", level="ERROR"):
            await deliver_with_fallback(
                ticket,
                telemetry=telemetry,
                primary_send=primary_send,
                fallback_send=None,
            )

        snapshot = telemetry.snapshot()
        self.assertEqual(snapshot.failed, 1)
        self.assertEqual(snapshot.primary_failure, "not_found")

    async def test_delivery_orchestrator_does_not_swallow_cancellation(self):
        telemetry = DeliveryTelemetry()
        ticket = telemetry.queued("card")

        async def primary_send():
            raise asyncio.CancelledError()

        with self.assertRaises(asyncio.CancelledError):
            await deliver_with_fallback(
                ticket,
                telemetry=telemetry,
                primary_send=primary_send,
                fallback_send=None,
            )

        self.assertEqual(telemetry.snapshot().completed, 0)

    async def test_delivery_orchestrator_does_not_swallow_fallback_cancellation(self):
        telemetry = DeliveryTelemetry()
        ticket = telemetry.queued("card")

        async def primary_send():
            raise ResponseError(400)

        async def fallback_send():
            raise asyncio.CancelledError()

        with self.assertRaises(asyncio.CancelledError):
            await deliver_with_fallback(
                ticket,
                telemetry=telemetry,
                primary_send=primary_send,
                fallback_send=fallback_send,
            )

        self.assertEqual(telemetry.snapshot().completed, 0)


if __name__ == "__main__":
    unittest.main()
