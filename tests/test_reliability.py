import asyncio
import unittest

from reliability import (
    ReliabilityClient,
    format_reliability_status,
    parse_reliability_payload,
)


STATUS_PAYLOAD = {
    "updatedAt": "2026-07-14T12:00:00Z",
    "overallStatus": "degraded",
    "platforms": [
        {
            "platform": "Twitter/X",
            "currentLatencyMs": 125,
            "status": "operational",
            "mode": "first-party",
            "notice": None,
            "checkedAt": "2026-07-14T12:00:00Z",
            "responseCode": 200,
        },
        {
            "platform": "Instagram",
            "currentLatencyMs": 812,
            "status": "degraded",
            "mode": "fallback",
            "notice": "Direct rendering failed; fallback supplied the embed.",
            "checkedAt": "2026-07-14T12:00:00Z",
            "responseCode": 200,
        },
    ],
}


class MutableClock:
    def __init__(self):
        self.value = 100.0

    def __call__(self):
        return self.value


class ReliabilityPayloadTests(unittest.TestCase):
    def test_parses_bounded_platform_health_from_worker_payload(self):
        report = parse_reliability_payload(STATUS_PAYLOAD)

        self.assertTrue(report.available)
        self.assertFalse(report.stale)
        self.assertEqual(report.overall_status, "degraded")
        self.assertEqual(report.updated_at, 1784030400)
        self.assertEqual(report.platforms[0].service, "Twitter")
        self.assertEqual(report.platforms[0].mode, "first-party")
        self.assertEqual(report.platforms[1].service, "Instagram")
        self.assertEqual(report.platforms[1].latency_ms, 812)

    def test_rejects_payload_without_any_supported_platform_rows(self):
        with self.assertRaises(ValueError):
            parse_reliability_payload({"platforms": [{"platform": "Unknown"}]})

    def test_formats_live_and_local_health_without_exposing_raw_errors(self):
        report = parse_reliability_payload(STATUS_PAYLOAD)

        text = format_reliability_status(
            report,
            local_stats={
                "total_fixed": 14,
                "total_failed": 2,
                "by_service": {
                    "Twitter": {"ok": 9, "fail": 1},
                    "Instagram": {"ok": 5, "fail": 1},
                },
            },
            pending_sends=3,
            icon_for_service=lambda service: f"[{service}]",
        )

        self.assertIn("**Live platform health:** ⚠️ Degraded", text)
        self.assertIn("[Twitter] **Twitter:** ✅ Operational · First-party · 125ms", text)
        self.assertIn("[Instagram] **Instagram:** ⚠️ Degraded · Fallback · 812ms", text)
        self.assertIn("**This bot process:** 14 fixed · 2 failed · 3 pending", text)
        self.assertNotIn("Direct rendering failed", text)


class ReliabilityClientTests(unittest.IsolatedAsyncioTestCase):
    async def test_reuses_fresh_report_within_cache_window(self):
        clock = MutableClock()
        calls = 0

        async def fetch_json(_url):
            nonlocal calls
            calls += 1
            return STATUS_PAYLOAD

        client = ReliabilityClient(fetch_json=fetch_json, clock=clock)

        first = await client.get_report()
        clock.value += 29
        second = await client.get_report()

        self.assertEqual(calls, 1)
        self.assertIs(first, second)

    async def test_force_refresh_bypasses_fresh_cache(self):
        clock = MutableClock()
        calls = 0

        async def fetch_json(_url):
            nonlocal calls
            calls += 1
            return STATUS_PAYLOAD

        client = ReliabilityClient(fetch_json=fetch_json, clock=clock)
        await client.get_report()
        await client.get_report(force=True)

        self.assertEqual(calls, 2)

    async def test_concurrent_force_refreshes_share_one_request(self):
        clock = MutableClock()
        calls = 0
        fetch_started = asyncio.Event()
        release_fetch = asyncio.Event()

        async def fetch_json(_url):
            nonlocal calls
            calls += 1
            if calls > 1:
                fetch_started.set()
                await release_fetch.wait()
            return STATUS_PAYLOAD

        client = ReliabilityClient(fetch_json=fetch_json, clock=clock)
        await client.get_report()

        first = asyncio.create_task(client.get_report(force=True))
        await fetch_started.wait()
        second = asyncio.create_task(client.get_report(force=True))
        release_fetch.set()
        first_report, second_report = await asyncio.gather(first, second)

        self.assertEqual(calls, 2)
        self.assertIs(first_report, second_report)

    async def test_returns_recent_verified_report_as_stale_when_refresh_fails(self):
        clock = MutableClock()
        should_fail = False

        async def fetch_json(_url):
            if should_fail:
                raise TimeoutError("private upstream details")
            return STATUS_PAYLOAD

        client = ReliabilityClient(fetch_json=fetch_json, clock=clock)
        await client.get_report()
        should_fail = True
        clock.value += 31

        report = await client.get_report()

        self.assertTrue(report.available)
        self.assertTrue(report.stale)
        self.assertEqual(report.error_code, "status_refresh_failed")

    async def test_reports_unavailable_without_a_recent_verified_report(self):
        calls = 0

        async def fetch_json(_url):
            nonlocal calls
            calls += 1
            raise TimeoutError("private upstream details")

        clock = MutableClock()
        client = ReliabilityClient(fetch_json=fetch_json, clock=clock)
        report = await client.get_report()
        repeated = await client.get_report(force=True)

        self.assertFalse(report.available)
        self.assertEqual(report.overall_status, "unavailable")
        self.assertEqual(report.error_code, "status_unavailable")
        self.assertIs(report, repeated)
        self.assertEqual(calls, 1)

        clock.value += 16
        await client.get_report()
        self.assertEqual(calls, 2)


if __name__ == "__main__":
    unittest.main()
