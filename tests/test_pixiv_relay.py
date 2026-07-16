import hashlib
import hmac
import time
import unittest
from typing import Any, Mapping

from aiohttp.test_utils import TestClient, TestServer

from pixiv_relay import _content_length_within_limit, create_pixiv_relay_app


class PixivRelayTests(unittest.IsolatedAsyncioTestCase):
    signing_secret = "test-relay-secret-32-bytes-minimum"

    def auth_headers(
        self, artwork_id: str, timestamp: int | None = None
    ) -> dict[str, str]:
        timestamp = str(timestamp if timestamp is not None else int(time.time()))
        signature = hmac.new(
            self.signing_secret.encode("utf-8"),
            f"{timestamp}:pixiv:{artwork_id}".encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        return {
            "X-FixEmbed-Timestamp": timestamp,
            "X-FixEmbed-Authorization": f"v1={signature}",
        }

    async def asyncSetUp(self):
        self.requested: list[str] = []

        async def fetch_json(
            url: str, _headers: Mapping[str, str], _maximum_bytes: int
        ) -> Mapping[str, Any]:
            self.requested.append(url)
            if url.endswith("/ajax/illust/101844438/pages"):
                return {
                    "error": False,
                    "body": [
                        {"urls": {"regular": "https://i.pximg.net/page-1.jpg"}},
                        {"urls": {"regular": "https://evil.example/page-2.jpg"}},
                        {"urls": {"original": "https://i.pximg.net/page-3.png"}},
                    ],
                }
            if url.endswith("/ajax/illust/101844438"):
                return {
                    "error": False,
                    "body": {
                        "illustId": "101844438",
                        "title": "[NovelAI Diffusion] Demon ladies",
                        "description": "<p>Creator notes<br>Second line</p>",
                        "userName": "aion21",
                        "userAccount": "master_nj_aion",
                        "userId": "3565666",
                        "createDate": "2022-10-09T02:47:30+00:00",
                        "commentCount": 12,
                        "likeCount": 345,
                        "viewCount": 6789,
                        "bookmarkCount": 234,
                        "urls": {"regular": "https://i.pximg.net/fallback.jpg"},
                    },
                }
            if url.endswith("/ajax/user/3565666?full=1&lang=en"):
                return {
                    "error": False,
                    "body": {"imageBig": "https://i.pximg.net/avatar_170.jpg"},
                }
            raise AssertionError(f"Unexpected upstream URL: {url}")

        self.app = create_pixiv_relay_app(
            fetch_json=fetch_json,
            signing_secret=self.signing_secret,
        )
        self.client = TestClient(TestServer(self.app))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()

    async def test_health_is_minimal_and_not_cached(self):
        response = await self.client.get("/health")

        self.assertEqual(response.status, 200)
        self.assertEqual(await response.json(), {"ok": True})
        self.assertEqual(response.headers["Cache-Control"], "no-store")

    async def test_rejects_non_numeric_artwork_ids_without_fetching(self):
        response = await self.client.get("/pixiv/http:%2F%2Flocalhost")

        self.assertEqual(response.status, 400)
        self.assertEqual(
            await response.json(),
            {
                "error": {
                    "code": "INVALID_ARTWORK_ID",
                    "message": "Artwork ID must be a positive integer",
                }
            },
        )
        self.assertEqual(self.requested, [])

    async def test_returns_only_normalized_public_pixiv_metadata(self):
        response = await self.client.get(
            "/pixiv/101844438", headers=self.auth_headers("101844438")
        )

        self.assertEqual(response.status, 200)
        self.assertEqual(response.headers["Cache-Control"], "private, max-age=300")
        raw_body = await response.read()
        expected_signature = hmac.new(
            b"test-relay-secret-32-bytes-minimum", raw_body, hashlib.sha256
        ).hexdigest()
        self.assertEqual(
            response.headers["X-FixEmbed-Signature"], f"v1={expected_signature}"
        )
        self.assertEqual(
            await response.json(),
            {
                "version": 1,
                "id": "101844438",
                "title": "[NovelAI Diffusion] Demon ladies",
                "description": "Creator notes\nSecond line",
                "authorName": "aion21",
                "authorHandle": "master_nj_aion",
                "authorId": "3565666",
                "authorAvatar": "https://i.pximg.net/avatar_170.jpg",
                "timestamp": "2022-10-09T02:47:30+00:00",
                "stats": {
                    "comments": 12,
                    "likes": 345,
                    "views": 6789,
                    "bookmarks": 234,
                },
                "images": [
                    "https://i.pximg.net/page-1.jpg",
                    "https://i.pximg.net/page-3.png",
                ],
            },
        )

    async def test_caches_normalized_metadata_by_artwork_id(self):
        headers = self.auth_headers("101844438")
        first = await self.client.get("/pixiv/101844438", headers=headers)
        second = await self.client.get("/pixiv/101844438", headers=headers)

        self.assertEqual(first.status, 200)
        self.assertEqual(second.status, 200)
        self.assertEqual(len(self.requested), 3)

    async def test_rejects_unsigned_and_invalidly_signed_requests(self):
        unsigned = await self.client.get("/pixiv/101844438")
        invalid = await self.client.get(
            "/pixiv/101844438",
            headers={
                "X-FixEmbed-Timestamp": str(int(time.time())),
                "X-FixEmbed-Authorization": f"v1={'0' * 64}",
            },
        )
        stale = await self.client.get(
            "/pixiv/101844438",
            headers=self.auth_headers("101844438", int(time.time()) - 120),
        )

        self.assertEqual(unsigned.status, 401)
        self.assertEqual(invalid.status, 401)
        self.assertEqual(stale.status, 401)
        self.assertEqual(self.requested, [])


class PixivRelayBoundaryTests(unittest.TestCase):
    def test_content_length_parser_rejects_malformed_negative_and_oversized_values(self):
        self.assertTrue(_content_length_within_limit(None, 1024))
        self.assertTrue(_content_length_within_limit("1024", 1024))
        self.assertFalse(_content_length_within_limit("invalid", 1024))
        self.assertFalse(_content_length_within_limit("-1", 1024))
        self.assertFalse(_content_length_within_limit("1025", 1024))


if __name__ == "__main__":
    unittest.main()
