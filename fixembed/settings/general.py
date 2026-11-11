"""General settings views."""

import discord
from discord import ui

from fixembed.delivery_policy import format_delivery_mode_status, resolve_delivery_mode
from fixembed.translations import LANGUAGE_NAMES, get_text

from ..config import DEFAULT_ENABLED_SERVICES, LANGUAGE_FLAG_EMOJIS
from ..runtime import client, get_service_display_icon, get_service_select_emoji
from ..storage import (
    channel_service_rules,
    channel_states,
    set_channel_service_rule,
    update_channel_state,
)
from .base import SettingsPageView
from .navigation import SettingsDropdown


class SettingsView(SettingsPageView):
    show_navigation = False

    def __init__(self, interaction, settings, *, premium=False):
        super().__init__(interaction, settings)
        enabled = settings.get("enabled_services", DEFAULT_ENABLED_SERVICES)
        delivery = settings.get("delivery_mode", "suppress")
        quality = settings.get("media_quality", "balanced")
        controls = [(SettingsDropdown(interaction, settings),)]
        if client.premium_sku_id and not premium:
            controls.append(
                (
                    discord.ui.Button(
                        style=discord.ButtonStyle.premium,
                        sku_id=int(client.premium_sku_id),
                    ),
                )
            )
        status = (
            f"**Services:** {len(enabled)}/{len(DEFAULT_ENABLED_SERVICES)} enabled\n"
            f"**Delivery:** {delivery.title()}  ·  **Quality:** {quality.title()}\n"
            f"**Language:** {LANGUAGE_NAMES.get(settings.get('language', 'en'), 'English')}"
        )
        self.render_page(
            title=get_text(self.lang, "settings_title"),
            description=get_text(self.lang, "settings_description"),
            status=status,
            controls=controls,
            footer="Server settings",
        )


class ServiceSelect(ui.Select):
    def __init__(self, view):
        enabled = view.settings.get("enabled_services", DEFAULT_ENABLED_SERVICES)
        options = [
            discord.SelectOption(
                label=service,
                value=service,
                emoji=get_service_select_emoji(view.interaction.guild, service),
                default=service in enabled,
            )
            for service in DEFAULT_ENABLED_SERVICES
        ]
        super().__init__(
            placeholder="Select services to activate...",
            min_values=1,
            max_values=len(options),
            options=options,
        )
        self.page = view

    async def callback(self, interaction):
        self.page.settings["enabled_services"] = list(self.values)
        await self.page.save()
        self.page.render()
        await interaction.response.edit_message(view=self.page)


class ServiceSettingsView(SettingsPageView):
    def __init__(self, interaction, settings):
        super().__init__(interaction, settings)
        self.render()

    def render(self):
        enabled = self.settings.get("enabled_services", DEFAULT_ENABLED_SERVICES)
        status = "\n".join(
            f"{'\U0001f7e2' if service in enabled else '\U0001f534'} {get_service_display_icon(self.interaction.guild, service)} {service}"
            for service in DEFAULT_ENABLED_SERVICES
        )
        self.render_page(
            title=get_text(self.lang, "service_settings"),
            description=get_text(self.lang, "service_settings_desc"),
            status=status,
            controls=((ServiceSelect(self),),),
            footer="Service settings",
        )


class QualitySelect(ui.Select):
    def __init__(self, view):
        current = view.settings.get("media_quality", "balanced")
        options = [
            discord.SelectOption(
                label=get_text(view.lang, f"quality_{value}"),
                value=value,
                description=get_text(view.lang, f"quality_{value}_desc"),
                default=current == value,
            )
            for value in ("fastest", "balanced", "highest")
        ]
        super().__init__(
            placeholder=get_text(view.lang, "quality_select_placeholder"),
            options=options,
        )
        self.page = view

    async def callback(self, interaction):
        self.page.settings["media_quality"] = self.values[0]
        await self.page.save()
        self.page.render()
        await interaction.response.edit_message(view=self.page)


class QualitySettingsView(SettingsPageView):
    def __init__(self, interaction, settings):
        super().__init__(interaction, settings)
        self.render()

    def render(self):
        current = self.settings.get("media_quality", "balanced")
        self.render_page(
            title=get_text(self.lang, "quality_profile"),
            description=get_text(self.lang, "quality_profile_desc"),
            status=get_text(self.lang, "quality_current_profile", profile=current),
            controls=((QualitySelect(self),),),
            footer="Media quality",
        )


