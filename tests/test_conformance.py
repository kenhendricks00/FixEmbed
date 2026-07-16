import asyncio
import json
from pathlib import Path
import unittest

from conformance import (
    FetchResponse,
    ManifestError,
    build_api_url,
    evaluate_payload,
    parse_manifest,
    run_conformance,
)


def valid_manifest(**case_overrides):
    case = {
        "id": "x-carousel",
        "platform": "twitter",
        "url": "https://x.com/example/status/123",
        "requires": ["title", "author", "timestamp", "stats", "media"],
        "mediaType": "carousel",
        "sectionKinds": ["quote"],
        "allowFallback": False,
    }
    case.update(case_overrides)
    return {"version": 1, "cases": [case]}


class ManifestTests(unittest.TestCase):
    def test_parses_bounded_semantic_contract(self):
        cases = parse_manifest(valid_manifest())

        self.assertEqual(len(cases), 1)
        self.assertEqual(cases[0].case_id, "x-carousel")
        self.assertEqual(cases[0].platform, "twitter")
        self.assertEqual(cases[0].media_type, "carousel")
        self.assertEqual(cases[0].section_kinds, frozenset({"quote"}))
        self.assertFalse(cases[0].allow_fallback)

    def test_rejects_duplicate_ids_and_more_than_fifty_cases(self):
        duplicate = valid_manifest()
        duplicate["cases"].append(dict(duplicate["cases"][0]))
        with self.assertRaisesRegex(ManifestError, "unique"):
            parse_manifest(duplicate)

        too_many = valid_manifest()
        too_many["cases"] = [
            {
                **too_many["cases"][0],
                "id": f"case-{index}",
            }
            for index in range(51)
        ]
        with self.assertRaisesRegex(ManifestError, "50"):
            parse_manifest(too_many)

    def test_rejects_non_https_unknown_hosts_and_platform_mismatches(self):
        for url in (
            "http://x.com/example/status/123",
            "https://attacker.example/x.com/example/status/123",
            "https://www.instagram.com/p/example/",
        ):
            with self.subTest(url=url):
                with self.assertRaises(ManifestError):
                    parse_manifest(valid_manifest(url=url))

    def test_rejects_unknown_expectations_and_inconsistent_media_contract(self):
        with self.assertRaisesRegex(ManifestError, "requirement"):
            parse_manifest(valid_manifest(requires=["title", "postBody"]))

        with self.assertRaisesRegex(ManifestError, "mediaType"):
            parse_manifest(
                valid_manifest(requires=["title"], mediaType="video")
            )

    def test_production_manifest_covers_every_worker_platform(self):
        manifest = json.loads(
            Path("conformance/production.json").read_text(encoding="utf-8")
        )
        platforms = {case.platform for case in parse_manifest(manifest)}

        self.assertEqual(
            platforms,
            {
                "twitter",
                "instagram",
                "reddit",
                "threads",
                "pixiv",
                "bluesky",
                "youtube",
                "bilibili",
                "pinterest",
            },
        )


class ContractEvaluationTests(unittest.TestCase):
    def setUp(self):
        self.case = parse_manifest(valid_manifest())[0]
        self.payload = {
            "success": True,
            "platform": "twitter",
            "source": "first-party",
            "data": {
                "title": "A public post",
                "authorName": "Creator",
                "authorHandle": "creator",
                "timestamp": "2026-07-15T12:00:00.000Z",
                "stats": "comments 1",
                "images": [
                    "https://cdn.example/one.jpg",
                    "https://cdn.example/two.jpg",
                ],
                "sections": [{"kind": "quote", "title": "Quote", "body": "Body"}],
            },
        }

    def test_passes_first_party_payload_with_expected_carousel_and_section(self):
        result = evaluate_payload(self.case, self.payload, duration_ms=125)

        self.assertEqual(result.status, "passed")
        self.assertEqual(result.source, "first-party")
        self.assertEqual(result.duration_ms, 125)
        self.assertEqual(result.failure_codes, ())

    def test_distinguishes_allowed_fallback_from_disallowed_fallback(self):
        self.payload["source"] = "fallback"

        disallowed = evaluate_payload(self.case, self.payload, duration_ms=10)
        allowed_case = parse_manifest(valid_manifest(allowFallback=True))[0]
        allowed = evaluate_payload(allowed_case, self.payload, duration_ms=10)

        self.assertEqual(disallowed.status, "failed")
        self.assertIn("fallback-disallowed", disallowed.failure_codes)
        self.assertEqual(allowed.status, "degraded")
        self.assertEqual(allowed.failure_codes, ("fallback-used",))

    def test_reports_bounded_codes_for_missing_fields_and_wrong_media(self):
        self.payload["data"] = {
            "title": "A public post",
            "images": ["https://cdn.example/only-one.jpg"],
            "sections": [],
        }

        result = evaluate_payload(self.case, self.payload, duration_ms=25)

        self.assertEqual(result.status, "failed")
        self.assertEqual(
            set(result.failure_codes),
            {
                "missing-author",
                "missing-timestamp",
                "missing-stats",
                "wrong-media-type",
                "missing-section",
            },
        )

    def test_rejects_invalid_envelope_platform_and_source(self):
        invalid = evaluate_payload(self.case, {}, duration_ms=1)
        self.assertEqual(invalid.failure_codes, ("invalid-envelope",))

        self.payload["platform"] = "reddit"
        self.payload["source"] = "mystery"
        invalid = evaluate_payload(self.case, self.payload, duration_ms=1)
        self.assertIn("platform-mismatch", invalid.failure_codes)
        self.assertIn("invalid-source", invalid.failure_codes)


