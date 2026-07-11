"""Pure URL helpers shared by the Discord bot's link entry points."""

from urllib.parse import urlparse
from typing import Optional


def social_service(url: str) -> Optional[str]:
    """Return the supported service for a URL based on its hostname."""
    hostname = (urlparse(url).hostname or "").lower()
    if hostname.startswith("www."):
        hostname = hostname[4:]

    hosts = {
        "twitter.com": "Twitter",
        "x.com": "Twitter",
        "instagram.com": "Instagram",
        "reddit.com": "Reddit",
        "old.reddit.com": "Reddit",
        "pixiv.net": "Pixiv",
        "threads.net": "Threads",
        "threads.com": "Threads",
        "bsky.app": "Bluesky",
        "bskyx.app": "Bluesky",
        "bilibili.com": "Bilibili",
        "b23.tv": "Bilibili",
    }
    return hosts.get(hostname)
