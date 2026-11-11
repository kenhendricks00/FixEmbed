"""Premium settings views."""

import discord
from discord import ui

from fixembed.premium.controls import save_premium_controls
from fixembed.presentation.footer import escape_component_text
from fixembed.translations import LANGUAGE_NAMES, get_text

from ..config import LANGUAGE_FLAG_EMOJIS
from ..runtime import client, is_guild_premium
from ..storage import save_guild_settings
from .base import SettingsNoticeView, SettingsPageView


class PremiumSettingsView(SettingsPageView):
    def __init__(self, interaction, settings):
        super().__init__(interaction, settings)
        controls = ()
        if client.premium_sku_id:
            controls = (
                (
                    discord.ui.Button(
                        style=discord.ButtonStyle.premium,
                        sku_id=int(client.premium_sku_id),
                    ),
                ),
            )
        self.render_page(
            title=get_text(self.lang, "embed_color_title"),
            description=get_text(self.lang, "premium_required"),
            controls=controls,
            accent_color=discord.Color.gold(),
            footer="Premium",
        )


class PremiumControlsPage(SettingsPageView):
    """Base page that rechecks entitlement before every Premium mutation."""

    def __init__(self, interaction, settings, *, premium):
        super().__init__(interaction, settings)
        self.premium = premium

    async def save_premium(self):
        await save_premium_controls(client.db, self.interaction.guild.id, self.settings)

    def render_locked(self, *, title, description):
        controls = ()
        if client.premium_sku_id:
            controls = (
                (
                    discord.ui.Button(
                        style=discord.ButtonStyle.premium,
                        sku_id=int(client.premium_sku_id),
                    ),
                ),
            )
        self.render_page(
            title=title,
            description=description,
            status="This is a FixEmbed Premium feature.",
            controls=controls,
            accent_color=discord.Color.gold(),
            footer="Premium",
        )

    async def confirm_premium(self, interaction):
        self.premium = await is_guild_premium(interaction.guild.id)
        if self.premium:
            return True
        self.render()
        await interaction.response.edit_message(view=self)
        return False


class CaptionModeSelect(ui.Select):
    def __init__(self, page):
        current = page.settings.get("card_caption_mode", "full")
        super().__init__(
            placeholder="Choose caption length...",
            options=[
                discord.SelectOption(
                    label="Full captions", value="full", default=current == "full"
                ),
                discord.SelectOption(
                    label="Compact captions",
                    description="Trim captions after 280 characters",
                    value="compact",
                    default=current == "compact",
                ),
            ],
        )
        self.page = page

    async def callback(self, interaction):
        if not await self.page.confirm_premium(interaction):
            return
        self.page.settings["card_caption_mode"] = self.values[0]
        await self.page.save_premium()
        self.page.render()
        await interaction.response.edit_message(view=self.page)


class CardStyleSettingsView(PremiumControlsPage):
    def __init__(self, interaction, settings, *, premium):
        super().__init__(interaction, settings, premium=premium)
        self.render()

    def render(self):
        if not self.premium:
            self.render_locked(
                title="Social Card Style",
                description="Control stats, hashtags, caption length, and card color.",
            )
            return
        show_stats = bool(self.settings.get("card_show_stats", True))
        show_hashtags = bool(self.settings.get("card_show_hashtags", True))
        stats = discord.ui.Button(
            label=f"Stats: {'Shown' if show_stats else 'Hidden'}",
            style=discord.ButtonStyle.green
            if show_stats
            else discord.ButtonStyle.secondary,
        )
        hashtags = discord.ui.Button(
            label=f"Hashtags: {'Shown' if show_hashtags else 'Hidden'}",
            style=discord.ButtonStyle.green
            if show_hashtags
            else discord.ButtonStyle.secondary,
        )
        stats.callback = self.toggle_stats
        hashtags.callback = self.toggle_hashtags
        color = self.settings.get("embed_color") or "Platform default"
        self.render_page(
            title="Social Card Style",
            description="Choose a consistent presentation for every supported Components V2 card.",
            status=(
                f"**Accent:** {color}\n"
                f"**Captions:** {self.settings.get('card_caption_mode', 'full').title()}\n"
                "-# Media playback and quality are never paywalled."
            ),
            controls=((stats, hashtags), (CaptionModeSelect(self),)),
            accent_color=discord.Color.gold(),
            footer="Premium card style",
        )

    async def toggle_stats(self, interaction):
        if not await self.confirm_premium(interaction):
            return
        self.settings["card_show_stats"] = not bool(
            self.settings.get("card_show_stats", True)
        )
        await self.save_premium()
        self.render()
        await interaction.response.edit_message(view=self)

    async def toggle_hashtags(self, interaction):
        if not await self.confirm_premium(interaction):
            return
        self.settings["card_show_hashtags"] = not bool(
            self.settings.get("card_show_hashtags", True)
        )
        await self.save_premium()
        self.render()
        await interaction.response.edit_message(view=self)


