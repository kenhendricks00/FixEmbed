import asyncio
import json
import unittest
from unittest.mock import AsyncMock, patch

import deviantart_embed
from deviantart_embed import (
    DeviantArtRateLimitError,
    DeviantArtSourceError,
    _ProfileMetadataParser,
    _fetch_deviantart_oembed_payload,
    _read_oembed_response,
    _request_deviantart_oembed_payload,
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

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None


class FakeSession:
    def __init__(self, *_args, **_kwargs):
        self.requested_urls = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    def get(self, url, **_kwargs):
        self.requested_urls.append(url)
        if url == deviantart_embed.DEVIANTART_OEMBED_URL:
            payload = {
                "type": "photo",
                "title": "Lunar eclipse",
                "description": "Artwork by Kabuvee.",
                "url": (
                    "https://images-wixmp-ed30a86b8c4ca887773594c2."
                    "wixmp.com/lunar.jpg?token=signed"
                ),
                "author_name": "Kabuvee",
                "author_url": "https://www.deviantart.com/kabuvee",
                "safety": "nonadult",
                "pubdate": "2023-10-31T22:47:46-07:00",
                "community": {
                    "statistics": {
                        "_attributes": {
                            "views": 510000,
                            "favorites": 428,
                            "comments": 11,
                        }
                    }
                },
            }
            return FakeResponse(
                200,
                headers={"Content-Type": "application/json"},
                chunks=(json.dumps(payload).encode(),),
            )
        if url == "https://www.deviantart.com/kabuvee":
            return FakeResponse(
                200,
                headers={"Content-Type": "text/html; charset=utf-8"},
                chunks=(
                    b'<meta property="og:image" content="'
                    b"https://a.deviantart.net/avatars/k/a/"
                    b'kabuvee.jpg?version=1">',
                ),
            )
        return FakeResponse(404)


class DeviantArtSourceResponseTests(unittest.IsolatedAsyncioTestCase):
    async def test_uses_bounded_retry_after_for_rate_limits(self):
        response = FakeResponse(429, headers={"Retry-After": "5000"})

        with self.assertRaises(DeviantArtRateLimitError) as raised:
            await _read_oembed_response(response)

        self.assertEqual(
            raised.exception.retry_after_seconds,
            deviantart_embed.MAX_RATE_LIMIT_SECONDS,
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

    async def test_complete_request_fetches_profile_avatar_and_normalizes_card_data(self):
        with patch("deviantart_embed.aiohttp.ClientSession", FakeSession):
            payload = await _request_deviantart_oembed_payload(SOURCE_URL)

        self.assertEqual(payload["title"], "Lunar eclipse")
        self.assertEqual(payload["authorName"], "Kabuvee")
        self.assertEqual(payload["authorHandle"], "@kabuvee")
        self.assertEqual(
            payload["authorAvatar"],
            "https://a.deviantart.net/avatars/k/a/kabuvee.jpg?version=1",
        )
        self.assertIn("510K views", payload["stats"])
        self.assertEqual(payload["timestamp"], "2023-11-01T05:47:46+00:00")


class DeviantArtSourceCacheTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        deviantart_embed._payload_cache.clear()
        deviantart_embed._negative_cache.clear()
        deviantart_embed._inflight.clear()
        deviantart_embed._rate_limited_until = float("-inf")

    async def test_coalesces_concurrent_misses_and_caches_success(self):
        release = asyncio.Event()

        async def request(_source_url):
            await release.wait()
            return {"title": "Lunar eclipse"}

        direct_request = AsyncMock(side_effect=request)
        with patch(
            "deviantart_embed._request_deviantart_oembed_payload",
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
            "deviantart_embed._request_deviantart_oembed_payload",
            direct_request,
        ):
            with self.assertRaises(DeviantArtSourceError):
                await _fetch_deviantart_oembed_payload(SOURCE_URL)
            with self.assertRaises(DeviantArtSourceError):
                await _fetch_deviantart_oembed_payload(SOURCE_URL)

        direct_request.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
