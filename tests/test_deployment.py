import os
import unittest
from unittest.mock import AsyncMock, MagicMock, patch
from urllib.parse import urlparse

from fixembed import deployment
from fixembed.platforms.client import fetch_embed_payload


class DeploymentOverrideTests(unittest.TestCase):
    def test_defaults_to_production_when_unset_or_blank(self):
        for environ in ({}, {"FIXEMBED_API_BASE": ""}, {"FIXEMBED_API_BASE": "  "}):
            with self.subTest(environ=environ):
                self.assertEqual(deployment.api_base(environ), "https://fixembed.app")
                self.assertEqual(
                    deployment.embed_api_url(environ), "https://fixembed.app/api/embed"
                )
                self.assertIsNone(deployment.test_guild_id(environ))
                self.assertTrue(deployment.guild_allowed(1195810157112852540, environ))

    def test_accepts_an_https_origin(self):
        environ = {
            "FIXEMBED_API_BASE": "https://FixEmbed-Service-Staging.kenhendricks00.workers.dev/"
        }
        self.assertEqual(
            deployment.embed_api_url(environ),
            "https://fixembed-service-staging.kenhendricks00.workers.dev/api/embed",
        )

    def test_rejects_anything_but_an_https_origin(self):
        for value in (
            "http://staging.example.workers.dev",
            "staging.example.workers.dev",
            "https://user:pass@staging.example.workers.dev",
            "https://staging.example.workers.dev/api/embed",
            "https://staging.example.workers.dev?x=1",
            "https://staging.example.workers.dev#x",
        ):
            with self.subTest(value=value), self.assertRaises(ValueError):
                deployment.api_base({"FIXEMBED_API_BASE": value})

    def test_test_guild_limits_the_instance_to_one_guild(self):
        environ = {"FIXEMBED_TEST_GUILD_ID": " 1195487142219092018 "}
        self.assertEqual(deployment.test_guild_id(environ), 1195487142219092018)
        self.assertTrue(deployment.guild_allowed(1195487142219092018, environ))
        self.assertFalse(deployment.guild_allowed(1195810157112852540, environ))
        with self.assertRaises(ValueError):
            deployment.test_guild_id({"FIXEMBED_TEST_GUILD_ID": "test-server"})


class EmbedClientApiBaseTests(unittest.IsolatedAsyncioTestCase):
    async def requested_url(self, environ):
        response = MagicMock()
        response.json = AsyncMock(
            return_value={"success": True, "platform": "reddit", "data": {}}
        )
        response.__aenter__ = AsyncMock(return_value=response)
        session = MagicMock()
        session.__aenter__ = AsyncMock(return_value=session)
        session.get.return_value = response
        with (
            patch.dict(os.environ, environ, clear=False),
            patch(
                "fixembed.platforms.client.aiohttp.ClientSession", return_value=session
            ),
        ):
            if not environ:
                os.environ.pop("FIXEMBED_API_BASE", None)
            await fetch_embed_payload(
                "https://www.reddit.com/r/aww/s/uTcEAsBqTj", "reddit"
            )
        return urlparse(session.get.call_args.args[0])

    async def test_production_api_is_the_default(self):
        url = await self.requested_url({})
        self.assertEqual((url.scheme, url.netloc, url.path), ("https", "fixembed.app", "/api/embed"))

    async def test_test_instance_reads_metadata_from_the_configured_worker(self):
        url = await self.requested_url(
            {"FIXEMBED_API_BASE": "https://fixembed-service-staging.kenhendricks00.workers.dev"}
        )
        self.assertEqual(
            (url.netloc, url.path),
            ("fixembed-service-staging.kenhendricks00.workers.dev", "/api/embed"),
        )


if __name__ == "__main__":
    unittest.main()
