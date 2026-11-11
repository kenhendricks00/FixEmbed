"""FixEmbed commands."""

from typing import Optional

import discord
from discord import app_commands

from fixembed.install_links import build_install_controls
from fixembed.atproto import verify_atproto_links
from fixembed.links import extract_supported_links
from fixembed.translations import get_text

from .cards import send_components_v2_links
from .config import VERSION
from .runtime import (
    client,
    get_guild_color,
    get_guild_lang,
    is_guild_premium,
    reliability_client,
)
from .settings import (
    CommandInfoView,
    DebugSettingsView,
    DeliverySelect,
    ReliabilitySettingsView,
    SettingsNoticeView,
    SettingsView,
)
from .storage import (
    bot_settings,
    channel_service_rules,
    channel_states,
    default_settings,
    save_guild_settings,
    set_channel_service_rule,
    update_channel_state,
)


@client.tree.command(
    name="activate",
    description="Activate link processing in this channel or another channel",
)
@app_commands.describe(
    channel="The channel to activate link processing in (leave blank for current channel)"
)
async def activate(
    interaction: discord.Interaction, channel: Optional[discord.TextChannel] = None
):
    if not channel:
        channel = interaction.channel
    lang = get_guild_lang(interaction.guild.id if interaction.guild else None)
    channel_states[channel.id] = True
    await update_channel_state(client.db, channel.id, True)
    view = SettingsNoticeView(
        title=f"{client.user.name} Activated",
        description=get_text(lang, "activated_for", channel=channel.mention),
        accent_color=discord.Color(0x78B159),
        footer="Activation",
    )
    await interaction.response.send_message(view=view, ephemeral=True)


@client.tree.command(
    name="deactivate",
    description="Deactivate link processing in this channel or another channel",
)
@app_commands.describe(
    channel="The channel to deactivate link processing in (leave blank for current channel)"
)
async def deactivate(
    interaction: discord.Interaction, channel: Optional[discord.TextChannel] = None
):
    if not channel:
        channel = interaction.channel
    lang = get_guild_lang(interaction.guild.id if interaction.guild else None)
    channel_states[channel.id] = False
    await update_channel_state(client.db, channel.id, False)
    view = SettingsNoticeView(
        title=f"{client.user.name} Deactivated",
        description=get_text(lang, "deactivated_for", channel=channel.mention),
        accent_color=discord.Color.red(),
        footer="Activation",
    )
    await interaction.response.send_message(view=view, ephemeral=True)


@client.tree.command(name="about", description="Show information about the bot")
@app_commands.allowed_installs(guilds=True, users=True)
@app_commands.allowed_contexts(guilds=True, dms=True, private_channels=True)
async def about(interaction: discord.Interaction):
    guild_id = interaction.guild.id if interaction.guild else None
    lang = get_guild_lang(guild_id)
    view = CommandInfoView(
        title=get_text(lang, "about_title"),
        description=get_text(lang, "about_description"),
        sections=(
            (
                get_text(lang, "quick_links"),
                "Choose **Install to My Account** to use `/fix` and the message command anywhere, "
                "or **Add to Server** for automatic link conversion.\n\n"
                "- [Vote for FixEmbed on Top.gg](https://top.gg/bot/1173820242305224764)\n"
                "- [Source Code (AGPL-3.0-or-later)](https://github.com/kenhendricks00/FixEmbed)\n"
                "- [Join the Support Server](https://discord.gg/QFxTAmtZdn)",
            ),
            (
                "Fallback services & acknowledgements",
                "FixEmbed uses first-party platform data whenever available. When a platform blocks or limits access, it may use:\n\n"
                "- [FxTwitter](https://github.com/FxEmbed/FxEmbed) — X metadata fallback\n"
                "- [VxInstagram](https://github.com/Lainmode/InstagramEmbed-vxinstagram) — Instagram fallback\n"
                "- [KKInstagram](https://kkinstagram.com) — Instagram media fallback\n"
                "- [SnapSave](https://snapsave.app) — Instagram media recovery\n"
                "- [Phixiv](https://github.com/thelaao/phixiv) — Pixiv fallback\n"
                "- [VxBilibili](https://github.com/niconi21/vxBilibili) — Bilibili fallback\n\n"
                "These services are not affiliated with or endorsed by FixEmbed.",
            ),
            (
                "License & Attribution",
                "FixEmbed was created by Kenneth Hendricks and is licensed under "
                "[AGPL-3.0-or-later](https://github.com/kenhendricks00/FixEmbed/blob/main/LICENSE).",
            ),
        ),
        accent_color=get_guild_color(guild_id, discord.Color(0x7289DA)),
        footer=f"About  ·  v{VERSION}",
        controls=build_install_controls(),
    )
    await interaction.response.send_message(view=view)


