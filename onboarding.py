"""One-time, owner-only Components V2 onboarding for new guild installs."""

from __future__ import annotations

import discord

from command_components import FIXEMBED_COLOR, FIXEMBED_EMOJI_ID
from embed_footer import escape_component_text


SUPPORT_SERVER_URL = "https://discord.gg/QFxTAmtZdn"


def build_onboarding_view(guild_name: str) -> discord.ui.LayoutView:
    """Build the private install welcome card without a sales prompt."""
    safe_name = escape_component_text(guild_name) or "your server"
    support = discord.ui.Button(
        label="Support Server",
        style=discord.ButtonStyle.link,
        url=SUPPORT_SERVER_URL,
    )
    view = discord.ui.LayoutView(timeout=None)
    view.add_item(
        discord.ui.Container(
            discord.ui.TextDisplay(
                f"## <:fixembed:{FIXEMBED_EMOJI_ID}> Thanks for adding FixEmbed!\n"
                f"FixEmbed is ready to use in **{safe_name}**. Post any supported "
                "social-media link and it will be fixed automatically."
            ),
            discord.ui.TextDisplay(
                "### Recommended setup\n"
                "- Run `/settings` to choose services, delivery behavior, and media quality.\n"
                "- Run `/help` for supported links and commands.\n"
                "- If something is not working, open **Debug** from `/settings` to check permissions."
            ),
            discord.ui.Separator(),
            discord.ui.ActionRow(support),
            discord.ui.Separator(),
            discord.ui.TextDisplay(
                f"-# <:fixembed:{FIXEMBED_EMOJI_ID}> FixEmbed  ·  Ready to embed"
            ),
            accent_color=FIXEMBED_COLOR,
        )
    )
    return view


async def send_onboarding_dm(guild: discord.Guild) -> bool:
    """DM the guild owner, returning False when the owner cannot be reached."""
    owner = guild.owner
    if owner is None:
        try:
            owner = await guild.fetch_member(guild.owner_id)
        except (discord.Forbidden, discord.HTTPException, AttributeError):
            return False
    try:
        await owner.send(view=build_onboarding_view(guild.name))
    except (discord.Forbidden, discord.HTTPException):
        return False
    return True
