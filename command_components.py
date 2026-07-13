"""Reusable Discord Components V2 composition for bot commands."""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from typing import Any

import discord


FIXEMBED_COLOR = 0x5865F2
FIXEMBED_EMOJI_ID = 1525580543503106148


def _render_branded_layout(
    view: discord.ui.LayoutView,
    *,
    title: str,
    description: str,
    content_blocks: Iterable[str] = (),
    controls: Iterable[Sequence[discord.ui.Item[Any]]] = (),
    accent_color: int | discord.Color = FIXEMBED_COLOR,
    footer: str,
) -> discord.ui.LayoutView:
    """Replace a view with one branded Components V2 container."""
    children: list[discord.ui.Item[Any]] = [
        discord.ui.TextDisplay(f"## {title}\n{description}".strip())
    ]

    children.extend(
        discord.ui.TextDisplay(block)
        for block in (str(item).strip() for item in content_blocks)
        if block
    )

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


def render_command_layout(
    view: discord.ui.LayoutView,
    *,
    title: str,
    description: str,
    sections: Iterable[tuple[str, str]] = (),
    controls: Iterable[Sequence[discord.ui.Item[Any]]] = (),
    accent_color: int | discord.Color = FIXEMBED_COLOR,
    footer: str,
) -> discord.ui.LayoutView:
    """Render a structured command card with titled content sections."""
    content_blocks = []
    for heading, content in sections:
        heading = str(heading).strip()
        content = str(content).strip()
        if heading and content:
            content_blocks.append(f"### {heading}\n{content}")

    return _render_branded_layout(
        view,
        title=title,
        description=description,
        content_blocks=content_blocks,
        controls=controls,
        accent_color=accent_color,
        footer=footer,
    )


def render_settings_layout(
    view: discord.ui.LayoutView,
    *,
    title: str,
    description: str,
    status: str | None = None,
    controls: Iterable[Sequence[discord.ui.Item[Any]]] = (),
    accent_color: int | discord.Color = FIXEMBED_COLOR,
    footer: str = "Settings",
) -> discord.ui.LayoutView:
    """Render a branded settings card with an optional status block."""
    return _render_branded_layout(
        view,
        title=title,
        description=description,
        content_blocks=(status,) if status else (),
        controls=controls,
        accent_color=accent_color,
        footer=footer,
    )
