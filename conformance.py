"""Privacy-safe semantic canaries for FixEmbed's public embed API."""

from __future__ import annotations

import argparse
import asyncio
from collections import Counter
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timezone
import json
from pathlib import Path
import re
from typing import Any, Optional
from urllib.parse import urlencode, urlparse
import uuid

import aiohttp

from card_conformance import evaluate_components_v2


MAX_CASES = 50
MAX_RESPONSE_BYTES = 1_048_576
DEFAULT_BASE_URL = "https://fixembed.app"
DEFAULT_TIMEOUT_SECONDS = 20.0
DEFAULT_CONCURRENCY = 3

SUPPORTED_HOSTS = {
    "twitter": frozenset({"x.com", "www.x.com", "twitter.com", "www.twitter.com"}),
    "instagram": frozenset({"instagram.com", "www.instagram.com"}),
    "reddit": frozenset({"reddit.com", "www.reddit.com"}),
    "threads": frozenset({"threads.net", "www.threads.net"}),
    "pixiv": frozenset({"pixiv.net", "www.pixiv.net"}),
    "bluesky": frozenset({"bsky.app"}),
    "youtube": frozenset({"youtube.com", "www.youtube.com", "m.youtube.com"}),
    "bilibili": frozenset({"bilibili.com", "www.bilibili.com"}),
    "pinterest": frozenset({"pinterest.com", "www.pinterest.com", "pin.it"}),
}
REQUIREMENTS = frozenset(
    {"title", "author", "timestamp", "stats", "media", "translation"}
)
MEDIA_TYPES = frozenset({"image", "carousel", "video", "gif"})
RENDERERS = frozenset({"components-v2"})
SECTION_KINDS = frozenset(
    {"poll", "quote", "community-note", "article", "link-card", "tombstone"}
)
CASE_ID = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")


class ManifestError(ValueError):
    """Raised when a canary manifest is unsafe or internally inconsistent."""


@dataclass(frozen=True)
class ConformanceCase:
    case_id: str
    platform: str
    source_url: str
    requires: frozenset[str]
    media_type: Optional[str]
    section_kinds: frozenset[str]
    allow_fallback: bool
    renderer: Optional[str]
    options: dict[str, str]


@dataclass(frozen=True)
class FetchResponse:
    status_code: int
    duration_ms: int
    payload: Any


@dataclass(frozen=True)
class ConformanceResult:
    case_id: str
    platform: str
    status: str
    source: str
    duration_ms: int
    failure_codes: tuple[str, ...]


@dataclass(frozen=True)
class ConformanceReport:
    generated_at: str
    summary: dict[str, int]
    results: tuple[ConformanceResult, ...]

    def to_dict(self) -> dict[str, Any]:
        return {
            "generatedAt": self.generated_at,
            "summary": self.summary,
            "results": [
                {
                    "id": result.case_id,
                    "platform": result.platform,
                    "status": result.status,
                    "source": result.source,
                    "durationMs": result.duration_ms,
                    "codes": list(result.failure_codes),
                }
                for result in self.results
            ],
        }


def _string_set(value: object, *, field: str, allowed: frozenset[str]) -> frozenset[str]:
    if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
        raise ManifestError(f"{field} must be a list of strings")
    result = frozenset(value)
    if not result.issubset(allowed):
        raise ManifestError(f"unknown {field} value")
    return result


