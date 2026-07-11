"""Pure URL helpers shared by the Discord bot's link entry points."""

from dataclasses import dataclass
import re
from typing import List, Optional
from urllib.parse import parse_qs, quote, urlparse, urlunparse


URL_PATTERN = re.compile(r"https?://[^\s<>]+", re.IGNORECASE)
TRAILING_PUNCTUATION = ".,!?;:)]}"
TWITTER_HOSTS = {"twitter.com", "x.com", "fxtwitter.com", "vxtwitter.com", "fixupx.com"}
EMBED_REVISION = "142"


@dataclass(frozen=True)
class SupportedLink:
    service: str
    canonical_url: str
    display_text: str
    start: int
    end: int


def _hostname(url: str) -> str:
    hostname = (urlparse(url).hostname or "").lower()
    return hostname[4:] if hostname.startswith("www.") else hostname


def _unwrap_fixembed_url(url: str) -> str:
    parsed = urlparse(url)
    if _hostname(url) != "fixembed.app" or parsed.path.rstrip("/") != "/embed":
        return url
    return parse_qs(parsed.query).get("url", [url])[0]


def social_service(url: str) -> Optional[str]:
    """Return the supported service for a URL based on its hostname."""
    hostname = _hostname(_unwrap_fixembed_url(url))
    hosts = {
        **{host: "Twitter" for host in TWITTER_HOSTS},
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


def _canonicalize(url: str) -> Optional[tuple[str, str, str]]:
    url = _unwrap_fixembed_url(url)
    parsed = urlparse(url)
    host = _hostname(url)
    segments = [segment for segment in parsed.path.split("/") if segment]

    if host in TWITTER_HOSTS and len(segments) >= 3 and segments[1].lower() == "status" and segments[2].isdigit():
        username, post_id = segments[0], segments[2]
        return "Twitter", f"https://x.com/{username}/status/{post_id}", f"Twitter • {username}"

    if host == "instagram.com" and len(segments) >= 2 and segments[0].lower() in {"p", "reel", "reels"}:
        kind = "p" if segments[0].lower() == "p" else "reel"
        shortcode = segments[1]
        return "Instagram", f"https://www.instagram.com/{kind}/{shortcode}/", f"Instagram • {shortcode}"

    if host in {"reddit.com", "old.reddit.com"} and len(segments) >= 4 and segments[0].lower() == "r" and segments[2].lower() in {"comments", "s"}:
        community = segments[1]
        canonical = urlunparse(("https", "www.reddit.com", parsed.path, "", "", ""))
        return "Reddit", canonical, f"Reddit • r/{community}"

    if host == "pixiv.net" and len(segments) >= 2:
        artwork_index = 1 if segments[0].lower() == "artworks" else 2 if segments[:2] == ["en", "artworks"] else -1
        if artwork_index >= 0 and len(segments) > artwork_index and segments[artwork_index].isdigit():
            artwork_id = segments[artwork_index]
            return "Pixiv", f"https://www.pixiv.net/en/artworks/{artwork_id}", f"Pixiv • {artwork_id}"

    if host in {"threads.net", "threads.com"} and len(segments) >= 3 and segments[0].startswith("@") and segments[1].lower() == "post":
        username, post_id = segments[0][1:], segments[2]
        return "Threads", f"https://www.threads.net/@{username}/post/{post_id}", f"Threads • @{username}"

    if host in {"bsky.app", "bskyx.app"} and len(segments) >= 4 and segments[0].lower() == "profile" and segments[2].lower() == "post":
        handle, post_id = segments[1], segments[3]
        return "Bluesky", f"https://bsky.app/profile/{handle}/post/{post_id}", f"Bluesky • {handle}"

    if host == "bilibili.com" and len(segments) >= 2 and segments[0].lower() == "video":
        video_id = segments[1]
        return "Bilibili", f"https://www.bilibili.com/video/{video_id}", f"Bilibili • {video_id}"

    if host == "b23.tv" and segments:
        video_id = segments[0]
        return "Bilibili", f"https://b23.tv/{video_id}", f"Bilibili • {video_id}"

    return None


def extract_supported_links(text: str, include_suppressed: bool = False) -> List[SupportedLink]:
    """Extract supported URLs in input order and normalize known proxy URLs."""
    links: List[SupportedLink] = []
    for match in URL_PATTERN.finditer(text):
        raw_url = match.group(0).rstrip(TRAILING_PUNCTUATION)
        end = match.start() + len(raw_url)
        suppressed = match.start() > 0 and end < len(text) and text[match.start() - 1] == "<" and text[end] == ">"
        if suppressed and not include_suppressed:
            continue

        canonical = _canonicalize(raw_url)
        if canonical:
            service, canonical_url, display_text = canonical
            links.append(SupportedLink(service, canonical_url, display_text, match.start(), end))
    return links


def build_fixembed_url(link: SupportedLink, quality: Optional[str] = None) -> str:
    """Build the public FixEmbed URL for a canonical supported link."""
    url = f"https://fixembed.app/embed?url={quote(link.canonical_url, safe='')}&v={EMBED_REVISION}"
    return f"{url}&quality={quote(quality, safe='')}" if quality else url


def chunk_lines(lines: List[str], max_length: int = 1900) -> List[str]:
    """Group complete lines into Discord-safe message chunks."""
    chunks: List[str] = []
    current: List[str] = []
    current_length = 0

    for line in lines:
        if len(line) > max_length:
            raise ValueError("A formatted link is too long to send through Discord")
        added_length = len(line) + (1 if current else 0)
        if current and current_length + added_length > max_length:
            chunks.append("\n".join(current))
            current = [line]
            current_length = len(line)
        else:
            current.append(line)
            current_length += added_length

    if current:
        chunks.append("\n".join(current))
    return chunks
