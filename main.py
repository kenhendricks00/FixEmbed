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

# Version number
VERSION = "1.1.8"

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

def is_channel_enabled(channel_id):
    # DMs are always enabled
    if isinstance(channel_id, discord.DMChannel) or str(channel_id).startswith('DM:'):
        return True
        
    # Check the channel state in the dictionary
    if channel_id in channel_states:
        return channel_states[channel_id]
    
    # Default to True if not found
    return True

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
    async with db.execute('SELECT guild_id, enabled_services, mention_users, delete_original FROM guild_settings') as cursor:
        async for row in cursor:
            guild_id, enabled_services, mention_users, delete_original = row
            enabled_services_list = eval(enabled_services) if enabled_services else ["Twitter", "Instagram", "Reddit", "Threads", "Pixiv", "Bluesky", "YouTube"]          
            bot_settings[guild_id] = {
                "enabled_services": enabled_services_list,
                "mention_users": mention_users if mention_users is not None else True,
                "delete_original": delete_original if delete_original is not None else True
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

async def update_setting(db, guild_id, enabled_services, mention_users, delete_original):
    retries = 5
    for i in range(retries):
        try:
            await db.execute('INSERT OR REPLACE INTO guild_settings (guild_id, enabled_services, mention_users, delete_original) VALUES (?, ?, ?, ?)', (guild_id, repr(enabled_services), mention_users, delete_original))
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
    channel_states[channel.id] = True
    await update_channel_state(client.db, channel.id, True)
    embed = discord.Embed(title=f"{client.user.name}",
                          description=f'✅ Activated for {channel.mention}!',
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
    channel_states[channel.id] = False
    await update_channel_state(client.db, channel.id, False)
    embed = discord.Embed(title=f"{client.user.name}",
                          description=f'❌ Deactivated for {channel.mention}!',
                          color=discord.Color.red())
    create_footer(embed, client)
    await interaction.response.send_message(embed=embed)

@client.tree.command(
    name='about',
    description="Show information about the bot")
async def about(interaction: discord.Interaction):
    embed = discord.Embed(
        title="About",
        description="This bot fixes the lack of embed support in Discord.",
        color=discord.Color(0x7289DA))
    embed.add_field(
        name="🎉 Quick Links",
        value=(
            "- [Invite FixEmbed](https://discord.com/oauth2/authorize?client_id=1173820242305224764)\n"
            "- [Vote for FixEmbed on Top.gg](https://top.gg/bot/1173820242305224764)\n"
            "- [Star our Source Code on GitHub](https://github.com/kenhendricks00/FixEmbedBot)\n"
            "- [Join the Support Server](https://discord.gg/QFxTAmtZdn)"
        ),
        inline=False)
    embed.add_field(
        name="📜 Credits",
        value=(
            "- [FxTwitter](https://github.com/FixTweet/FxTwitter), created by FixTweet\n"
            "- [KKInstagram](https://kkinstagram.com), Instagram embed fixer\n"
            "- [vxReddit](https://github.com/dylanpdx/vxReddit), created by dylanpdx\n"
            "- [fixthreads](https://github.com/milanmdev/fixthreads), created by milanmdev\n"
            "- [phixiv](https://github.com/thelaao/phixiv), created by thelaao\n"
            "- [VixBluesky](https://github.com/Rapougnac/VixBluesky), created by Rapougnac\n"
            "- [koutube](https://github.com/iGerman00/koutube), created by iGerman00"
        ),
        inline=False)
    create_footer(embed, client)
    await interaction.response.send_message(embed=embed)

async def debug_info(interaction: discord.Interaction, channel: Optional[discord.TextChannel] = None):
    if not channel:
        channel = interaction.channel

    guild = interaction.guild
    permissions = channel.permissions_for(guild.me)
    fix_embed_status = is_channel_enabled(channel.id)
    fix_embed_activated = all(is_channel_enabled(ch.id) for ch in guild.text_channels)

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
        activated = all(
            is_channel_enabled(ch.id)
            for ch in interaction.guild.text_channels)
        mention_users = settings.get("mention_users", True)
        delete_original = settings.get("delete_original", True)
        
        options = [
            discord.SelectOption(
                label="FixEmbed",
                description="Activate or deactivate the bot in all channels",
                emoji="🟢" if activated else "🔴"
            ),
            discord.SelectOption(
                label="Mention Users",
                description="Toggle mentioning users in messages",
                emoji="🔔" if mention_users else "🔕"
            ),
            discord.SelectOption(
                label="Delivery Method",
                description="Toggle original message deletion",
                emoji="📬" if delete_original else "📪"
            ),
            discord.SelectOption(
                label="Service Settings",
                description="Configure which services are activated",
                emoji="⚙️"),
            discord.SelectOption(
                label="Debug",
                description="Show current debug information",
                emoji="🐞"
            )
        ]
        super().__init__(placeholder="Choose an option...",
                         min_values=1,
                         max_values=1,
                         options=options)

    async def callback(self, interaction: discord.Interaction):
        if self.values[0] == "Delivery Method":
            delete_original = self.settings.get("delete_original", True)
            embed = discord.Embed(
                title="Delivery Method Settings",
                description=f"Original message deletion is currently {'activated' if delete_original else 'deactivated'}.",
                color=discord.Color.green() if delete_original else discord.Color.red())
            view = DeliveryMethodSettingsView(delete_original, self.interaction, self.settings)
            await interaction.response.send_message(embed=embed, view=view, ephemeral=True)
        elif self.values[0] == "FixEmbed":
            activated = all(
                is_channel_enabled(ch.id)
                for ch in interaction.guild.text_channels)
            embed = discord.Embed(
                title="FixEmbed Settings",
                description="**Activate/Deactivate FixEmbed:**\n"
                f"{'🟢 FixEmbed activated' if activated else '🔴 FixEmbed deactivated'}\n\n"
                "**NOTE:** May take a few seconds to apply changes to all channels.",
                color=discord.Color.green()
                if activated else discord.Color.red())
            view = FixEmbedSettingsView(activated, self.interaction, self.settings)
            await interaction.response.send_message(embed=embed, view=view, ephemeral=True)
        elif self.values[0] == "Mention Users":
            mention_users = self.settings.get("mention_users", True)
            embed = discord.Embed(
                title="Mention Users Settings",
                description=f"User mentions are currently {'activated' if mention_users else 'deactivated'}.",
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
                title="Service Settings",
                description=f"Configure which services are activated.\n\n**Activated services:**\n{service_status_list}",
                color=discord.Color.blurple())
            view = ServiceSettingsView(self.interaction, self.settings)
            await interaction.response.send_message(embed=embed, view=view, ephemeral=True)
        elif self.values[0] == "Debug":
            await debug_info(interaction, interaction.channel)


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
        await update_setting(client.db, guild_id, selected_services, self.settings["mention_users"], self.settings["delete_original"])

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

class FixEmbedSettingsView(ui.View):

    def __init__(self, activated, interaction, settings, timeout=180):
        super().__init__(timeout=timeout)
        self.activated = activated
        self.interaction = interaction
        self.settings = settings
        self.toggle_button = discord.ui.Button(
            label="Activated" if activated else "Deactivated",
            style=discord.ButtonStyle.green if activated else discord.ButtonStyle.red)
        self.toggle_button.callback = self.toggle
        self.add_item(self.toggle_button)
        self.add_item(SettingsDropdown(interaction, settings))

    async def toggle(self, interaction: discord.Interaction):
        await interaction.response.defer()
        
        self.activated = not self.activated
        for ch in self.interaction.guild.text_channels:
            channel_states[ch.id] = self.activated
            await update_channel_state(client.db, ch.id, self.activated)
        self.toggle_button.label = "Activated" if self.activated else "Deactivated"
        self.toggle_button.style = discord.ButtonStyle.green if self.activated else discord.ButtonStyle.red

        embed = discord.Embed(
            title="FixEmbed Settings",
            description="**Activate/Deactivate FixEmbed:**\n"
            f"{'🟢 FixEmbed activated' if self.activated else '🔴 FixEmbed deactivated'}\n\n"
            "**NOTE:** May take a few seconds to apply changes to all channels.",
            color=discord.Color.green() if self.activated else discord.Color.red())

        try:
            await interaction.edit_original_response(embed=embed, view=self, ephemeral=True)
        except discord.errors.NotFound:
            logging.error("Failed to edit original response: Unknown Webhook")

    async def on_timeout(self):
        for item in self.children:
            item.disabled = True

        embed = discord.Embed(
            title="FixEmbed Settings",
            description="This view has timed out and is no longer interactive.",
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
        self.toggle_button = discord.ui.Button(
            label="Activated" if mention_users else "Deactivated",
            style=discord.ButtonStyle.green if mention_users else discord.ButtonStyle.red)
        self.toggle_button.callback = self.toggle
        self.add_item(self.toggle_button)
        self.add_item(SettingsDropdown(interaction, settings))

    async def toggle(self, interaction: discord.Interaction):
        await interaction.response.defer()
        
        self.mention_users = not self.mention_users
        self.settings["mention_users"] = self.mention_users
        await update_setting(client.db, self.interaction.guild.id, self.settings["enabled_services"], self.mention_users, self.settings["delete_original"])
        self.toggle_button.label = "Activated" if self.mention_users else "Deactivated"
        self.toggle_button.style = discord.ButtonStyle.green if self.mention_users else discord.ButtonStyle.red

        embed = discord.Embed(
            title="Mention Users Settings",
            description=f"User mentions are currently {'activated' if self.mention_users else 'deactivated'}.",
            color=discord.Color.green() if self.mention_users else discord.Color.red())

        try:
            await interaction.edit_original_response(embed=embed, view=self)
        except discord.errors.NotFound:
            logging.error("Failed to edit original response: Unknown Webhook")

    async def on_timeout(self):
        for item in self.children:
            item.disabled = True

        embed = discord.Embed(
            title="Mention Users Settings",
            description="This view has timed out and is no longer interactive.",
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
        self.toggle_button = discord.ui.Button(
            label="Activated" if delete_original else "Deactivated",
            style=discord.ButtonStyle.green if delete_original else discord.ButtonStyle.red)
        self.toggle_button.callback = self.toggle
        self.add_item(self.toggle_button)
        self.add_item(SettingsDropdown(interaction, settings))

    async def toggle(self, interaction: discord.Interaction):
        await interaction.response.defer()

        self.delete_original = not self.delete_original
        self.settings["delete_original"] = self.delete_original
        await update_setting(client.db, self.interaction.guild.id, self.settings["enabled_services"], self.settings["mention_users"], self.delete_original)
        
        self.toggle_button.label = "Activated" if self.delete_original else "Deactivated"
        self.toggle_button.style = discord.ButtonStyle.green if self.delete_original else discord.ButtonStyle.red

        embed = discord.Embed(
            title="Delivery Method Setting",
            description=f"Original message deletion is now {'activated' if self.delete_original else 'deactivated'}.",
            color=discord.Color.green() if self.delete_original else discord.Color.red())

        try:
            await interaction.edit_original_response(embed=embed, view=self)
        except discord.errors.NotFound:
            logging.error("Failed to edit original response: Unknown Webhook")

    async def on_timeout(self):
        for item in self.children:
            item.disabled = True

        embed = discord.Embed(
            title="Delivery Method Setting",
            description="This view has timed out and is no longer interactive.",
            color=discord.Color.red())
        
        try:
            await self.interaction.edit_original_response(embed=embed, view=self)
        except discord.errors.NotFound:
            logging.error("Failed to edit original response on timeout: Unknown Webhook")

@client.tree.command(name='settings', description="Configure FixEmbed's settings")
async def settings(interaction: discord.Interaction):
    # Check if in a DM
    if interaction.guild is None:
        embed = discord.Embed(title="Settings",
                             description="FixEmbed is always enabled in DMs with all services active.",
                             color=discord.Color(0x7289DA))
        embed.add_field(
            name="📱 Direct Messages Mode",
            value="All link fixing features are enabled when chatting directly with the bot.",
            inline=False)
        create_footer(embed, client)
        await interaction.response.send_message(embed=embed)
        return
    
    # Guild settings
    guild_id = interaction.guild.id
    guild_settings = bot_settings.get(guild_id, {"enabled_services": ["Twitter", "Instagram", "Reddit", "Threads", "Pixiv", "Bluesky", "YouTube"], "mention_users": True, "delete_original": True})
    
    embed = discord.Embed(title="Settings",
                          description="Configure FixEmbed's settings",
                          color=discord.Color(0x7289DA))
    create_footer(embed, client)
    await interaction.response.send_message(embed=embed, view=SettingsView(interaction, guild_settings), ephemeral=True)

@client.event
async def on_message(message):
    if message.author == client.user:
        return

    # Default settings to use for DMs
    dm_settings = {
        "enabled_services": ["Twitter", "Instagram", "Reddit", "Threads", "Pixiv", "Bluesky", "YouTube"],
        "mention_users": True,
        "delete_original": True
    }
    
    # Check if message is in a guild or DM
    is_dm = message.guild is None
    
    if is_dm:
        # Use default settings for DMs
        enabled_services = dm_settings["enabled_services"]
        mention_users = dm_settings["mention_users"]
        delete_original = dm_settings["delete_original"]
        channel_enabled = True  # Always enable in DMs
    else:
        # Guild settings
        guild_id = message.guild.id
        guild_settings = bot_settings.get(guild_id, {
            "enabled_services": ["Twitter", "Instagram", "Reddit", "Threads", "Pixiv", "Bluesky", "YouTube"],
            "mention_users": True,
            "delete_original": True
        })
        enabled_services = guild_settings.get("enabled_services", ["Twitter", "Instagram", "Reddit", "Threads", "Pixiv", "Bluesky", "YouTube"])
        mention_users = guild_settings.get("mention_users", True)
        delete_original = guild_settings.get("delete_original", True)
        channel_enabled = is_channel_enabled(message.channel.id)
    
    if channel_enabled:
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
                                                 .replace("instagram.com", "kkinstagram.com")\
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
                        if mention_users and not is_dm:
                            # Only mention users in guilds, not in DMs
                            await message.channel.send(f"{message.author.mention}: {formatted_message}")
                        else:
                            # No mention in DMs
                            await message.channel.send(formatted_message)
                        try:
                            # Only delete message in guild context, not in DMs
                            if not is_dm:
                                await message.delete()
                        except discord.errors.Forbidden:
                            pass  # No permission to delete
                    else:
                        # Don't delete original message, just reply with fixed link
                        formatted_message = f"[{display_text}](https://{modified_link})"
                        try:
                            # Use mention_author only in guilds, not in DMs
                            await message.reply(formatted_message, mention_author=mention_users and not is_dm)
                        except discord.errors.HTTPException:
                            # Fallback if reply fails
                            if is_dm:
                                await message.channel.send(f"Fixed link: {formatted_message}")
                            else:
                                if mention_users:
                                    await message.channel.send(f"{message.author.mention}: {formatted_message}")
                                else:
                                    await message.channel.send(formatted_message)

        except Exception as e:
            logging.error(f"Error in on_message: {e}")
            # Log different error formats based on context
            if is_dm:
                logging.error(f"Error in DM with user {message.author.id}: {e}")
            else:
                logging.error(f"Error in guild {message.guild.id}, channel {message.channel.id}: {e}")

    await client.process_commands(message)

@client.event
async def on_guild_join(guild):
    guild_id = guild.id
    if guild_id not in bot_settings:
        bot_settings[guild_id] = {
            "enabled_services": ["Twitter", "Instagram", "Reddit", "Threads", "Pixiv", "Bluesky", "YouTube"],
            "mention_users": True,
            "delete_original": True
        }
        await update_setting(client.db, guild_id, bot_settings[guild_id]["enabled_services"], bot_settings[guild_id]["mention_users"], bot_settings[guild_id]["delete_original"])

# Loading the bot token from .env
load_dotenv()
bot_token = os.getenv('BOT_TOKEN')
client.run(bot_token)
