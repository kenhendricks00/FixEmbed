"""FixEmbed events."""

import asyncio
import itertools
import logging
import os
import time

import discord
from discord.ext import tasks

from fixembed.content_visibility import (
    init_content_visibility,
    load_channel_visibility_overrides,
)
from fixembed.delivery_policy import (
    apply_source_message_action,
    resolve_delivery_mode,
    should_apply_source_message_action,
)
from fixembed.deployment import guild_allowed, test_guild_id
from fixembed.atproto import verify_atproto_links
from fixembed.links import build_automatic_url, chunk_lines, extract_supported_links
from fixembed.onboarding import send_onboarding_dm
from fixembed.platforms.pixiv_relay import start_pixiv_relay
from fixembed.premium.controls import (
    init_premium_controls,
    load_premium_controls,
    record_processing_outcome,
    should_skip_automatic,
)
from fixembed.premium.roles import (
    reconcile_supporter_roles,
    sync_supporter_role,
    sync_supporter_role_for_member,
)
from fixembed.premium.sku import resolve_premium_sku
from fixembed.presentation.mentions import format_tagged_users
from fixembed.presentation.preferences import preferences_from_settings
from fixembed.settings_migrations import (
    migrate_new_social_services_default,
    migrate_pinterest_service_default,
    migrate_youtube_service_default,
)

from .cards import build_components_v2_link, with_translation_language
from .config import (
    DEDUP_WINDOW_SECONDS,
    DEFAULT_ENABLED_SERVICES,
    SERVICE_NAMES,
    SUPPORT_GUILD_ID,
    SUPPORTER_ROLE_ID,
)
from .delivery import rate_limited_send, send_worker
from .runtime import (
    client,
    delivery_telemetry,
    effective_content_visibility,
    get_footer_branding,
    is_guild_premium,
    processed_link_cache,
)
from .storage import (
    bot_settings,
    channel_states,
    channel_visibility_overrides,
    default_settings,
    get_service_rule,
    init_db,
    load_channel_service_rules,
    load_channel_states,
    load_settings,
    save_guild_settings,
)

_ready_lock = asyncio.Lock()


@client.event
async def on_ready():
    async with _ready_lock:
        if not client.initialized:
            await initialize_runtime()
            client.initialized = True


async def initialize_runtime():
    print(f"We have logged in as {client.user}")
    logging.info(f"Logged in as {client.user}")
    if (
        os.getenv("PIXIV_RELAY_ENABLED") == "1"
        and getattr(client, "pixiv_relay_runner", None) is None
    ):
        try:
            client.pixiv_relay_runner = await start_pixiv_relay()
        except Exception as error:
            logging.exception("Pixiv relay startup failed: %s", error)
    if client.db is None:
        client.db = await init_db()
    await init_content_visibility(client.db)
    await init_premium_controls(client.db)
    await migrate_youtube_service_default(client.db)
    await migrate_pinterest_service_default(client.db)
    await migrate_new_social_services_default(client.db)
    await load_channel_states(client.db, client.guilds)
    await load_settings(client.db)
    for guild_id, controls in (await load_premium_controls(client.db)).items():
        bot_settings.setdefault(
            guild_id,
            default_settings(),
        ).update(controls)
    await load_channel_service_rules(client.db)
    channel_visibility_overrides.update(
        await load_channel_visibility_overrides(client.db)
    )
    client.premium_sku_id = await resolve_premium_sku(client, client.premium_sku_id)
    # A test instance must never change roles in the production support server.
    if client.premium_sku_id and test_guild_id() is None:
        try:
            await reconcile_supporter_roles(
                client,
                int(client.premium_sku_id),
                SUPPORT_GUILD_ID,
                SUPPORTER_ROLE_ID,
            )
        except Exception as error:
            logging.exception("Premium supporter role reconciliation failed: %s", error)
    if not change_status.is_running():
        change_status.start()
    if client.send_task is None or client.send_task.done():
        client.send_task = asyncio.create_task(
            send_worker(), name="fixembed-send-worker"
        )

    try:
        synced = await client.tree.sync()
        print(f"Synced {len(synced)} command(s)")
    except Exception as e:
        print(f"Failed to sync commands: {e}")

    client.launch_time = discord.utils.utcnow()


