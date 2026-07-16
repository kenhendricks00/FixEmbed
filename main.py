import logging
import asyncio
from discord.ext import commands, tasks
from discord import app_commands, ui
from typing import Optional
import discord
import re
import os
from dotenv import load_dotenv
import itertools
import aiosqlite
import sqlite3
import time
import ast
from collections import deque
from translations import get_text, LANGUAGE_NAMES, TRANSLATIONS
from link_utils import build_automatic_url, build_fixembed_url, chunk_lines, extract_supported_links
from instagram_embed import fetch_instagram_layout
from twitter_embed import build_twitter_layout, fetch_twitter_payload
from reddit_embed import fetch_reddit_layout
from threads_embed import fetch_threads_layout
from bluesky_embed import fetch_bluesky_layout
from pixiv_embed import fetch_pixiv_layout
from pixiv_relay import start_pixiv_relay
from bilibili_embed import fetch_bilibili_layout
from youtube_embed import fetch_youtube_community_layout
from pinterest_embed import fetch_pinterest_layout
from embed_footer import FooterBranding, escape_component_text
from card_preferences import preferences_from_settings
from premium_controls import (
    fetch_analytics_summary,
    init_premium_controls,
    load_premium_controls,
    record_processing_outcome,
    resolve_twitter_language,
    save_premium_controls,
    should_skip_automatic,
)
from message_context import format_tagged_users
from command_components import render_command_layout, render_settings_layout
from onboarding import send_onboarding_dm
from settings_migrations import migrate_pinterest_service_default, migrate_youtube_service_default
from reliability import (
    ReliabilityClient,
    ReliabilityReport,
    format_reliability_status,
)
from conversion_telemetry import (
    ConversionTelemetry,
    format_local_conversion_health,
    new_request_id,
)
from delivery_telemetry import (
    DeliveryTelemetry,
    deliver_with_fallback,
    format_delivery_health,
)
from delivery_policy import (
    apply_source_message_action,
    format_delivery_mode_status,
    resolve_delivery_mode,
)
from premium_roles import (
    reconcile_supporter_roles,
    sync_supporter_role,
    sync_supporter_role_for_member,
)

# Version number
VERSION = "1.4.8"

# Service configuration for link processing
# All services now use the unified FixEmbed service at fixembed.app
SERVICES = {
    "Twitter": {
        "patterns": [r"twitter\.com/(\w+)/status/(\d+)", r"x\.com/(\w+)/status/(\d+)"],
        "base_url": "fixembed.app",
        "display_format": "Twitter • {0}"
    },
    "Instagram": {
        "patterns": [r"instagram\.com/(?:p|reels?)/([\w-]+)"],
        "base_url": "fixembed.app",
        "display_format": "Instagram • {0}"
    },
    "Reddit": {
        "patterns": [r"(?:old\.)?reddit\.com/r/(\w+)/(?:s|comments)/\w+"],
        "base_url": "fixembed.app",
        "display_format": "Reddit • r/{0}"
    },
    "Threads": {
        "patterns": [r"threads\.net/@([^/]+)/post/([\w-]+)"],
        "base_url": "fixembed.app",
        "display_format": "Threads • @{0}"
    },
    "Pixiv": {
        "patterns": [r"pixiv\.net/(?:en/)?artworks/(\d+)"],
        "base_url": "fixembed.app",
        "display_format": "Pixiv • {0}"
    },
    "Bluesky": {
        "patterns": [r"bskyx?\.app/profile/([^/]+)/post/([\w-]+)"],
        "base_url": "fixembed.app",
        "display_format": "Bluesky • {0}"
    },
    "Bilibili": {
        "patterns": [r"bilibili\.com/video/([\w]+)", r"b23\.tv/([\w]+)"],
        "base_url": "fixembed.app",
        "display_format": "Bilibili • {0}"
    },
    "YouTube": {
        "patterns": [r"youtube\.com/post/([\w-]+)"],
        "base_url": "fixembed.app",
        "display_format": "YouTube • Community Post"
    },
    "Pinterest": {
        "patterns": [r"pinterest\.com/pin/[\w-]+", r"pin\.it/[\w-]+"],
        "base_url": "fixembed.app",
        "display_format": "Pinterest • {0}"
    }
}

SERVICE_NAMES = list(SERVICES.keys())
DEFAULT_ENABLED_SERVICES = SERVICE_NAMES.copy()
SERVICE_EMOJI_FALLBACKS = {
    "Twitter": "🐦",
    "Instagram": "📷",
    "Reddit": "👽",
    "Threads": "🧵",
    "Pixiv": "🎨",
    "Bluesky": "🦋",
    "Bilibili": "📺",
    "YouTube": "▶️",
    "Pinterest": "📌",
}
SERVICE_EMOJI_IDS = {
    "YouTube": 1526267390592290926,
    "Pixiv": 1526268469920792577,
    "Threads": 1526267848924725399,
    "Reddit": 1526267589808881684,
    "Instagram": 1526267158793949435,
    "Twitter": 1526268173589155921,
    "Bluesky": 1526269663334502544,
    "Bilibili": 1526271150739423304,
    "Pinterest": 1526398381415731240,
}
LANGUAGE_FLAG_EMOJIS = {
    "en": "🇺🇸",
    "es": "🇪🇸",
    "pt": "🇧🇷",
    "fr": "🇫🇷",
    "de": "🇩🇪",
    "ja": "🇯🇵",
    "ko": "🇰🇷",
    "zh": "🇨🇳",
}

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

# Initialize logging
logging.basicConfig(level=logging.INFO)

# Bot configuration
intents = discord.Intents.default()
intents.message_content = True
client = commands.AutoShardedBot(
    command_prefix=commands.when_mentioned,
    intents=intents,
    shard_count=10,
)

# In-memory storage for channel states and settings
channel_states = {}
bot_settings = {}
channel_service_rules = {}

# Rate-limiting configuration
MESSAGE_LIMIT = 5
TIME_WINDOW = 1  # Time window in seconds

message_timestamps = deque()

SEND_QUEUE = asyncio.Queue()
processed_link_cache = {}
DEDUP_WINDOW_SECONDS = 10
reliability_client = ReliabilityClient()
conversion_telemetry = ConversionTelemetry(supported_services=SERVICE_NAMES)
delivery_telemetry = DeliveryTelemetry()

async def rate_limited_send(
    channel,
    content=None,
    embed=None,
    file=None,
    allowed_mentions=None,
    view=None,
    fallback_content=None,
):
    ticket = delivery_telemetry.queued("card" if view is not None else "link")
    await SEND_QUEUE.put(
        (
            ticket,
            channel,
            content,
            embed,
            file,
            allowed_mentions,
            view,
            fallback_content,
        )
    )