class TranslationLanguageSelect(ui.Select):
    def __init__(self, page):
        current = page.settings.get("translation_language")
        options = [
            discord.SelectOption(
                label="Original language", value="none", default=current is None
            )
        ]
        options.extend(
            discord.SelectOption(
                label=name,
                value=code,
                emoji=LANGUAGE_FLAG_EMOJIS.get(code, "🌐"),
                default=code == current,
            )
            for code, name in LANGUAGE_NAMES.items()
        )
        super().__init__(
            placeholder="Choose the default translation language...", options=options
        )
        self.page = page

    async def callback(self, interaction):
        self.page.settings["translation_language"] = (
            None if self.values[0] == "none" else self.values[0]
        )
        await self.page.save_translation()
        self.page.render()
        await interaction.response.edit_message(view=self.page)


class TranslationSettingsView(SettingsPageView):
    def __init__(self, interaction, settings):
        super().__init__(interaction, settings)
        self.render()

    async def save_translation(self):
        await save_premium_controls(client.db, self.interaction.guild.id, self.settings)

    def render(self):
        current = self.settings.get("translation_language")
        label = LANGUAGE_NAMES.get(current, "Original language")
        self.render_page(
            title="Default Translation",
            description="Translate posts from every supported platform. Explicit link options take priority.",
            status=f"**Default:** {label}",
            controls=((TranslationLanguageSelect(self),),),
            accent_color=discord.Color.blurple(),
            footer="Translation",
        )


class IgnoredUsersSelect(ui.UserSelect):
    def __init__(self, page):
        super().__init__(
            placeholder="Choose members to ignore...", min_values=0, max_values=25
        )
        self.page = page

    async def callback(self, interaction):
        if not await self.page.confirm_premium(interaction):
            return
        self.page.settings["ignored_user_ids"] = [value.id for value in self.values]
        await self.page.save_premium()
        self.page.render()
        await interaction.response.edit_message(view=self.page)


class IgnoredRolesSelect(ui.RoleSelect):
    def __init__(self, page):
        super().__init__(
            placeholder="Choose roles to ignore...", min_values=0, max_values=25
        )
        self.page = page

    async def callback(self, interaction):
        if not await self.page.confirm_premium(interaction):
            return
        self.page.settings["ignored_role_ids"] = [value.id for value in self.values]
        await self.page.save_premium()
        self.page.render()
        await interaction.response.edit_message(view=self.page)


class ExclusionSettingsView(PremiumControlsPage):
    def __init__(self, interaction, settings, *, premium):
        super().__init__(interaction, settings, premium=premium)
        self.render()

    def render(self):
        if not self.premium:
            self.render_locked(
                title="Automatic Processing Exclusions",
                description="Keep selected members or roles out of automatic link processing.",
            )
            return
        user_ids = self.settings.get("ignored_user_ids", [])
        role_ids = self.settings.get("ignored_role_ids", [])
        self.render_page(
            title="Automatic Processing Exclusions",
            description="Links from selected members, or anyone with a selected role, are left untouched.",
            status=(
                f"**Ignored members:** {len(user_ids)}/25\n"
                f"**Ignored roles:** {len(role_ids)}/25"
            ),
            controls=((IgnoredUsersSelect(self),), (IgnoredRolesSelect(self),)),
            accent_color=discord.Color.gold(),
            footer="Premium exclusions",
        )


class AnalyticsSettingsView(PremiumControlsPage):
    def __init__(self, interaction, settings, *, premium, summary):
        super().__init__(interaction, settings, premium=premium)
        self.summary = summary
        self.render()

    def render(self):
        if not self.premium:
            self.render_locked(
                title="Private Analytics",
                description="See aggregate link-processing outcomes from the last 30 days.",
            )
            return
        total_rich = sum(item["rich_count"] for item in self.summary)
        total_fallback = sum(item["fallback_count"] for item in self.summary)
        lines = [
            f"**{escape_component_text(item['service'])}:** "
            f"{item['rich_count']} rich · {item['fallback_count']} fallback"
            for item in self.summary
        ]
        status = (
            f"**Rich cards:** {total_rich}  ·  **Link fallbacks:** {total_fallback}\n\n"
            + ("\n".join(lines) if lines else "No activity recorded yet.")
            + "\n\n-# Stores daily counts only—never message text, links, or member identities."
        )
        self.render_page(
            title="Private 30-Day Analytics",
            description="Understand platform usage and fallback reliability without tracking content.",
            status=status,
            accent_color=discord.Color.gold(),
            footer="Premium analytics · 90-day aggregate retention",
        )