def parse_manifest(raw: object) -> tuple[ConformanceCase, ...]:
    """Validate an untrusted manifest before any network request is made."""
    if not isinstance(raw, Mapping) or raw.get("version") != 1:
        raise ManifestError("manifest version must be 1")
    raw_cases = raw.get("cases")
    if not isinstance(raw_cases, list) or not raw_cases:
        raise ManifestError("manifest must contain cases")
    if len(raw_cases) > MAX_CASES:
        raise ManifestError(f"manifest cannot contain more than {MAX_CASES} cases")

    cases: list[ConformanceCase] = []
    seen_ids: set[str] = set()
    for raw_case in raw_cases:
        if not isinstance(raw_case, Mapping):
            raise ManifestError("every case must be an object")
        case_id = raw_case.get("id")
        if not isinstance(case_id, str) or not CASE_ID.fullmatch(case_id):
            raise ManifestError("case id is invalid")
        if case_id in seen_ids:
            raise ManifestError("case ids must be unique")
        seen_ids.add(case_id)

        platform = raw_case.get("platform")
        if not isinstance(platform, str) or platform not in SUPPORTED_HOSTS:
            raise ManifestError("case platform is unsupported")
        source_url = raw_case.get("url")
        if not isinstance(source_url, str):
            raise ManifestError("case url must be a string")
        parsed_url = urlparse(source_url)
        if parsed_url.scheme != "https" or parsed_url.hostname not in SUPPORTED_HOSTS[platform]:
            raise ManifestError("case url must use the platform's approved HTTPS host")

        requires = _string_set(
            raw_case.get("requires", []), field="requirement", allowed=REQUIREMENTS
        )
        media_type = raw_case.get("mediaType")
        if media_type is not None and (
            not isinstance(media_type, str) or media_type not in MEDIA_TYPES
        ):
            raise ManifestError("unknown mediaType value")
        if media_type is not None and "media" not in requires:
            raise ManifestError("mediaType requires the media requirement")
        section_kinds = _string_set(
            raw_case.get("sectionKinds", []),
            field="sectionKinds",
            allowed=SECTION_KINDS,
        )
        allow_fallback = raw_case.get("allowFallback", False)
        if not isinstance(allow_fallback, bool):
            raise ManifestError("allowFallback must be a boolean")
        renderer = raw_case.get("renderer")
        if renderer is not None and (
            not isinstance(renderer, str) or renderer not in RENDERERS
        ):
            raise ManifestError("unknown renderer value")
        raw_options = raw_case.get("options", {})
        if not isinstance(raw_options, Mapping):
            raise ManifestError("options must be an object")
        if not set(raw_options).issubset({"lang", "mode"}):
            raise ManifestError("unknown option value")
        options: dict[str, str] = {}
        if "lang" in raw_options:
            language = raw_options["lang"]
            if not isinstance(language, str) or not re.fullmatch(r"[a-zA-Z]{2}", language):
                raise ManifestError("lang option must be a two-letter language code")
            options["lang"] = language.lower()
        if "mode" in raw_options:
            mode = raw_options["mode"]
            if not isinstance(mode, str) or mode not in {"gallery", "mosaic"}:
                raise ManifestError("mode option is unsupported")
            options["mode"] = mode
        if options and platform != "twitter":
            raise ManifestError("options are only supported for twitter cases")
        if "translation" in requires and "lang" not in options:
            raise ManifestError("translation requirement needs a lang option")

        cases.append(
            ConformanceCase(
                case_id=case_id,
                platform=platform,
                source_url=source_url,
                requires=requires,
                media_type=media_type,
                section_kinds=section_kinds,
                allow_fallback=allow_fallback,
                renderer=renderer,
                options=options,
            )
        )
    return tuple(cases)


def load_manifest(path: Path) -> tuple[ConformanceCase, ...]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ManifestError("manifest could not be read") from error
    return parse_manifest(raw)


def _has_text(data: Mapping[str, Any], *fields: str) -> bool:
    return any(isinstance(data.get(field), str) and data[field].strip() for field in fields)


def _media_matches(data: Mapping[str, Any], media_type: Optional[str]) -> bool:
    images = data.get("images") if isinstance(data.get("images"), list) else []
    images = [item for item in images if isinstance(item, str) and item.strip()]
    image = _has_text(data, "image")
    video = data.get("video") if isinstance(data.get("video"), Mapping) else None
    video_url = _has_text(video, "url") if video else False
    video_type = str(video.get("mediaType") or "video").lower() if video else ""
    if media_type is None:
        return bool(images or image or video_url)
    if media_type == "image":
        return bool(images or image)
    if media_type == "carousel":
        return len(images) >= 2
    if media_type == "gif":
        return bool(video_url and video_type == "gif")
    return bool(video_url and video_type != "gif")


