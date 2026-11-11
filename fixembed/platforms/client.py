"""Retrieve and validate rich-card metadata from the FixEmbed Worker."""

from collections.abc import Mapping
from typing import Any
from urllib.parse import urlencode

import aiohttp

from fixembed.deployment import embed_api_url

FIXEMBED_API = "https://fixembed.app/api/embed"


async def fetch_embed_payload(
    source_url: str,
    platform: str,
    *,
    language: str | None = None,
    mode: str | None = None,
    renderer: str | None = None,
) -> Mapping[str, Any]:
    query = {"url": source_url}
    query.update(
        {
            key: value
            for key, value in {
                "lang": language,
                "mode": mode,
                "renderer": renderer,
            }.items()
            if value
        }
    )
    timeout = aiohttp.ClientTimeout(total=15)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.get(f"{embed_api_url()}?{urlencode(query)}") as response:
            response.raise_for_status()
            body = await response.json()

    if (
        not isinstance(body, Mapping)
        or not body.get("success")
        or body.get("platform") != platform
    ):
        name = "X" if platform == "twitter" else platform.title()
        raise ValueError(f"FixEmbed did not return {name} metadata")
    payload = body.get("data")
    return payload if isinstance(payload, Mapping) else {}