async def send_worker():
    while True:
        (
            ticket,
            channel,
            content,
            embed,
            file,
            allowed_mentions,
            view,
            fallback_content,
        ) = await SEND_QUEUE.get()
        try:
            current_time = time.time()
            while message_timestamps and current_time - message_timestamps[0] >= TIME_WINDOW:
                message_timestamps.popleft()

            while len(message_timestamps) >= MESSAGE_LIMIT:
                await asyncio.sleep(0.1)
                current_time = time.time()
                while message_timestamps and current_time - message_timestamps[0] >= TIME_WINDOW:
                    message_timestamps.popleft()

            message_timestamps.append(time.time())
            async def primary_send():
                return await channel.send(
                    content=content,
                    embed=embed,
                    file=file,
                    allowed_mentions=allowed_mentions,
                    view=view,
                    silent=True,
                )

            async def fallback_send():
                return await channel.send(
                    content=fallback_content,
                    allowed_mentions=allowed_mentions,
                    silent=True,
                )

            await deliver_with_fallback(
                ticket,
                telemetry=delivery_telemetry,
                primary_send=primary_send,
                fallback_send=fallback_send if fallback_content else None,
            )
        except Exception as error:
            delivery_telemetry.failed(ticket, error)
        finally:
            SEND_QUEUE.task_done()

# Premium SKU ID (loaded from .env at bottom of file)
PREMIUM_SKU_ID = None
SUPPORT_GUILD_ID = 1195810157112852540
SUPPORTER_ROLE_ID = 1195810157112852547

def get_guild_lang(guild_id):
    """Get the language setting for a guild, defaulting to English."""
    if guild_id is None:
        return "en"
    return bot_settings.get(guild_id, {}).get("language", "en")

async def is_guild_premium(guild_id):
    """Check if a guild has an active premium subscription."""
    if not PREMIUM_SKU_ID:
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
        entitlements = [e async for e in client.entitlements(guild=guild, skus=[discord.Object(id=int(PREMIUM_SKU_ID))])]
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
            return discord.Color(int(color_hex.lstrip('#'), 16))
        except (ValueError, AttributeError):
            pass
    return None

def get_guild_color(guild_id, default=None):
    """Get the guild's custom color if premium, otherwise return default."""
    custom = get_premium_color(guild_id)
    return custom if custom else (default or discord.Color.blurple())


class CommandInfoView(ui.LayoutView):
    """Static Components V2 card for public informational commands."""

    def __init__(self, *, title, description, sections, accent_color, footer):
        super().__init__(timeout=180)
        render_command_layout(
            self,
            title=title,
            description=description,
            sections=sections,
            accent_color=accent_color,
            footer=footer,
        )


async def init_db():
    db = await aiosqlite.connect('fixembed_data.db')
    await db.execute('''CREATE TABLE IF NOT EXISTS channel_states (channel_id INTEGER PRIMARY KEY, state BOOLEAN)''')
    await db.commit()
    await db.execute('''CREATE TABLE IF NOT EXISTS guild_settings (guild_id INTEGER PRIMARY KEY, enabled_services TEXT, mention_users BOOLEAN, delete_original BOOLEAN DEFAULT TRUE, language TEXT DEFAULT 'en', embed_color TEXT DEFAULT NULL, delivery_mode TEXT DEFAULT 'suppress', media_quality TEXT DEFAULT 'balanced', footer_branding_enabled BOOLEAN DEFAULT FALSE, footer_emoji_id INTEGER DEFAULT NULL)''')
    await db.commit()
    await db.execute('''CREATE TABLE IF NOT EXISTS channel_service_rules (guild_id INTEGER, channel_id INTEGER, service TEXT, action TEXT, PRIMARY KEY (guild_id, channel_id, service))''')
    await db.commit()

    try:
        await db.execute('ALTER TABLE guild_settings ADD COLUMN mention_users BOOLEAN DEFAULT TRUE')
        await db.commit()
    except sqlite3.OperationalError as e:
        if 'duplicate column name' in str(e):
            pass
        else:
            raise

    try:
        await db.execute('ALTER TABLE guild_settings ADD COLUMN delete_original BOOLEAN DEFAULT TRUE')
        await db.commit()
    except sqlite3.OperationalError as e:
        if 'duplicate column name' in str(e):
            pass
        else:
            raise

    try:
        await db.execute("ALTER TABLE guild_settings ADD COLUMN language TEXT DEFAULT 'en'")
        await db.commit()
    except sqlite3.OperationalError as e:
        if 'duplicate column name' in str(e):
            pass
        else:
            raise

    try:
        await db.execute('ALTER TABLE guild_settings ADD COLUMN embed_color TEXT DEFAULT NULL')
        await db.commit()
    except sqlite3.OperationalError as e:
        if 'duplicate column name' in str(e):
            pass
        else:
            raise

    try:
        await db.execute("ALTER TABLE guild_settings ADD COLUMN delivery_mode TEXT DEFAULT 'suppress'")
        await db.commit()
    except sqlite3.OperationalError as e:
        if 'duplicate column name' in str(e):
            pass
        else:
            raise

    try:
        await db.execute("ALTER TABLE guild_settings ADD COLUMN media_quality TEXT DEFAULT 'balanced'")
        await db.commit()
    except sqlite3.OperationalError as e:
        if 'duplicate column name' in str(e):
            pass
        else:
            raise

    try:
        await db.execute("ALTER TABLE guild_settings ADD COLUMN footer_branding_enabled BOOLEAN DEFAULT FALSE")
        await db.commit()
    except sqlite3.OperationalError as e:
        if 'duplicate column name' in str(e):
            pass
        else:
            raise

    try:
        await db.execute("ALTER TABLE guild_settings ADD COLUMN footer_emoji_id INTEGER DEFAULT NULL")
        await db.commit()
    except sqlite3.OperationalError as e:
        if 'duplicate column name' in str(e):
            pass
        else:
            raise

    return db

async def load_channel_states(db):
    async with db.execute('SELECT channel_id, state FROM channel_states') as cursor:
        async for row in cursor:
            channel_states[row[0]] = row[1]

    for guild in client.guilds:
        for channel in guild.text_channels:
            if channel.id not in channel_states:
                channel_states[channel.id] = True

async def load_settings(db):
    async with db.execute('SELECT guild_id, enabled_services, mention_users, delete_original, language, embed_color, delivery_mode, media_quality, footer_branding_enabled, footer_emoji_id FROM guild_settings') as cursor:
        async for row in cursor:
            guild_id = row[0]
            enabled_services = row[1]
            mention_users = row[2]
            delete_original = row[3]
            language = row[4] if len(row) > 4 else "en"
            embed_color = row[5] if len(row) > 5 else None
            delivery_mode = row[6] if len(row) > 6 else "suppress"
            media_quality = row[7] if len(row) > 7 else "balanced"
            footer_branding_enabled = row[8] if len(row) > 8 else False
            footer_emoji_id = row[9] if len(row) > 9 else None
            enabled_services_list = ast.literal_eval(enabled_services) if enabled_services else DEFAULT_ENABLED_SERVICES          
            bot_settings[guild_id] = {
                "enabled_services": enabled_services_list,
                "mention_users": mention_users if mention_users is not None else True,
                "delete_original": delete_original if delete_original is not None else True,
                "language": language if language else "en",
                "embed_color": embed_color,
                "delivery_mode": delivery_mode if delivery_mode else "suppress",
                "media_quality": media_quality if media_quality else "balanced",
                "footer_branding_enabled": bool(footer_branding_enabled),
                "footer_emoji_id": footer_emoji_id,
            }

