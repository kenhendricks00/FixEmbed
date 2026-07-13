"""Reusable Discord Components V2 composition for FixEmbed settings."""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from typing import Any, Optional

import discord


FIXEMBED_COLOR = 0x5865F2
FIXEMBED_EMOJI_ID = 1525580543503106148


def render_settings_layout(
    view: discord.ui.LayoutView,
    *,
    title: str,
    description: str,
    status: Optional[str] = None,
    controls: Iterable[Sequence[discord.ui.Item[Any]]] = (),
    accent_color: int | discord.Color = FIXEMBED_COLOR,
    footer: str = "Settings",
) -> discord.ui.LayoutView:
    """Replace a settings view with one branded Components V2 container."""
    children: list[discord.ui.Item[Any]] = [
        discord.ui.TextDisplay(f"## {title}\n{description}".strip())
    ]
    if status:
        children.append(discord.ui.TextDisplay(status))

    rows = [tuple(row) for row in controls if row]
    if rows:
        children.append(discord.ui.Separator())
        children.extend(discord.ui.ActionRow(*row) for row in rows)

    children.extend(
        (
            discord.ui.Separator(),
            discord.ui.TextDisplay(
                f"-# <:fixembed:{FIXEMBED_EMOJI_ID}> FixEmbed  ·  {footer}"
            ),
        )
    )

    view.clear_items()
    view.add_item(discord.ui.Container(*children, accent_color=accent_color))
    return view
