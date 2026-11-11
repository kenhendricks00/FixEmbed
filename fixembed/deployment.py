"""Opt-in overrides for an isolated test instance. Unset, the bot runs as production."""

import os
from collections.abc import Mapping
from urllib.parse import urlsplit

PRODUCTION_API_BASE = "https://fixembed.app"


def api_base(environ: Mapping[str, str] = os.environ) -> str:
    """Return the Worker origin the bot reads card metadata from."""
    raw = (environ.get("FIXEMBED_API_BASE") or "").strip()
    if not raw:
        return PRODUCTION_API_BASE
    parts = urlsplit(raw)
    if (
        parts.scheme != "https"
        or not parts.hostname
        or parts.username
        or parts.password
        or parts.query
        or parts.fragment
        or parts.path not in ("", "/")
    ):
        raise ValueError(
            "FIXEMBED_API_BASE must be an https origin, such as https://example.workers.dev"
        )
    return f"https://{parts.netloc.lower()}"


def embed_api_url(environ: Mapping[str, str] = os.environ) -> str:
    return f"{api_base(environ)}/api/embed"


def test_guild_id(environ: Mapping[str, str] = os.environ) -> int | None:
    """Return the only guild a test instance may act in, or None in production."""
    raw = (environ.get("FIXEMBED_TEST_GUILD_ID") or "").strip()
    if not raw:
        return None
    if not raw.isdigit():
        raise ValueError("FIXEMBED_TEST_GUILD_ID must be a numeric Discord guild ID")
    return int(raw)


def guild_allowed(guild_id: int, environ: Mapping[str, str] = os.environ) -> bool:
    only = test_guild_id(environ)
    return only is None or guild_id == only