class RunnerTests(unittest.IsolatedAsyncioTestCase):
    async def test_builds_encoded_api_url_and_preserves_manifest_order(self):
        cases = parse_manifest(
            {
                "version": 1,
                "cases": [
                    valid_manifest()["cases"][0],
                    {
                        **valid_manifest()["cases"][0],
                        "id": "x-second",
                        "url": "https://x.com/example/status/456?lang=en",
                    },
                ],
            }
        )
        requested = []

        async def fetch_json(url, timeout_seconds):
            requested.append((url, timeout_seconds))
            return FetchResponse(
                status_code=200,
                duration_ms=5,
                payload={
                    "success": True,
                    "platform": "twitter",
                    "source": "first-party",
                    "data": {
                        "title": "Post",
                        "authorName": "Creator",
                        "timestamp": "2026-07-15T12:00:00Z",
                        "stats": "1",
                        "images": ["one", "two"],
                        "sections": [{"kind": "quote"}],
                    },
                },
            )

        report = await run_conformance(
            cases,
            base_url="https://fixembed.app",
            fetch_json=fetch_json,
            concurrency=1,
            timeout_seconds=7,
        )

        self.assertEqual([result.case_id for result in report.results], ["x-carousel", "x-second"])
        self.assertIn("url=https%3A%2F%2Fx.com%2Fexample%2Fstatus%2F123", requested[0][0])
        self.assertIn("%3Flang%3Den", requested[1][0])
        first_probe = requested[0][0].split("_conformance=", 1)[1]
        second_probe = requested[1][0].split("_conformance=", 1)[1]
        self.assertTrue(first_probe)
        self.assertEqual(first_probe, second_probe)
        self.assertEqual(requested[0][1], 7)
        self.assertEqual(report.summary, {"passed": 2, "degraded": 0, "failed": 0})

    async def test_timeout_and_http_failures_are_bounded_and_privacy_safe(self):
        cases = parse_manifest(valid_manifest())
        private_error = "https://x.com/private/status/999 secret caption"

        async def timeout_fetch(_url, _timeout_seconds):
            raise asyncio.TimeoutError(private_error)

        timeout_report = await run_conformance(cases, fetch_json=timeout_fetch)
        serialized = json.dumps(timeout_report.to_dict())
        self.assertEqual(timeout_report.results[0].failure_codes, ("request-timeout",))
        self.assertNotIn("private", serialized)
        self.assertNotIn("x.com", serialized)

        async def http_fetch(_url, _timeout_seconds):
            return FetchResponse(status_code=503, duration_ms=20, payload={"error": private_error})

        http_report = await run_conformance(cases, fetch_json=http_fetch)
        serialized = json.dumps(http_report.to_dict())
        self.assertEqual(http_report.results[0].failure_codes, ("http-5xx",))
        self.assertNotIn("private", serialized)
        self.assertNotIn("x.com", serialized)

    async def test_oversized_response_uses_a_fixed_failure_code(self):
        cases = parse_manifest(valid_manifest())

        async def oversized_fetch(_url, _timeout_seconds):
            raise ValueError("response-too-large")

        report = await run_conformance(cases, fetch_json=oversized_fetch)

        self.assertEqual(report.results[0].failure_codes, ("response-too-large",))

    async def test_build_api_url_rejects_non_https_production_base(self):
        with self.assertRaisesRegex(ValueError, "HTTPS"):
            build_api_url("http://fixembed.app", "https://x.com/example/status/1")


if __name__ == "__main__":
    unittest.main()