statuses = itertools.cycle(
    [
        "for Twitter links",
        "for Reddit links",
        "for Instagram links",
        "for Threads links",
        "for Pixiv links",
        "for Bluesky links",
        "for Bilibili links",
        "for YouTube links",
        "for Pinterest links",
        "for TikTok links",
        "for Tumblr links",
        "for Twitch links",
    ]
)


@tasks.loop(seconds=60)
async def change_status():
    current_status = next(statuses)
    try:
        await client.change_presence(
            activity=discord.Activity(
                type=discord.ActivityType.watching, name=current_status
            )
        )
    except discord.errors.HTTPException as e:
        logging.error(f"Failed to change status: {e}")


@client.event
async def on_message(message):
    if message.author == client.user:
        return

    if not message.guild:
        return

    guild_id = message.guild.id
    if not guild_allowed(guild_id):
        return
    guild_settings = bot_settings.get(
        guild_id,
        default_settings(),
    )
    enabled_services = guild_settings.get("enabled_services", DEFAULT_ENABLED_SERVICES)
    mention_users = guild_settings.get("mention_users", True)
    delete_original = guild_settings.get("delete_original", True)
    delivery_mode = guild_settings.get("delivery_mode", "suppress")
    media_quality = guild_settings.get("media_quality", "balanced")
    premium = await is_guild_premium(guild_id)
    if should_skip_automatic(message, guild_settings, premium=premium):
        return
    footer_branding = get_footer_branding(message.guild, guild_settings, premium)
    content_visibility = effective_content_visibility(
        guild_settings,
        message.channel,
    )
    card_preferences = preferences_from_settings(
        guild_settings,
        premium=premium,
        content_visibility=content_visibility,
    )

    # Premium perk: skip bot messages only if NOT premium
    if message.author.bot and not premium:
        return

    if channel_states.get(message.channel.id, True):
        try:
            links = extract_supported_links(
                message.content,
                include_preconverted=False,
                include_fixembed=False,
            )
            # AT Protocol app links on other hosts need a network check; skip it
            # when the channel would not convert Bluesky links anyway.
            links = await verify_atproto_links(
                item
                for item in links
                if item.atproto_post is None
                or get_service_rule(
                    guild_id,
                    message.channel.id,
                    item.service,
                    item.service in enabled_services,
                )
            )
            formatted_links = []
            component_layouts = []
            for item in links:
                default_enabled = item.service in enabled_services
                service_enabled = get_service_rule(
                    guild_id, message.channel.id, item.service, default_enabled
                )
                dedup_key = (message.channel.id, item.canonical_url)
                cache_time = processed_link_cache.get(dedup_key, 0)
                recently_processed = (time.time() - cache_time) < DEDUP_WINDOW_SECONDS

                if service_enabled and not recently_processed:
                    rich_card_built = False
                    translated_item = with_translation_language(
                        item,
                        guild_settings,
                    )
                    automatic_url = build_automatic_url(
                        translated_item,
                        media_quality,
                        os.getenv("AUTO_TWITTER_PROVIDER", "fixembed"),
                    )
                    if item.service in SERVICE_NAMES:
                        try:
                            delivery = await build_components_v2_link(
                                item,
                                guild_settings,
                                footer_branding,
                                card_preferences,
                                premium=premium,
                            )
                            component_layouts.append(delivery)
                            rich_card_built = True
                        except Exception:
                            formatted_links.append(automatic_url)
                    else:
                        formatted_links.append(
                            f"[{item.display_text}]({automatic_url})"
                        )
                    if premium:
                        try:
                            await record_processing_outcome(
                                client.db,
                                guild_id,
                                item.service,
                                rich=rich_card_built,
                            )
                        except Exception as error:
                            logging.warning(
                                "Premium analytics write failed for guild %s: %s",
                                guild_id,
                                error,
                            )
                    processed_link_cache[dedup_key] = time.time()
            if formatted_links or component_layouts:
                permissions = message.channel.permissions_for(message.guild.me)
                delivery_decision = resolve_delivery_mode(
                    delivery_mode,
                    legacy_delete_original=delete_original,
                    can_manage_messages=permissions.manage_messages,
                )
                effective_delivery_mode = delivery_decision.effective_mode
                if delivery_decision.downgrade_reason:
                    delivery_telemetry.mode_downgraded(
                        delivery_decision.downgrade_reason
                    )

                async def suppress_source_message():
                    return await message.edit(suppress=True)

                allowed_mentions = None
                if effective_delivery_mode == "delete":
                    if not premium:
                        sender = (
                            message.author.mention
                            if mention_users
                            else message.author.display_name
                        )
                        formatted_links.append(f"Sent by {sender}")
                    tagged_users = format_tagged_users(
                        message.mentions, message.author.id
                    )
                    if tagged_users:
                        formatted_links.append(tagged_users)
                    allowed_mentions = discord.AllowedMentions(
                        users=[message.author] if mention_users and not premium else [],
                        roles=False,
                        everyone=False,
                        replied_user=False,
                    )

                delivery_outcomes = []
                for chunk in chunk_lines(formatted_links):
                    delivery_outcomes.append(
                        await rate_limited_send(
                            message.channel,
                            content=chunk,
                            allowed_mentions=allowed_mentions,
                        )
                    )
                for delivery in component_layouts:
                    delivery_outcomes.append(
                        await rate_limited_send(
                            message.channel,
                            view=delivery.view,
                            files=delivery.files,
                            fallback_content=delivery.fallback_url,
                            allowed_mentions=allowed_mentions,
                        )
                    )
                if should_apply_source_message_action(
                    effective_delivery_mode, delivery_outcomes
                ):
                    await apply_source_message_action(
                        effective_delivery_mode,
                        delete_message=message.delete,
                        suppress_message=suppress_source_message,
                        forbidden_errors=(discord.Forbidden,),
                        on_permission_recovery=delivery_telemetry.mode_downgraded,
                    )

        except discord.Forbidden as error:
            logging.warning(
                "Missing permissions in channel %s: %s", message.channel.id, error
            )
        except discord.NotFound:
            logging.debug(f"Message already deleted in channel {message.channel.id}")
        except discord.HTTPException as e:
            logging.error(f"HTTP error in on_message: {e}")
        except Exception as e:
            logging.error(f"Unexpected error in on_message: {e}", exc_info=True)