def evaluate_payload(
    case: ConformanceCase, payload: object, *, duration_ms: int
) -> ConformanceResult:
    """Evaluate semantic card shape without copying response content into output."""
    if not isinstance(payload, Mapping) or payload.get("success") is not True:
        return ConformanceResult(
            case.case_id, case.platform, "failed", "unknown", duration_ms, ("invalid-envelope",)
        )

    codes: list[str] = []
    if payload.get("platform") != case.platform:
        codes.append("platform-mismatch")
    source = payload.get("source")
    if source not in {"first-party", "fallback"}:
        source = "unknown"
        codes.append("invalid-source")
    elif source == "fallback":
        codes.append("fallback-used" if case.allow_fallback else "fallback-disallowed")

    data = payload.get("data")
    if not isinstance(data, Mapping):
        codes.append("missing-data")
    else:
        checks = {
            "title": _has_text(data, "title"),
            "author": _has_text(data, "authorName", "authorHandle"),
            "timestamp": _has_text(data, "timestamp"),
            "stats": _has_text(data, "stats"),
            "media": _media_matches(data, None),
            "translation": bool(
                re.search(
                    r"Translation \([A-Z]{2}\):",
                    str(data.get("description") or ""),
                )
            ),
        }
        for requirement in (
            "title",
            "author",
            "timestamp",
            "stats",
            "media",
            "translation",
        ):
            if requirement in case.requires and not checks[requirement]:
                codes.append(f"missing-{requirement}")
        if case.media_type and not _media_matches(data, case.media_type):
            codes.append("wrong-media-type")
        if case.section_kinds:
            sections = data.get("sections") if isinstance(data.get("sections"), list) else []
            actual_kinds = {
                item.get("kind") for item in sections if isinstance(item, Mapping)
            }
            if not case.section_kinds.issubset(actual_kinds):
                codes.append("missing-section")
        if case.renderer == "components-v2":
            codes.extend(
                evaluate_components_v2(
                    case.platform,
                    data,
                    requires=case.requires,
                    media_type=case.media_type,
                    section_kinds=case.section_kinds,
                )
            )

    only_allowed_fallback = codes == ["fallback-used"]
    status = "degraded" if only_allowed_fallback else "failed" if codes else "passed"
    return ConformanceResult(
        case.case_id,
        case.platform,
        status,
        str(source),
        max(0, int(duration_ms)),
        tuple(codes),
    )


def build_api_url(
    base_url: str,
    source_url: str,
    *,
    probe_id: Optional[str] = None,
    options: Optional[Mapping[str, str]] = None,
) -> str:
    parsed = urlparse(base_url)
    local_http = parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1", "::1"}
    if parsed.scheme != "https" and not local_http:
        raise ValueError("conformance base URL must use HTTPS")
    if not parsed.hostname:
        raise ValueError("conformance base URL is invalid")
    query = {"url": source_url}
    query.update(options or {})
    if probe_id:
        query["_conformance"] = probe_id
    return f"{base_url.rstrip('/')}/api/embed?{urlencode(query)}"


async def _read_bounded_body(content: Any) -> bytes:
    body = bytearray()
    while True:
        remaining = MAX_RESPONSE_BYTES - len(body)
        chunk = await content.read(min(65_536, remaining + 1))
        if not chunk:
            return bytes(body)
        body.extend(chunk)
        if len(body) > MAX_RESPONSE_BYTES:
            raise ValueError("response-too-large")


