import asyncio
import unittest
from unittest.mock import AsyncMock, patch

import deviantart_source
from deviantart_source import (
    DeviantArtRateLimitError,
    DeviantArtSourceError,
    _ProfileMetadataParser,
    _fetch_deviantart_oembed_payload,
    _read_oembed_response,
)


SOURCE_URL = (
    "https://www.deviantart.com/kabuvee/art/"
    "Lunar-eclipse-991658138"
)


class FakeContent:
    def __init__(self, *chunks):
        self.chunks = chunks

    async def iter_chunked(self, _size):
        for chunk in self.chunks:
            yield chunk


class FakeResponse:
    def __init__(self, status, *, headers=None, chunks=()):
        self.status = status
        self.headers = headers or {}
        self.content = FakeContent(*chunks)


class DeviantArtSourceResponseTests(unittest.IsolatedAsyncioTestCase):
    async def test_uses_bounded_retry_after_for_rate_limits(self):
        response = FakeResponse(429, headers={"Retry-After": "5000"})

        with self.assertRaises(DeviantArtRateLimitError) as raised:
            await _read_oembed_response(response)

        self.assertEqual(
            raised.exception.retry_after_seconds,
            deviantart_source.MAX_RATE_LIMIT_SECONDS,
        )

    async def test_reads_chunked_oembed_json(self):
        response = FakeResponse(
            200,
            chunks=(b'{"title":', b'"Lunar eclipse"}'),
        )

        payload = await _read_oembed_response(response)

        self.assertEqual(payload["title"], "Lunar eclipse")

    def test_extracts_only_trusted_profile_metadata_later_validated_by_source(self):
        parser = _ProfileMetadataParser()
        parser.feed(
            '<meta property="og:image" content="'
            'https://a.deviantart.net/avatars/k/a/kabuvee.jpg?version=1">'
        )

        self.assertEqual(
            parser.avatar_url,
            "https://a.deviantart.net/avatars/k/a/kabuvee.jpg?version=1",
        )


class DeviantArtSourceCacheTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        deviantart_source._payload_cache.clear()
        deviantart_source._negative_cache.clear()
        deviantart_source._inflight.clear()
        deviantart_source._rate_limited_until = float("-inf")

    async def test_coalesces_concurrent_misses_and_caches_success(self):
        release = asyncio.Event()

        async def request(_source_url):
            await release.wait()
            return {"title": "Lunar eclipse"}

        direct_request = AsyncMock(side_effect=request)
        with patch(
            "deviantart_source._request_deviantart_oembed_payload",
            direct_request,
        ):
            first = asyncio.create_task(
                _fetch_deviantart_oembed_payload(SOURCE_URL)
            )
            second = asyncio.create_task(
                _fetch_deviantart_oembed_payload(SOURCE_URL)
            )
            await asyncio.sleep(0)
            release.set()
            first_payload, second_payload = await asyncio.gather(first, second)
            cached_payload = await _fetch_deviantart_oembed_payload(SOURCE_URL)

        direct_request.assert_awaited_once()
        self.assertIs(first_payload, second_payload)
        self.assertIs(first_payload, cached_payload)

    async def test_negatively_caches_source_failures(self):
        direct_request = AsyncMock(
            side_effect=DeviantArtSourceError("DeviantArt returned 404")
        )
        with patch(
            "deviantart_source._request_deviantart_oembed_payload",
            direct_request,
        ):
            with self.assertRaises(DeviantArtSourceError):
                await _fetch_deviantart_oembed_payload(SOURCE_URL)
            with self.assertRaises(DeviantArtSourceError):
                await _fetch_deviantart_oembed_payload(SOURCE_URL)

        direct_request.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
