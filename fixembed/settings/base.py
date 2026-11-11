"""Base settings views."""

from discord import ui

from fixembed.presentation.components import (
    render_command_layout,
    render_settings_layout,
)

from ..runtime import client, get_guild_color
from ..storage import save_guild_settings


class CommandInfoView(ui.LayoutView):
    """Static Components V2 card for public informational commands."""

    def __init__(
        self, *, title, description, sections, accent_color, footer, controls=()
    ):
        super().__init__(timeout=180)
        render_command_layout(
            self,
            title=title,
            description=description,
            sections=sections,
            controls=controls,
            accent_color=accent_color,
            footer=footer,
        )


class SettingsPageView(ui.LayoutView):
    show_navigation = True

    def __init__(self, interaction, settings, *, timeout=180):
        super().__init__(timeout=timeout)
        self.interaction = interaction
        self.settings = settings

    @property
    def lang(self):
        return self.settings.get("language", "en")

    async def save(self):
        await save_guild_settings(client.db, self.interaction.guild.id, self.settings)

    def render_page(
        self,
        *,
        title,
        description,
        status=None,
        controls=(),
        accent_color=None,
        footer="Settings",
    ):
        rows = list(controls)
        if self.show_navigation:
            from .navigation import SettingsDropdown

            rows.append((SettingsDropdown(self.interaction, self.settings),))
        render_settings_layout(
            self,
            title=title,
            description=description,
            status=status,
            controls=rows,
            accent_color=accent_color or get_guild_color(self.interaction.guild.id),
            footer=footer,
        )
        return self


class SettingsNoticeView(ui.LayoutView):
    def __init__(self, *, title, description, accent_color, footer, controls=()):
        super().__init__(timeout=180)
        render_settings_layout(
            self,
            title=title,
            description=description,
            controls=controls,
            accent_color=accent_color,
            footer=footer,
        )