async def fetch_json(url: str, timeout_seconds: float) -> FetchResponse:
    timeout = aiohttp.ClientTimeout(total=timeout_seconds)
    started = asyncio.get_running_loop().time()
    async with aiohttp.ClientSession(
        timeout=timeout,
        headers={"Accept": "application/json", "User-Agent": "FixEmbed-Conformance/1.0"},
    ) as session:
        async with session.get(url, allow_redirects=False) as response:
            declared_size = response.content_length
            if declared_size is not None and declared_size > MAX_RESPONSE_BYTES:
                raise ValueError("response-too-large")
            body = await _read_bounded_body(response.content)
            duration_ms = round((asyncio.get_running_loop().time() - started) * 1000)
            try:
                payload = json.loads(body)
            except (UnicodeDecodeError, json.JSONDecodeError):
                payload = None
            return FetchResponse(response.status, duration_ms, payload)


async def run_conformance(
    cases: Sequence[ConformanceCase],
    *,
    base_url: str = DEFAULT_BASE_URL,
    fetch_json: Callable[[str, float], Awaitable[FetchResponse]] = fetch_json,
    concurrency: int = DEFAULT_CONCURRENCY,
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
) -> ConformanceReport:
    if not 1 <= concurrency <= 10:
        raise ValueError("concurrency must be between 1 and 10")
    if not 1 <= timeout_seconds <= 60:
        raise ValueError("timeout must be between 1 and 60 seconds")
    semaphore = asyncio.Semaphore(concurrency)
    probe_id = uuid.uuid4().hex

    async def run_case(case: ConformanceCase) -> ConformanceResult:
        endpoint = build_api_url(
            base_url,
            case.source_url,
            probe_id=probe_id,
            options=case.options,
        )
        async with semaphore:
            try:
                response = await fetch_json(endpoint, timeout_seconds)
            except asyncio.TimeoutError:
                return ConformanceResult(
                    case.case_id, case.platform, "failed", "unknown", 0, ("request-timeout",)
                )
            except ValueError as error:
                code = "response-too-large" if str(error) == "response-too-large" else "request-failed"
                return ConformanceResult(case.case_id, case.platform, "failed", "unknown", 0, (code,))
            except (aiohttp.ClientError, OSError):
                return ConformanceResult(
                    case.case_id, case.platform, "failed", "unknown", 0, ("request-failed",)
                )
            except Exception:
                return ConformanceResult(
                    case.case_id, case.platform, "failed", "unknown", 0, ("unexpected-error",)
                )
        if not 200 <= response.status_code < 300:
            status_class = max(0, min(9, response.status_code // 100))
            return ConformanceResult(
                case.case_id,
                case.platform,
                "failed",
                "unknown",
                response.duration_ms,
                (f"http-{status_class}xx",),
            )
        return evaluate_payload(case, response.payload, duration_ms=response.duration_ms)

    results = tuple(await asyncio.gather(*(run_case(case) for case in cases)))
    counts = Counter(result.status for result in results)
    summary = {status: counts[status] for status in ("passed", "degraded", "failed")}
    generated_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    return ConformanceReport(generated_at, summary, results)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT_SECONDS)
    parser.add_argument("--concurrency", type=int, default=DEFAULT_CONCURRENCY)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--fail-on-degraded", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    try:
        cases = load_manifest(args.manifest)
        report = asyncio.run(
            run_conformance(
                cases,
                base_url=args.base_url,
                timeout_seconds=args.timeout,
                concurrency=args.concurrency,
            )
        )
    except (ManifestError, ValueError) as error:
        print(json.dumps({"error": type(error).__name__, "code": "invalid-configuration"}))
        return 2

    rendered = json.dumps(report.to_dict(), indent=2, sort_keys=True)
    if args.output:
        args.output.write_text(rendered + "\n", encoding="utf-8")
    else:
        print(rendered)
    if report.summary["failed"]:
        return 1
    if args.fail_on_degraded and report.summary["degraded"]:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