async def update_channel_state(db, channel_id, state):
    retries = 5
    for i in range(retries):
        try:
            await db.execute('INSERT OR REPLACE INTO channel_states (channel_id, state) VALUES (?, ?)', (channel_id, state))
            await db.commit()
            break
        except sqlite3.OperationalError as e:
            if 'locked' in str(e):
                await asyncio.sleep(0.1)
            else:
                raise

async def update_setting(
    db,
    guild_id,
    enabled_services,
    mention_users,
    delete_original,
    language="en",
    embed_color=None,
    delivery_mode="suppress",
    media_quality="balanced",
    footer_branding_enabled=False,
    footer_emoji_id=None,
):
    retries = 5
    for i in range(retries):
        try:
            await db.execute(
                'INSERT OR REPLACE INTO guild_settings (guild_id, enabled_services, mention_users, delete_original, language, embed_color, delivery_mode, media_quality, footer_branding_enabled, footer_emoji_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                (
                    guild_id,
                    repr(enabled_services),
                    mention_users,
                    delete_original,
                    language,
                    embed_color,
                    delivery_mode,
                    media_quality,
                    footer_branding_enabled,
                    footer_emoji_id,
                ),
            )
            await db.commit()
            break
        except sqlite3.OperationalError as e:
            if 'locked' in str(e):
                await asyncio.sleep(0.1)
            else:
                raise

async def load_channel_service_rules(db):
    async with db.execute('SELECT guild_id, channel_id, service, action FROM channel_service_rules') as cursor:
        async for guild_id, channel_id, service, action in cursor:
            channel_service_rules[(guild_id, channel_id, service)] = action

async def set_channel_service_rule(db, guild_id, channel_id, service, action):
    await db.execute('INSERT OR REPLACE INTO channel_service_rules (guild_id, channel_id, service, action) VALUES (?, ?, ?, ?)', (guild_id, channel_id, service, action))
    await db.commit()
    channel_service_rules[(guild_id, channel_id, service)] = action

def get_service_rule(guild_id, channel_id, service, default_enabled=True):
    rule = channel_service_rules.get((guild_id, channel_id, service))
    if rule == "on":
        return True
    if rule == "off":
        return False
    return default_enabled

@client.event
async def on_ready():
    print(f'We have logged in as {client.user}')
    logging.info(f'Logged in as {client.user}')
    if (
        os.getenv("PIXIV_RELAY_ENABLED") == "1"
        and getattr(client, "pixiv_relay_runner", None) is None
    ):
        try:
            client.pixiv_relay_runner = await start_pixiv_relay()
        except Exception as error:
            logging.exception("Pixiv relay startup failed: %s", error)
    client.db = await init_db()
    await init_premium_controls(client.db)
    await migrate_youtube_service_default(client.db)
    await migrate_pinterest_service_default(client.db)
    await load_channel_states(client.db)
    await load_settings(client.db)
    for guild_id, controls in (await load_premium_controls(client.db)).items():
        bot_settings.setdefault(
            guild_id,
            {
                "enabled_services": DEFAULT_ENABLED_SERVICES.copy(),
                "mention_users": True,
                "delete_original": True,
                "language": "en",
                "delivery_mode": "suppress",
                "media_quality": "balanced",
            },
        ).update(controls)
    await load_channel_service_rules(client.db)
    if PREMIUM_SKU_ID:
        try:
            await reconcile_supporter_roles(
                client,
                int(PREMIUM_SKU_ID),
                SUPPORT_GUILD_ID,
                SUPPORTER_ROLE_ID,
            )
        except Exception as error:
            logging.exception("Premium supporter role reconciliation failed: %s", error)
    change_status.start()
    client.loop.create_task(send_worker())

    try:
        synced = await client.tree.sync()
        print(f'Synced {len(synced)} command(s)')
    except Exception as e:
        print(f'Failed to sync commands: {e}')

    client.launch_time = discord.utils.utcnow()

statuses = itertools.cycle([
    "for Twitter links", "for Reddit links", "for Instagram links", "for Threads links", "for Pixiv links", "for Bluesky links", "for Bilibili links", "for YouTube links", "for Pinterest links"
])

@tasks.loop(seconds=60)
async def change_status():
    current_status = next(statuses)
    try:
        await client.change_presence(activity=discord.Activity(type=discord.ActivityType.watching, name=current_status))
    except discord.errors.HTTPException as e:
        logging.error(f"Failed to change status: {e}")

@client.tree.command(
    name='activate',
    description="Activate link processing in this channel or another channel")
@app_commands.describe(
    channel="The channel to activate link processing in (leave blank for current channel)"
)
async def activate(interaction: discord.Interaction,
                   channel: Optional[discord.TextChannel] = None):
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
    name='deactivate',
    description="Deactivate link processing in this channel or another channel")
@app_commands.describe(
    channel="The channel to deactivate link processing in (leave blank for current channel)"
)
async def deactivate(interaction: discord.Interaction,
                     channel: Optional[discord.TextChannel] = None):
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

@client.tree.command(
    name='about',
    description="Show information about the bot")
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
                "- [Invite FixEmbed](https://discord.com/oauth2/authorize?client_id=1173820242305224764)\n"
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
    )
    await interaction.response.send_message(view=view)

@client.tree.command(
    name='help',
    description="Show all available commands")
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
            (get_text(lang, "server_settings"), get_text(lang, "server_settings_value")),
            (get_text(lang, "info"), get_text(lang, "info_value")),
            ("💎 " + get_text(lang, "premium_title"), get_text(lang, "premium_help_value")),
            (get_text(lang, "supported_services"), get_text(lang, "supported_services_value")),
            (get_text(lang, "tip"), get_text(lang, "tip_value")),
            (get_text(lang, "languages_supported"), get_text(lang, "languages_supported_value")),
        ),
        accent_color=get_guild_color(guild_id, discord.Color(0x7289DA)),
        footer=f"Help  ·  v{VERSION}",
    )
    await interaction.response.send_message(view=view)

@client.tree.command(
    name='fix',
    description="Convert social media links into polished FixEmbed links")