@client.tree.command(name="help", description="Show all available commands")
@app_commands.allowed_installs(guilds=True, users=True)
@app_commands.allowed_contexts(guilds=True, dms=True, private_channels=True)
async def help_command(interaction: discord.Interaction):
    guild_id = interaction.guild.id if interaction.guild else None
    lang = get_guild_lang(guild_id)
    view = CommandInfoView(
        title=get_text(lang, "help_title"),
        description=get_text(lang, "help_description"),
        sections=(
            (get_text(lang, "fix_links"), get_text(lang, "fix_links_value")),
            (
                get_text(lang, "server_settings"),
                get_text(lang, "server_settings_value"),
            ),
            (get_text(lang, "info"), get_text(lang, "info_value")),
            (
                "💎 " + get_text(lang, "premium_title"),
                get_text(lang, "premium_help_value"),
            ),
            (
                get_text(lang, "supported_services"),
                get_text(lang, "supported_services_value"),
            ),
            (get_text(lang, "tip"), get_text(lang, "tip_value")),
            (
                get_text(lang, "languages_supported"),
                get_text(lang, "languages_supported_value"),
            ),
        ),
        accent_color=get_guild_color(guild_id, discord.Color(0x7289DA)),
        footer=f"Help  ·  v{VERSION}",
        controls=build_install_controls(),
    )
    await interaction.response.send_message(view=view)


@client.tree.command(
    name="invite", description="Install FixEmbed to your account or add it to a server"
)
@app_commands.allowed_installs(guilds=True, users=True)
@app_commands.allowed_contexts(guilds=True, dms=True, private_channels=True)
async def invite(interaction: discord.Interaction):
    guild_id = interaction.guild.id if interaction.guild else None
    view = CommandInfoView(
        title="Install FixEmbed",
        description=(
            "Use FixEmbed anywhere with a personal install, or add it to a server "
            "for automatic link conversion and server settings."
        ),
        sections=(
            (
                "Choose an install",
                "**Install to My Account** — use `/fix` and Apps → Fix Embed in DMs, "
                "group chats, and servers.\n\n"
                "**Add to Server** — automatically convert supported links and unlock "
                "server-wide controls.",
            ),
        ),
        accent_color=get_guild_color(guild_id, discord.Color(0x7289DA)),
        footer=f"Install  ·  v{VERSION}",
        controls=build_install_controls(),
    )
    await interaction.response.send_message(view=view, ephemeral=True)


@client.tree.command(
    name="fix", description="Convert social media links into polished FixEmbed links"
)
@app_commands.describe(link="Paste one or more supported social media links")
@app_commands.allowed_installs(guilds=True, users=True)
@app_commands.allowed_contexts(guilds=True, dms=True, private_channels=True)
async def fix_link(interaction: discord.Interaction, link: str):
    """Convert one or more social media links to Components V2 cards."""
    lang = get_guild_lang(interaction.guild.id if interaction.guild else None)
    links = await verify_atproto_links(extract_supported_links(link))

    if not links:
        await interaction.response.send_message(
            get_text(lang, "no_supported_link"), ephemeral=True
        )
        return

    await send_components_v2_links(interaction, links)


