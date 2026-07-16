import asyncio
import json
from pathlib import Path
import unittest

from conformance import (
    FetchResponse,
    ManifestError,
    _read_bounded_body,
    build_api_url,
    evaluate_payload,
    parse_manifest,
    run_conformance,
)
from card_conformance import BUILDERS, evaluate_components_v2, validate_serialized_card


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


class ChunkedResponseTests(unittest.IsolatedAsyncioTestCase):
    async def test_reads_every_chunk_before_decoding_json(self):
        class ChunkedBody:
            def __init__(self):
                self.chunks = [b'{"success":', b'true,"data":', b'{}}', b'']

            async def read(self, _size):
                return self.chunks.pop(0)

        body = await _read_bounded_body(ChunkedBody())

        self.assertEqual(json.loads(body), {"success": True, "data": {}})


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

    def test_parses_components_renderer_and_bounded_api_options(self):
        case = parse_manifest(
            valid_manifest(
                renderer="components-v2",
                options={"lang": "ES", "mode": "mosaic"},
                requires=["title", "translation"],
                mediaType=None,
                sectionKinds=[],
            )
        )[0]

        self.assertEqual(case.renderer, "components-v2")
        self.assertEqual(case.options, {"lang": "es", "mode": "mosaic"})
        self.assertIn("translation", case.requires)

    def test_rejects_unknown_renderer_and_unbounded_api_options(self):
        for overrides in (
            {"renderer": "legacy-embed"},
            {"renderer": ["components-v2"]},
            {"options": {"unknown": "value"}},
            {"options": {"lang": "not-a-language"}},
            {"options": {"mode": "unsupported"}},
            {"options": {"mode": ["gallery"]}},
            {"mediaType": ["video"]},
        ):
            with self.subTest(overrides=overrides):
                with self.assertRaises(ManifestError):
                    parse_manifest(valid_manifest(**overrides))

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
        self.assertEqual(set(BUILDERS), platforms)

    def test_production_manifest_exercises_real_cards_and_advanced_x_media(self):
        manifest = json.loads(
            Path("conformance/production.json").read_text(encoding="utf-8")
        )
        cases = parse_manifest(manifest)
        by_id = {case.case_id: case for case in cases}

        self.assertTrue(all(case.renderer == "components-v2" for case in cases))
        self.assertEqual(by_id["twitter-carousel"].media_type, "carousel")
        self.assertEqual(by_id["twitter-gif"].media_type, "gif")
        self.assertEqual(by_id["twitter-video"].media_type, "video")
        self.assertEqual(
            by_id["twitter-translation"].options,
            {"lang": "es"},
        )
        self.assertIn("translation", by_id["twitter-translation"].requires)
        self.assertIn("tombstone", by_id["twitter-tombstone"].section_kinds)


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

    def test_components_renderer_is_part_of_the_payload_contract(self):
        case = parse_manifest(
            valid_manifest(
                renderer="components-v2",
                requires=["title", "author", "timestamp", "stats", "media"],
                mediaType="carousel",
                sectionKinds=["quote"],
            )
        )[0]
        payload = {
            **self.payload,
            "data": {
                **self.payload["data"],
                "description": "A complete public post.",
                "url": "https://x.com/example/status/123",
                "authorUrl": "https://x.com/creator",
                "authorAvatar": "https://pbs.twimg.com/profile_images/1/avatar_normal.jpg",
                "sections": [
                    {
                        "kind": "quote",
                        "title": "Quoted Creator",
                        "body": "Quoted body",
                        "url": "https://x.com/quoted/status/456",
                        "authorName": "Quoted Creator",
                        "authorHandle": "@quoted",
                    }
                ],
            },
        }

        result = evaluate_payload(case, payload, duration_ms=25)

        self.assertEqual(result.status, "passed")
        self.assertEqual(result.failure_codes, ())


