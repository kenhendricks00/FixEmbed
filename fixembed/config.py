"""FixEmbed config."""

VERSION = "1.5.0"


SERVICE_NAMES = [
    "Twitter",
    "Instagram",
    "Reddit",
    "Threads",
    "Pixiv",
    "Bluesky",
    "Bilibili",
    "YouTube",
    "Pinterest",
    "TikTok",
    "Tumblr",
    "Twitch",
    "DeviantArt",
]


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
    "TikTok": "🎵",
    "Tumblr": "🅣",
    "Twitch": "🟣",
    "DeviantArt": "🎨",
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
    "TikTok": 1527868616215629954,
    "Tumblr": 1527868615393546400,
    "Twitch": 1527868614269468852,
    "DeviantArt": 1528150711089500180,
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


SUPPORT_GUILD_ID = 1195810157112852540


SUPPORTER_ROLE_ID = 1195810157112852547


DEDUP_WINDOW_SECONDS = 10