@client.event
async def on_guild_join(guild):
    guild_id = guild.id
    if not guild_allowed(guild_id):
        return
    if guild_id not in bot_settings:
        bot_settings[guild_id] = default_settings()
        await save_guild_settings(client.db, guild_id, bot_settings[guild_id])
    if test_guild_id() is None and await send_onboarding_dm(guild):
        logging.info("Sent onboarding DM for guild %s", guild_id)


@client.event
async def on_entitlement_create(entitlement):
    """Called when a user subscribes to premium."""
    if entitlement.guild_id:
        guild_id = entitlement.guild_id
        if guild_id in bot_settings:
            bot_settings[guild_id]["is_premium"] = True
        logging.info(f"Premium activated for guild {guild_id}")
    if client.premium_sku_id:
        await sync_supporter_role(
            client,
            entitlement,
            int(client.premium_sku_id),
            SUPPORT_GUILD_ID,
            SUPPORTER_ROLE_ID,
        )


@client.event
async def on_entitlement_update(entitlement):
    """Called when an entitlement is updated."""
    if entitlement.guild_id:
        guild_id = entitlement.guild_id
        is_active = not entitlement.is_expired()
        if guild_id in bot_settings:
            bot_settings[guild_id]["is_premium"] = is_active
        logging.info(
            f"Premium {'activated' if is_active else 'deactivated'} for guild {guild_id}"
        )
    if client.premium_sku_id:
        await sync_supporter_role(
            client,
            entitlement,
            int(client.premium_sku_id),
            SUPPORT_GUILD_ID,
            SUPPORTER_ROLE_ID,
        )


@client.event
async def on_entitlement_delete(entitlement):
    """Called when a user's subscription to premium is removed."""
    if entitlement.guild_id:
        guild_id = entitlement.guild_id
        if guild_id in bot_settings:
            bot_settings[guild_id]["is_premium"] = False
        logging.info(f"Premium removed for guild {guild_id}")
    if client.premium_sku_id:
        await sync_supporter_role(
            client,
            entitlement,
            int(client.premium_sku_id),
            SUPPORT_GUILD_ID,
            SUPPORTER_ROLE_ID,
            active=False,
        )


@client.event
async def on_member_join(member):
    """Grant returning Premium purchasers their Supporters role on join."""
    if client.premium_sku_id and member.guild.id == SUPPORT_GUILD_ID:
        await sync_supporter_role_for_member(
            client,
            member,
            int(client.premium_sku_id),
            SUPPORT_GUILD_ID,
            SUPPORTER_ROLE_ID,
        )
