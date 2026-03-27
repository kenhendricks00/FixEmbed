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

# Version number
VERSION = "1.2.5"

# Service configuration for link processing
# All services now use the unified FixEmbed service at fixembed.app
SERVICES = {
    "Twitter": {
        "patterns": [r"twitter\.com/(\w+)/status/(\d+)", r"x\.com/(\w+)/status/(\d+)"],
        "base_url": "fixembed.app",
        "display_format": "Twitter • {0}"
    },
    "Instagram": {
        "patterns": [r"instagram\.com/(?:p|reel)/([\w-]+)"],
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
        "patterns": [r"bsky\.app/profile/([^/]+)/post/([\w-]+)"],
        "base_url": "fixembed.app",
        "display_format": "Bluesky • {0}"
    },
    "Bilibili": {
        "patterns": [r"bilibili\.com/video/([\w]+)", r"b23\.tv/([\w]+)"],
        "base_url": "fixembed.app",
        "display_format": "Bilibili • {0}"
    }
}

SERVICE_NAMES = list(SERVICES.keys())
DEFAULT_ENABLED_SERVICES = SERVICE_NAMES.copy()
SERVICE_EMOJI_FALLBACKS = {
    "Twitter": "𝕏",
    "Instagram": "📷",
    "Reddit": "👽",
    "Threads": "🧵",
    "Pixiv": "🎨",
    "Bluesky": "🦋",
    "Bilibili": "📺",
}

def get_custom_service_emoji(guild: Optional[discord.Guild], service: str) -> Optional[discord.Emoji]:
    """Return a guild custom emoji for a service, if available."""
    if guild is None:
        return None
    for candidate in (service.lower(), service.replace(" ", "").lower()):
        emoji = discord.utils.get(guild.emojis, name=candidate)
        if emoji:
            return emoji
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
client = commands.Bot(command_prefix='/', intents=intents, shard_count=10)

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
processing_stats = {
    "total_fixed": 0,
    "total_failed": 0,
    "by_service": {}
}

async def rate_limited_send(channel, content=None, embed=None):
    await SEND_QUEUE.put((channel, content, embed))

async def send_worker():
    while True:
        channel, content, embed = await SEND_QUEUE.get()
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
            await channel.send(content=content, embed=embed)
        except Exception as e:
            logging.error(f"Queue send failed: {e}")
        finally:
            SEND_QUEUE.task_done()

def create_footer(embed, client):
    embed.set_footer(text=f"{client.user.name} | v{VERSION}", icon_url=client.user.avatar.url)

# Premium SKU ID (loaded from .env at bottom of file)
PREMIUM_SKU_ID = None

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