class FooterEmojiSelect(ui.Select):
    def __init__(self, page):
        current_id = page.settings.get("footer_emoji_id")
        options = [
            discord.SelectOption(
                label="No server emoji",
                value="none",
                default=current_id is None,
            )
        ]
        options.extend(
            discord.SelectOption(
                label=emoji.name[:100],
                value=str(emoji.id),
                emoji=emoji,
                default=str(emoji.id) == str(current_id),
            )
            for emoji in page.interaction.guild.emojis[:24]
        )
        super().__init__(
            placeholder="Choose an optional server emoji...", options=options
        )
        self.page = page

    async def callback(self, interaction):
        if not await is_guild_premium(interaction.guild.id):
            self.page.premium = False
            self.page.render()
            await interaction.response.edit_message(view=self.page)
            return
        value = self.values[0]
        if value == "none":
            emoji_id = None
        else:
            try:
                emoji_id = int(value)
            except ValueError:
                emoji_id = None
            if discord.utils.get(interaction.guild.emojis, id=emoji_id) is None:
                await interaction.response.send_message(
                    "That emoji is no longer available in this server.", ephemeral=True
                )
                return
        self.page.settings["footer_emoji_id"] = emoji_id
        await self.page.save()
        self.page.render()
        await interaction.response.edit_message(view=self.page)


class FooterBrandingSettingsView(SettingsPageView):
    def __init__(self, interaction, settings, *, premium):
        super().__init__(interaction, settings)
        self.premium = premium
        self.render()

    def render(self):
        if not self.premium:
            controls = ()
            if client.premium_sku_id:
                controls = (
                    (
                        discord.ui.Button(
                            style=discord.ButtonStyle.premium,
                            sku_id=int(client.premium_sku_id),
                        ),
                    ),
                )
            self.render_page(
                title="Custom Footer Branding",
                description="Use your server name and an optional server emoji on social cards.",
                status="This is a FixEmbed Premium feature.",
                controls=controls,
                accent_color=discord.Color.gold(),
                footer="Premium",
            )
            return

        enabled = bool(self.settings.get("footer_branding_enabled", False))
        selected = discord.utils.get(
            self.interaction.guild.emojis,
            id=self.settings.get("footer_emoji_id"),
        )
        safe_name = escape_component_text(self.interaction.guild.name)
        toggle = discord.ui.Button(
            label="Enabled" if enabled else "Disabled",
            style=discord.ButtonStyle.green
            if enabled
            else discord.ButtonStyle.secondary,
        )
        toggle.callback = self.toggle
        status = (
            f"**Status:** {'Enabled' if enabled else 'Disabled'}\n"
            f"**Footer identity:** {str(selected) + ' ' if selected else ''}{safe_name}\n"
            "-# Social cards retain a subtle via FixEmbed attribution."
        )
        controls = [(toggle,)]
        if self.interaction.guild.emojis:
            controls.append((FooterEmojiSelect(self),))
        self.render_page(
            title="Custom Footer Branding",
            description="Brand social cards with this server's current name and an optional emoji.",
            status=status,
            controls=controls,
            accent_color=discord.Color.gold(),
            footer="Premium branding",
        )

    async def toggle(self, interaction):
        if not await is_guild_premium(interaction.guild.id):
            self.premium = False
            self.render()
            await interaction.response.edit_message(view=self)
            return
        self.settings["footer_branding_enabled"] = not bool(
            self.settings.get("footer_branding_enabled", False)
        )
        await self.save()
        self.render()
        await interaction.response.edit_message(view=self)


class EmbedColorModal(ui.Modal, title="Set Embed Color"):
    color_input = ui.TextInput(
        label="Hex Color Code",
        placeholder="#FF5733 or 'reset'",
        required=True,
        max_length=7,
    )

    def __init__(self, interaction, settings):
        super().__init__()
        self.original_interaction = interaction
        self.settings = settings

    async def on_submit(self, interaction: discord.Interaction):
        lang = self.settings.get("language", "en")
        value = self.color_input.value.strip()
        guild_id = self.original_interaction.guild.id

        if value.lower() == "reset":
            self.settings["embed_color"] = None
            await save_guild_settings(client.db, guild_id, self.settings)
            view = SettingsNoticeView(
                title=get_text(lang, "embed_color_title"),
                description=get_text(lang, "embed_color_reset"),
                accent_color=discord.Color.green(),
                footer="Embed color",
            )
            await interaction.response.send_message(view=view, ephemeral=True)
        else:
            # Validate hex color
            hex_color = value.lstrip("#")
            if len(hex_color) == 6:
                try:
                    int(hex_color, 16)
                    color_str = f"#{hex_color.upper()}"
                    self.settings["embed_color"] = color_str
                    await save_guild_settings(client.db, guild_id, self.settings)
                    view = SettingsNoticeView(
                        title=get_text(lang, "embed_color_title"),
                        description=get_text(lang, "embed_color_set", color=color_str),
                        accent_color=discord.Color(int(hex_color, 16)),
                        footer="Embed color",
                    )
                    await interaction.response.send_message(view=view, ephemeral=True)
                    return
                except ValueError:
                    pass
            view = SettingsNoticeView(
                title=get_text(lang, "embed_color_title"),
                description=get_text(lang, "embed_color_invalid"),
                accent_color=discord.Color.red(),
                footer="Embed color",
            )
            await interaction.response.send_message(view=view, ephemeral=True)
