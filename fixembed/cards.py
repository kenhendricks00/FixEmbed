"""FixEmbed cards."""

import logging
import os
from dataclasses import dataclass, replace

import discord

from fixembed.links import build_automatic_url, build_fixembed_url
from fixembed.platforms.bilibili import fetch_bilibili_layout
from fixembed.platforms.bluesky import fetch_bluesky_layout
from fixembed.platforms.deviantart import fetch_deviantart_layout
from fixembed.platforms.instagram import fetch_instagram_delivery
from fixembed.platforms.pinterest import fetch_pinterest_layout
from fixembed.platforms.pixiv import fetch_pixiv_layout
from fixembed.platforms.reddit import fetch_reddit_layout
from fixembed.platforms.threads import fetch_threads_layout
from fixembed.platforms.tiktok import fetch_tiktok_layout
from fixembed.platforms.tumblr import fetch_tumblr_layout
from fixembed.platforms.twitch import fetch_twitch_layout
from fixembed.platforms.twitter import build_twitter_layout, fetch_twitter_payload
from fixembed.platforms.youtube import fetch_youtube_community_layout
from fixembed.premium.controls import resolve_translation_language
from fixembed.presentation.preferences import preferences_from_settings
from fixembed.telemetry.conversion import new_request_id

from .runtime import (
    conversion_telemetry,
    effective_content_visibility,
    get_footer_branding,
    is_guild_premium,
)
from .storage import bot_settings, default_settings


@dataclass(frozen=True)
class ComponentsV2Delivery:
    view: discord.ui.LayoutView
    fallback_url: str
    files: tuple[discord.File, ...] = ()


LAYOUT_FETCHERS = {
    "Reddit": fetch_reddit_layout,
    "Threads": fetch_threads_layout,
    "Pixiv": fetch_pixiv_layout,
    "Bluesky": fetch_bluesky_layout,
    "Bilibili": fetch_bilibili_layout,
    "Pinterest": fetch_pinterest_layout,
    "TikTok": fetch_tiktok_layout,
    "Tumblr": fetch_tumblr_layout,
    "Twitch": fetch_twitch_layout,
    "DeviantArt": fetch_deviantart_layout,
    "YouTube": fetch_youtube_community_layout,
}


async def build_components_v2_link(
    item,
    guild_settings,
    footer_branding,
    card_preferences,
    *,
    premium=False,
):
    """Build the same Components V2 card for automatic and command entry points."""
    media_quality = guild_settings.get("media_quality", "balanced")
    translated_item = with_translation_language(item, guild_settings)
    translation_language = translated_item.language
    automatic_url = build_automatic_url(
        translated_item,
        media_quality,
        os.getenv("AUTO_TWITTER_PROVIDER", "fixembed"),
    )
    request_id = new_request_id()
    files: tuple[discord.File, ...] = ()
    async with conversion_telemetry.observe(item.service, request_id):
        if item.service == "Instagram":
            instagram_delivery = await fetch_instagram_delivery(
                item.canonical_url,
                automatic_url,
                footer_branding,
                card_preferences,
                translation_language=translation_language,
            )
            layout = instagram_delivery.layout
            files = instagram_delivery.files
        elif item.service == "Twitter":
            fixed_url = build_fixembed_url(translated_item, media_quality)
            payload = await fetch_twitter_payload(
                item.canonical_url,
                translation_language,
                item.mode,
            )
            layout = build_twitter_layout(
                payload,
                fixed_url,
                footer_branding,
                card_preferences,
            )
        else:
            fetch_layout = LAYOUT_FETCHERS.get(item.service)
            if fetch_layout is None:
                raise ValueError("unsupported rich-card service")
            layout = await fetch_layout(
                item.canonical_url,
                automatic_url,
                footer_branding,
                card_preferences,
                translation_language=translation_language,
            )
    return ComponentsV2Delivery(
        view=layout,
        fallback_url=automatic_url,
        files=files,
    )


def with_translation_language(item, guild_settings):
    """Apply an explicit or guild-default translation to every delivery path."""
    return replace(
        item,
        language=resolve_translation_language(item.language, guild_settings),
    )


async def send_components_v2_links(interaction, links):
    """Respond to a user command with modern cards and safe URL fallbacks."""
    guild_id = interaction.guild.id if interaction.guild else None
    guild_settings = bot_settings.get(
        guild_id,
        default_settings(),
    )
    premium = await is_guild_premium(guild_id) if guild_id is not None else False
    footer_branding = get_footer_branding(interaction.guild, guild_settings, premium)
    content_visibility = effective_content_visibility(
        guild_settings,
        interaction.channel,
    )
    card_preferences = preferences_from_settings(
        guild_settings,
        premium=premium,
        content_visibility=content_visibility,
    )

    await interaction.response.defer()
    for item in links:
        translated_item = with_translation_language(item, guild_settings)
        fallback_url = build_automatic_url(
            translated_item,
            guild_settings.get("media_quality", "balanced"),
            os.getenv("AUTO_TWITTER_PROVIDER", "fixembed"),
        )
        try:
            delivery = await build_components_v2_link(
                item,
                guild_settings,
                footer_branding,
                card_preferences,
                premium=premium,
            )
        except Exception as error:
            logging.warning(
                "Components V2 command card failed for %s: %s",
                item.service,
                type(error).__name__,
            )
            await interaction.followup.send(fallback_url)
            continue

        try:
            send_options = {"view": delivery.view}
            if delivery.files:
                send_options["files"] = list(delivery.files)
            await interaction.followup.send(**send_options)
        except discord.HTTPException as error:
            logging.warning(
                "Components V2 command delivery failed for %s: %s",
                item.service,
                type(error).__name__,
            )
            await interaction.followup.send(delivery.fallback_url)
