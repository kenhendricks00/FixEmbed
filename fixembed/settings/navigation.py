"""Navigation settings views."""

import logging

import discord
from discord import ui

from fixembed.premium.controls import fetch_analytics_summary
from fixembed.translations import get_text

from ..runtime import client, is_guild_premium, reliability_client


class SettingsDropdown(ui.Select):
    def __init__(self, interaction, settings):
        self.source_interaction = interaction
        self.settings = settings
        lang = settings.get("language", "en")
        options = [
            discord.SelectOption(
                label=get_text(lang, "fixembed_settings"),
                description=get_text(lang, "fixembed_activate_deactivate"),
                value="FixEmbed",
                emoji="⚙️",
            ),
            discord.SelectOption(
                label=get_text(lang, "mention_users"),
                description=get_text(lang, "mention_users_toggle"),
                value="Mention Users",
                emoji="🔔",
            ),
            discord.SelectOption(
                label=get_text(lang, "delivery_method"),
                description=get_text(lang, "delivery_method_toggle"),
                value="Delivery Method",
                emoji="📨",
            ),
            discord.SelectOption(
                label=get_text(lang, "service_settings"),
                description=get_text(lang, "service_settings_desc"),
                value="Service Settings",
                emoji="🧩",
            ),
            discord.SelectOption(
                label=get_text(lang, "quality_profile"),
                description=get_text(lang, "quality_profile_desc"),
                value="Quality Profile",
                emoji="🎞️",
            ),
            discord.SelectOption(
                label=get_text(lang, "content_visibility"),
                description=get_text(lang, "content_visibility_desc"),
                value="Content Visibility",
                emoji="👁️",
            ),
            discord.SelectOption(
                label=get_text(lang, "channel_visibility"),
                description=get_text(lang, "channel_visibility_desc"),
                value="Channel Visibility",
                emoji="🛡️",
            ),
            discord.SelectOption(
                label=get_text(lang, "channel_rules"),
                description=get_text(lang, "channel_rules_desc"),
                value="Channel Rules",
                emoji="🧭",
            ),
            discord.SelectOption(
                label=get_text(lang, "reliability_status"),
                description=get_text(lang, "reliability_status_desc"),
                value="Reliability Status",
                emoji="📊",
            ),
            discord.SelectOption(
                label=get_text(lang, "language"),
                description=get_text(lang, "language_desc"),
                value="Language",
                emoji="🌐",
            ),
            discord.SelectOption(
                label=get_text(lang, "debug"),
                description=get_text(lang, "debug_desc"),
                value="Debug",
                emoji="🐞",
            ),
            discord.SelectOption(
                label=get_text(lang, "embed_color"),
                description=get_text(lang, "embed_color_desc"),
                value="Embed Color",
                emoji="💎",
            ),
            discord.SelectOption(
                label="Card Style",
                description="Customize social cards (Premium)",
                value="Card Style",
                emoji="🎛️",
            ),
            discord.SelectOption(
                label="Translation",
                description="Translate every supported platform",
                value="Translation",
                emoji="🌐",
            ),
            discord.SelectOption(
                label="Exclusions",
                description="Ignore members or roles (Premium)",
                value="Exclusions",
                emoji="🛡️",
            ),
            discord.SelectOption(
                label="Analytics",
                description="View private 30-day insights (Premium)",
                value="Analytics",
                emoji="📈",
            ),
            discord.SelectOption(
                label="Footer Branding",
                description="Use this server's identity in social cards (Premium)",
                value="Footer Branding",
                emoji="🏷️",
            ),
        ]
        super().__init__(placeholder=get_text(lang, "choose_option"), options=options)

    async def callback(self, interaction: discord.Interaction):
        from .diagnostics import DebugSettingsView, ReliabilitySettingsView
        from .general import (
            ChannelRulesSettingsView,
            DeliveryMethodSettingsView,
            FixEmbedSettingsView,
            LanguageSettingsView,
            MentionUsersSettingsView,
            QualitySettingsView,
            ServiceSettingsView,
        )
        from .premium import (
            AnalyticsSettingsView,
            CardStyleSettingsView,
            EmbedColorModal,
            ExclusionSettingsView,
            FooterBrandingSettingsView,
            PremiumSettingsView,
            TranslationSettingsView,
        )
        from .visibility import (
            ChannelVisibilitySettingsView,
            ContentVisibilitySettingsView,
        )

        value = self.values[0]
        if value == "Embed Color" and await is_guild_premium(interaction.guild.id):
            await interaction.response.send_modal(
                EmbedColorModal(self.source_interaction, self.settings)
            )
            return
        if value == "Footer Branding":
            premium = await is_guild_premium(interaction.guild.id)
            view = FooterBrandingSettingsView(
                self.source_interaction, self.settings, premium=premium
            )
            await interaction.response.send_message(view=view, ephemeral=True)
            return
        if value == "Translation":
            view = TranslationSettingsView(self.source_interaction, self.settings)
            await interaction.response.send_message(view=view, ephemeral=True)
            return
        premium_pages = {
            "Card Style": CardStyleSettingsView,
            "Exclusions": ExclusionSettingsView,
        }
        if value in premium_pages:
            premium = await is_guild_premium(interaction.guild.id)
            view = premium_pages[value](
                self.source_interaction, self.settings, premium=premium
            )
            await interaction.response.send_message(view=view, ephemeral=True)
            return
        if value == "Analytics":
            premium = await is_guild_premium(interaction.guild.id)
            summary = []
            if premium:
                try:
                    summary = await fetch_analytics_summary(
                        client.db, interaction.guild.id, days=30
                    )
                except Exception as error:
                    logging.warning(
                        "Premium analytics lookup failed for guild %s: %s",
                        interaction.guild.id,
                        error,
                    )
            view = AnalyticsSettingsView(
                self.source_interaction,
                self.settings,
                premium=premium,
                summary=summary,
            )
            await interaction.response.send_message(view=view, ephemeral=True)
            return
        if value == "Reliability Status":
            await interaction.response.defer(ephemeral=True)
            report = await reliability_client.get_report()
            view = ReliabilitySettingsView(
                self.source_interaction,
                self.settings,
                report=report,
            )
            await interaction.followup.send(view=view, ephemeral=True)
            return

        page_types = {
            "FixEmbed": FixEmbedSettingsView,
            "Mention Users": MentionUsersSettingsView,
            "Delivery Method": DeliveryMethodSettingsView,
            "Service Settings": ServiceSettingsView,
            "Quality Profile": QualitySettingsView,
            "Content Visibility": ContentVisibilitySettingsView,
            "Channel Visibility": ChannelVisibilitySettingsView,
            "Channel Rules": ChannelRulesSettingsView,
            "Language": LanguageSettingsView,
            "Debug": DebugSettingsView,
            "Embed Color": PremiumSettingsView,
        }
        view = page_types[value](self.source_interaction, self.settings)
        await interaction.response.send_message(view=view, ephemeral=True)