@client.tree.context_menu(name="Fix Embed")
@app_commands.allowed_installs(guilds=True, users=True)
@app_commands.allowed_contexts(guilds=True, dms=True, private_channels=True)
async def fix_embed_context(interaction: discord.Interaction, message: discord.Message):
    """Convert social media links in a message to Components V2 cards."""
    lang = get_guild_lang(interaction.guild.id if interaction.guild else None)
    links = await verify_atproto_links(extract_supported_links(message.content))

    if not links:
        await interaction.response.send_message(
            get_text(lang, "no_links_found"), ephemeral=True
        )
        return

    await send_components_v2_links(interaction, links)


async def debug_info(
    interaction: discord.Interaction, channel: Optional[discord.TextChannel] = None
):
    settings = bot_settings.get(
        interaction.guild.id,
        default_settings(),
    )
    await interaction.response.send_message(
        view=DebugSettingsView(interaction, settings),
        ephemeral=True,
    )


@client.tree.command(name="settings", description="Configure FixEmbed's settings")
@app_commands.guild_only()
@app_commands.default_permissions(manage_guild=True)
@app_commands.checks.has_permissions(manage_guild=True)
async def settings(interaction: discord.Interaction):
    guild_id = interaction.guild.id
    guild_settings = bot_settings.get(
        guild_id,
        default_settings(),
    )
    premium = await is_guild_premium(guild_id)

    await interaction.response.send_message(
        view=SettingsView(interaction, guild_settings, premium=premium),
        ephemeral=True,
    )


@client.tree.command(
    name="delivery",
    description="Power-user alias for delivery mode (also in /settings)",
)
@app_commands.describe(mode="delete, suppress, or reply")
@app_commands.choices(
    mode=[
        app_commands.Choice(name="delete original + send fixed link", value="delete"),
        app_commands.Choice(
            name="suppress original embed + send fixed link", value="suppress"
        ),
        app_commands.Choice(name="keep original + send fixed link", value="reply"),
    ]
)
async def delivery(interaction: discord.Interaction, mode: app_commands.Choice[str]):
    guild_id = interaction.guild.id
    settings_obj = bot_settings.setdefault(
        guild_id,
        default_settings(),
    )
    settings_obj["delivery_mode"] = mode.value
    settings_obj["delete_original"] = mode.value == "delete"
    await save_guild_settings(client.db, guild_id, settings_obj)
    view = SettingsNoticeView(
        title="Delivery Method",
        description=f"✅ Delivery mode set to **{mode.value}**.\n{DeliverySelect.MODES[mode.value]}",
        accent_color=get_guild_color(guild_id),
        footer="Delivery",
    )
    await interaction.response.send_message(view=view, ephemeral=True)


@client.tree.command(
    name="quality",
    description="Power-user alias for quality profile (also in /settings)",
)
@app_commands.describe(profile="fastest, balanced, or highest")
@app_commands.choices(
    profile=[
        app_commands.Choice(name="fastest", value="fastest"),
        app_commands.Choice(name="balanced", value="balanced"),
        app_commands.Choice(name="highest quality", value="highest"),
    ]
)
async def quality(interaction: discord.Interaction, profile: app_commands.Choice[str]):
    guild_id = interaction.guild.id
    settings_obj = bot_settings.setdefault(
        guild_id,
        default_settings(),
    )
    settings_obj["media_quality"] = profile.value
    await save_guild_settings(client.db, guild_id, settings_obj)
    view = SettingsNoticeView(
        title="Media Quality",
        description=f"✅ Media quality profile set to **{profile.value}**.",
        accent_color=get_guild_color(guild_id),
        footer="Media quality",
    )
    await interaction.response.send_message(view=view, ephemeral=True)


