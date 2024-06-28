from typing import Optional
import discord
from discord.ext import commands, tasks
from discord import app_commands
import re
import os
import logging
from dotenv import load_dotenv
import itertools
import aiosqlite

# Initialize logging
logging.basicConfig(level=logging.INFO)

# Bot configuration
intents = discord.Intents(guild_messages=True, message_content=True, guilds=True)
client = commands.AutoShardedBot(shard_count=10, command_prefix='/', intents=intents)

# In-memory storage for channel states
channel_states = {}

def create_footer(embed, client):
    embed.set_footer(text=f"{client.user.name} | ver. 1.0.5", icon_url=client.user.avatar.url)

async def init_db():
    async with aiosqlite.connect('channel_states.db') as db:
        await db.execute('''CREATE TABLE IF NOT EXISTS channel_states (channel_id INTEGER PRIMARY KEY, state BOOLEAN)''')
        await db.commit()

async def load_channel_states():
    async with aiosqlite.connect('channel_states.db') as db:
        async with db.execute('SELECT channel_id, state FROM channel_states') as cursor:
            async for row in cursor:
                channel_states[row[0]] = row[1]

async def update_channel_state(channel_id, state):
    async with aiosqlite.connect('channel_states.db') as db:
        await db.execute('INSERT OR REPLACE INTO channel_states (channel_id, state) VALUES (?, ?)', (channel_id, state))
        await db.commit()

@client.event
async def on_ready():
    print(f'We have logged in as {client.user}')
    logging.info(f'Logged in as {client.user}')
    await client.tree.sync()  # Sync commands with Discord
    await init_db()  # Initialize the database
    await load_channel_states()  # Load channel states from the database
    change_status.start()  # Start the status change loop

# Define the statuses to alternate
statuses = itertools.cycle(["for Twitter links", "for Reddit links", "for TikTok links", "for Instagram links"])

# Task to change the bot's status
@tasks.loop(seconds=60)  # Change status every 60 seconds
async def change_status():
    current_status = next(statuses)
    await client.change_presence(activity=discord.Activity(type=discord.ActivityType.watching, name=current_status))

# Enable command
@client.tree.command(name='enable', description="Enable link processing in this channel, another channel, or all channels")
@app_commands.describe(channel="The channel to enable link processing in (leave blank for current channel)", all_channels="Enable link processing in all channels")
async def enable(ctx: discord.Interaction, channel: Optional[discord.TextChannel] = None, all_channels: Optional[bool] = False):
    if all_channels:
        for ch in ctx.guild.text_channels:
            channel_states[ch.id] = True
            await update_channel_state(ch.id, True)
        embed = discord.Embed(title=f"{client.user.name}", description=f'✅ Enabled in all channels of {ctx.guild.name}!', color=discord.Color(0x78b159))
        create_footer(embed, client)
        await ctx.response.send_message(embed=embed)
    else:
        if channel is None:
            channel = ctx.channel
        channel_states[channel.id] = True
        await update_channel_state(channel.id, True)
        embed = discord.Embed(title=f"{client.user.name}", description=f'✅ Enabled for {channel.mention}!', color=discord.Color(0x78b159))
        create_footer(embed, client)
        await ctx.response.send_message(embed=embed)

# Disable command
@client.tree.command(name='disable', description="Disable link processing in this channel, another channel, or all channels")
@app_commands.describe(channel="The channel to disable link processing in (leave blank for current channel)", all_channels="Disable link processing in all channels")
async def disable(ctx: discord.Interaction, channel: Optional[discord.TextChannel] = None, all_channels: Optional[bool] = False):
    if all_channels:
        for ch in ctx.guild.text_channels:
            channel_states[ch.id] = False
            await update_channel_state(ch.id, False)
        embed = discord.Embed(title=f"{client.user.name}", description=f'❎ Disabled in all channels of {ctx.guild.name}!', color=discord.Color(0x78b159))
        create_footer(embed, client)
        await ctx.response.send_message(embed=embed)
    else:
        if channel is None:
            channel = ctx.channel
        channel_states[channel.id] = False
        await update_channel_state(channel.id, False)
        embed = discord.Embed(title=f"{client.user.name}", description=f'❎ Disabled for {channel.mention}!', color=discord.Color(0x78b159))
        create_footer(embed, client)
        await ctx.response.send_message(embed=embed)

