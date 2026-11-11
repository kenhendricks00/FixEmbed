"""Visibility settings views."""

import discord
from discord import ui

from fixembed.content_visibility import (
    is_nsfw_channel,
    resolve_content_visibility,
    set_channel_visibility_override,
)
from fixembed.translations import get_text

from ..runtime import client
from ..storage import channel_visibility_overrides
from .base import SettingsPageView


class ContentVisibilitySettingsView(SettingsPageView):
    def __init__(self, interaction, settings):
        super().__init__(interaction, settings)
        self.render()

    def render(self):
        show_nsfw = bool(self.settings.get("show_nsfw", False))
        show_spoilers = bool(self.settings.get("show_spoilers", False))
        nsfw_button = discord.ui.Button(
            label=get_text(
                self.lang,
                "content_visibility_hide_nsfw"
                if show_nsfw
                else "content_visibility_show_nsfw",
            ),
            style=discord.ButtonStyle.green
            if show_nsfw
            else discord.ButtonStyle.secondary,
        )
        nsfw_button.callback = self.toggle_nsfw
        spoilers_button = discord.ui.Button(
            label=get_text(
                self.lang,
                "content_visibility_hide_spoilers"
                if show_spoilers
                else "content_visibility_show_spoilers",
            ),
            style=discord.ButtonStyle.green
            if show_spoilers
            else discord.ButtonStyle.secondary,
        )
        spoilers_button.callback = self.toggle_spoilers
        self.render_page(
            title=get_text(self.lang, "content_visibility_title"),
            description=get_text(self.lang, "content_visibility_instructions"),
            status=get_text(
                self.lang,
                "content_visibility_status",
                nsfw_status="✅" if show_nsfw else "❌",
                spoiler_status="✅" if show_spoilers else "❌",
            ),
            controls=((nsfw_button, spoilers_button),),
            footer="Content visibility",
        )

    async def toggle_nsfw(self, interaction):
        self.settings["show_nsfw"] = not bool(self.settings.get("show_nsfw", False))
        await self.save()
        self.render()
        await interaction.response.edit_message(view=self)

    async def toggle_spoilers(self, interaction):
        self.settings["show_spoilers"] = not bool(
            self.settings.get("show_spoilers", False)
        )
        await self.save()
        self.render()
        await interaction.response.edit_message(view=self)


class ChannelVisibilityChannelSelect(ui.ChannelSelect):
    def __init__(self, page):
        super().__init__(
            placeholder=get_text(page.lang, "channel_visibility_pick_channel"),
            channel_types=[
                discord.ChannelType.text,
                discord.ChannelType.news,
                discord.ChannelType.voice,
                discord.ChannelType.stage_voice,
                discord.ChannelType.forum,
                discord.ChannelType.media,
                discord.ChannelType.news_thread,
                discord.ChannelType.public_thread,
                discord.ChannelType.private_thread,
            ],
            min_values=1,
            max_values=1,
            default_values=(
                [page.selected_channel] if page.selected_channel is not None else []
            ),
        )
        self.page = page

    async def callback(self, interaction):
        self.page.selected_channel_id = self.values[0].id
        self.page.load_selected_override()
        self.page.render()
        await interaction.response.edit_message(view=self.page)


class ChannelVisibilityValueSelect(ui.Select):
    VALUES = {
        "inherit": None,
        "show": True,
        "hide": False,
    }

    def __init__(self, page, setting_name, placeholder_key):
        current = getattr(page, setting_name)
        options = [
            discord.SelectOption(
                label=get_text(page.lang, f"channel_visibility_{value}"),
                value=value,
                default=resolved is current,
            )
            for value, resolved in self.VALUES.items()
        ]
        super().__init__(
            placeholder=get_text(page.lang, placeholder_key),
            options=options,
            disabled=page.selected_channel is None,
        )
        self.page = page
        self.setting_name = setting_name

    async def callback(self, interaction):
        setattr(self.page, self.setting_name, self.VALUES[self.values[0]])
        self.page.render()
        await interaction.response.edit_message(view=self.page)


class ChannelVisibilitySettingsView(SettingsPageView):
    def __init__(self, interaction, settings):
        super().__init__(interaction, settings)
        self.selected_channel_id = getattr(interaction.channel, "id", None)
        self.show_nsfw = None
        self.show_spoilers = None
        self.load_selected_override()
        self.render()

    @property
    def selected_channel(self):
        if self.selected_channel_id is None:
            return None
        return self.interaction.guild.get_channel_or_thread(self.selected_channel_id)

    def load_selected_override(self):
        if self.selected_channel_id is None:
            self.show_nsfw = None
            self.show_spoilers = None
            return
        override = channel_visibility_overrides.get(
            (self.interaction.guild.id, self.selected_channel_id),
            {},
        )
        self.show_nsfw = override.get("show_nsfw")
        self.show_spoilers = override.get("show_spoilers")

    @staticmethod
    def override_label(value):
        if value is True:
            return "Show"
        if value is False:
            return "Hide"
        return "Inherit"

    def render(self):
        channel = self.selected_channel
        draft_override = {
            "show_nsfw": self.show_nsfw,
            "show_spoilers": self.show_spoilers,
        }
        effective = resolve_content_visibility(
            self.settings,
            draft_override,
            channel_is_nsfw=is_nsfw_channel(channel),
        )
        apply_button = discord.ui.Button(
            label=get_text(self.lang, "channel_visibility_apply"),
            style=discord.ButtonStyle.green,
            disabled=channel is None,
        )
        apply_button.callback = self.apply_override
        self.render_page(
            title=get_text(self.lang, "channel_visibility_title"),
            description=get_text(self.lang, "channel_visibility_instructions"),
            status=get_text(
                self.lang,
                "channel_visibility_status",
                channel=(
                    channel.mention
                    if channel is not None
                    else get_text(self.lang, "channel_visibility_unavailable")
                ),
                nsfw_override=self.override_label(self.show_nsfw),
                nsfw_effective=self.override_label(effective.show_nsfw),
                spoiler_override=self.override_label(self.show_spoilers),
                spoiler_effective=self.override_label(effective.show_spoilers),
            ),
            controls=(
                (ChannelVisibilityChannelSelect(self),),
                (
                    ChannelVisibilityValueSelect(
                        self,
                        "show_nsfw",
                        "channel_visibility_nsfw",
                    ),
                ),
                (
                    ChannelVisibilityValueSelect(
                        self,
                        "show_spoilers",
                        "channel_visibility_spoilers",
                    ),
                ),
                (apply_button,),
            ),
            footer="Channel visibility",
        )

    async def apply_override(self, interaction):
        if self.selected_channel is None:
            self.render()
            await interaction.response.edit_message(view=self)
            return
        key = (self.interaction.guild.id, self.selected_channel_id)
        await set_channel_visibility_override(
            client.db,
            guild_id=key[0],
            channel_id=key[1],
            show_nsfw=self.show_nsfw,
            show_spoilers=self.show_spoilers,
        )
        if self.show_nsfw is None and self.show_spoilers is None:
            channel_visibility_overrides.pop(key, None)
        else:
            channel_visibility_overrides[key] = {
                "show_nsfw": self.show_nsfw,
                "show_spoilers": self.show_spoilers,
            }
        self.render()
        await interaction.response.edit_message(view=self)