async def init_db():
    db = await aiosqlite.connect('fixembed_data.db')
    await db.execute('''CREATE TABLE IF NOT EXISTS channel_states (channel_id INTEGER PRIMARY KEY, state BOOLEAN)''')
    await db.commit()
    await db.execute('''CREATE TABLE IF NOT EXISTS guild_settings (guild_id INTEGER PRIMARY KEY, enabled_services TEXT, mention_users BOOLEAN, delete_original BOOLEAN DEFAULT TRUE, language TEXT DEFAULT 'en', embed_color TEXT DEFAULT NULL, delivery_mode TEXT DEFAULT 'suppress', media_quality TEXT DEFAULT 'balanced')''')
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
    async with db.execute('SELECT guild_id, enabled_services, mention_users, delete_original, language, embed_color, delivery_mode, media_quality FROM guild_settings') as cursor:
        async for row in cursor:
            guild_id = row[0]
            enabled_services = row[1]
            mention_users = row[2]
            delete_original = row[3]
            language = row[4] if len(row) > 4 else "en"
            embed_color = row[5] if len(row) > 5 else None
            delivery_mode = row[6] if len(row) > 6 else "suppress"
            media_quality = row[7] if len(row) > 7 else "balanced"
            enabled_services_list = ast.literal_eval(enabled_services) if enabled_services else DEFAULT_ENABLED_SERVICES          
            bot_settings[guild_id] = {
                "enabled_services": enabled_services_list,
                "mention_users": mention_users if mention_users is not None else True,
                "delete_original": delete_original if delete_original is not None else True,
                "language": language if language else "en",
                "embed_color": embed_color,
                "delivery_mode": delivery_mode if delivery_mode else "suppress",
                "media_quality": media_quality if media_quality else "balanced"
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

async def update_setting(db, guild_id, enabled_services, mention_users, delete_original, language="en", embed_color=None, delivery_mode="suppress", media_quality="balanced"):
    retries = 5
    for i in range(retries):
        try:
            await db.execute('INSERT OR REPLACE INTO guild_settings (guild_id, enabled_services, mention_users, delete_original, language, embed_color, delivery_mode, media_quality) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', (guild_id, repr(enabled_services), mention_users, delete_original, language, embed_color, delivery_mode, media_quality))
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
    client.db = await init_db()
    await load_channel_states(client.db)
    await load_settings(client.db)
    await load_channel_service_rules(client.db)
    change_status.start()
    client.loop.create_task(send_worker())

    try:
        synced = await client.tree.sync()
        print(f'Synced {len(synced)} command(s)')
    except Exception as e:
        print(f'Failed to sync commands: {e}')

    client.launch_time = discord.utils.utcnow()

statuses = itertools.cycle([
    "for Twitter links", "for Reddit links", "for Instagram links", "for Threads links", "for Pixiv links", "for Bluesky links", "for Bilibili links"
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
    embed = discord.Embed(title=f"{client.user.name}",
                          description=get_text(lang, "activated_for", channel=channel.mention),
                          color=discord.Color(0x78b159))
    create_footer(embed, client)
    await interaction.response.send_message(embed=embed)

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
    embed = discord.Embed(title=f"{client.user.name}",
                          description=get_text(lang, "deactivated_for", channel=channel.mention),
                          color=discord.Color.red())
    create_footer(embed, client)
    await interaction.response.send_message(embed=embed)

@client.tree.command(
    name='about',
    description="Show information about the bot")
@app_commands.allowed_installs(guilds=True, users=True)
@app_commands.allowed_contexts(guilds=True, dms=True, private_channels=True)
async def about(interaction: discord.Interaction):
    guild_id = interaction.guild.id if interaction.guild else None
    lang = get_guild_lang(guild_id)
    embed = discord.Embed(
        title=get_text(lang, "about_title"),
        description=get_text(lang, "about_description"),
        color=get_guild_color(guild_id, discord.Color(0x7289DA)))
    embed.add_field(
        name=get_text(lang, "quick_links"),
        value=(
            "- [Invite FixEmbed](https://discord.com/oauth2/authorize?client_id=1173820242305224764)\n"
            "- [Vote for FixEmbed on Top.gg](https://top.gg/bot/1173820242305224764)\n"
            "- [Star our Source Code on GitHub](https://github.com/kenhendricks00/FixEmbedBot)\n"
            "- [Join the Support Server](https://discord.gg/QFxTAmtZdn)"
        ),
        inline=False)
    embed.add_field(
        name=get_text(lang, "credits"),
        value=(
            "- [VxInstagram](https://github.com/Lainmode/InstagramEmbed-vxinstagram), created by Lainmode\n"
            "- [Snapsave](https://snapsave.app)\n"
            "- [Phixiv](https://github.com/thelaao/phixiv), created by thelaao\n"
            "- [VxBilibili](https://github.com/niconi21/vxBilibili), created by niconi21\n"
        ),
        inline=False)
    create_footer(embed, client)
    await interaction.response.send_message(embed=embed)

@client.tree.command(
    name='help',
    description="Show all available commands")
@app_commands.allowed_installs(guilds=True, users=True)
@app_commands.allowed_contexts(guilds=True, dms=True, private_channels=True)
async def help_command(interaction: discord.Interaction):
    guild_id = interaction.guild.id if interaction.guild else None
    lang = get_guild_lang(guild_id)
    embed = discord.Embed(
        title=get_text(lang, "help_title"),
        description=get_text(lang, "help_description"),
        color=get_guild_color(guild_id, discord.Color(0x7289DA)))
    
    embed.add_field(
        name=get_text(lang, "fix_links"),
        value=get_text(lang, "fix_links_value"),
        inline=False)
    
    embed.add_field(
        name=get_text(lang, "server_settings"),
        value=get_text(lang, "server_settings_value"),
        inline=False)
    
    embed.add_field(
        name=get_text(lang, "info"),
        value=get_text(lang, "info_value"),
        inline=False)
    
    embed.add_field(
        name="💎 " + get_text(lang, "premium_title"),
        value=get_text(lang, "premium_help_value"),
        inline=False)
    
    embed.add_field(
        name=get_text(lang, "supported_services"),
        value=get_text(lang, "supported_services_value"),
        inline=False)
    
    embed.add_field(
        name=get_text(lang, "tip"),
        value=get_text(lang, "tip_value"),
        inline=False)
    
    embed.add_field(
        name=get_text(lang, "languages_supported"),
        value=get_text(lang, "languages_supported_value"),
        inline=False)
    
    create_footer(embed, client)
    await interaction.response.send_message(embed=embed)

@client.tree.command(
    name='fix',
    description="Convert a social media link to an embed-friendly version")
@app_commands.describe(link="The link to convert (Twitter, Instagram, Reddit, etc.)")
@app_commands.allowed_installs(guilds=True, users=True)
@app_commands.allowed_contexts(guilds=True, dms=True, private_channels=True)
async def fix_link(interaction: discord.Interaction, link: str):
    """Convert a social media link to an embed-friendly version."""
    lang = get_guild_lang(interaction.guild.id if interaction.guild else None)
    # Standard link pattern to capture all the relevant links (YouTube removed)
    link_pattern = r"https?://(?:www\.)?(twitter\.com/\w+/status/\d+|x\.com/\w+/status/\d+|instagram\.com/(?:p|reel)/[\w-]+|reddit\.com/r/\w+/s/\w+|reddit\.com/r/\w+/comments/\w+/\w+|old\.reddit\.com/r/\w+/comments/\w+/\w+|pixiv\.net/(?:en/)?artworks/\d+|threads\.net/@[^/]+/post/[\w-]+|bsky\.app/profile/[^/]+/post/[\w-]+|bilibili\.com/video/[\w]+|b23\.tv/[\w]+)"
    match = re.search(link_pattern, link)
    
    if not match:
        await interaction.response.send_message(get_text(lang, "no_supported_link"), ephemeral=True)
        return
    
    original_link = match.group(0)  # Get full URL including https://
    matched_path = match.group(1)   # Get the path portion
    display_text = ""
    
    # Determine display text based on platform
    if 'twitter.com' in matched_path or 'x.com' in matched_path:
        user_match = re.findall(r"(?:twitter\.com|x\.com)/(\w+)/status/\d+", matched_path)
        user = user_match[0] if user_match else "Unknown"
        display_text = f"Twitter • {user}"
        
    elif 'instagram.com' in matched_path:
        user_match = re.findall(r"instagram\.com/(?:p|reel)/([\w-]+)", matched_path)
        user = user_match[0] if user_match else "Unknown"
        display_text = f"Instagram • {user}"
        
    elif 'reddit.com' in matched_path or 'old.reddit.com' in matched_path:
        community_match = re.findall(r"(?:reddit\.com|old\.reddit\.com)/r/(\w+)", matched_path)
        community = community_match[0] if community_match else "Unknown"
        display_text = f"Reddit • r/{community}"
        
    elif 'pixiv.net' in matched_path:
        id_match = re.findall(r"pixiv\.net/(?:en/)?artworks/(\d+)", matched_path)
        artwork_id = id_match[0] if id_match else "Unknown"
        display_text = f"Pixiv • {artwork_id}"
        
    elif 'threads.net' in matched_path:
        user_match = re.findall(r"threads\.net/@([^/]+)/post/([\w-]+)", matched_path)
        if user_match:
            user = user_match[0][0]
            display_text = f"Threads • @{user}"
        
    elif 'bsky.app' in matched_path:
        bsky_match = re.findall(r"bsky\.app/profile/([^/]+)/post/([\w-]+)", matched_path)
        if bsky_match:
            user = bsky_match[0][0]
            display_text = f"Bluesky • {user}"
    
    elif 'bilibili.com' in matched_path or 'b23.tv' in matched_path:
        if 'bilibili.com' in matched_path:
            video_id_match = re.findall(r"bilibili\.com/video/([\w]+)", matched_path)
        else:
            video_id_match = re.findall(r"b23\.tv/([\w]+)", matched_path)
        if video_id_match:
            video_id = video_id_match[0]
            display_text = f"Bilibili • {video_id}"
    
    if display_text:
        # Use the unified FixEmbed service
        import urllib.parse
        embed_url = f"https://fixembed.app/embed?url={urllib.parse.quote(original_link, safe='')}"
        await interaction.response.send_message(f"[{display_text}]({embed_url})")
    else:
        await interaction.response.send_message(get_text(lang, "could_not_convert"), ephemeral=True)

@client.tree.context_menu(name='Fix Embed')
@app_commands.allowed_installs(guilds=True, users=True)
@app_commands.allowed_contexts(guilds=True, dms=True, private_channels=True)
async def fix_embed_context(interaction: discord.Interaction, message: discord.Message):
    """Convert social media links in a message to embed-friendly versions."""
    import urllib.parse
    lang = get_guild_lang(interaction.guild.id if interaction.guild else None)
    # Standard link pattern to capture all the relevant links (YouTube removed)
    link_pattern = r"(https?://(?:www\.)?(?:twitter\.com/\w+/status/\d+|x\.com/\w+/status/\d+|instagram\.com/(?:p|reel)/[\w-]+|reddit\.com/r/\w+/s/\w+|reddit\.com/r/\w+/comments/\w+/\w+|old\.reddit\.com/r/\w+/comments/\w+/\w+|pixiv\.net/(?:en/)?artworks/\d+|threads\.net/@[^/]+/post/[\w-]+|bsky\.app/profile/[^/]+/post/[\w-]+|bilibili\.com/video/[\w]+|b23\.tv/[\w]+))"
    matches = re.findall(link_pattern, message.content)
    
    if not matches:
        await interaction.response.send_message(get_text(lang, "no_links_found"), ephemeral=True)
        return
    
    fixed_links = []
    
    for original_link in matches:
        display_text = ""
        
        if 'twitter.com' in original_link or 'x.com' in original_link:
            user_match = re.findall(r"(?:twitter\.com|x\.com)/(\w+)/status/\d+", original_link)
            user = user_match[0] if user_match else "Unknown"
            display_text = f"Twitter • {user}"
            
        elif 'instagram.com' in original_link:
            user_match = re.findall(r"instagram\.com/(?:p|reel)/([\w-]+)", original_link)
            user = user_match[0] if user_match else "Unknown"
            display_text = f"Instagram • {user}"
            
        elif 'reddit.com' in original_link or 'old.reddit.com' in original_link:
            community_match = re.findall(r"(?:reddit\.com|old\.reddit\.com)/r/(\w+)", original_link)
            community = community_match[0] if community_match else "Unknown"
            display_text = f"Reddit • r/{community}"
            
        elif 'pixiv.net' in original_link:
            id_match = re.findall(r"pixiv\.net/(?:en/)?artworks/(\d+)", original_link)
            artwork_id = id_match[0] if id_match else "Unknown"
            display_text = f"Pixiv • {artwork_id}"
            
        elif 'threads.net' in original_link:
            user_match = re.findall(r"threads\.net/@([^/]+)/post/([\w-]+)", original_link)
            if user_match:
                user = user_match[0][0]
                display_text = f"Threads • @{user}"
            
        elif 'bsky.app' in original_link:
            bsky_match = re.findall(r"bsky\.app/profile/([^/]+)/post/([\w-]+)", original_link)
            if bsky_match:
                user = bsky_match[0][0]
                display_text = f"Bluesky • {user}"
        
        elif 'bilibili.com' in original_link or 'b23.tv' in original_link:
            if 'bilibili.com' in original_link:
                video_id_match = re.findall(r"bilibili\.com/video/([\w]+)", original_link)
            else:
                video_id_match = re.findall(r"b23\.tv/([\w]+)", original_link)
            if video_id_match:
                video_id = video_id_match[0]
                display_text = f"Bilibili • {video_id}"
        
        if display_text:
            embed_url = f"https://fixembed.app/embed?url={urllib.parse.quote(original_link, safe='')}"
            fixed_links.append(f"[{display_text}]({embed_url})")
    
    if fixed_links:
        response = "\n".join(fixed_links)
        await interaction.response.send_message(response)
    else:
        await interaction.response.send_message("Could not convert any links.", ephemeral=True)

async def debug_info(interaction: discord.Interaction, channel: Optional[discord.TextChannel] = None):
    if not channel:
        channel = interaction.channel

    guild = interaction.guild
    permissions = channel.permissions_for(guild.me)
    fix_embed_status = channel_states.get(channel.id, True)
    fix_embed_activated = all(channel_states.get(ch.id, True) for ch in guild.text_channels)

    embed = discord.Embed(
        title="Debug Information",
        description="For more help, join the [support server](https://discord.gg/QFxTAmtZdn)",
        color=get_guild_color(guild.id, discord.Color(0x7289DA)))
    
    embed.add_field(
        name="Status and Permissions",
        value=(
            f'{f"🟢 **FixEmbed working in** {channel.mention}" if fix_embed_status else f"🔴 **FixEmbed not working in** {channel.mention}"}\n'
            f"- {'🟢 FixEmbed activated' if fix_embed_status else '🔴 FixEmbed deactivated'}\n"
            f"- {'🟢' if permissions.read_messages else '🔴'} Read message permission\n"
            f"- {'🟢' if permissions.send_messages else '🔴'} Send message permission\n"
            f"- {'🟢' if permissions.embed_links else '🔴'} Embed links permission\n"
            f"- {'🟢' if permissions.manage_messages else '🔴'} Manage messages permission"
        ),
        inline=False
    )

    shard_id = client.shard_id if client.shard_id is not None else 0
    embed.add_field(
        name="FixEmbed Stats",
        value=(
            f"```\n"
            f"Status: {'Activated' if fix_embed_activated else 'Deactivated'}\n"
            f"Shard: {shard_id + 1}\n"
            f"Uptime: {str(discord.utils.utcnow() - client.launch_time).split('.')[0]}\n"
            f"Version: {VERSION}\n"
            f"```"
        ),
        inline=False
    )

    create_footer(embed, client)
    await interaction.response.send_message(embed=embed, view=SettingsView(interaction, bot_settings.get(interaction.guild.id, {"enabled_services": DEFAULT_ENABLED_SERVICES, "mention_users": True, "delete_original": True, "delivery_mode": "suppress", "media_quality": "balanced"})))

class SettingsDropdown(ui.Select):

    def __init__(self, interaction, settings):
        self.interaction = interaction
        self.settings = settings
        lang = settings.get("language", "en")
        activated = all(
            channel_states.get(ch.id, True)
            for ch in interaction.guild.text_channels)
        mention_users = settings.get("mention_users", True)
        delivery_mode = settings.get("delivery_mode", "suppress")
        
        options = [
            discord.SelectOption(
                label=get_text(lang, "fixembed_settings"),
                description=get_text(lang, "fixembed_activate_deactivate"),
                emoji="🟢" if activated else "🔴",
                value="FixEmbed"
            ),
            discord.SelectOption(
                label=get_text(lang, "mention_users"),
                description=get_text(lang, "mention_users_toggle"),
                emoji="🔔" if mention_users else "🔕",
                value="Mention Users"
            ),
            discord.SelectOption(
                label=get_text(lang, "delivery_method"),
                description=get_text(lang, "delivery_method_toggle"),
                emoji="🗑️" if delivery_mode == "delete" else ("🙈" if delivery_mode == "suppress" else "💬"),
                value="Delivery Method"
            ),
            discord.SelectOption(
                label=get_text(lang, "service_settings"),
                description=get_text(lang, "service_settings_desc"),
                emoji="⚙️",
                value="Service Settings"),
            discord.SelectOption(
                label=get_text(lang, "quality_profile"),
                description=get_text(lang, "quality_profile_desc"),
                emoji="🎞️",
                value="Quality Profile"),
            discord.SelectOption(
                label=get_text(lang, "channel_rules"),
                description=get_text(lang, "channel_rules_desc"),
                emoji="🧭",
                value="Channel Rules"),
            discord.SelectOption(
                label=get_text(lang, "reliability_status"),
                description=get_text(lang, "reliability_status_desc"),
                emoji="📊",
                value="Reliability Status"),
            discord.SelectOption(
                label=get_text(lang, "language"),
                description=get_text(lang, "language_desc"),
                emoji="🌐",
                value="Language"),
            discord.SelectOption(
                label=get_text(lang, "debug"),
                description=get_text(lang, "debug_desc"),
                emoji="\U0001f41e",
                value="Debug"
            ),
            discord.SelectOption(
                label=get_text(lang, "embed_color"),
                description=get_text(lang, "embed_color_desc"),
                emoji="\U0001f48e",
                value="Embed Color"
            )
        ]
        super().__init__(placeholder=get_text(lang, "choose_option"),
                         min_values=1,
                         max_values=1,
                         options=options)

    async def callback(self, interaction: discord.Interaction):
        lang = self.settings.get("language", "en")
        status_activated = get_text(lang, "activated")
        status_deactivated = get_text(lang, "deactivated")
        
        if self.values[0] == "Delivery Method":
            delivery_mode = self.settings.get("delivery_mode", "suppress")
            mode_text = {
                "delete": "Delete original message and post fixed link",
                "suppress": "Keep message, suppress original embed, and post fixed link",
                "reply": "Keep original message and post fixed link"
            }.get(delivery_mode, "Delete original message and post fixed link")
            embed = discord.Embed(
                title=get_text(lang, "delivery_method_title"),
                description=f"Current mode: **{delivery_mode}**\n{mode_text}",
                color=get_guild_color(self.interaction.guild.id))
            view = DeliveryMethodSettingsView(delivery_mode, self.interaction, self.settings)
            await interaction.response.send_message(embed=embed, view=view, ephemeral=True)
        elif self.values[0] == "FixEmbed":
            activated = all(
                channel_states.get(ch.id, True)
                for ch in interaction.guild.text_channels)
            working_status = get_text(lang, "working_in", channel="") if activated else get_text(lang, "not_working_in", channel="")
            embed = discord.Embed(
                title=get_text(lang, "fixembed_settings"),
                description=f"{working_status.replace('**', '').strip()}\n\n{get_text(lang, 'note_apply_changes')}",
                color=discord.Color.green() if activated else discord.Color.red())
            view = FixEmbedSettingsView(activated, self.interaction, self.settings)
            await interaction.response.send_message(embed=embed, view=view, ephemeral=True)
        elif self.values[0] == "Mention Users":
            mention_users = self.settings.get("mention_users", True)
            embed = discord.Embed(
                title=get_text(lang, "mention_users_title"),
                description=get_text(lang, "user_mentions_status", status=status_activated if mention_users else status_deactivated),
                color=discord.Color.green() if mention_users else discord.Color.red())
            view = MentionUsersSettingsView(mention_users, self.interaction, self.settings)
            await interaction.response.send_message(embed=embed, view=view, ephemeral=True)
        elif self.values[0] == "Service Settings":
            enabled_services = self.settings.get("enabled_services", DEFAULT_ENABLED_SERVICES)
            service_status_list = "\n".join([
                f"{'🟢' if service in enabled_services else '🔴'} {get_service_display_icon(interaction.guild, service)} {service}"
                for service in DEFAULT_ENABLED_SERVICES
            ])
            embed = discord.Embed(
                title=get_text(lang, "service_settings"),
                description=f"{get_text(lang, 'activated_services')}\n{service_status_list}",
                color=get_guild_color(self.interaction.guild.id))
            view = ServiceSettingsView(self.interaction, self.settings)
            await interaction.response.send_message(embed=embed, view=view, ephemeral=True)
        elif self.values[0] == "Quality Profile":
            current_quality = self.settings.get("media_quality", "balanced")
            embed = discord.Embed(
                title=get_text(lang, "quality_profile"),
                description=get_text(lang, "quality_current_profile", profile=current_quality),
                color=get_guild_color(self.interaction.guild.id))
            view = QualitySettingsView(self.interaction, self.settings)
            await interaction.response.send_message(embed=embed, view=view, ephemeral=True)
        elif self.values[0] == "Channel Rules":
            embed = discord.Embed(
                title=get_text(lang, "channel_rules_title"),
                description=get_text(lang, "channel_rules_instructions"),
                color=get_guild_color(self.interaction.guild.id))
            view = ChannelRulesSettingsView(self.interaction, self.settings)
            await interaction.response.send_message(embed=embed, view=view, ephemeral=True)
        elif self.values[0] == "Reliability Status":
            by_service = processing_stats.get("by_service", {})
            service_lines = []
            for service in DEFAULT_ENABLED_SERVICES:
                data = by_service.get(service, {"ok": 0, "fail": 0})
                service_lines.append(f"- {get_service_display_icon(interaction.guild, service)} {service}: ✅ {data['ok']} | ❌ {data['fail']}")
            embed = discord.Embed(title=get_text(lang, "reliability_status_title"), color=get_guild_color(self.interaction.guild.id))
            embed.add_field(name=get_text(lang, "status_queue"), value=get_text(lang, "status_pending_sends", count=SEND_QUEUE.qsize()), inline=False)
            embed.add_field(name=get_text(lang, "status_totals"), value=f"{get_text(lang, 'status_fixed', count=processing_stats['total_fixed'])}\n{get_text(lang, 'status_failed', count=processing_stats['total_failed'])}", inline=False)
            embed.add_field(name=get_text(lang, "status_per_service"), value="\n".join(service_lines), inline=False)
            await interaction.response.send_message(embed=embed, ephemeral=True)
        elif self.values[0] == "Debug":
            await debug_info(interaction, interaction.channel)
        elif self.values[0] == "Language":
            current_lang = self.settings.get("language", "en")
            current_lang_name = LANGUAGE_NAMES.get(current_lang, "English")
            embed = discord.Embed(
                title=get_text(lang, "language_title"),
                description=get_text(lang, "language_current", language=current_lang_name),
                color=get_guild_color(self.interaction.guild.id))
            view = LanguageSettingsView(self.interaction, self.settings)
            await interaction.response.send_message(embed=embed, view=view, ephemeral=True)
        elif self.values[0] == "Embed Color":
            premium = await is_guild_premium(self.interaction.guild.id)
            if premium:
                current_color = self.settings.get("embed_color")
                color_desc = get_text(lang, "premium_current_color", color=current_color) if current_color else get_text(lang, "premium_no_color")
                modal = EmbedColorModal(self.interaction, self.settings)
                await interaction.response.send_modal(modal)
            else:
                embed = discord.Embed(
                    title=get_text(lang, "embed_color_title"),
                    description=get_text(lang, "premium_required"),
                    color=discord.Color.gold())
                view = discord.ui.View()
                if PREMIUM_SKU_ID:
                    btn = discord.ui.Button(style=discord.ButtonStyle.premium, sku_id=int(PREMIUM_SKU_ID))
                    view.add_item(btn)
                await interaction.response.send_message(embed=embed, view=view, ephemeral=True)



class ServicesDropdown(ui.Select):

    def __init__(self, interaction, parent_view, settings):
        self.interaction = interaction
        self.parent_view = parent_view
        self.settings = settings
        enabled_services = settings.get("enabled_services", DEFAULT_ENABLED_SERVICES)
        options = [
            discord.SelectOption(
                label=service,
                description=f"Activate or deactivate {service} links",
                emoji=get_service_select_emoji(interaction.guild, service),
                default=service in enabled_services)
            for service in DEFAULT_ENABLED_SERVICES
        ]
        super().__init__(placeholder="Select services to activate...",
                         min_values=1,
                         max_values=len(options),
                         options=options)

    async def callback(self, interaction: discord.Interaction):
        selected_services = self.values
        guild_id = self.interaction.guild.id
        self.settings["enabled_services"] = selected_services
        await update_setting(client.db, guild_id, selected_services, self.settings["mention_users"], self.settings["delete_original"], self.settings.get("language", "en"), self.settings.get("embed_color"), self.settings.get("delivery_mode", "suppress"), self.settings.get("media_quality", "balanced"))

        self.parent_view.clear_items()
        self.parent_view.add_item(
            ServicesDropdown(self.interaction, self.parent_view, self.settings))
        self.parent_view.add_item(SettingsDropdown(self.interaction, self.settings))

        service_status_list = "\n".join([
            f"{'🟢' if service in selected_services else '🔴'} {get_service_display_icon(self.interaction.guild, service)} {service}"
            for service in DEFAULT_ENABLED_SERVICES
        ])
        embed = discord.Embed(
            title="Service Settings",
            description=f"Configure which services are activated.\n\n**Activated services:**\n{service_status_list}",
            color=get_guild_color(self.interaction.guild.id))
        
        try:
            await interaction.response.edit_message(embed=embed, view=self.parent_view)
        except discord.errors.NotFound:
            try:
                await interaction.edit_original_response(embed=embed, view=self.parent_view)
            except discord.errors.NotFound:
                logging.error("Failed to edit original response: Unknown Webhook")
        except discord.errors.InteractionResponded:
            try:
                await interaction.edit_original_response(embed=embed, view=self.parent_view)
            except discord.errors.NotFound:
                logging.error("Failed to edit original response: Unknown Webhook")

class SettingsView(ui.View):

    def __init__(self, interaction, settings):
        super().__init__()
        self.add_item(SettingsDropdown(interaction, settings))

class ServiceSettingsView(ui.View):

    def __init__(self, interaction, settings):
        super().__init__()
        self.add_item(ServicesDropdown(interaction, self, settings))
        self.add_item(SettingsDropdown(interaction, settings))


class QualityDropdown(ui.Select):
    def __init__(self, interaction, parent_view, settings):
        self.interaction = interaction
        self.parent_view = parent_view
        self.settings = settings
        lang = settings.get("language", "en")
        current_quality = settings.get("media_quality", "balanced")
        options = [
            discord.SelectOption(label=get_text(lang, "quality_fastest"), value="fastest", description=get_text(lang, "quality_fastest_desc"), default=current_quality == "fastest"),
            discord.SelectOption(label=get_text(lang, "quality_balanced"), value="balanced", description=get_text(lang, "quality_balanced_desc"), default=current_quality == "balanced"),
            discord.SelectOption(label=get_text(lang, "quality_highest"), value="highest", description=get_text(lang, "quality_highest_desc"), default=current_quality == "highest"),
        ]
        super().__init__(placeholder=get_text(lang, "quality_select_placeholder"), min_values=1, max_values=1, options=options)

    async def callback(self, interaction: discord.Interaction):
        selected_quality = self.values[0]
        self.settings["media_quality"] = selected_quality
        await update_setting(
            client.db,
            self.interaction.guild.id,
            self.settings.get("enabled_services", DEFAULT_ENABLED_SERVICES),
            self.settings.get("mention_users", True),
            self.settings.get("delete_original", True),
            self.settings.get("language", "en"),
            self.settings.get("embed_color"),
            self.settings.get("delivery_mode", "suppress"),
            selected_quality,
        )
        embed = discord.Embed(
            title=get_text(self.settings.get("language", "en"), "quality_profile"),
            description=get_text(self.settings.get("language", "en"), "quality_set", profile=selected_quality),
            color=get_guild_color(self.interaction.guild.id))
        await interaction.response.edit_message(embed=embed, view=self.parent_view)


class QualitySettingsView(ui.View):
    def __init__(self, interaction, settings, timeout=180):
        super().__init__(timeout=timeout)
        self.interaction = interaction
        self.settings = settings
        self.add_item(QualityDropdown(interaction, self, settings))
        self.add_item(SettingsDropdown(interaction, settings))


class ChannelDropdown(ui.Select):
    def __init__(self, interaction, parent_view):
        self.interaction = interaction
        self.parent_view = parent_view
        channels = interaction.guild.text_channels[:25]
        options = [
            discord.SelectOption(label=ch.name[:100], value=str(ch.id), default=(parent_view.selected_channel_id == ch.id))
            for ch in channels
        ]
        super().__init__(placeholder=get_text(parent_view.settings.get("language", "en"), "channel_rules_pick_channel"), min_values=1, max_values=1, options=options)

    async def callback(self, interaction: discord.Interaction):
        self.parent_view.selected_channel_id = int(self.values[0])
        await self.parent_view.refresh(interaction)


class RuleServiceDropdown(ui.Select):
    def __init__(self, interaction, parent_view):
        self.interaction = interaction
        self.parent_view = parent_view
        options = [
            discord.SelectOption(
                label=s,
                value=s,
                emoji=get_service_select_emoji(interaction.guild, s),
                default=(parent_view.selected_service == s),
            )
            for s in DEFAULT_ENABLED_SERVICES
        ]
        super().__init__(placeholder=get_text(parent_view.settings.get("language", "en"), "channel_rules_pick_service"), min_values=1, max_values=1, options=options)

    async def callback(self, interaction: discord.Interaction):
        self.parent_view.selected_service = self.values[0]
        await self.parent_view.refresh(interaction)


class RuleActionDropdown(ui.Select):
    def __init__(self, interaction, parent_view):
        self.interaction = interaction
        self.parent_view = parent_view
        options = [
            discord.SelectOption(label=get_text(parent_view.settings.get("language", "en"), "channel_rules_force_on"), value="on", default=(parent_view.selected_action == "on")),
            discord.SelectOption(label=get_text(parent_view.settings.get("language", "en"), "channel_rules_force_off"), value="off", default=(parent_view.selected_action == "off")),
            discord.SelectOption(label=get_text(parent_view.settings.get("language", "en"), "channel_rules_default"), value="default", default=(parent_view.selected_action == "default")),
        ]
        super().__init__(placeholder=get_text(parent_view.settings.get("language", "en"), "channel_rules_pick_action"), min_values=1, max_values=1, options=options)

    async def callback(self, interaction: discord.Interaction):
        self.parent_view.selected_action = self.values[0]
        await self.parent_view.refresh(interaction)


class ApplyRuleButton(discord.ui.Button):
    def __init__(self, parent_view):
        super().__init__(label=get_text(parent_view.settings.get("language", "en"), "channel_rules_apply"), style=discord.ButtonStyle.green)
        self.parent_view = parent_view

    async def callback(self, interaction: discord.Interaction):
        if not self.parent_view.selected_channel_id or not self.parent_view.selected_service or not self.parent_view.selected_action:
            await interaction.response.send_message(get_text(self.parent_view.settings.get("language", "en"), "channel_rules_select_all"), ephemeral=True)
            return
        guild_id = self.parent_view.interaction.guild.id
        channel_id = self.parent_view.selected_channel_id
        service = self.parent_view.selected_service
        action = self.parent_view.selected_action
        if action == "default":
            await client.db.execute("DELETE FROM channel_service_rules WHERE guild_id = ? AND channel_id = ? AND service = ?", (guild_id, channel_id, service))
            await client.db.commit()
            channel_service_rules.pop((guild_id, channel_id, service), None)
        else:
            await set_channel_service_rule(client.db, guild_id, channel_id, service, action)
        channel = self.parent_view.interaction.guild.get_channel(channel_id)
        channel_name = channel.mention if channel else str(channel_id)
        embed = discord.Embed(
            title=get_text(self.parent_view.settings.get("language", "en"), "channel_rules_title"),
            description=get_text(self.parent_view.settings.get("language", "en"), "channel_rules_updated", channel=channel_name, service=service, action=action),
            color=get_guild_color(self.parent_view.interaction.guild.id))
        await interaction.response.edit_message(embed=embed, view=self.parent_view)


class ChannelRulesSettingsView(ui.View):
    def __init__(self, interaction, settings, timeout=180):
        super().__init__(timeout=timeout)
        self.interaction = interaction
        self.settings = settings
        self.selected_channel_id = interaction.channel.id if interaction.channel else None
        self.selected_service = "Twitter"
        self.selected_action = "default"
        self.add_item(ChannelDropdown(interaction, self))
        self.add_item(RuleServiceDropdown(interaction, self))
        self.add_item(RuleActionDropdown(interaction, self))
        self.add_item(ApplyRuleButton(self))
        self.add_item(SettingsDropdown(interaction, settings))

    async def refresh(self, interaction: discord.Interaction):
        self.clear_items()
        self.add_item(ChannelDropdown(self.interaction, self))
        self.add_item(RuleServiceDropdown(self.interaction, self))
        self.add_item(RuleActionDropdown(self.interaction, self))
        self.add_item(ApplyRuleButton(self))
        self.add_item(SettingsDropdown(self.interaction, self.settings))
        channel = self.interaction.guild.get_channel(self.selected_channel_id) if self.selected_channel_id else None
        channel_name = channel.mention if channel else "None"
        embed = discord.Embed(
            title=get_text(self.settings.get("language", "en"), "channel_rules_title"),
            description=get_text(self.settings.get("language", "en"), "channel_rules_selections", channel=channel_name, service=self.selected_service, action=self.selected_action),
            color=get_guild_color(self.interaction.guild.id))
        await interaction.response.edit_message(embed=embed, view=self)

class LanguageDropdown(ui.Select):

    def __init__(self, interaction, parent_view, settings):
        self.interaction = interaction
        self.parent_view = parent_view
        self.settings = settings
        current_lang = settings.get("language", "en")
        
        options = [
            discord.SelectOption(
                label=name,
                value=code,
                description=f"Set language to {name}",
                default=(code == current_lang)
            )
            for code, name in LANGUAGE_NAMES.items()
        ]
        super().__init__(placeholder="Select a language...",
                         min_values=1,
                         max_values=1,
                         options=options)

    async def callback(self, interaction: discord.Interaction):
        selected_lang = self.values[0]
        guild_id = self.interaction.guild.id
        self.settings["language"] = selected_lang
        
        await update_setting(
            client.db, 
            guild_id, 
            self.settings.get("enabled_services", DEFAULT_ENABLED_SERVICES),
            self.settings.get("mention_users", True),
            self.settings.get("delete_original", True),
            selected_lang,
            self.settings.get("embed_color"),
            self.settings.get("delivery_mode", "suppress"),
            self.settings.get("media_quality", "balanced")
        )
        
        lang_name = LANGUAGE_NAMES.get(selected_lang, "English")
        embed = discord.Embed(
            title="🌐 Language Settings",
            description=f"✅ Language changed to **{lang_name}**!",
            color=discord.Color.green())
        
        # Update the dropdown to show new selection
        self.parent_view.clear_items()
        self.parent_view.add_item(LanguageDropdown(self.interaction, self.parent_view, self.settings))
        self.parent_view.add_item(SettingsDropdown(self.interaction, self.settings))
        
        try:
            await interaction.response.edit_message(embed=embed, view=self.parent_view)
        except discord.errors.NotFound:
            try:
                await interaction.edit_original_response(embed=embed, view=self.parent_view)
            except discord.errors.NotFound:
                logging.error("Failed to edit language response")

class LanguageSettingsView(ui.View):

    def __init__(self, interaction, settings, timeout=180):
        super().__init__(timeout=timeout)
        self.interaction = interaction
        self.settings = settings
        self.add_item(LanguageDropdown(interaction, self, settings))
        self.add_item(SettingsDropdown(interaction, settings))

    async def on_timeout(self):
        for item in self.children:
            item.disabled = True
        lang = self.settings.get("language", "en")
        embed = discord.Embed(
            title=get_text(lang, "language_title"),
            description=get_text(lang, "view_timed_out"),
            color=discord.Color.red())
        try:
            await self.interaction.edit_original_response(embed=embed, view=self)
        except discord.errors.NotFound:
            logging.error("Failed to edit language response on timeout")

class FixEmbedSettingsView(ui.View):

    def __init__(self, activated, interaction, settings, timeout=180):
        super().__init__(timeout=timeout)
        self.activated = activated
        self.interaction = interaction
        self.settings = settings
        lang = settings.get("language", "en")
        self.toggle_button = discord.ui.Button(
            label=get_text(lang, "activated") if activated else get_text(lang, "deactivated"),
            style=discord.ButtonStyle.green if activated else discord.ButtonStyle.red)
        self.toggle_button.callback = self.toggle
        self.add_item(self.toggle_button)
        self.add_item(SettingsDropdown(interaction, settings))

    async def toggle(self, interaction: discord.Interaction):
        await interaction.response.defer()
        lang = self.settings.get("language", "en")
        
        self.activated = not self.activated
        for ch in self.interaction.guild.text_channels:
            channel_states[ch.id] = self.activated
            await update_channel_state(client.db, ch.id, self.activated)
        self.toggle_button.label = get_text(lang, "activated") if self.activated else get_text(lang, "deactivated")
        self.toggle_button.style = discord.ButtonStyle.green if self.activated else discord.ButtonStyle.red

        working_status = get_text(lang, "working_in", channel="") if self.activated else get_text(lang, "not_working_in", channel="")
        embed = discord.Embed(
            title=get_text(lang, "fixembed_settings"),
            description=f"{working_status.replace('**', '').strip()}\n\n{get_text(lang, 'note_apply_changes')}",
            color=discord.Color.green() if self.activated else discord.Color.red())

        try:
            await interaction.edit_original_response(embed=embed, view=self, ephemeral=True)
        except discord.errors.NotFound:
            logging.error("Failed to edit original response: Unknown Webhook")

    async def on_timeout(self):
        for item in self.children:
            item.disabled = True
        lang = self.settings.get("language", "en")
        embed = discord.Embed(
            title=get_text(lang, "fixembed_settings"),
            description=get_text(lang, "view_timed_out"),
            color=discord.Color.red())
        
        try:
            await self.interaction.edit_original_response(embed=embed, view=self, ephemeral=True)
        except discord.errors.NotFound:
            logging.error("Failed to edit original response on timeout: Unknown Webhook")


class MentionUsersSettingsView(ui.View):

    def __init__(self, mention_users, interaction, settings, timeout=180):
        super().__init__(timeout=timeout)
        self.mention_users = mention_users
        self.interaction = interaction
        self.settings = settings
        lang = settings.get("language", "en")
        self.toggle_button = discord.ui.Button(
            label=get_text(lang, "activated") if mention_users else get_text(lang, "deactivated"),
            style=discord.ButtonStyle.green if mention_users else discord.ButtonStyle.red)
        self.toggle_button.callback = self.toggle
        self.add_item(self.toggle_button)
        self.add_item(SettingsDropdown(interaction, settings))

    async def toggle(self, interaction: discord.Interaction):
        await interaction.response.defer()
        lang = self.settings.get("language", "en")
        
        self.mention_users = not self.mention_users
        self.settings["mention_users"] = self.mention_users
        await update_setting(client.db, self.interaction.guild.id, self.settings["enabled_services"], self.mention_users, self.settings["delete_original"], self.settings.get("language", "en"), self.settings.get("embed_color"), self.settings.get("delivery_mode", "suppress"), self.settings.get("media_quality", "balanced"))
        self.toggle_button.label = get_text(lang, "activated") if self.mention_users else get_text(lang, "deactivated")
        self.toggle_button.style = discord.ButtonStyle.green if self.mention_users else discord.ButtonStyle.red

        status = get_text(lang, "activated") if self.mention_users else get_text(lang, "deactivated")
        embed = discord.Embed(
            title=get_text(lang, "mention_users_title"),
            description=get_text(lang, "user_mentions_status", status=status),
            color=discord.Color.green() if self.mention_users else discord.Color.red())

        try:
            await interaction.edit_original_response(embed=embed, view=self)
        except discord.errors.NotFound:
            logging.error("Failed to edit original response: Unknown Webhook")

    async def on_timeout(self):
        for item in self.children:
            item.disabled = True
        lang = self.settings.get("language", "en")
        embed = discord.Embed(
            title=get_text(lang, "mention_users_title"),
            description=get_text(lang, "view_timed_out"),
            color=discord.Color.red())
        
        try:
            await self.interaction.edit_original_response(embed=embed, view=self)
        except discord.errors.NotFound:
            logging.error("Failed to edit original response on timeout: Unknown Webhook")

class DeliveryMethodDropdown(ui.Select):
    def __init__(self, interaction, parent_view, settings, current_mode):
        self.interaction = interaction
        self.parent_view = parent_view
        self.settings = settings
        options = [
            discord.SelectOption(label="Delete Original", value="delete", description="Delete source message, post fixed link", default=current_mode == "delete"),
            discord.SelectOption(label="Suppress Embed", value="suppress", description="Keep message, suppress original embed", default=current_mode == "suppress"),
            discord.SelectOption(label="Reply Only", value="reply", description="Keep original and post fixed link", default=current_mode == "reply"),
        ]
        super().__init__(placeholder="Choose delivery mode...", min_values=1, max_values=1, options=options)

    async def callback(self, interaction: discord.Interaction):
        mode = self.values[0]
        self.settings["delivery_mode"] = mode
        # Keep backward compatibility with legacy boolean setting.
        self.settings["delete_original"] = mode == "delete"
        await update_setting(
            client.db,
            self.interaction.guild.id,
            self.settings["enabled_services"],
            self.settings["mention_users"],
            self.settings["delete_original"],
            self.settings.get("language", "en"),
            self.settings.get("embed_color"),
            self.settings["delivery_mode"],
            self.settings.get("media_quality", "balanced"),
        )
        mode_text = {
            "delete": "Delete original message and post fixed link",
            "suppress": "Keep message, suppress original embed, and post fixed link",
            "reply": "Keep original message and post fixed link"
        }[mode]
        embed = discord.Embed(
            title="Delivery Method",
            description=f"✅ Delivery mode set to **{mode}**\n{mode_text}",
            color=get_guild_color(self.interaction.guild.id))
        self.parent_view.clear_items()
        self.parent_view.add_item(DeliveryMethodDropdown(self.interaction, self.parent_view, self.settings, mode))
        self.parent_view.add_item(SettingsDropdown(self.interaction, self.settings))
        await interaction.response.edit_message(embed=embed, view=self.parent_view)


class DeliveryMethodSettingsView(ui.View):
    def __init__(self, delivery_mode, interaction, settings, timeout=180):
        super().__init__(timeout=timeout)
        self.interaction = interaction
        self.settings = settings
        self.add_item(DeliveryMethodDropdown(interaction, self, settings, delivery_mode))
        self.add_item(SettingsDropdown(interaction, settings))

    async def on_timeout(self):
        for item in self.children:
            item.disabled = True
        lang = self.settings.get("language", "en")
        embed = discord.Embed(
            title=get_text(lang, "delivery_method_title"),
            description=get_text(lang, "view_timed_out"),
            color=discord.Color.red())
        
        try:
            await self.interaction.edit_original_response(embed=embed, view=self)
        except discord.errors.NotFound:
            logging.error("Failed to edit original response on timeout: Unknown Webhook")


@client.tree.command(name='settings', description="Configure FixEmbed's settings")
async def settings(interaction: discord.Interaction):
    guild_id = interaction.guild.id
    guild_settings = bot_settings.get(guild_id, {"enabled_services": DEFAULT_ENABLED_SERVICES, "mention_users": True, "delete_original": True, "delivery_mode": "suppress", "media_quality": "balanced"})
    
    lang = get_guild_lang(interaction.guild.id)
    embed = discord.Embed(title=get_text(lang, "settings_title"),
                          description=get_text(lang, "settings_description"),
                          color=get_guild_color(interaction.guild.id))
    create_footer(embed, client)
    await interaction.response.send_message(embed=embed, view=SettingsView(interaction, guild_settings), ephemeral=True)

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
    await update_setting(
        client.db, guild_id, settings_obj["enabled_services"], settings_obj["mention_users"],
        settings_obj.get("delete_original", True), settings_obj.get("language", "en"),
        settings_obj.get("embed_color"), settings_obj["delivery_mode"], settings_obj.get("media_quality", "balanced")
    )
    await interaction.response.send_message(f"✅ Delivery mode set to `{mode.value}`.", ephemeral=True)

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
        settings_obj.get("embed_color"), settings_obj.get("delivery_mode", "suppress"), settings_obj["media_quality"]
    )
    await interaction.response.send_message(f"✅ Media quality profile set to `{profile.value}`.", ephemeral=True)

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
    await interaction.response.send_message(f"✅ Rule updated: {channel.mention} • {service.value} → `{action.value}`", ephemeral=True)

@client.tree.command(name='status', description="Power-user alias for reliability status (also in /settings)")
async def status(interaction: discord.Interaction):
    by_service = processing_stats.get("by_service", {})
    service_lines = []
    for service in DEFAULT_ENABLED_SERVICES:
        data = by_service.get(service, {"ok": 0, "fail": 0})
        service_lines.append(f"- {get_service_display_icon(interaction.guild, service)} {service}: ✅ {data['ok']} | ❌ {data['fail']}")
    embed = discord.Embed(title="FixEmbed Status", color=discord.Color.blurple())
    embed.add_field(name="Queue", value=f"Pending sends: {SEND_QUEUE.qsize()}", inline=False)
    embed.add_field(name="Totals", value=f"Fixed: {processing_stats['total_fixed']}\nFailed: {processing_stats['total_failed']}", inline=False)
    embed.add_field(name="Per Service", value="\n".join(service_lines), inline=False)
    await interaction.response.send_message(embed=embed, ephemeral=True)

@client.event
async def on_message(message):
    if message.author == client.user:
        return

    if not message.guild:
        await client.process_commands(message)
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

    # Premium perk: skip bot messages only if NOT premium
    if message.author.bot and not premium:
        await client.process_commands(message)
        return
    
    if channel_states.get(message.channel.id, True):
        try:
            # Standard link pattern to capture all the relevant links
            link_pattern = r"https?://(?:www\.)?(twitter\.com/\w+/status/\d+|x\.com/\w+/status/\d+|instagram\.com/(?:p|reel)/[\w-]+|reddit\.com/r/\w+/s/\w+|reddit\.com/r/\w+/comments/\w+/\w+|old\.reddit\.com/r/\w+/comments/\w+/\w+|pixiv\.net/(?:en/)?artworks/\d+|threads\.net/@[^/]+/post/[\w-]+|bsky\.app/profile/[^/]+/post/[\w-]+|bilibili\.com/video/[\w]+|b23\.tv/[\w]+)"
            matches = re.findall(link_pattern, message.content)

            # Regex pattern to detect links surrounded by < >
            surrounded_link_pattern = r"<https?://(?:www\.)?(twitter\.com/\w+/status/\d+|x\.com/\w+/status/\d+|instagram\.com/(?:p|reel)/[\w-]+|reddit\.com/r/\w+/s/\w+|reddit\.com/r/\w+/comments/\w+/\w+|old\.reddit\.com/r/\w+/comments/\w+/\w+|pixiv\.net/(?:en/)?artworks/\d+|threads\.net/@[^/]+/post/[\w-]+|bsky\.app/profile/[^/]+/post/[\w-]+|bilibili\.com/video/[\w]+|b23\.tv/[\w]+)>"

            valid_link_found = False
            if len(matches) > 1:
                await message.channel.trigger_typing()

            for original_link in matches:
                # Check if this specific link is surrounded by < > in the message content
                if f"<{original_link}>" in message.content:
                    continue  # Skip processing this link

                display_text = ""
                modified_link = original_link
                service = ""
                user_or_community = ""

                if 'twitter.com' in original_link or 'x.com' in original_link:
                    service = "Twitter"
                    user_match = re.findall(
                        r"(?:twitter\.com|x\.com)/(\w+)/status/\d+",
                        original_link)
                    user_or_community = user_match[
                        0] if user_match else "Unknown"

                elif 'instagram.com' in original_link:
                    service = "Instagram"
                    user_match = re.findall(r"instagram\.com/(?:p|reel)/([\w-]+)",
                                            original_link)
                    user_or_community = user_match[
                        0] if user_match else "Unknown"

                elif 'reddit.com' in original_link or 'old.reddit.com' in original_link:
                    service = "Reddit"
                    community_match = re.findall(
                        r"(?:reddit\.com|old\.reddit\.com)/r/(\w+)", original_link)
                    user_or_community = community_match[
                        0] if community_match else "Unknown"
                    
                elif 'pixiv.net' in original_link:
                    service = "Pixiv"
                    user_match = re.findall(r"pixiv\.net/(?:en/)?artworks/(\d+)", original_link)
                    user_or_community = user_match[
                        0] if user_match else "Unknown"

                elif 'threads.net' in original_link:
                    service = "Threads"
                    user_match = re.findall(r"threads\.net/@([^/]+)/post/([\w-]+)", original_link)
                    if len(user_match) > 0:
                        user_or_community, post_id = user_match[0]
                        modified_link = f"fixthreads.net/@{user_or_community}/post/{post_id}"
                        display_text = f"Threads • @{user_or_community}"

                elif 'bsky.app' in original_link:
                    service = "Bluesky"
                    bsky_match = re.findall(r"bsky\.app/profile/([^/]+)/post/([\w-]+)", original_link)
                    if len(bsky_match) > 0:
                        user_or_community, post_id = bsky_match[0]
                        modified_link = f"bskyx.app/profile/{user_or_community}/post/{post_id}"
                        display_text = f"Bluesky • {user_or_community}"

                elif 'bilibili.com' in original_link or 'b23.tv' in original_link:
                    service = "Bilibili"
                    if 'bilibili.com' in original_link:
                        video_id_match = re.findall(r"bilibili\.com/video/([\w]+)", original_link)
                        if video_id_match:
                            video_id = video_id_match[0]
                            user_or_community = video_id
                            display_text = f"Bilibili • {video_id}"
                    elif 'b23.tv' in original_link:
                        video_id_match = re.findall(r"b23\.tv/([\w]+)", original_link)
                        if video_id_match:
                            video_id = video_id_match[0]
                            user_or_community = video_id
                            display_text = f"Bilibili • {video_id}"

                default_enabled = service in enabled_services
                service_enabled = get_service_rule(guild_id, message.channel.id, service, default_enabled)
                full_original_url = f"https://{original_link}"
                dedup_key = (message.channel.id, full_original_url)
                cache_time = processed_link_cache.get(dedup_key, 0)
                recently_processed = (time.time() - cache_time) < DEDUP_WINDOW_SECONDS

                if service and user_or_community and service_enabled and not recently_processed:
                    if not display_text:
                        display_text = f"{service} • {user_or_community}"
                    # Use the unified FixEmbed service
                    import urllib.parse
                    modified_link = f"fixembed.app/embed?url={urllib.parse.quote(full_original_url, safe='')}&quality={media_quality}"
                    valid_link_found = True
                    processed_link_cache[dedup_key] = time.time()
                    service_stats = processing_stats["by_service"].setdefault(service, {"ok": 0, "fail": 0})
                    service_stats["ok"] += 1
                    processing_stats["total_fixed"] += 1

                if valid_link_found:
                    if delivery_mode == "delete" or (delivery_mode not in {"delete", "suppress", "reply"} and delete_original):
                        formatted_message = f"[{display_text}](https://{modified_link})"
                        # Premium perk: no 'Sent by' label
                        if not premium:
                            if mention_users:
                                formatted_message += f" | Sent by {message.author.mention}"
                            else:
                                formatted_message += f" | Sent by {message.author.display_name}"
                        await rate_limited_send(message.channel, content=formatted_message)
                        await message.delete()
                    elif delivery_mode == "suppress":
                        await message.edit(suppress=True)
                        formatted_message = f"[{display_text}](https://{modified_link})"
                        await rate_limited_send(message.channel, content=formatted_message)
                    else:
                        formatted_message = f"[{display_text}](https://{modified_link})"
                        await rate_limited_send(message.channel, content=formatted_message)

        except discord.Forbidden:
            logging.warning(f"Missing permissions in channel {message.channel.id}")
            processing_stats["total_failed"] += 1
        except discord.NotFound:
            logging.debug(f"Message already deleted in channel {message.channel.id}")
            processing_stats["total_failed"] += 1
        except discord.HTTPException as e:
            logging.error(f"HTTP error in on_message: {e}")
            processing_stats["total_failed"] += 1
        except Exception as e:
            logging.error(f"Unexpected error in on_message: {e}", exc_info=True)
            processing_stats["total_failed"] += 1

    await client.process_commands(message)

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
            "media_quality": "balanced"
        }
        await update_setting(client.db, guild_id, bot_settings[guild_id]["enabled_services"], bot_settings[guild_id]["mention_users"], bot_settings[guild_id]["delete_original"], bot_settings[guild_id]["language"], bot_settings[guild_id].get("embed_color"), bot_settings[guild_id].get("delivery_mode", "suppress"), bot_settings[guild_id].get("media_quality", "balanced"))

# --- Premium Command ---
@client.tree.command(name='premium', description="View FixEmbed Premium subscription info")
@app_commands.allowed_installs(guilds=True, users=True)
@app_commands.allowed_contexts(guilds=True, dms=True, private_channels=True)
async def premium_command(interaction: discord.Interaction):
    lang = get_guild_lang(interaction.guild.id if interaction.guild else None)
    premium = False
    if interaction.guild:
        premium = await is_guild_premium(interaction.guild.id)
    
    embed = discord.Embed(
        title=get_text(lang, "premium_title"),
        description=get_text(lang, "premium_description"),
        color=discord.Color.gold())
    
    if premium:
        embed.add_field(
            name="Status",
            value=get_text(lang, "premium_active"),
            inline=False)
    else:
        embed.add_field(
            name="Status",
            value=get_text(lang, "premium_not_active"),
            inline=False)
    
    embed.add_field(
        name=get_text(lang, "premium_perks_title"),
        value=get_text(lang, "premium_perks"),
        inline=False)
    
    create_footer(embed, client)
    
    view = discord.ui.View()
    if PREMIUM_SKU_ID and not premium:
        subscribe_button = discord.ui.Button(
            style=discord.ButtonStyle.premium,
            sku_id=int(PREMIUM_SKU_ID))
        view.add_item(subscribe_button)
    
    await interaction.response.send_message(embed=embed, view=view, ephemeral=True)

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
                self.settings.get("media_quality", "balanced"))
            embed = discord.Embed(
                title=get_text(lang, "embed_color_title"),
                description=get_text(lang, "embed_color_reset"),
                color=discord.Color.green())
            await interaction.response.send_message(embed=embed, ephemeral=True)
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
                        self.settings.get("media_quality", "balanced"))
                    embed = discord.Embed(
                        title=get_text(lang, "embed_color_title"),
                        description=get_text(lang, "embed_color_set", color=color_str),
                        color=discord.Color(int(hex_color, 16)))
                    await interaction.response.send_message(embed=embed, ephemeral=True)
                    return
                except ValueError:
                    pass
            embed = discord.Embed(
                title=get_text(lang, "embed_color_title"),
                description=get_text(lang, "embed_color_invalid"),
                color=discord.Color.red())
            await interaction.response.send_message(embed=embed, ephemeral=True)