@app_commands.describe(link="Paste one or more supported social media links")
@app_commands.allowed_installs(guilds=True, users=True)
@app_commands.allowed_contexts(guilds=True, dms=True, private_channels=True)
async def fix_link(interaction: discord.Interaction, link: str):
    """Convert one or more social media links to embed-friendly versions."""
    lang = get_guild_lang(interaction.guild.id if interaction.guild else None)
    links = extract_supported_links(link)

    if not links:
        await interaction.response.send_message(get_text(lang, "no_supported_link"), ephemeral=True)
        return

    fixed_links = [f"[{item.display_text}]({build_fixembed_url(item)})" for item in links]
    chunks = chunk_lines(fixed_links)
    await interaction.response.send_message(chunks[0])
    for chunk in chunks[1:]:
        await interaction.followup.send(chunk)

@client.tree.context_menu(name='Fix Embed')
@app_commands.allowed_installs(guilds=True, users=True)
@app_commands.allowed_contexts(guilds=True, dms=True, private_channels=True)
async def fix_embed_context(interaction: discord.Interaction, message: discord.Message):
    """Convert social media links in a message to embed-friendly versions."""
    lang = get_guild_lang(interaction.guild.id if interaction.guild else None)
    links = extract_supported_links(message.content)

    if not links:
        await interaction.response.send_message(get_text(lang, "no_links_found"), ephemeral=True)
        return

    fixed_links = [f"[{item.display_text}]({build_fixembed_url(item)})" for item in links]
    chunks = chunk_lines(fixed_links)
    await interaction.response.send_message(chunks[0])
    for chunk in chunks[1:]:
        await interaction.followup.send(chunk)

async def debug_info(interaction: discord.Interaction, channel: Optional[discord.TextChannel] = None):
    settings = bot_settings.get(
        interaction.guild.id,
        {
            "enabled_services": DEFAULT_ENABLED_SERVICES,
            "mention_users": True,
            "delete_original": True,
            "delivery_mode": "suppress",
            "media_quality": "balanced",
        },
    )
    await interaction.response.send_message(
        view=DebugSettingsView(interaction, settings),
        ephemeral=True,
    )


# Components V2 settings implementation used by the private configuration flow.


class SettingsPageView(ui.LayoutView):
    def __init__(self, interaction, settings, *, timeout=180):
        super().__init__(timeout=timeout)
        self.interaction = interaction
        self.settings = settings

    @property
    def lang(self):
        return self.settings.get("language", "en")

    async def save(self):
        await update_setting(
            client.db,
            self.interaction.guild.id,
            self.settings.get("enabled_services", DEFAULT_ENABLED_SERVICES),
            self.settings.get("mention_users", True),
            self.settings.get("delete_original", True),
            self.settings.get("language", "en"),
            self.settings.get("embed_color"),
            self.settings.get("delivery_mode", "suppress"),
            self.settings.get("media_quality", "balanced"),
            self.settings.get("footer_branding_enabled", False),
            self.settings.get("footer_emoji_id"),
        )

    def render_page(self, *, title, description, status=None, controls=(), accent_color=None, footer="Settings"):
        rows = list(controls)
        if not isinstance(self, SettingsView):
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


class SettingsDropdown(ui.Select):
    def __init__(self, interaction, settings):
        self.source_interaction = interaction
        self.settings = settings
        lang = settings.get("language", "en")
        options = [
            discord.SelectOption(label=get_text(lang, "fixembed_settings"), description=get_text(lang, "fixembed_activate_deactivate"), value="FixEmbed", emoji="⚙️"),
            discord.SelectOption(label=get_text(lang, "mention_users"), description=get_text(lang, "mention_users_toggle"), value="Mention Users", emoji="🔔"),
            discord.SelectOption(label=get_text(lang, "delivery_method"), description=get_text(lang, "delivery_method_toggle"), value="Delivery Method", emoji="📨"),
            discord.SelectOption(label=get_text(lang, "service_settings"), description=get_text(lang, "service_settings_desc"), value="Service Settings", emoji="🧩"),
            discord.SelectOption(label=get_text(lang, "quality_profile"), description=get_text(lang, "quality_profile_desc"), value="Quality Profile", emoji="🎞️"),
            discord.SelectOption(label=get_text(lang, "channel_rules"), description=get_text(lang, "channel_rules_desc"), value="Channel Rules", emoji="🧭"),
            discord.SelectOption(label=get_text(lang, "reliability_status"), description=get_text(lang, "reliability_status_desc"), value="Reliability Status", emoji="📊"),
            discord.SelectOption(label=get_text(lang, "language"), description=get_text(lang, "language_desc"), value="Language", emoji="🌐"),
            discord.SelectOption(label=get_text(lang, "debug"), description=get_text(lang, "debug_desc"), value="Debug", emoji="🐞"),
            discord.SelectOption(label=get_text(lang, "embed_color"), description=get_text(lang, "embed_color_desc"), value="Embed Color", emoji="💎"),
            discord.SelectOption(label="Card Style", description="Customize social cards (Premium)", value="Card Style", emoji="🎛️"),
            discord.SelectOption(label="X Translation", description="Choose a default language (Premium)", value="X Translation", emoji="🌐"),
            discord.SelectOption(label="Exclusions", description="Ignore members or roles (Premium)", value="Exclusions", emoji="🛡️"),
            discord.SelectOption(label="Analytics", description="View private 30-day insights (Premium)", value="Analytics", emoji="📈"),
            discord.SelectOption(
                label="Footer Branding",
                description="Use this server's identity in social cards (Premium)",
                value="Footer Branding",
                emoji="🏷️",
            ),
        ]
        super().__init__(placeholder=get_text(lang, "choose_option"), options=options)

    async def callback(self, interaction: discord.Interaction):
        value = self.values[0]
        if value == "Embed Color" and await is_guild_premium(interaction.guild.id):
            await interaction.response.send_modal(EmbedColorModal(self.source_interaction, self.settings))
            return
        if value == "Footer Branding":
            premium = await is_guild_premium(interaction.guild.id)
            view = FooterBrandingSettingsView(
                self.source_interaction, self.settings, premium=premium
            )
            await interaction.response.send_message(view=view, ephemeral=True)
            return
        premium_pages = {
            "Card Style": CardStyleSettingsView,
            "X Translation": TwitterTranslationSettingsView,
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
            "Channel Rules": ChannelRulesSettingsView,
            "Language": LanguageSettingsView,
            "Debug": DebugSettingsView,
            "Embed Color": PremiumSettingsView,
        }
        view = page_types[value](self.source_interaction, self.settings)
        await interaction.response.send_message(view=view, ephemeral=True)


