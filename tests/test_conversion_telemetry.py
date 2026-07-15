import asyncio
import json
import unittest

from conversion_telemetry import (
    ConversionTelemetry,
    classify_build_failure,
    format_local_conversion_health,
    new_request_id,
)


class MutableClock:
    def __init__(self):
        self.value = 10.0

    def __call__(self):
        return self.value


class ResponseError(Exception):
    def __init__(self, status, message="private upstream URL https://example.com/post/1"):
        super().__init__(message)
        self.status = status


class ConversionTelemetryTests(unittest.IsolatedAsyncioTestCase):
    def test_generated_request_ids_are_safe_and_unique(self):
        first = new_request_id()
        second = new_request_id()

        self.assertRegex(first, r"^[a-f0-9]{16}$")
        self.assertNotEqual(first, second)

    def test_classifies_failures_into_bounded_operational_categories(self):
        self.assertEqual(classify_build_failure(TimeoutError()), "timeout")
        self.assertEqual(classify_build_failure(ResponseError(429)), "rate_limited")
        self.assertEqual(classify_build_failure(ResponseError(404)), "upstream_4xx")
        self.assertEqual(classify_build_failure(ResponseError(503)), "upstream_5xx")
        self.assertEqual(classify_build_failure(ConnectionError()), "network")
        self.assertEqual(classify_build_failure(ValueError()), "invalid_response")
        self.assertEqual(classify_build_failure(RuntimeError()), "unexpected")

    async def test_observation_records_rich_success_and_recent_p95_latency(self):
        clock = MutableClock()
        telemetry = ConversionTelemetry(clock=clock, sample_size=3)

        for duration_ms in (100, 300, 200, 900):
            async with telemetry.observe("Twitter", "request-1"):
                clock.value += duration_ms / 1000

        snapshot = telemetry.snapshot()
        twitter = snapshot.services[0]

        self.assertEqual(snapshot.total_attempts, 4)
        self.assertEqual(snapshot.total_rich, 4)
        self.assertEqual(snapshot.total_fallbacks, 0)
        self.assertEqual(twitter.sample_count, 3)
        self.assertEqual(twitter.p95_ms, 900)

    async def test_fallback_log_is_structured_and_excludes_sensitive_details(self):
        clock = MutableClock()
        telemetry = ConversionTelemetry(clock=clock)

        with self.assertLogs("fixembed.conversion", level="WARNING") as captured:
            with self.assertRaises(ResponseError):
                async with telemetry.observe("Instagram", "req safe / unsafe"):
                    clock.value += 0.25
                    raise ResponseError(429)

        event = json.loads(captured.records[0].getMessage())
        snapshot = telemetry.snapshot()

        self.assertEqual(event["event"], "conversion_card_fallback")
        self.assertEqual(event["service"], "Instagram")
        self.assertEqual(event["category"], "rate_limited")
        self.assertEqual(event["request_id"], "reqsafeunsafe")
        self.assertEqual(event["duration_ms"], 250)
        self.assertNotIn("message", event)
        self.assertNotIn("url", event)
        self.assertNotIn("example.com", captured.output[0])
        self.assertEqual(snapshot.total_fallbacks, 1)

    async def test_unknown_services_are_folded_into_a_bounded_label(self):
        telemetry = ConversionTelemetry()

        async with telemetry.observe("attacker-controlled-service-name", "req-1"):
            pass

        snapshot = telemetry.snapshot()
        self.assertEqual(snapshot.services[0].service, "Unknown")

    async def test_dominant_failure_category_wins_over_the_latest_failure(self):
        telemetry = ConversionTelemetry()

        for status in (503, 503, 429):
            with self.assertRaises(ResponseError):
                async with telemetry.observe("Instagram", "req"):
                    raise ResponseError(status)

        self.assertEqual(
            telemetry.snapshot().services[0].primary_failure,
            "upstream_5xx",
        )

    async def test_cancelled_build_is_not_misreported_as_a_link_fallback(self):
        telemetry = ConversionTelemetry()

        with self.assertRaises(asyncio.CancelledError):
            async with telemetry.observe("Twitter", "req"):
                raise asyncio.CancelledError()

        self.assertEqual(telemetry.snapshot().total_attempts, 0)

    async def test_formats_only_the_most_actionable_local_degradation(self):
        clock = MutableClock()
        telemetry = ConversionTelemetry(clock=clock)

        async with telemetry.observe("Twitter", "one"):
            clock.value += 0.1
        failures = (
            ("Instagram", 429),
            ("Reddit", 503),
            ("Pixiv", 404),
            ("Threads", 500),
        )
        for service, status in failures:
            with self.assertRaises(ResponseError):
                async with telemetry.observe(service, service):
                    clock.value += 0.2
                    raise ResponseError(status)

        text = format_local_conversion_health(
            telemetry.snapshot(),
            icon_for_service=lambda service: f"[{service}]",
        )

        self.assertIn("**Local card quality:** 1 rich · 4 link fallbacks", text)
        self.assertNotIn("pending", text)
        self.assertIn("**Recent rich-card rate:** 20.0% · p95 200ms", text)
        self.assertIn("[Instagram] **Instagram:** 1/1 fallbacks · Rate limited", text)
        self.assertIn("[Reddit] **Reddit:** 1/1 fallbacks · Upstream 5xx", text)
        self.assertIn("[Pixiv] **Pixiv:** 1/1 fallbacks · Upstream 4xx", text)
        self.assertNotIn("[Threads]", text)
        self.assertIn("Process-scoped", text)

    async def test_attention_list_prioritizes_fallback_rate_over_first_seen_order(self):
        telemetry = ConversionTelemetry()

        with self.assertRaises(ResponseError):
            async with telemetry.observe("Instagram", "first"):
                raise ResponseError(429)
        for _ in range(9):
            async with telemetry.observe("Instagram", "healthy"):
                pass
        for service in ("Reddit", "Pixiv", "Threads"):
            with self.assertRaises(ResponseError):
                async with telemetry.observe(service, service):
                    raise ResponseError(503)

        text = format_local_conversion_health(
            telemetry.snapshot(),
            icon_for_service=lambda service: f"[{service}]",
        )

        self.assertNotIn("[Instagram]", text)
        self.assertIn("[Reddit]", text)
        self.assertIn("[Pixiv]", text)
        self.assertIn("[Threads]", text)


if __name__ == "__main__":
    unittest.main()