# --- Entitlement Events ---
@client.event
async def on_entitlement_create(entitlement):
    """Called when a user subscribes to premium."""
    if entitlement.guild_id:
        guild_id = entitlement.guild_id
        if guild_id in bot_settings:
            bot_settings[guild_id]["is_premium"] = True
        logging.info(f"Premium activated for guild {guild_id}")

@client.event
async def on_entitlement_update(entitlement):
    """Called when an entitlement is updated."""
    if entitlement.guild_id:
        guild_id = entitlement.guild_id
        is_active = not entitlement.is_expired()
        if guild_id in bot_settings:
            bot_settings[guild_id]["is_premium"] = is_active
        logging.info(f"Premium {'activated' if is_active else 'deactivated'} for guild {guild_id}")

@client.event
async def on_entitlement_delete(entitlement):
    """Called when a user's subscription to premium is removed."""
    if entitlement.guild_id:
        guild_id = entitlement.guild_id
        if guild_id in bot_settings:
            bot_settings[guild_id]["is_premium"] = False
        logging.info(f"Premium removed for guild {guild_id}")

# Loading the bot token from .env
load_dotenv()
bot_token = os.getenv('BOT_TOKEN')
PREMIUM_SKU_ID = os.getenv('PREMIUM_SKU_ID')
client.run(bot_token)
