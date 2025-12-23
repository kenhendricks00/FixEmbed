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
from collections import deque
from translations import get_text, LANGUAGE_NAMES, TRANSLATIONS

# Version number
VERSION = "1.2.3"

# Service configuration for link processing
SERVICES = {
    "Twitter": {
        "patterns": [r"twitter\.com/(\w+)/status/(\d+)", r"x\.com/(\w+)/status/(\d+)"],
        "replacements": {"twitter.com": "fxtwitter.com", "x.com": "fixupx.com"},
        "display_format": "Twitter • {0}"
    },
    "Instagram": {
        "patterns": [r"instagram\.com/(?:p|reel)/([\w-]+)"],
        "replacements": {"instagram.com": "d.vxinstagram.com"},
        "display_format": "Instagram • {0}"
    },
    "Reddit": {
        "patterns": [r"(?:old\.)?reddit\.com/r/(\w+)/(?:s|comments)/\w+"],
        "replacements": {"reddit.com": "vxreddit.com", "old.reddit.com": "vxreddit.com"},
        "display_format": "Reddit • r/{0}"
    },
    "Threads": {
        "patterns": [r"threads\.net/@([^/]+)/post/([\w-]+)"],
        "replacements": {"threads.net": "fixthreads.net"},
        "display_format": "Threads • @{0}"
    },
    "Pixiv": {
        "patterns": [r"pixiv\.net/(?:en/)?artworks/(\d+)"],
        "replacements": {"pixiv.net": "phixiv.net"},
        "display_format": "Pixiv • {0}"
    },
    "Bluesky": {
        "patterns": [r"bsky\.app/profile/([^/]+)/post/([\w-]+)"],
        "replacements": {"bsky.app": "bskyx.app"},
        "display_format": "Bluesky • {0}"
    },
    "YouTube": {
        "patterns": [r"youtube\.com/watch\?v=([\w-]+)", r"youtu\.be/([\w-]+)"],
        "replacements": {"youtube.com": "koutube.com", "youtu.be": "koutube.com/watch?v="},
        "display_format": "YouTube • {0}"
    }
}

# Initialize logging
logging.basicConfig(level=logging.INFO)

# Bot configuration
intents = discord.Intents.default()
intents.message_content = True
client = commands.Bot(command_prefix='/', intents=intents, shard_count=10)

# In-memory storage for channel states and settings
channel_states = {}
bot_settings = {}

# Rate-limiting configuration
MESSAGE_LIMIT = 5
TIME_WINDOW = 1  # Time window in seconds

message_timestamps = deque()

async def rate_limited_send(channel, content):
    current_time = time.time()
    while len(message_timestamps) >= MESSAGE_LIMIT and current_time - message_timestamps[0] < TIME_WINDOW:
        await asyncio.sleep(0.1)
        current_time = time.time()
        message_timestamps.popleft()
    message_timestamps.append(current_time)
    await channel.send(content)

def create_footer(embed, client):
    embed.set_footer(text=f"{client.user.name} | v{VERSION}", icon_url=client.user.avatar.url)

def get_guild_lang(guild_id):
    """Get the language setting for a guild, defaulting to English."""
    if guild_id is None:
        return "en"
    return bot_settings.get(guild_id, {}).get("language", "en")

