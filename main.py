import discord
from discord.ext import commands
import re
import os
import logging
from dotenv import load_dotenv

# Initialize logging
logging.basicConfig(level=logging.INFO)

# Bot configuration
intents = discord.Intents(guild_messages=True, message_content=True, guilds=True)
client = commands.Bot(command_prefix='/', intents=intents)

# In-memory storage for channel states
channel_states = {}

def create_footer(embed, client):
  embed.set_footer(text=f"{client.user.name} | ver. 1.0.1", icon_url=client.user.avatar.url)

@client.event
async def on_ready():
    print(f'We have logged in as {client.user}')
    logging.info(f'Logged in as {client.user}')
    await client.tree.sync()  # Sync commands with Discord

@client.tree.command(name='enable', description="Enable link processing in this channel or another channel")
async def enable(ctx, channel: discord.TextChannel = None):
    if not channel:
        channel = ctx.channel
    channel_states[channel.id] = True
    embed = discord.Embed(title=f"{client.user.name}", description=f'✅ Enabled for {channel.mention}!', color=discord.Color(0x78b159))
    create_footer(embed, client)
    await ctx.response.send_message(embed=embed)

@client.tree.command(name='disable', description="Disable link processing in this channel or another channel")
async def disable(ctx, channel: discord.TextChannel = None):
    if not channel:
        channel = ctx.channel
    channel_states[channel.id] = False
    embed = discord.Embed(title=f"{client.user.name}", description=f'❎ Disabled for {channel.mention}!', color=discord.Color(0x78b159))
    create_footer(embed, client)
    await ctx.response.send_message(embed=embed)

@client.tree.command(name='about', description="Show information about the bot or a specific channel")
async def about(ctx, channel: discord.TextChannel = None):
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
            # Regular expression to detect links
            link_pattern = r"https?://(?:www\.)?(twitter\.com/\w+/status/\d+|x\.com/\w+/status/\d+|tiktok\.com/t/\w+|instagram\.com/(?:p|reel)/\w+|reddit\.com/r/\w+/comments/\w+/\w+)"
            matches = re.findall(link_pattern, message.content)

            for original_link in matches:
                display_text = ""
                modified_link = original_link

                # Check and process Twitter links
                if 'twitter.com' in original_link:
                    twitter_match = re.findall(r"twitter\.com/(\w+)/status/\d+", original_link)
                    if twitter_match:
                        user = twitter_match[0]
                        display_text = f"[Twitter • {user}]"
                        modified_link = original_link.replace("twitter.com", "fxtwitter.com")

                # Check and process x.com links
                if 'x.com' in original_link:
                    twitter_match = re.findall(r"x\.com/(\w+)/status/\d+", original_link)
                    if twitter_match:
                        user = twitter_match[0]
                        display_text = f"[Twitter • {user}]"
                        modified_link = original_link.replace("x.com", "fxtwitter.com")

                # Check and process TikTok links
                elif 'tiktok.com' in original_link:
                    tiktok_match = re.findall(r"tiktok\.com/t/(\w+)", original_link)
                    if tiktok_match:
                        user = tiktok_match[0]
                        display_text = f"[TikTok • {user}]"
                        modified_link = original_link.replace("tiktok.com", "vxtiktok.com")

                # Check and process Instagram links
                elif 'instagram.com' in original_link:
                    instagram_match = re.findall(r"instagram\.com/(?:p|reel)/(\w+)", original_link)
                    if instagram_match:
                        user = instagram_match[0]
                        display_text = f"[Instagram • {user}]"
                        modified_link = original_link.replace("instagram.com", "ddinstagram.com")

                # Check and process Reddit links
                elif 'reddit.com' in original_link:
                    reddit_match = re.findall(r"reddit\.com/r/(\w+)/comments", original_link)
                    if reddit_match:
                        community = reddit_match[0]
                        display_text = f"[Reddit • {community}]"
                        modified_link = original_link.replace("reddit.com", "rxddit.com")

                # Send the formatted message
                if display_text:
                    formatted_message = f"{display_text}(https://{modified_link})"
                    await message.channel.send(formatted_message)

        except Exception as e:
            logging.error(f"Error in on_message: {e}")

    # This line is necessary to process commands
    await client.process_commands(message)


# Loading the bot token from .env
load_dotenv()
bot_token = os.getenv('BOT_TOKEN')
client.run(bot_token)