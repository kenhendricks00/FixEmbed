"""Diagnostics settings views."""

import discord
from discord import ui

from fixembed.delivery_policy import format_delivery_mode_status, resolve_delivery_mode
from fixembed.telemetry.conversion import format_local_conversion_health
from fixembed.telemetry.delivery import format_delivery_health
from fixembed.telemetry.reliability import ReliabilityReport, format_reliability_status
from fixembed.translations import get_text

from ..config import VERSION
from ..delivery import SEND_QUEUE
from ..runtime import (
    client,
    conversion_telemetry,
    delivery_telemetry,
    get_service_display_icon,
    reliability_client,
)
from .base import SettingsPageView


class StaticSettingsView(SettingsPageView):
    def __init__(self, interaction, settings, *, title, description, status, footer):
        super().__init__(interaction, settings)
        self.render_page(
            title=title, description=description, status=status, footer=footer
        )


class ReliabilityRefreshButton(ui.Button):
    def __init__(self, page):
        super().__init__(
            label="Refresh", style=discord.ButtonStyle.secondary, emoji="🔄"
        )
        self.page = page

    async def callback(self, interaction: discord.Interaction):
        await interaction.response.defer()
        self.page.report = await reliability_client.get_report(force=True)
        self.page.render()
        await interaction.edit_original_response(view=self.page)


class ReliabilitySettingsView(SettingsPageView):
    def __init__(self, interaction, settings, *, report: ReliabilityReport):
        super().__init__(interaction, settings)
        self.report = report
        self.render()

    def render(self):
        status = format_reliability_status(
            self.report,
            icon_for_service=lambda service: get_service_display_icon(
                self.interaction.guild, service
            ),
        )
        status += "\n\n" + format_local_conversion_health(
            conversion_telemetry.snapshot(),
            icon_for_service=lambda service: get_service_display_icon(
                self.interaction.guild, service
            ),
        )
        status += "\n\n" + format_delivery_health(
            delivery_telemetry.snapshot(),
            pending=SEND_QUEUE.qsize(),
        )
        controls = (
            (
                ReliabilityRefreshButton(self),
                discord.ui.Button(
                    label="Public status",
                    style=discord.ButtonStyle.link,
                    url="https://fixembed.app/status",
                ),
            ),
        )
        self.render_page(
            title=get_text(self.lang, "reliability_status_title"),
            description=get_text(self.lang, "reliability_status_desc"),
            status=status,
            controls=controls,
            footer="Reliability",
        )


class DebugSettingsView(StaticSettingsView):
    def __init__(self, interaction, settings):
        permissions = interaction.channel.permissions_for(interaction.guild.me)
        checks = (
            ("Read messages", permissions.read_messages),
            ("Send messages", permissions.send_messages),
            ("Embed links", permissions.embed_links),
            ("Manage messages", permissions.manage_messages),
        )
        status = "\n".join(
            f"{'\u2705' if allowed else '\u274c'} {name}" for name, allowed in checks
        )
        delivery_decision = resolve_delivery_mode(
            settings.get("delivery_mode", "suppress"),
            legacy_delete_original=settings.get("delete_original", True),
            can_manage_messages=permissions.manage_messages,
        )
        status += "\n\n" + format_delivery_mode_status(delivery_decision)
        status += f"\n\n**Shard:** {interaction.guild.shard_id + 1}  ·  **Version:** {VERSION}\n**Uptime:** {str(discord.utils.utcnow() - client.launch_time).split('.')[0]}"
        super().__init__(
            interaction,
            settings,
            title="Debug Information",
            description="Permission and runtime diagnostics for this server.",
            status=status,
            footer="Diagnostics",
        )