async def init_db():
    db = await aiosqlite.connect('fixembed_data.db')
    await db.execute('''CREATE TABLE IF NOT EXISTS channel_states (channel_id INTEGER PRIMARY KEY, state BOOLEAN)''')
    await db.commit()
    await db.execute('''CREATE TABLE IF NOT EXISTS guild_settings (guild_id INTEGER PRIMARY KEY, enabled_services TEXT, mention_users BOOLEAN, delete_original BOOLEAN DEFAULT TRUE)''')
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
    async with db.execute('SELECT guild_id, enabled_services, mention_users, delete_original, language FROM guild_settings') as cursor:
        async for row in cursor:
            guild_id = row[0]
            enabled_services = row[1]
            mention_users = row[2]
            delete_original = row[3]
            language = row[4] if len(row) > 4 else "en"
            enabled_services_list = eval(enabled_services) if enabled_services else ["Twitter", "Instagram", "Reddit", "Threads", "Pixiv", "Bluesky", "YouTube"]          
            bot_settings[guild_id] = {
                "enabled_services": enabled_services_list,
                "mention_users": mention_users if mention_users is not None else True,
                "delete_original": delete_original if delete_original is not None else True,
                "language": language if language else "en"
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

async def update_setting(db, guild_id, enabled_services, mention_users, delete_original, language="en"):
    retries = 5
    for i in range(retries):
        try:
            await db.execute('INSERT OR REPLACE INTO guild_settings (guild_id, enabled_services, mention_users, delete_original, language) VALUES (?, ?, ?, ?, ?)', (guild_id, repr(enabled_services), mention_users, delete_original, language))
            await db.commit()
            break
        except sqlite3.OperationalError as e:
            if 'locked' in str(e):
                await asyncio.sleep(0.1)
            else:
                raise

@client.event
async def on_ready():
    print(f'We have logged in as {client.user}')
    logging.info(f'Logged in as {client.user}')
    client.db = await init_db()
    await load_channel_states(client.db)
    await load_settings(client.db)
    change_status.start()

    try:
        synced = await client.tree.sync()
        print(f'Synced {len(synced)} command(s)')
    except Exception as e:
        print(f'Failed to sync commands: {e}')

    client.launch_time = discord.utils.utcnow()

statuses = itertools.cycle([
    "for Twitter links", "for Reddit links", "for Instagram links", "for Threads links", "for Pixiv links", "for Bluesky links", "for YouTube links"
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
    lang = get_guild_lang(interaction.guild.id if interaction.guild else None)
    embed = discord.Embed(
        title=get_text(lang, "about_title"),
        description=get_text(lang, "about_description"),
        color=discord.Color(0x7289DA))
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
            "- [FxEmbed](https://github.com/FxEmbed/FxEmbed), created by FxEmbed\n"
            "- [InstagramEmbed](https://github.com/Lainmode/InstagramEmbed-vxinstagram), created by Lainmode\n"
            "- [vxReddit](https://github.com/dylanpdx/vxReddit), created by dylanpdx\n"
            "- [fixthreads](https://github.com/milanmdev/fixthreads), created by milanmdev\n"
            "- [phixiv](https://github.com/thelaao/phixiv), created by thelaao\n"
            "- [VixBluesky](https://github.com/Rapougnac/VixBluesky), created by Rapougnac\n"
            "- [koutube](https://github.com/iGerman00/koutube), created by iGerman00"
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
    lang = get_guild_lang(interaction.guild.id if interaction.guild else None)
    embed = discord.Embed(
        title=get_text(lang, "help_title"),
        description=get_text(lang, "help_description"),
        color=discord.Color(0x7289DA))
    
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
        name=get_text(lang, "supported_services"),
        value=get_text(lang, "supported_services_value"),
        inline=False)
    
    embed.add_field(
        name=get_text(lang, "tip"),
        value=get_text(lang, "tip_value"),
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
    # Standard link pattern to capture all the relevant links
    link_pattern = r"https?://(?:www\.)?(twitter\.com/\w+/status/\d+|x\.com/\w+/status/\d+|instagram\.com/(?:p|reel)/[\w-]+|reddit\.com/r/\w+/s/\w+|reddit\.com/r/\w+/comments/\w+/\w+|old\.reddit\.com/r/\w+/comments/\w+/\w+|pixiv\.net/(?:en/)?artworks/\d+|threads\.net/@[^/]+/post/[\w-]+|bsky\.app/profile/[^/]+/post/[\w-]+|youtube\.com/watch\?v=[\w-]+|youtu\.be/[\w-]+)"
    match = re.search(link_pattern, link)
    
    if not match:
        await interaction.response.send_message(get_text(lang, "no_supported_link"), ephemeral=True)
        return
    
    original_link = match.group(1)
    display_text = ""
    modified_link = original_link
    
    if 'twitter.com' in original_link or 'x.com' in original_link:
        user_match = re.findall(r"(?:twitter\.com|x\.com)/(\w+)/status/\d+", original_link)
        user = user_match[0] if user_match else "Unknown"
        display_text = f"Twitter • {user}"
        modified_link = original_link.replace("twitter.com", "fxtwitter.com").replace("x.com", "fixupx.com")
        
    elif 'instagram.com' in original_link:
        user_match = re.findall(r"instagram\.com/(?:p|reel)/([\w-]+)", original_link)
        user = user_match[0] if user_match else "Unknown"
        display_text = f"Instagram • {user}"
        modified_link = original_link.replace("instagram.com", "d.vxinstagram.com")
        
    elif 'reddit.com' in original_link or 'old.reddit.com' in original_link:
        community_match = re.findall(r"(?:reddit\.com|old\.reddit\.com)/r/(\w+)", original_link)
        community = community_match[0] if community_match else "Unknown"
        display_text = f"Reddit • r/{community}"
        modified_link = original_link.replace("reddit.com", "vxreddit.com").replace("old.reddit.com", "vxreddit.com")
        
    elif 'pixiv.net' in original_link:
        id_match = re.findall(r"pixiv\.net/(?:en/)?artworks/(\d+)", original_link)
        artwork_id = id_match[0] if id_match else "Unknown"
        display_text = f"Pixiv • {artwork_id}"
        modified_link = original_link.replace("pixiv.net", "phixiv.net")
        
    elif 'threads.net' in original_link:
        user_match = re.findall(r"threads\.net/@([^/]+)/post/([\w-]+)", original_link)
        if user_match:
            user = user_match[0][0]
            display_text = f"Threads • @{user}"
        modified_link = original_link.replace("threads.net", "fixthreads.net")
        
    elif 'bsky.app' in original_link:
        bsky_match = re.findall(r"bsky\.app/profile/([^/]+)/post/([\w-]+)", original_link)
        if bsky_match:
            user = bsky_match[0][0]
            display_text = f"Bluesky • {user}"
        modified_link = original_link.replace("bsky.app", "bskyx.app")
        
    elif 'youtube.com' in original_link or 'youtu.be' in original_link:
        if 'youtube.com' in original_link:
            video_id_match = re.findall(r"youtube\.com/watch\?v=([\w-]+)", original_link)
        else:
            video_id_match = re.findall(r"youtu\.be/([\w-]+)", original_link)
        if video_id_match:
            video_id = video_id_match[0]
            display_text = f"YouTube • {video_id}"
            modified_link = f"koutube.com/watch?v={video_id}"
    
    if display_text and modified_link:
        await interaction.response.send_message(f"[{display_text}](https://{modified_link})")
    else:
        await interaction.response.send_message(get_text(lang, "could_not_convert"), ephemeral=True)

@client.tree.context_menu(name='Fix Embed')
@app_commands.allowed_installs(guilds=True, users=True)
@app_commands.allowed_contexts(guilds=True, dms=True, private_channels=True)
async def fix_embed_context(interaction: discord.Interaction, message: discord.Message):
    """Convert social media links in a message to embed-friendly versions."""
    lang = get_guild_lang(interaction.guild.id if interaction.guild else None)
    # Standard link pattern to capture all the relevant links
    link_pattern = r"https?://(?:www\.)?(twitter\.com/\w+/status/\d+|x\.com/\w+/status/\d+|instagram\.com/(?:p|reel)/[\w-]+|reddit\.com/r/\w+/s/\w+|reddit\.com/r/\w+/comments/\w+/\w+|old\.reddit\.com/r/\w+/comments/\w+/\w+|pixiv\.net/(?:en/)?artworks/\d+|threads\.net/@[^/]+/post/[\w-]+|bsky\.app/profile/[^/]+/post/[\w-]+|youtube\.com/watch\?v=[\w-]+|youtu\.be/[\w-]+)"
    matches = re.findall(link_pattern, message.content)
    
    if not matches:
        await interaction.response.send_message(get_text(lang, "no_links_found"), ephemeral=True)
        return
    
    fixed_links = []
    
    for original_link in matches:
        display_text = ""
        modified_link = original_link
        
        if 'twitter.com' in original_link or 'x.com' in original_link:
            user_match = re.findall(r"(?:twitter\.com|x\.com)/(\w+)/status/\d+", original_link)
            user = user_match[0] if user_match else "Unknown"
            display_text = f"Twitter • {user}"
            modified_link = original_link.replace("twitter.com", "fxtwitter.com").replace("x.com", "fixupx.com")
            
        elif 'instagram.com' in original_link:
            user_match = re.findall(r"instagram\.com/(?:p|reel)/([\w-]+)", original_link)
            user = user_match[0] if user_match else "Unknown"
            display_text = f"Instagram • {user}"
            modified_link = original_link.replace("instagram.com", "d.vxinstagram.com")
            
        elif 'reddit.com' in original_link or 'old.reddit.com' in original_link:
            community_match = re.findall(r"(?:reddit\.com|old\.reddit\.com)/r/(\w+)", original_link)
            community = community_match[0] if community_match else "Unknown"
            display_text = f"Reddit • r/{community}"
            modified_link = original_link.replace("reddit.com", "vxreddit.com").replace("old.reddit.com", "vxreddit.com")
            
        elif 'pixiv.net' in original_link:
            id_match = re.findall(r"pixiv\.net/(?:en/)?artworks/(\d+)", original_link)
            artwork_id = id_match[0] if id_match else "Unknown"
            display_text = f"Pixiv • {artwork_id}"
            modified_link = original_link.replace("pixiv.net", "phixiv.net")
            
        elif 'threads.net' in original_link:
            user_match = re.findall(r"threads\.net/@([^/]+)/post/([\w-]+)", original_link)
            if user_match:
                user = user_match[0][0]
                display_text = f"Threads • @{user}"
            modified_link = original_link.replace("threads.net", "fixthreads.net")
            
        elif 'bsky.app' in original_link:
            bsky_match = re.findall(r"bsky\.app/profile/([^/]+)/post/([\w-]+)", original_link)
            if bsky_match:
                user = bsky_match[0][0]
                display_text = f"Bluesky • {user}"
            modified_link = original_link.replace("bsky.app", "bskyx.app")
            
        elif 'youtube.com' in original_link or 'youtu.be' in original_link:
            if 'youtube.com' in original_link:
                video_id_match = re.findall(r"youtube\.com/watch\?v=([\w-]+)", original_link)
            else:
                video_id_match = re.findall(r"youtu\.be/([\w-]+)", original_link)
            if video_id_match:
                video_id = video_id_match[0]
                display_text = f"YouTube • {video_id}"
                modified_link = f"koutube.com/watch?v={video_id}"
        
        if display_text and modified_link:
            fixed_links.append(f"[{display_text}](https://{modified_link})")
    
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
        color=discord.Color(0x7289DA))
    
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
    await interaction.response.send_message(embed=embed, view=SettingsView(interaction, bot_settings.get(interaction.guild.id, {"enabled_services": ["Twitter", "Instagram", "Reddit", "Threads", "Pixiv", "Bluesky", "YouTube"], "mention_users": True, "delete_original": True})))

class SettingsDropdown(ui.Select):

    def __init__(self, interaction, settings):
        self.interaction = interaction
        self.settings = settings
        lang = settings.get("language", "en")
        activated = all(
            channel_states.get(ch.id, True)
            for ch in interaction.guild.text_channels)
        mention_users = settings.get("mention_users", True)
        delete_original = settings.get("delete_original", True)
        
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
                emoji="📬" if delete_original else "📪",
                value="Delivery Method"
            ),
            discord.SelectOption(
                label=get_text(lang, "service_settings"),
                description=get_text(lang, "service_settings_desc"),
                emoji="⚙️",
                value="Service Settings"),
            discord.SelectOption(
                label=get_text(lang, "language"),
                description=get_text(lang, "language_desc"),
                emoji="🌐",
                value="Language"),
            discord.SelectOption(
                label=get_text(lang, "debug"),
                description=get_text(lang, "debug_desc"),
                emoji="🐞",
                value="Debug"
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
            delete_original = self.settings.get("delete_original", True)
            embed = discord.Embed(
                title=get_text(lang, "delivery_method_title"),
                description=get_text(lang, "original_deletion_status", status=status_activated if delete_original else status_deactivated),
                color=discord.Color.green() if delete_original else discord.Color.red())
            view = DeliveryMethodSettingsView(delete_original, self.interaction, self.settings)
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
            enabled_services = self.settings.get("enabled_services", ["Twitter", "Instagram", "Reddit", "Threads", "Pixiv", "Bluesky", "YouTube"])
            service_status_list = "\n".join([
                f"{'🟢' if service in enabled_services else '🔴'} {service}"
                for service in ["Twitter", "Instagram", "Reddit", "Threads", "Pixiv", "Bluesky", "YouTube"]
            ])
            embed = discord.Embed(
                title=get_text(lang, "service_settings"),
                description=f"{get_text(lang, 'activated_services')}\n{service_status_list}",
                color=discord.Color.blurple())
            view = ServiceSettingsView(self.interaction, self.settings)
            await interaction.response.send_message(embed=embed, view=view, ephemeral=True)
        elif self.values[0] == "Debug":
            await debug_info(interaction, interaction.channel)
        elif self.values[0] == "Language":
            current_lang = self.settings.get("language", "en")
            current_lang_name = LANGUAGE_NAMES.get(current_lang, "English")
            embed = discord.Embed(
                title=get_text(lang, "language_title"),
                description=get_text(lang, "language_current", language=current_lang_name),
                color=discord.Color.blurple())
            view = LanguageSettingsView(self.interaction, self.settings)
            await interaction.response.send_message(embed=embed, view=view, ephemeral=True)



class ServicesDropdown(ui.Select):

    def __init__(self, interaction, parent_view, settings):
        self.interaction = interaction
        self.parent_view = parent_view
        self.settings = settings
        enabled_services = settings.get("enabled_services", ["Twitter", "Instagram", "Reddit", "Threads", "Pixiv", "Bluesky", "YouTube"])
        options = [
            discord.SelectOption(
                label=service,
                description=f"Activate or deactivate {service} links",
                emoji="✅" if service in enabled_services else "❌")
            for service in ["Twitter", "Instagram", "Reddit", "Threads", "Pixiv", "Bluesky", "YouTube"]
        ]
        super().__init__(placeholder="Select services to activate...",
                         min_values=1,
                         max_values=len(options),
                         options=options)

    async def callback(self, interaction: discord.Interaction):
        selected_services = self.values
        guild_id = self.interaction.guild.id
        self.settings["enabled_services"] = selected_services
        await update_setting(client.db, guild_id, selected_services, self.settings["mention_users"], self.settings["delete_original"], self.settings.get("language", "en"))

        self.parent_view.clear_items()
        self.parent_view.add_item(
            ServicesDropdown(self.interaction, self.parent_view, self.settings))
        self.parent_view.add_item(SettingsDropdown(self.interaction, self.settings))

        service_status_list = "\n".join([
            f"{'🟢' if service in selected_services else '🔴'} {service}"
            for service in ["Twitter", "Instagram", "Reddit", "Threads", "Pixiv", "Bluesky", "YouTube"]
        ])
        embed = discord.Embed(
            title="Service Settings",
            description=f"Configure which services are activated.\n\n**Activated services:**\n{service_status_list}",
            color=discord.Color.blurple())
        
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
            self.settings.get("enabled_services", ["Twitter", "Instagram", "Reddit", "Threads", "Pixiv", "Bluesky", "YouTube"]),
            self.settings.get("mention_users", True),
            self.settings.get("delete_original", True),
            selected_lang
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
        await update_setting(client.db, self.interaction.guild.id, self.settings["enabled_services"], self.mention_users, self.settings["delete_original"], self.settings.get("language", "en"))
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

class DeliveryMethodSettingsView(ui.View):

    def __init__(self, delete_original, interaction, settings, timeout=180):
        super().__init__(timeout=timeout)
        self.delete_original = delete_original
        self.interaction = interaction
        self.settings = settings
        lang = settings.get("language", "en")
        self.toggle_button = discord.ui.Button(
            label=get_text(lang, "activated") if delete_original else get_text(lang, "deactivated"),
            style=discord.ButtonStyle.green if delete_original else discord.ButtonStyle.red)
        self.toggle_button.callback = self.toggle
        self.add_item(self.toggle_button)
        self.add_item(SettingsDropdown(interaction, settings))

    async def toggle(self, interaction: discord.Interaction):
        await interaction.response.defer()
        lang = self.settings.get("language", "en")

        self.delete_original = not self.delete_original
        self.settings["delete_original"] = self.delete_original
        await update_setting(client.db, self.interaction.guild.id, self.settings["enabled_services"], self.settings["mention_users"], self.delete_original, self.settings.get("language", "en"))
        
        self.toggle_button.label = get_text(lang, "activated") if self.delete_original else get_text(lang, "deactivated")
        self.toggle_button.style = discord.ButtonStyle.green if self.delete_original else discord.ButtonStyle.red

        status = get_text(lang, "activated") if self.delete_original else get_text(lang, "deactivated")
        embed = discord.Embed(
            title=get_text(lang, "delivery_method_title"),
            description=get_text(lang, "original_deletion_changed", status=status),
            color=discord.Color.green() if self.delete_original else discord.Color.red())

        try:
            await interaction.edit_original_response(embed=embed, view=self)
        except discord.errors.NotFound:
            logging.error("Failed to edit original response: Unknown Webhook")

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
    guild_settings = bot_settings.get(guild_id, {"enabled_services": ["Twitter", "Instagram", "Reddit", "Threads", "Pixiv", "Bluesky", "YouTube"], "mention_users": True, "delete_original": True})
    
    lang = get_guild_lang(interaction.guild.id)
    embed = discord.Embed(title=get_text(lang, "settings_title"),
                          description=get_text(lang, "settings_description"),
                          color=discord.Color.blurple())
    create_footer(embed, client)
    await interaction.response.send_message(embed=embed, view=SettingsView(interaction, guild_settings), ephemeral=True)

@client.event
async def on_message(message):
    if message.author == client.user:
        return

    guild_id = message.guild.id
    guild_settings = bot_settings.get(guild_id, {
        "enabled_services": ["Twitter", "Instagram", "Reddit", "Threads", "Pixiv", "Bluesky", "YouTube"],
        "mention_users": True,
        "delete_original": True
    })
    enabled_services = guild_settings.get("enabled_services", ["Twitter", "Instagram", "Reddit", "Threads", "Pixiv", "Bluesky", "YouTube"])
    mention_users = guild_settings.get("mention_users", True)
    delete_original = guild_settings.get("delete_original", True)
    
    if channel_states.get(message.channel.id, True):
        try:
            # Standard link pattern to capture all the relevant links
            link_pattern = r"https?://(?:www\.)?(twitter\.com/\w+/status/\d+|x\.com/\w+/status/\d+|instagram\.com/(?:p|reel)/[\w-]+|reddit\.com/r/\w+/s/\w+|reddit\.com/r/\w+/comments/\w+/\w+|old\.reddit\.com/r/\w+/comments/\w+/\w+|pixiv\.net/(?:en/)?artworks/\d+|threads\.net/@[^/]+/post/[\w-]+|bsky\.app/profile/[^/]+/post/[\w-]+|youtube\.com/watch\?v=[\w-]+|youtu\.be/[\w-]+)"
            matches = re.findall(link_pattern, message.content)

            # Regex pattern to detect links surrounded by < >
            surrounded_link_pattern = r"<https?://(?:www\.)?(twitter\.com/\w+/status/\d+|x\.com/\w+/status/\d+|instagram\.com/(?:p|reel)/[\w-]+|reddit\.com/r/\w+/s/\w+|reddit\.com/r/\w+/comments/\w+/\w+|old\.reddit\.com/r/\w+/comments/\w+/\w+|pixiv\.net/(?:en/)?artworks/\d+|threads\.net/@[^/]+/post/[\w-]+|bsky\.app/profile/[^/]+/post/[\w-]+|youtube\.com/watch\?v=[\w-]+|youtu\.be/[\w-]+)>"

            valid_link_found = False

            for original_link in matches:
                # Skip links if they are surrounded by < >
                if re.search(surrounded_link_pattern, message.content):
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

                elif 'youtube.com' in original_link or 'youtu.be' in original_link:
                    service = "YouTube"
                    if 'youtube.com' in original_link:
                        video_id_match = re.findall(r"youtube\.com/watch\?v=([\w-]+)", original_link)
                        if video_id_match:
                            video_id = video_id_match[0]
                            modified_link = f"koutube.com/watch?v={video_id}"
                            display_text = f"YouTube • {video_id}"
                    elif 'youtu.be' in original_link:
                        video_id_match = re.findall(r"youtu\.be/([\w-]+)", original_link)
                        if video_id_match:
                            video_id = video_id_match[0]
                            modified_link = f"koutube.com/watch?v={video_id}"
                            display_text = f"YouTube • {video_id}"

                if service and user_or_community and service in enabled_services:
                    if not display_text:
                        display_text = f"{service} • {user_or_community}"
                    modified_link = original_link.replace("twitter.com", "fxtwitter.com")\
                                                 .replace("x.com", "fixupx.com")\
                                                 .replace("instagram.com", "d.vxinstagram.com")\
                                                 .replace("reddit.com", "vxreddit.com")\
                                                 .replace("old.reddit.com", "vxreddit.com")\
                                                 .replace("threads.net", "fixthreads.net")\
                                                 .replace("pixiv.net", "phixiv.net")\
                                                 .replace("bsky.app", "bskyx.app")\
                                                 .replace("youtube.com", "koutube.com")\
                                                 .replace("youtu.be", "koutube.com/watch?v=")
                    valid_link_found = True

                if valid_link_found:
                    if delete_original:
                        formatted_message = f"[{display_text}](https://{modified_link})"
                        if mention_users:
                            formatted_message += f" | Sent by {message.author.mention}"
                        else:
                            formatted_message += f" | Sent by {message.author.display_name}"
                        await rate_limited_send(message.channel, formatted_message)
                        await message.delete()
                    else:
                        await message.edit(suppress=True)
                        formatted_message = f"[{display_text}](https://{modified_link})"
                        await rate_limited_send(message.channel, formatted_message)

        except discord.Forbidden:
            logging.warning(f"Missing permissions in channel {message.channel.id}")
        except discord.NotFound:
            logging.debug(f"Message already deleted in channel {message.channel.id}")
        except discord.HTTPException as e:
            logging.error(f"HTTP error in on_message: {e}")
        except Exception as e:
            logging.error(f"Unexpected error in on_message: {e}", exc_info=True)

    await client.process_commands(message)

@client.event
async def on_guild_join(guild):
    guild_id = guild.id
    if guild_id not in bot_settings:
        bot_settings[guild_id] = {
            "enabled_services": ["Twitter", "Instagram", "Reddit", "Threads", "Pixiv", "Bluesky", "YouTube"],
            "mention_users": True,
            "delete_original": True,
            "language": "en"
        }
        await update_setting(client.db, guild_id, bot_settings[guild_id]["enabled_services"], bot_settings[guild_id]["mention_users"], bot_settings[guild_id]["delete_original"], bot_settings[guild_id]["language"])

# Loading the bot token from .env
load_dotenv()
bot_token = os.getenv('BOT_TOKEN')
client.run(bot_token)