class SettingsView(SettingsPageView):
    def __init__(self, interaction, settings, *, premium=False):
        super().__init__(interaction, settings)
        enabled = settings.get("enabled_services", DEFAULT_ENABLED_SERVICES)
        delivery = settings.get("delivery_mode", "suppress")
        quality = settings.get("media_quality", "balanced")
        controls = [(SettingsDropdown(interaction, settings),)]
        if PREMIUM_SKU_ID and not premium:
            controls.append((discord.ui.Button(
                style=discord.ButtonStyle.premium,
                sku_id=int(PREMIUM_SKU_ID),
            ),))
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
        super().__init__(placeholder="Select services to activate...", min_values=1, max_values=len(options), options=options)
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
            discord.SelectOption(label=get_text(view.lang, f"quality_{value}"), value=value, description=get_text(view.lang, f"quality_{value}_desc"), default=current == value)
            for value in ("fastest", "balanced", "highest")
        ]
        super().__init__(placeholder=get_text(view.lang, "quality_select_placeholder"), options=options)
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
            discord.SelectOption(label=name, value=code, emoji=LANGUAGE_FLAG_EMOJIS.get(code, "🌐"), default=code == current)
            for code, name in LANGUAGE_NAMES.items()
        ]
        super().__init__(placeholder=get_text(current, "language_select"), options=options)
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
        status = get_text(self.lang, "activated") if self.current_value() else get_text(self.lang, "deactivated")
        return get_text(self.lang, "user_mentions_status", status=status)

    def render(self):
        active = self.current_value()
        button = discord.ui.Button(
            label=get_text(self.lang, "activated") if active else get_text(self.lang, "deactivated"),
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
        self.activated = all(channel_states.get(ch.id, True) for ch in interaction.guild.text_channels)
        self.render()

    def render(self):
        status = get_text(self.lang, "activated") if self.activated else get_text(self.lang, "deactivated")
        button = discord.ui.Button(label=status, style=discord.ButtonStyle.green if self.activated else discord.ButtonStyle.red)
        button.callback = self.toggle
        self.render_page(
            title=get_text(self.lang, "fixembed_settings"),
            description=f"**{status}**\n{get_text(self.lang, 'note_apply_changes')}",
            controls=((button,),),
            accent_color=discord.Color.green() if self.activated else discord.Color.red(),
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
        options = [discord.SelectOption(label=name.title(), value=name, description=description, default=current == name) for name, description in self.MODES.items()]
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
        setattr(self.page, self.kind, int(value) if self.kind == "selected_channel_id" else value)
        self.page.render()
        await interaction.response.edit_message(view=self.page)


class ChannelRulesSettingsView(SettingsPageView):
    def __init__(self, interaction, settings):
        super().__init__(interaction, settings)
        self.selected_channel_id = interaction.channel.id if interaction.channel else None
        self.selected_service = "Twitter"
        self.selected_action = "default"
        self.render()

    def render(self):
        channels = self.interaction.guild.text_channels[:25]
        channel_options = [discord.SelectOption(label=ch.name[:100], value=str(ch.id), default=ch.id == self.selected_channel_id) for ch in channels]
        service_options = [discord.SelectOption(label=name, value=name, emoji=get_service_select_emoji(self.interaction.guild, name), default=name == self.selected_service) for name in DEFAULT_ENABLED_SERVICES]
        action_options = [discord.SelectOption(label=name.title(), value=name, default=name == self.selected_action) for name in ("on", "off", "default")]
        apply_button = discord.ui.Button(label=get_text(self.lang, "channel_rules_apply"), style=discord.ButtonStyle.green)
        apply_button.callback = self.apply_rule
        channel = self.interaction.guild.get_channel(self.selected_channel_id) if self.selected_channel_id else None
        status = get_text(self.lang, "channel_rules_selections", channel=channel.mention if channel else "None", service=self.selected_service, action=self.selected_action)
        self.render_page(
            title=get_text(self.lang, "channel_rules_title"),
            description=get_text(self.lang, "channel_rules_instructions"),
            status=status,
            controls=(
                (RuleSelect(self, "selected_channel_id", channel_options, get_text(self.lang, "channel_rules_pick_channel")),),
                (RuleSelect(self, "selected_service", service_options, get_text(self.lang, "channel_rules_pick_service")),),
                (RuleSelect(self, "selected_action", action_options, get_text(self.lang, "channel_rules_pick_action")),),
                (apply_button,),
            ),
            footer="Channel rules",
        )

    async def apply_rule(self, interaction):
        guild_id = self.interaction.guild.id
        key = (guild_id, self.selected_channel_id, self.selected_service)
        if self.selected_action == "default":
            await client.db.execute("DELETE FROM channel_service_rules WHERE guild_id = ? AND channel_id = ? AND service = ?", key)
            await client.db.commit()
            channel_service_rules.pop(key, None)
        else:
            await set_channel_service_rule(client.db, *key, self.selected_action)
        self.render()
        await interaction.response.edit_message(view=self)


class StaticSettingsView(SettingsPageView):
    def __init__(self, interaction, settings, *, title, description, status, footer):
        super().__init__(interaction, settings)
        self.render_page(title=title, description=description, status=status, footer=footer)


class ReliabilityRefreshButton(ui.Button):
    def __init__(self, page):
        super().__init__(label="Refresh", style=discord.ButtonStyle.secondary, emoji="🔄")
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
        controls = ((
            ReliabilityRefreshButton(self),
            discord.ui.Button(
                label="Public status",
                style=discord.ButtonStyle.link,
                url="https://fixembed.app/status",
            ),
        ),)
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
        status = "\n".join(f"{'\u2705' if allowed else '\u274c'} {name}" for name, allowed in checks)
        delivery_decision = resolve_delivery_mode(
            settings.get("delivery_mode", "suppress"),
            legacy_delete_original=settings.get("delete_original", True),
            can_manage_messages=permissions.manage_messages,
        )
        status += "\n\n" + format_delivery_mode_status(delivery_decision)
        status += f"\n\n**Shard:** {interaction.guild.shard_id + 1}  ·  **Version:** {VERSION}\n**Uptime:** {str(discord.utils.utcnow() - client.launch_time).split('.')[0]}"
        super().__init__(interaction, settings, title="Debug Information", description="Permission and runtime diagnostics for this server.", status=status, footer="Diagnostics")


class PremiumSettingsView(SettingsPageView):
    def __init__(self, interaction, settings):
        super().__init__(interaction, settings)
        controls = ()
        if PREMIUM_SKU_ID:
            controls = ((discord.ui.Button(style=discord.ButtonStyle.premium, sku_id=int(PREMIUM_SKU_ID)),),)
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
        await save_premium_controls(
            client.db, self.interaction.guild.id, self.settings
        )

    def render_locked(self, *, title, description):
        controls = ()
        if PREMIUM_SKU_ID:
            controls = ((discord.ui.Button(
                style=discord.ButtonStyle.premium,
                sku_id=int(PREMIUM_SKU_ID),
            ),),)
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
            style=discord.ButtonStyle.green if show_stats else discord.ButtonStyle.secondary,
        )
        hashtags = discord.ui.Button(
            label=f"Hashtags: {'Shown' if show_hashtags else 'Hidden'}",
            style=discord.ButtonStyle.green if show_hashtags else discord.ButtonStyle.secondary,
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


class TwitterLanguageSelect(ui.Select):
    def __init__(self, page):
        current = page.settings.get("twitter_language")
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
        super().__init__(placeholder="Choose the default X language...", options=options)
        self.page = page

    async def callback(self, interaction):
        if not await self.page.confirm_premium(interaction):
            return
        self.page.settings["twitter_language"] = (
            None if self.values[0] == "none" else self.values[0]
        )
        await self.page.save_premium()
        self.page.render()
        await interaction.response.edit_message(view=self.page)


class TwitterTranslationSettingsView(PremiumControlsPage):
    def __init__(self, interaction, settings, *, premium):
        super().__init__(interaction, settings, premium=premium)
        self.render()

    def render(self):
        if not self.premium:
            self.render_locked(
                title="Default X Translation",
                description="Automatically translate X posts unless a link requests another language.",
            )
            return
        current = self.settings.get("twitter_language")
        label = LANGUAGE_NAMES.get(current, "Original language")
        self.render_page(
            title="Default X Translation",
            description="Explicit translation options in a posted link always take priority.",
            status=f"**Default:** {label}",
            controls=((TwitterLanguageSelect(self),),),
            accent_color=discord.Color.gold(),
            footer="Premium translation",
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
        super().__init__(placeholder="Choose an optional server emoji...", options=options)
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
            if PREMIUM_SKU_ID:
                controls = ((discord.ui.Button(
                    style=discord.ButtonStyle.premium,
                    sku_id=int(PREMIUM_SKU_ID),
                ),),)
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
            style=discord.ButtonStyle.green if enabled else discord.ButtonStyle.secondary,
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


@client.tree.command(name='settings', description="Configure FixEmbed's settings")
@app_commands.guild_only()
@app_commands.default_permissions(manage_guild=True)
@app_commands.checks.has_permissions(manage_guild=True)
async def settings(interaction: discord.Interaction):
    guild_id = interaction.guild.id
    guild_settings = bot_settings.get(guild_id, {"enabled_services": DEFAULT_ENABLED_SERVICES, "mention_users": True, "delete_original": True, "delivery_mode": "suppress", "media_quality": "balanced"})
    premium = await is_guild_premium(guild_id)

    await interaction.response.send_message(
        view=SettingsView(interaction, guild_settings, premium=premium),
        ephemeral=True,
    )

@client.tree.command(name='delivery', description="Power-user alias for delivery mode (also in /settings)")
@app_commands.describe(mode="delete, suppress, or reply")
@app_commands.choices(mode=[
    app_commands.Choice(name="delete original + send fixed link", value="delete"),
    app_commands.Choice(name="suppress original embed + send fixed link", value="suppress"),
    app_commands.Choice(name="keep original + send fixed link", value="reply"),
])
async def delivery(interaction: discord.Interaction, mode: app_commands.Choice[str]):
    guild_id = interaction.guild.id
    settings_obj = bot_settings.setdefault(guild_id, {
        "enabled_services": DEFAULT_ENABLED_SERVICES,
        "mention_users": True,
        "delete_original": True,
        "language": "en",
        "delivery_mode": "suppress",
        "media_quality": "balanced",
    })
    settings_obj["delivery_mode"] = mode.value
    settings_obj["delete_original"] = mode.value == "delete"
    await update_setting(
        client.db, guild_id, settings_obj["enabled_services"], settings_obj["mention_users"],
        settings_obj.get("delete_original", True), settings_obj.get("language", "en"),
        settings_obj.get("embed_color"), settings_obj["delivery_mode"], settings_obj.get("media_quality", "balanced"),
        settings_obj.get("footer_branding_enabled", False), settings_obj.get("footer_emoji_id")
    )
    view = SettingsNoticeView(
        title="Delivery Method",
        description=f"✅ Delivery mode set to **{mode.value}**.\n{DeliverySelect.MODES[mode.value]}",
        accent_color=get_guild_color(guild_id),
        footer="Delivery",
    )
    await interaction.response.send_message(view=view, ephemeral=True)

@client.tree.command(name='quality', description="Power-user alias for quality profile (also in /settings)")
@app_commands.describe(profile="fastest, balanced, or highest")
@app_commands.choices(profile=[
    app_commands.Choice(name="fastest", value="fastest"),
    app_commands.Choice(name="balanced", value="balanced"),
    app_commands.Choice(name="highest quality", value="highest"),
])
async def quality(interaction: discord.Interaction, profile: app_commands.Choice[str]):
    guild_id = interaction.guild.id
    settings_obj = bot_settings.setdefault(guild_id, {
        "enabled_services": DEFAULT_ENABLED_SERVICES,
        "mention_users": True,
        "delete_original": True,
        "language": "en",
        "delivery_mode": "suppress",
        "media_quality": "balanced",
    })
    settings_obj["media_quality"] = profile.value
    await update_setting(
        client.db, guild_id, settings_obj["enabled_services"], settings_obj["mention_users"],
        settings_obj.get("delete_original", True), settings_obj.get("language", "en"),
        settings_obj.get("embed_color"), settings_obj.get("delivery_mode", "suppress"), settings_obj["media_quality"],
        settings_obj.get("footer_branding_enabled", False), settings_obj.get("footer_emoji_id")
    )
    view = SettingsNoticeView(
        title="Media Quality",
        description=f"✅ Media quality profile set to **{profile.value}**.",
        accent_color=get_guild_color(guild_id),
        footer="Media quality",
    )
    await interaction.response.send_message(view=view, ephemeral=True)

@client.tree.command(name='rule', description="Power-user alias for channel rules (also in /settings)")
@app_commands.describe(channel="Target channel", service="Service name", action="on, off, or default")
@app_commands.choices(service=[
    app_commands.Choice(name="Twitter", value="Twitter"),
    app_commands.Choice(name="Instagram", value="Instagram"),
    app_commands.Choice(name="Reddit", value="Reddit"),
    app_commands.Choice(name="Threads", value="Threads"),
    app_commands.Choice(name="Pixiv", value="Pixiv"),
    app_commands.Choice(name="Bluesky", value="Bluesky"),
    app_commands.Choice(name="Bilibili", value="Bilibili"),
    app_commands.Choice(name="YouTube", value="YouTube"),
    app_commands.Choice(name="Pinterest", value="Pinterest"),
], action=[
    app_commands.Choice(name="force on", value="on"),
    app_commands.Choice(name="force off", value="off"),
    app_commands.Choice(name="default (inherit)", value="default"),
])
async def rule(interaction: discord.Interaction, channel: discord.TextChannel, service: app_commands.Choice[str], action: app_commands.Choice[str]):
    guild_id = interaction.guild.id
    if action.value == "default":
        await client.db.execute("DELETE FROM channel_service_rules WHERE guild_id = ? AND channel_id = ? AND service = ?", (guild_id, channel.id, service.value))
        await client.db.commit()
        channel_service_rules.pop((guild_id, channel.id, service.value), None)
    else:
        await set_channel_service_rule(client.db, guild_id, channel.id, service.value, action.value)
    view = SettingsNoticeView(
        title="Channel Rule Updated",
        description=f"✅ {channel.mention}  ·  **{service.value}**  →  **{action.value}**",
        accent_color=get_guild_color(guild_id),
        footer="Channel rules",
    )
    await interaction.response.send_message(view=view, ephemeral=True)

@client.tree.command(name='status', description="Power-user alias for reliability status (also in /settings)")
@app_commands.guild_only()
async def status(interaction: discord.Interaction):
    await interaction.response.defer(ephemeral=True)
    settings = bot_settings.get(interaction.guild.id, {
        "enabled_services": DEFAULT_ENABLED_SERVICES,
        "language": "en",
    })
    report = await reliability_client.get_report()
    view = ReliabilitySettingsView(
        interaction,
        settings,
        report=report,
    )
    await interaction.edit_original_response(view=view)

@client.event
async def on_message(message):
    if message.author == client.user:
        return

    if not message.guild:
        return

    guild_id = message.guild.id
    guild_settings = bot_settings.get(guild_id, {
        "enabled_services": DEFAULT_ENABLED_SERVICES,
        "mention_users": True,
        "delete_original": True
    })
    enabled_services = guild_settings.get("enabled_services", DEFAULT_ENABLED_SERVICES)
    mention_users = guild_settings.get("mention_users", True)
    delete_original = guild_settings.get("delete_original", True)
    delivery_mode = guild_settings.get("delivery_mode", "suppress")
    media_quality = guild_settings.get("media_quality", "balanced")
    premium = await is_guild_premium(guild_id)
    if should_skip_automatic(message, guild_settings, premium=premium):
        return
    footer_branding = get_footer_branding(message.guild, guild_settings, premium)
    card_preferences = preferences_from_settings(guild_settings, premium=premium)

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
            formatted_links = []
            component_layouts = []
            for item in links:
                default_enabled = item.service in enabled_services
                service_enabled = get_service_rule(guild_id, message.channel.id, item.service, default_enabled)
                dedup_key = (message.channel.id, item.canonical_url)
                cache_time = processed_link_cache.get(dedup_key, 0)
                recently_processed = (time.time() - cache_time) < DEDUP_WINDOW_SECONDS

                if service_enabled and not recently_processed:
                    rich_card_built = False
                    automatic_url = build_automatic_url(
                        item,
                        media_quality,
                        os.getenv("AUTO_TWITTER_PROVIDER", "fixembed"),
                    )
                    request_id = new_request_id()
                    if item.service in SERVICE_NAMES:
                        try:
                            async with conversion_telemetry.observe(
                                item.service, request_id
                            ):
                                if item.service == "Instagram":
                                    layout = await fetch_instagram_layout(
                                        item.canonical_url,
                                        automatic_url,
                                        footer_branding,
                                        card_preferences,
                                    )
                                elif item.service == "Twitter":
                                    fixed_url = build_fixembed_url(item, media_quality)
                                    twitter_language = resolve_twitter_language(
                                        item.language, guild_settings, premium=premium
                                    )
                                    payload = await fetch_twitter_payload(
                                        item.canonical_url,
                                        twitter_language,
                                        item.mode,
                                    )
                                    layout = build_twitter_layout(
                                        payload,
                                        fixed_url,
                                        footer_branding,
                                        card_preferences,
                                    )
                                elif item.service == "Reddit":
                                    layout = await fetch_reddit_layout(
                                        item.canonical_url,
                                        automatic_url,
                                        footer_branding,
                                        card_preferences,
                                    )
                                elif item.service == "Threads":
                                    layout = await fetch_threads_layout(
                                        item.canonical_url,
                                        automatic_url,
                                        footer_branding,
                                        card_preferences,
                                    )
                                elif item.service == "Pixiv":
                                    layout = await fetch_pixiv_layout(
                                        item.canonical_url,
                                        automatic_url,
                                        footer_branding,
                                        card_preferences,
                                    )
                                elif item.service == "Bluesky":
                                    layout = await fetch_bluesky_layout(
                                        item.canonical_url,
                                        automatic_url,
                                        footer_branding,
                                        card_preferences,
                                    )
                                elif item.service == "Bilibili":
                                    layout = await fetch_bilibili_layout(
                                        item.canonical_url,
                                        automatic_url,
                                        footer_branding,
                                        card_preferences,
                                    )
                                elif item.service == "YouTube":
                                    layout = await fetch_youtube_community_layout(
                                        item.canonical_url,
                                        automatic_url,
                                        footer_branding,
                                        card_preferences,
                                    )
                                elif item.service == "Pinterest":
                                    layout = await fetch_pinterest_layout(
                                        item.canonical_url,
                                        automatic_url,
                                        footer_branding,
                                        card_preferences,
                                    )
                                else:
                                    raise ValueError("unsupported rich-card service")
                            component_layouts.append((layout, automatic_url))
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

                if effective_delivery_mode == "delete":
                    if not premium:
                        sender = message.author.mention if mention_users else message.author.display_name
                        formatted_links.append(f"Sent by {sender}")
                    tagged_users = format_tagged_users(message.mentions, message.author.id)
                    if tagged_users:
                        formatted_links.append(tagged_users)
                    allowed_mentions = discord.AllowedMentions(
                        users=[message.author] if mention_users and not premium else [],
                        roles=False,
                        everyone=False,
                        replied_user=False,
                    )
                    for chunk in chunk_lines(formatted_links):
                        await rate_limited_send(
                            message.channel,
                            content=chunk,
                            allowed_mentions=allowed_mentions,
                        )
                    for layout, automatic_url in component_layouts:
                        await rate_limited_send(
                            message.channel,
                            view=layout,
                            fallback_content=automatic_url,
                            allowed_mentions=allowed_mentions,
                        )
                    await apply_source_message_action(
                        "delete",
                        delete_message=message.delete,
                        suppress_message=suppress_source_message,
                        forbidden_errors=(discord.Forbidden,),
                        on_permission_recovery=delivery_telemetry.mode_downgraded,
                    )
                elif effective_delivery_mode == "suppress":
                    await apply_source_message_action(
                        "suppress",
                        delete_message=message.delete,
                        suppress_message=suppress_source_message,
                        forbidden_errors=(discord.Forbidden,),
                        on_permission_recovery=delivery_telemetry.mode_downgraded,
                    )
                    for chunk in chunk_lines(formatted_links):
                        await rate_limited_send(message.channel, content=chunk)
                    for layout, automatic_url in component_layouts:
                        await rate_limited_send(
                            message.channel,
                            view=layout,
                            fallback_content=automatic_url,
                        )
                else:
                    for chunk in chunk_lines(formatted_links):
                        await rate_limited_send(message.channel, content=chunk)
                    for layout, automatic_url in component_layouts:
                        await rate_limited_send(
                            message.channel,
                            view=layout,
                            fallback_content=automatic_url,
                        )

        except discord.Forbidden as error:
            logging.warning("Missing permissions in channel %s: %s", message.channel.id, error)
        except discord.NotFound:
            logging.debug(f"Message already deleted in channel {message.channel.id}")
        except discord.HTTPException as e:
            logging.error(f"HTTP error in on_message: {e}")
        except Exception as e:
            logging.error(f"Unexpected error in on_message: {e}", exc_info=True)

@client.event
async def on_guild_join(guild):
    guild_id = guild.id
    if guild_id not in bot_settings:
        bot_settings[guild_id] = {
            "enabled_services": DEFAULT_ENABLED_SERVICES,
            "mention_users": True,
            "delete_original": True,
            "language": "en",
            "delivery_mode": "suppress",
            "media_quality": "balanced",
            "footer_branding_enabled": False,
            "footer_emoji_id": None,
        }
        await update_setting(
            client.db,
            guild_id,
            bot_settings[guild_id]["enabled_services"],
            bot_settings[guild_id]["mention_users"],
            bot_settings[guild_id]["delete_original"],
            bot_settings[guild_id]["language"],
            bot_settings[guild_id].get("embed_color"),
            bot_settings[guild_id].get("delivery_mode", "suppress"),
            bot_settings[guild_id].get("media_quality", "balanced"),
            bot_settings[guild_id].get("footer_branding_enabled", False),
            bot_settings[guild_id].get("footer_emoji_id"),
        )
    if await send_onboarding_dm(guild):
        logging.info("Sent onboarding DM for guild %s", guild_id)

# --- Premium Command ---
@client.tree.command(name='premium', description="View FixEmbed Premium subscription info")
@app_commands.allowed_installs(guilds=True, users=True)
@app_commands.allowed_contexts(guilds=True, dms=True, private_channels=True)
async def premium_command(interaction: discord.Interaction):
    lang = get_guild_lang(interaction.guild.id if interaction.guild else None)
    premium = False
    if interaction.guild:
        premium = await is_guild_premium(interaction.guild.id)
    
    controls = ()
    if PREMIUM_SKU_ID and not premium:
        subscribe_button = discord.ui.Button(
            style=discord.ButtonStyle.premium,
            sku_id=int(PREMIUM_SKU_ID))
        controls = ((subscribe_button,),)
    status = get_text(lang, "premium_active") if premium else get_text(lang, "premium_not_active")
    view = SettingsNoticeView(
        title=get_text(lang, "premium_title"),
        description=f"{get_text(lang, 'premium_description')}\n\n**Status**\n{status}\n\n**{get_text(lang, 'premium_perks_title')}**\n{get_text(lang, 'premium_perks')}",
        accent_color=discord.Color.gold(),
        footer="Premium",
        controls=controls,
    )
    
    await interaction.response.send_message(view=view, ephemeral=True)

# --- Embed Color Modal ---
class EmbedColorModal(ui.Modal, title="Set Embed Color"):
    color_input = ui.TextInput(
        label="Hex Color Code",
        placeholder="#FF5733 or 'reset'",
        required=True,
        max_length=7)
    
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
            await update_setting(
                client.db, guild_id,
                self.settings.get("enabled_services", DEFAULT_ENABLED_SERVICES),
                self.settings.get("mention_users", True),
                self.settings.get("delete_original", True),
                self.settings.get("language", "en"),
                None,
                self.settings.get("delivery_mode", "suppress"),
                self.settings.get("media_quality", "balanced"),
                self.settings.get("footer_branding_enabled", False),
                self.settings.get("footer_emoji_id"))
            view = SettingsNoticeView(
                title=get_text(lang, "embed_color_title"),
                description=get_text(lang, "embed_color_reset"),
                accent_color=discord.Color.green(),
                footer="Embed color",
            )
            await interaction.response.send_message(view=view, ephemeral=True)
        else:
            # Validate hex color
            hex_color = value.lstrip('#')
            if len(hex_color) == 6:
                try:
                    int(hex_color, 16)
                    color_str = f"#{hex_color.upper()}"
                    self.settings["embed_color"] = color_str
                    await update_setting(
                        client.db, guild_id,
                        self.settings.get("enabled_services", DEFAULT_ENABLED_SERVICES),
                        self.settings.get("mention_users", True),
                        self.settings.get("delete_original", True),
                        self.settings.get("language", "en"),
                        color_str,
                        self.settings.get("delivery_mode", "suppress"),
                        self.settings.get("media_quality", "balanced"),
                        self.settings.get("footer_branding_enabled", False),
                        self.settings.get("footer_emoji_id"))
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

# --- Entitlement Events ---
@client.event
async def on_entitlement_create(entitlement):
    """Called when a user subscribes to premium."""
    if entitlement.guild_id:
        guild_id = entitlement.guild_id
        if guild_id in bot_settings:
            bot_settings[guild_id]["is_premium"] = True
        logging.info(f"Premium activated for guild {guild_id}")
    if PREMIUM_SKU_ID:
        await sync_supporter_role(
            client, entitlement, int(PREMIUM_SKU_ID), SUPPORT_GUILD_ID, SUPPORTER_ROLE_ID)

@client.event
async def on_entitlement_update(entitlement):
    """Called when an entitlement is updated."""
    if entitlement.guild_id:
        guild_id = entitlement.guild_id
        is_active = not entitlement.is_expired()
        if guild_id in bot_settings:
            bot_settings[guild_id]["is_premium"] = is_active
        logging.info(f"Premium {'activated' if is_active else 'deactivated'} for guild {guild_id}")
    if PREMIUM_SKU_ID:
        await sync_supporter_role(
            client, entitlement, int(PREMIUM_SKU_ID), SUPPORT_GUILD_ID, SUPPORTER_ROLE_ID)

@client.event
async def on_entitlement_delete(entitlement):
    """Called when a user's subscription to premium is removed."""
    if entitlement.guild_id:
        guild_id = entitlement.guild_id
        if guild_id in bot_settings:
            bot_settings[guild_id]["is_premium"] = False
        logging.info(f"Premium removed for guild {guild_id}")
    if PREMIUM_SKU_ID:
        await sync_supporter_role(
            client,
            entitlement,
            int(PREMIUM_SKU_ID),
            SUPPORT_GUILD_ID,
            SUPPORTER_ROLE_ID,
            active=False,
        )


@client.event
async def on_member_join(member):
    """Grant returning Premium purchasers their Supporters role on join."""
    if PREMIUM_SKU_ID and member.guild.id == SUPPORT_GUILD_ID:
        await sync_supporter_role_for_member(
            client,
            member,
            int(PREMIUM_SKU_ID),
            SUPPORT_GUILD_ID,
            SUPPORTER_ROLE_ID,
        )

# Loading the bot token from .env
load_dotenv()
bot_token = os.getenv('BOT_TOKEN')
PREMIUM_SKU_ID = os.getenv('PREMIUM_SKU_ID')
client.run(bot_token)