class ComponentsV2EvaluationTests(unittest.TestCase):
    def setUp(self):
        self.payload = {
            "title": "A public post",
            "description": "A complete public post.",
            "url": "https://x.com/example/status/123",
            "authorName": "Creator",
            "authorHandle": "@creator",
            "authorUrl": "https://x.com/creator",
            "authorAvatar": "https://pbs.twimg.com/profile_images/1/avatar_normal.jpg",
            "timestamp": "2026-07-15T12:00:00Z",
            "stats": "comments 1 reposts 2 likes 3 views 4",
            "images": [
                "https://pbs.twimg.com/media/one.jpg",
                "https://pbs.twimg.com/media/two.jpg",
            ],
            "sections": [
                {
                    "kind": "quote",
                    "title": "Quoted Creator",
                    "body": "Quoted body",
                    "url": "https://x.com/quoted/status/456",
                    "authorName": "Quoted Creator",
                    "authorHandle": "@quoted",
                }
            ],
        }

    def test_real_twitter_builder_satisfies_components_v2_contract(self):
        codes = evaluate_components_v2(
            "twitter",
            self.payload,
            requires=frozenset({"title", "author", "timestamp", "stats", "media"}),
            media_type="carousel",
            section_kinds=frozenset({"quote"}),
        )

        self.assertEqual(codes, ())

    def test_serialized_validator_returns_only_bounded_layout_codes(self):
        codes = validate_serialized_card(
            self.payload,
            [{"type": 17, "components": [{"type": 10, "content": "Creator"}]}],
            requires=frozenset({"author", "timestamp", "stats", "media"}),
            media_type="carousel",
            section_kinds=frozenset({"quote"}),
        )

        self.assertEqual(
            set(codes),
            {
                "card-missing-avatar",
                "card-missing-media",
                "card-missing-stats",
                "card-missing-section",
                "card-missing-footer",
                "card-missing-timestamp",
            },
        )

    def test_stats_must_be_rendered_in_a_dedicated_stats_row(self):
        components = [
            {
                "type": 17,
                "components": [
                    {
                        "type": 10,
                        "content": "Creator posted item 1",
                    },
                    {
                        "type": 10,
                        "content": (
                            "-# [FixEmbed](https://fixembed.app) · "
                            "[X](https://x.com/example/status/123) · <t:1784116800:R>"
                        ),
                    },
                ],
            }
        ]

        codes = validate_serialized_card(
            self.payload,
            components,
            requires=frozenset({"stats"}),
            media_type=None,
            section_kinds=frozenset(),
        )

        self.assertIn("card-missing-stats", codes)

    def test_serialized_validator_rejects_non_https_media(self):
        payload = {
            **self.payload,
            "authorAvatar": "http://example.test/avatar.jpg",
            "images": ["http://example.test/image.jpg"],
        }
        components = [
            {
                "type": 17,
                "components": [
                    {
                        "type": 9,
                        "components": [{"type": 10, "content": "Creator"}],
                        "accessory": {
                            "type": 11,
                            "media": {"url": "http://example.test/avatar.jpg"},
                        },
                    },
                    {
                        "type": 12,
                        "items": [
                            {"media": {"url": "http://example.test/image.jpg"}}
                        ],
                    },
                    {
                        "type": 10,
                        "content": (
                            "-# [FixEmbed](https://fixembed.app) · "
                            "[X](https://x.com/example/status/123) · <t:1784116800:R>"
                        ),
                    },
                ],
            }
        ]

        codes = validate_serialized_card(
            payload,
            components,
            requires=frozenset({"author", "media"}),
            media_type="image",
            section_kinds=frozenset(),
        )

        self.assertIn("card-unsafe-media", codes)

    def test_unknown_platform_fails_without_exposing_payload_content(self):
        codes = evaluate_components_v2(
            "unknown",
            {**self.payload, "description": "private canary content"},
            requires=frozenset({"title"}),
            media_type=None,
            section_kinds=frozenset(),
        )

        self.assertEqual(codes, ("card-render-failed",))
        self.assertNotIn("private", json.dumps(codes))


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

    async def test_forwards_only_reviewed_manifest_options(self):
        case = parse_manifest(
            valid_manifest(
                options={"lang": "es", "mode": "gallery"},
                requires=["title"],
                mediaType=None,
                sectionKinds=[],
            )
        )[0]
        requested = []

        async def fetch_json(url, _timeout_seconds):
            requested.append(url)
            return FetchResponse(
                status_code=200,
                duration_ms=5,
                payload={
                    "success": True,
                    "platform": "twitter",
                    "source": "first-party",
                    "data": {"title": "Post"},
                },
            )

        report = await run_conformance([case], fetch_json=fetch_json)

        self.assertEqual(report.summary["passed"], 1)
        self.assertIn("lang=es", requested[0])
        self.assertIn("mode=gallery", requested[0])

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