class LanguageSelect(ui.Select):
    def __init__(self, view):
        current = view.settings.get("language", "en")
        options = [
            discord.SelectOption(
                label=name,
                value=code,
                emoji=LANGUAGE_FLAG_EMOJIS.get(code, "🌐"),
                default=code == current,
            )
            for code, name in LANGUAGE_NAMES.items()
        ]
        super().__init__(
            placeholder=get_text(current, "language_select"), options=options
        )
        self.page = view

    async def callback(self, interaction):
        self.page.settings["language"] = self.values[0]
        await self.page.save()
        self.page.render()
        await interaction.response.edit_message(view=self.page)


class LanguageSettingsView(SettingsPageView):
    def __init__(self, interaction, settings):
        super().__init__(interaction, settings)
        self.render()

    def render(self):
        current = LANGUAGE_NAMES.get(self.settings.get("language", "en"), "English")
        self.render_page(
            title=get_text(self.lang, "language_title"),
            description=get_text(self.lang, "language_current", language=current),
            controls=((LanguageSelect(self),),),
            footer="Language",
        )


class ToggleSettingsView(SettingsPageView):
    setting_key = ""
    title_key = ""

    def __init__(self, interaction, settings):
        super().__init__(interaction, settings)
        self.render()

    def current_value(self):
        return bool(self.settings.get(self.setting_key, True))

    def description(self):
        status = (
            get_text(self.lang, "activated")
            if self.current_value()
            else get_text(self.lang, "deactivated")
        )
        return get_text(self.lang, "user_mentions_status", status=status)

    def render(self):
        active = self.current_value()
        button = discord.ui.Button(
            label=get_text(self.lang, "activated")
            if active
            else get_text(self.lang, "deactivated"),
            style=discord.ButtonStyle.green if active else discord.ButtonStyle.red,
        )
        button.callback = self.toggle
        self.render_page(
            title=get_text(self.lang, self.title_key),
            description=self.description(),
            controls=((button,),),
            accent_color=discord.Color.green() if active else discord.Color.red(),
        )

    async def toggle(self, interaction):
        self.settings[self.setting_key] = not self.current_value()
        await self.save()
        self.render()
        await interaction.response.edit_message(view=self)


class MentionUsersSettingsView(ToggleSettingsView):
    setting_key = "mention_users"
    title_key = "mention_users_title"


class FixEmbedSettingsView(SettingsPageView):
    def __init__(self, interaction, settings):
        super().__init__(interaction, settings)
        self.activated = all(
            channel_states.get(ch.id, True) for ch in interaction.guild.text_channels
        )
        self.render()

    def render(self):
        status = (
            get_text(self.lang, "activated")
            if self.activated
            else get_text(self.lang, "deactivated")
        )
        button = discord.ui.Button(
            label=status,
            style=discord.ButtonStyle.green
            if self.activated
            else discord.ButtonStyle.red,
        )
        button.callback = self.toggle
        self.render_page(
            title=get_text(self.lang, "fixembed_settings"),
            description=f"**{status}**\n{get_text(self.lang, 'note_apply_changes')}",
            controls=((button,),),
            accent_color=discord.Color.green()
            if self.activated
            else discord.Color.red(),
            footer="Activation",
        )

    async def toggle(self, interaction):
        self.activated = not self.activated
        for channel in self.interaction.guild.text_channels:
            channel_states[channel.id] = self.activated
            await update_channel_state(client.db, channel.id, self.activated)
        self.render()
        await interaction.response.edit_message(view=self)


class DeliverySelect(ui.Select):
    MODES = {
        "delete": "Delete source message, post fixed link",
        "suppress": "Keep message, suppress original embed",
        "reply": "Keep original and post fixed link",
    }

    def __init__(self, view):
        current = view.settings.get("delivery_mode", "suppress")
        options = [
            discord.SelectOption(
                label=name.title(),
                value=name,
                description=description,
                default=current == name,
            )
            for name, description in self.MODES.items()
        ]
        super().__init__(placeholder="Choose delivery mode...", options=options)
        self.page = view

    async def callback(self, interaction):
        mode = self.values[0]
        self.page.settings["delivery_mode"] = mode
        self.page.settings["delete_original"] = mode == "delete"
        await self.page.save()
        self.page.render()
        await interaction.response.edit_message(view=self.page)