@client.tree.command(
    name="rule", description="Power-user alias for channel rules (also in /settings)"
)
@app_commands.describe(
    channel="Target channel", service="Service name", action="on, off, or default"
)
@app_commands.choices(
    service=[
        app_commands.Choice(name="Twitter", value="Twitter"),
        app_commands.Choice(name="Instagram", value="Instagram"),
        app_commands.Choice(name="Reddit", value="Reddit"),
        app_commands.Choice(name="Threads", value="Threads"),
        app_commands.Choice(name="Pixiv", value="Pixiv"),
        app_commands.Choice(name="Bluesky", value="Bluesky"),
        app_commands.Choice(name="Bilibili", value="Bilibili"),
        app_commands.Choice(name="YouTube", value="YouTube"),
        app_commands.Choice(name="Pinterest", value="Pinterest"),
        app_commands.Choice(name="TikTok", value="TikTok"),
        app_commands.Choice(name="Tumblr", value="Tumblr"),
        app_commands.Choice(name="Twitch", value="Twitch"),
        app_commands.Choice(name="DeviantArt", value="DeviantArt"),
    ],
    action=[
        app_commands.Choice(name="force on", value="on"),
        app_commands.Choice(name="force off", value="off"),
        app_commands.Choice(name="default (inherit)", value="default"),
    ],
)
async def rule(
    interaction: discord.Interaction,
    channel: discord.TextChannel,
    service: app_commands.Choice[str],
    action: app_commands.Choice[str],
):
    guild_id = interaction.guild.id
    if action.value == "default":
        await client.db.execute(
            "DELETE FROM channel_service_rules WHERE guild_id = ? AND channel_id = ? AND service = ?",
            (guild_id, channel.id, service.value),
        )
        await client.db.commit()
        channel_service_rules.pop((guild_id, channel.id, service.value), None)
    else:
        await set_channel_service_rule(
            client.db, guild_id, channel.id, service.value, action.value
        )
    view = SettingsNoticeView(
        title="Channel Rule Updated",
        description=f"✅ {channel.mention}  ·  **{service.value}**  →  **{action.value}**",
        accent_color=get_guild_color(guild_id),
        footer="Channel rules",
    )
    await interaction.response.send_message(view=view, ephemeral=True)


@client.tree.command(
    name="status",
    description="Power-user alias for reliability status (also in /settings)",
)
@app_commands.guild_only()
async def status(interaction: discord.Interaction):
    await interaction.response.defer(ephemeral=True)
    settings = bot_settings.get(
        interaction.guild.id,
        default_settings(),
    )
    report = await reliability_client.get_report()
    view = ReliabilitySettingsView(
        interaction,
        settings,
        report=report,
    )
    await interaction.edit_original_response(view=view)


@client.tree.command(
    name="premium", description="View FixEmbed Premium subscription info"
)
@app_commands.allowed_installs(guilds=True, users=True)
@app_commands.allowed_contexts(guilds=True, dms=True, private_channels=True)
async def premium_command(interaction: discord.Interaction):
    lang = get_guild_lang(interaction.guild.id if interaction.guild else None)
    premium = False
    if interaction.guild:
        premium = await is_guild_premium(interaction.guild.id)

    controls = ()
    if client.premium_sku_id and not premium:
        subscribe_button = discord.ui.Button(
            style=discord.ButtonStyle.premium, sku_id=int(client.premium_sku_id)
        )
        controls = ((subscribe_button,),)
    status = (
        get_text(lang, "premium_active")
        if premium
        else get_text(lang, "premium_not_active")
    )
    view = SettingsNoticeView(
        title=get_text(lang, "premium_title"),
        description=f"{get_text(lang, 'premium_description')}\n\n**Status**\n{status}\n\n**{get_text(lang, 'premium_perks_title')}**\n{get_text(lang, 'premium_perks')}",
        accent_color=discord.Color.gold(),
        footer="Premium",
        controls=controls,
    )

    await interaction.response.send_message(view=view, ephemeral=True)
