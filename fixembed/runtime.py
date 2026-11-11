"""FixEmbed runtime."""

import asyncio
import logging
from contextlib import AsyncExitStack
from typing import Optional

import discord
from discord.ext import commands

from fixembed.content_visibility import (
    channel_visibility_override,
    is_nsfw_channel,
    resolve_content_visibility,
)
from fixembed.presentation.footer import FooterBranding
from fixembed.telemetry.conversion import ConversionTelemetry
from fixembed.telemetry.delivery import DeliveryTelemetry
from fixembed.telemetry.reliability import (
    ReliabilityClient,
    probe_deviantart_bot_health,
)

from .config import SERVICE_EMOJI_FALLBACKS, SERVICE_EMOJI_IDS, SERVICE_NAMES
from .storage import bot_settings, channel_visibility_overrides


def get_custom_service_emoji(guild: Optional[discord.Guild], service: str):
    """Return a custom emoji for a service (guild/client/id lookup), if available."""
    candidates = (service.lower(), service.replace(" ", "").lower())

    if guild is not None:
        for candidate in candidates:
            emoji = discord.utils.get(guild.emojis, name=candidate)
            if emoji:
                return emoji

    # Fallback by hardcoded emoji IDs (supports cases where emojis are not in guild.emojis)
    emoji_id = SERVICE_EMOJI_IDS.get(service)
    if emoji_id:
        if guild is not None:
            emoji = guild.get_emoji(emoji_id)
            if emoji:
                return emoji
        emoji = client.get_emoji(emoji_id)
        if emoji:
            return emoji

        candidate_name = service.lower()
        return discord.PartialEmoji(name=candidate_name, id=emoji_id)

    return None


def get_service_select_emoji(guild: Optional[discord.Guild], service: str):
    """Emoji object/char for select options with fallback when custom emojis are missing."""
    custom = get_custom_service_emoji(guild, service)
    return custom or SERVICE_EMOJI_FALLBACKS.get(service, "🔗")


def get_service_display_icon(guild: Optional[discord.Guild], service: str) -> str:
    """String icon for embeds/text with fallback when custom emojis are missing."""
    custom = get_custom_service_emoji(guild, service)
    return str(custom) if custom else SERVICE_EMOJI_FALLBACKS.get(service, "🔗")


class FixEmbedBot(commands.AutoShardedBot):
    """Own the database, background tasks, and optional media relay lifetime."""

    premium_sku_id = None
    db = None
    pixiv_relay_runner = None
    send_task = None
    initialized = False

    async def close(self):
        from .delivery import outbound
        from .events import change_status

        change_status.cancel()
        async with AsyncExitStack() as cleanup:
            cleanup.push_async_callback(super().close)
            if self.db is not None:
                cleanup.push_async_callback(self.db.close)
                self.db = None
            if self.pixiv_relay_runner is not None:
                cleanup.push_async_callback(self.pixiv_relay_runner.cleanup)
                self.pixiv_relay_runner = None
            cleanup.callback(outbound.cancel_pending)
            if self.send_task is not None:
                self.send_task.cancel()
                await asyncio.gather(self.send_task, return_exceptions=True)
                self.send_task = None


intents = discord.Intents.default()


intents.message_content = True


client = FixEmbedBot(
    command_prefix=commands.when_mentioned,
    intents=intents,
    shard_count=10,
)


processed_link_cache = {}


reliability_client = ReliabilityClient(
    local_checks=(probe_deviantart_bot_health,),
)


conversion_telemetry = ConversionTelemetry(supported_services=SERVICE_NAMES)


delivery_telemetry = DeliveryTelemetry()


def get_guild_lang(guild_id):
    """Get the language setting for a guild, defaulting to English."""
    if guild_id is None:
        return "en"
    return bot_settings.get(guild_id, {}).get("language", "en")


async def is_guild_premium(guild_id):
    """Check if a guild has an active premium subscription."""
    if not client.premium_sku_id:
        return False
    # Check cache first
    cached = bot_settings.get(guild_id, {}).get("is_premium")
    if cached is not None:
        return cached
    # Query entitlements
    try:
        guild = client.get_guild(guild_id)
        if guild is None:
            return False
        entitlements = [
            e
            async for e in client.entitlements(
                guild=guild, skus=[discord.Object(id=int(client.premium_sku_id))]
            )
        ]
        is_premium = any(not e.is_expired() for e in entitlements)
        if guild_id in bot_settings:
            bot_settings[guild_id]["is_premium"] = is_premium
        return is_premium
    except Exception as e:
        logging.error(f"Error checking premium status: {e}")
        return False


def get_footer_branding(guild, settings, premium):
    """Resolve persisted Premium branding against the current guild."""
    if not premium or not settings.get("footer_branding_enabled", False):
        return None
    emoji = ""
    emoji_id = settings.get("footer_emoji_id")
    if emoji_id:
        try:
            guild_emoji = discord.utils.get(guild.emojis, id=int(emoji_id))
        except (TypeError, ValueError):
            guild_emoji = None
        if guild_emoji is not None:
            emoji = str(guild_emoji)
    return FooterBranding(name=guild.name, emoji=emoji)


def get_premium_color(guild_id):
    """Get custom embed color for a premium guild, or None."""
    color_hex = bot_settings.get(guild_id, {}).get("embed_color")
    if color_hex:
        try:
            return discord.Color(int(color_hex.lstrip("#"), 16))
        except (ValueError, AttributeError):
            pass
    return None


def get_guild_color(guild_id, default=None):
    """Get the guild's custom color if premium, otherwise return default."""
    custom = get_premium_color(guild_id)
    return custom if custom else (default or discord.Color.blurple())


def effective_content_visibility(guild_settings, channel):
    """Resolve the visibility policy for one Discord channel."""
    override = channel_visibility_override(
        channel_visibility_overrides,
        channel,
    )
    return resolve_content_visibility(
        guild_settings,
        override,
        channel_is_nsfw=is_nsfw_channel(channel),
    )
