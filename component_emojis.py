"""Shared Discord application emojis for Components V2 cards."""

from __future__ import annotations

from typing import Final, Optional


APPLICATION_EMOJI_IDS: Final[dict[str, int]] = {
    "quote": 1526256046786609164,
    "upvote": 1526256000641007616,
    "downvote": 1526255999210487859,
    "coins": 1526369937013342350,
    "bookmark": 1526255813268733962,
    "views": 1526255708683636896,
    "like": 1526255244483362866,
    "repost": 1526255036072591450,
    "comment": 1526254715250282506,
    "x_government": 1527644261208690778,
    "x_premium": 1527644259308798113,
    "x_organization": 1527642128300118129,
}


def application_emoji(name: str) -> str:
    """Return Discord markup for a named FixEmbed application emoji."""
    return f"<:{name}:{APPLICATION_EMOJI_IDS[name]}>"


def format_component_stats(stats: str, platform: Optional[str] = None) -> str:
    """Replace portable Unicode activity icons with FixEmbed application emojis."""
    replacements = (
        ("\U0001f4ac", "comment"),
        ("\U0001f44d", "like"),
        ("\U0001f501", "repost"),
        ("\u2764\ufe0f", "like"),
        ("\u2764", "like"),
        ("\U0001f441\ufe0f", "views"),
        ("\U0001f441", "views"),
        ("\U0001fa99", "coins"),
        ("\U0001f516", "bookmark"),
    )
    rendered = stats
    for portable_icon, emoji_name in replacements:
        rendered = rendered.replace(portable_icon, application_emoji(emoji_name))

    if platform and platform.casefold() == "reddit":
        rendered = rendered.replace(application_emoji("like"), application_emoji("upvote"))
    return rendered
