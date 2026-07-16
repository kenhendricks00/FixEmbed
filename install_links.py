"""Canonical Discord install links and reusable install controls."""

from __future__ import annotations

from urllib.parse import urlencode

import discord


DISCORD_CLIENT_ID = "1173820242305224764"
SERVER_INSTALL_PERMISSIONS = 274878295040
_DISCORD_AUTHORIZE_URL = "https://discord.com/oauth2/authorize"


def _discord_install_url(
    *,
    integration_type: int,
    scope: str | None = None,
    permissions: int | None = None,
) -> str:
    query = {
        "client_id": DISCORD_CLIENT_ID,
        "integration_type": str(integration_type),
    }
    if scope:
        query["scope"] = scope
    if permissions is not None:
        query["permissions"] = str(permissions)
    return f"{_DISCORD_AUTHORIZE_URL}?{urlencode(query)}"


USER_INSTALL_URL = _discord_install_url(
    integration_type=1,
    scope="applications.commands",
)
SERVER_INSTALL_URL = _discord_install_url(
    integration_type=0,
    scope="bot applications.commands",
    permissions=SERVER_INSTALL_PERMISSIONS,
)


def build_install_controls() -> tuple[tuple[discord.ui.Button, discord.ui.Button], ...]:
    """Return the two explicit Discord install choices used by public commands."""
    return (
        (
            discord.ui.Button(
                label="Install to My Account",
                style=discord.ButtonStyle.link,
                url=USER_INSTALL_URL,
                emoji="👤",
            ),
            discord.ui.Button(
                label="Add to Server",
                style=discord.ButtonStyle.link,
                url=SERVER_INSTALL_URL,
                emoji="🏠",
            ),
        ),
    )