@client.tree.command(name='about', description="Show information about the bot or a specific channel")
@app_commands.describe(channel="The channel to show information about")
async def about(ctx: discord.Interaction, channel: Optional[discord.TextChannel] = None):
    # If no channel is specified, use the current channel
    if not channel:
        channel = ctx.channel

    guild = ctx.guild
    permissions = channel.permissions_for(guild.me)

    # Check if FixEmbed is working in the specified channel
    fix_embed_status = channel_states.get(channel.id, True)

    # Set embed color to Discord purple
    embed = discord.Embed(title="About", description="This bot fixes the lack of embed support in Discord.", color=discord.Color(0x7289DA))
    embed.add_field(name="Ping", value=f"{round(client.latency * 1000)} ms", inline=False)
    embed.add_field(name="Debug info", value=(
        f'{f"🟢 **FixEmbed working in** {channel.mention}" if fix_embed_status else f"🔴 **FixEmbed not working in** {channel.mention}"}\n'
        f"- {'🟢 FixEmbed enabled' if fix_embed_status else '🔴 FixEmbed disabled'}\n"
        f"- {'🟢' if permissions.read_messages else '🔴'} Read message permission\n"
        f"- {'🟢' if permissions.send_messages else '🔴'} Send message permission\n"
        f"- {'🟢' if permissions.embed_links else '🔴'} Embed links permission\n"
        f"- {'🟢' if permissions.manage_messages else '🔴'} Manage messages permission"
    ), inline=False)
    embed.add_field(name="Links", value=(
        "- [Invite link](https://discord.com/api/oauth2/authorize?client_id=1173820242305224764&permissions=274877934592&scope=bot+applications.commands)\n"
        "- [Tog.gg Page](https://top.gg/bot/1173820242305224764) (please vote!)\n"
        "- [Source code](https://github.com/kenhendricks00/FixEmbedBot) (please leave a star!)\n"
        "- [Support server](https://discord.gg/QFxTAmtZdn)"
        ), inline=False)
    create_footer(embed, client)
    await ctx.response.send_message(embed=embed)

@client.event
async def on_message(message):
    # Ensure the bot does not respond to its own messages
    if message.author == client.user:
        return

    # Check if the feature is enabled for the channel
    if channel_states.get(message.channel.id, True):
        try:
            link_pattern = r"https?://(?:www\.)?(twitter\.com/\w+/status/\d+|x\.com/\w+/status/\d+|tiktok\.com/@[^/]+/video/\d+|tiktok\.com/t/\w+|instagram\.com/(?:p|reel)/\w+|reddit\.com/r/\w+/comments/\w+/\w+)"
            matches = re.findall(link_pattern, message.content)

            # Flag to check if a valid link is found
            valid_link_found = False

            for original_link in matches:
                display_text = ""
                modified_link = original_link
                service = ""
                user_or_community = ""

                # Check and process Twitter links
                if 'twitter.com' in original_link or 'x.com' in original_link:
                    service = "Twitter"
                    user_match = re.findall(r"(?:twitter\.com|x\.com)/(\w+)/status/\d+", original_link)
                    user_or_community = user_match[0] if user_match else "Unknown"

                # Check and process TikTok links with the username and video ID pattern - Desktop Links
                elif 'tiktok.com/@' in original_link:
                    service = "TikTok"
                    tiktok_match = re.search(r"tiktok\.com/@([^/]+)/video/(\d+)", original_link)
                    if tiktok_match:
                        user_or_community = tiktok_match.group(1)
                        video_id = tiktok_match.group(2)
                        modified_link = f"vxtiktok.com/@{user_or_community}/video/{video_id}"
                        display_text = f"TikTok • @{user_or_community}"

                # Check and process short TikTok links (tiktok.com/t/<code>) - Mobile Links
                elif 'tiktok.com/t/' in original_link:
                    service = "TikTok"
                    tiktok_match = re.search(r"tiktok\.com/t/(\w+)", original_link)
                    if tiktok_match:
                        user_or_community = tiktok_match.group(1)
                        modified_link = f"vxtiktok.com/t/{user_or_community}"
                        display_text = f"TikTok • {user_or_community}"

                # Check and process Instagram links
                elif 'instagram.com' in original_link:
                    service = "Instagram"
                    user_match = re.findall(r"instagram\.com/(?:p|reel)/(\w+)", original_link)
                    user_or_community = user_match[0] if user_match else "Unknown"

                # Check and process Reddit links
                elif 'reddit.com' in original_link:
                    service = "Reddit"
                    community_match = re.findall(r"reddit\.com/r/(\w+)/comments", original_link)
                    user_or_community = community_match[0] if community_match else "Unknown"

                # Modify the link if necessary
                if service and user_or_community:
                    display_text = f"{service} • {user_or_community}"
                    modified_link = original_link.replace("twitter.com", "fxtwitter.com")\
                                                 .replace("x.com", "fixupx.com")\
                                                 .replace("tiktok.com", "vxtiktok.com")\
                                                 .replace("instagram.com", "ddinstagram.com")\
                                                 .replace("reddit.com", "rxddit.com")
                    valid_link_found = True

                # Send the formatted message and delete the original message if a valid link is found
                if valid_link_found:
                    formatted_message = f"[{display_text}](https://{modified_link}) | Sent by {message.author.mention}"
                    await message.channel.send(formatted_message)
                    await message.delete()
                    
        except Exception as e:
            logging.error(f"Error in on_message: {e}")

    # This line is necessary to process commands
    await client.process_commands(message)

# Loading the bot token from .env
load_dotenv()
bot_token = os.getenv('BOT_TOKEN')
client.run(bot_token)