class DeliveryMethodSettingsView(SettingsPageView):
    def __init__(self, interaction, settings):
        super().__init__(interaction, settings)
        self.render()

    def render(self):
        mode = self.settings.get("delivery_mode", "suppress")
        permissions = self.interaction.channel.permissions_for(
            self.interaction.guild.me
        )
        delivery_decision = resolve_delivery_mode(
            mode,
            legacy_delete_original=self.settings.get("delete_original", True),
            can_manage_messages=permissions.manage_messages,
        )
        self.render_page(
            title=get_text(self.lang, "delivery_method_title"),
            description=DeliverySelect.MODES[delivery_decision.configured_mode],
            status=format_delivery_mode_status(delivery_decision),
            controls=((DeliverySelect(self),),),
            footer="Delivery",
        )


class RuleSelect(ui.Select):
    def __init__(self, page, kind, options, placeholder):
        super().__init__(placeholder=placeholder, options=options)
        self.page = page
        self.kind = kind

    async def callback(self, interaction):
        value = self.values[0]
        setattr(
            self.page,
            self.kind,
            int(value) if self.kind == "selected_channel_id" else value,
        )
        self.page.render()
        await interaction.response.edit_message(view=self.page)


class ChannelRulesSettingsView(SettingsPageView):
    def __init__(self, interaction, settings):
        super().__init__(interaction, settings)
        self.selected_channel_id = (
            interaction.channel.id if interaction.channel else None
        )
        self.selected_service = "Twitter"
        self.selected_action = "default"
        self.render()

    def render(self):
        channels = self.interaction.guild.text_channels[:25]
        channel_options = [
            discord.SelectOption(
                label=ch.name[:100],
                value=str(ch.id),
                default=ch.id == self.selected_channel_id,
            )
            for ch in channels
        ]
        service_options = [
            discord.SelectOption(
                label=name,
                value=name,
                emoji=get_service_select_emoji(self.interaction.guild, name),
                default=name == self.selected_service,
            )
            for name in DEFAULT_ENABLED_SERVICES
        ]
        action_options = [
            discord.SelectOption(
                label=name.title(), value=name, default=name == self.selected_action
            )
            for name in ("on", "off", "default")
        ]
        apply_button = discord.ui.Button(
            label=get_text(self.lang, "channel_rules_apply"),
            style=discord.ButtonStyle.green,
        )
        apply_button.callback = self.apply_rule
        channel = (
            self.interaction.guild.get_channel(self.selected_channel_id)
            if self.selected_channel_id
            else None
        )
        status = get_text(
            self.lang,
            "channel_rules_selections",
            channel=channel.mention if channel else "None",
            service=self.selected_service,
            action=self.selected_action,
        )
        self.render_page(
            title=get_text(self.lang, "channel_rules_title"),
            description=get_text(self.lang, "channel_rules_instructions"),
            status=status,
            controls=(
                (
                    RuleSelect(
                        self,
                        "selected_channel_id",
                        channel_options,
                        get_text(self.lang, "channel_rules_pick_channel"),
                    ),
                ),
                (
                    RuleSelect(
                        self,
                        "selected_service",
                        service_options,
                        get_text(self.lang, "channel_rules_pick_service"),
                    ),
                ),
                (
                    RuleSelect(
                        self,
                        "selected_action",
                        action_options,
                        get_text(self.lang, "channel_rules_pick_action"),
                    ),
                ),
                (apply_button,),
            ),
            footer="Channel rules",
        )

    async def apply_rule(self, interaction):
        guild_id = self.interaction.guild.id
        key = (guild_id, self.selected_channel_id, self.selected_service)
        if self.selected_action == "default":
            await client.db.execute(
                "DELETE FROM channel_service_rules WHERE guild_id = ? AND channel_id = ? AND service = ?",
                key,
            )
            await client.db.commit()
            channel_service_rules.pop(key, None)
        else:
            await set_channel_service_rule(client.db, *key, self.selected_action)
        self.render()
        await interaction.response.edit_message(view=self)
