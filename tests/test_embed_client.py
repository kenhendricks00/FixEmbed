import unittest
from unittest.mock import AsyncMock, MagicMock, patch
from urllib.parse import parse_qs, urlparse

from fixembed.platforms.client import fetch_embed_payload


class EmbedClientTests(unittest.IsolatedAsyncioTestCase):
    async def fetch(self, body, **options):
        response = MagicMock()
        response.json = AsyncMock(return_value=body)
        response.__aenter__ = AsyncMock(return_value=response)
        session = MagicMock()
        session.__aenter__ = AsyncMock(return_value=session)
        session.get.return_value = response
        with patch(
            'fixembed.platforms.client.aiohttp.ClientSession', return_value=session
        ) as create:
            result = await fetch_embed_payload(
                "https://example.com/post?a=one&b=two", "twitter", **options
            )
        self.assertEqual(create.call_args.kwargs["timeout"].total, 15)
        response.raise_for_status.assert_called_once()
        return result, parse_qs(urlparse(session.get.call_args.args[0]).query)

    async def test_encodes_source_url_and_preserves_all_rendering_options(self):
        payload = {"title": "Post"}
        result, query = await self.fetch(
            {"success": True, "platform": "twitter", "data": payload},
            language="ja",
            mode="gallery",
            renderer="components-v2",
        )
        self.assertEqual(result, payload)
        self.assertEqual(
            query,
            {
                "url": ["https://example.com/post?a=one&b=two"],
                "lang": ["ja"],
                "mode": ["gallery"],
                "renderer": ["components-v2"],
            },
        )

    async def test_omits_unspecified_options(self):
        _, query = await self.fetch(
            {"success": True, "platform": "twitter", "data": {}}
        )
        self.assertEqual(set(query), {"url"})

    async def test_rejects_failed_wrong_platform_and_non_object_responses(self):
        for body in (
            {"success": False},
            {"success": True, "platform": "reddit"},
            None,
            [],
        ):
            with (
                self.subTest(body=body),
                self.assertRaisesRegex(ValueError, "X metadata"),
            ):
                await self.fetch(body)

    async def test_missing_or_malformed_payload_degrades_to_an_empty_mapping(self):
        for data in (None, [], "invalid"):
            with self.subTest(data=data):
                result, _ = await self.fetch(
                    {"success": True, "platform": "twitter", "data": data}
                )
                self.assertEqual(result, {})
