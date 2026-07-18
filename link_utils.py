"""Pure URL helpers shared by the Discord bot's link entry points."""

from dataclasses import dataclass
import re
from typing import List, Optional
from urllib.parse import parse_qs, quote, urlparse, urlunparse


URL_PATTERN = re.compile(r"https?://[^\s<>]+", re.IGNORECASE)
TRAILING_PUNCTUATION = ".,!?;:)]}"
TWITTER_HOSTS = {"twitter.com", "x.com", "fxtwitter.com", "vxtwitter.com", "fixupx.com"}
PRECONVERTED_HOSTS = {"fixembed.app", "fixupx.com", "fxtwitter.com", "vxtwitter.com", "bskyx.app"}
EMBED_REVISION = "154"
TWITCH_RESERVED_PATHS = {
    "directory",
    "downloads",
    "inventory",
    "jobs",
    "p",
    "search",
    "settings",
    "subscriptions",
    "videos",
    "wallet",
}


@dataclass(frozen=True)
class SupportedLink:
    service: str
    canonical_url: str
    display_text: str
    start: int
    end: int
    language: Optional[str] = None
    mode: Optional[str] = None


def _hostname(url: str) -> str:
    hostname = (urlparse(url).hostname or "").lower()
    return hostname[4:] if hostname.startswith("www.") else hostname


def _unwrap_fixembed_url(url: str) -> str:
    parsed = urlparse(url)
    if _hostname(url) != "fixembed.app" or parsed.path.rstrip("/") != "/embed":
        return url
    return parse_qs(parsed.query).get("url", [url])[0]


def _strict_https_authority(parsed) -> bool:
    try:
        return (
            parsed.scheme.lower() == "https"
            and parsed.username is None
            and parsed.password is None
            and parsed.port in {None, 443}
        )
    except ValueError:
        return False


def social_service(url: str) -> Optional[str]:
    """Return the supported service for a URL based on its hostname."""
    hostname = _hostname(_unwrap_fixembed_url(url))
    if hostname.endswith(".tumblr.com") and hostname != "www.tumblr.com":
        return "Tumblr"
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
        "youtube.com": "YouTube",
        "pinterest.com": "Pinterest",
        "pin.it": "Pinterest",
        "tiktok.com": "TikTok",
        "vm.tiktok.com": "TikTok",
        "vt.tiktok.com": "TikTok",
        "tumblr.com": "Tumblr",
        "twitch.tv": "Twitch",
        "clips.twitch.tv": "Twitch",
        "deviantart.com": "DeviantArt",
        "sta.sh": "DeviantArt",
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

    if (
        host == "instagram.com"
        and len(segments) >= 3
        and segments[0].lower() == "share"
        and segments[1].lower() in {"p", "reel"}
    ):
        share_type, share_token = segments[1].lower(), segments[2]
        canonical = f"https://www.instagram.com/share/{share_type}/{share_token}/"
        return "Instagram", canonical, f"Instagram • {share_token}"

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

    if host == "youtube.com" and len(segments) >= 2 and segments[0].lower() == "post":
        post_id = segments[1]
        return "YouTube", f"https://www.youtube.com/post/{post_id}", "YouTube • Community Post"

    if host == "pinterest.com" and len(segments) >= 2 and segments[0].lower() == "pin":
        pin_id_match = re.search(r"(\d+)$", segments[1])
        if pin_id_match:
            pin_id = pin_id_match.group(1)
            return "Pinterest", f"https://www.pinterest.com/pin/{pin_id}/", f"Pinterest • {pin_id}"

    if host == "pin.it" and segments and re.fullmatch(r"[A-Za-z0-9_-]+", segments[0]):
        token = segments[0]
        return "Pinterest", f"https://pin.it/{token}", f"Pinterest • {token}"

    if (
        _strict_https_authority(parsed)
        and host == "deviantart.com"
        and len(segments) == 3
        and segments[1].lower() == "art"
        and re.fullmatch(r"[A-Za-z0-9_-]+", segments[0])
        and re.fullmatch(r"[A-Za-z0-9_-]+", segments[2])
    ):
        artist, slug = segments[0], segments[2]
        canonical = f"https://www.deviantart.com/{artist}/art/{slug}"
        return "DeviantArt", canonical, f"DeviantArt • {artist}"

    if (
        _strict_https_authority(parsed)
        and host == "sta.sh"
        and len(segments) == 1
        and re.fullmatch(r"[A-Za-z0-9_-]+", segments[0])
    ):
        token = segments[0]
        return "DeviantArt", f"https://sta.sh/{token}", "DeviantArt • Sta.sh"

    if (
        host == "tiktok.com"
        and len(segments) >= 3
        and segments[0].startswith("@")
        and segments[1].lower() == "video"
        and segments[2].isdigit()
    ):
        handle, post_id = segments[0][1:], segments[2]
        if re.fullmatch(r"[\w.-]+", handle):
            return (
                "TikTok",
                f"https://www.tiktok.com/@{handle}/video/{post_id}",
                f"TikTok • @{handle}",
            )

    if host in {"vm.tiktok.com", "vt.tiktok.com"} and segments:
        token = segments[0]
        if re.fullmatch(r"[A-Za-z0-9_-]+", token):
            return "TikTok", f"https://{host}/{token}/", f"TikTok • {token}"

    if host == "tiktok.com" and len(segments) >= 2 and segments[0].lower() == "t":
        token = segments[1]
        if re.fullmatch(r"[A-Za-z0-9_-]+", token):
            return "TikTok", f"https://www.tiktok.com/t/{token}/", f"TikTok • {token}"

    if host == "tumblr.com" and len(segments) >= 2 and segments[1].isdigit():
        blog, post_id = segments[0], segments[1]
        if re.fullmatch(r"[\w-]+", blog):
            slug = f"/{segments[2]}" if len(segments) >= 3 else ""
            canonical = f"https://{blog}.tumblr.com/post/{post_id}{slug}"
            return "Tumblr", canonical, f"Tumblr • @{blog}"

    if (
        host.endswith(".tumblr.com")
        and host != "www.tumblr.com"
        and len(segments) >= 2
        and segments[0].lower() == "post"
        and segments[1].isdigit()
    ):
        blog = host.removesuffix(".tumblr.com")
        if re.fullmatch(r"[\w-]+", blog):
            post_id = segments[1]
            slug = f"/{segments[2]}" if len(segments) >= 3 else ""
            canonical = f"https://{blog}.tumblr.com/post/{post_id}{slug}"
            return "Tumblr", canonical, f"Tumblr • @{blog}"

    if host == "clips.twitch.tv" and segments:
        slug = segments[0]
        if re.fullmatch(r"[A-Za-z0-9_-]+", slug):
            return (
                "Twitch",
                f"https://clips.twitch.tv/{slug}",
                f"Twitch • Clip {slug}",
            )

    if host == "twitch.tv" and len(segments) >= 3 and segments[1].lower() == "clip":
        channel, slug = segments[0], segments[2]
        if re.fullmatch(r"[A-Za-z0-9_]+", channel) and re.fullmatch(r"[A-Za-z0-9_-]+", slug):
            return (
                "Twitch",
                f"https://clips.twitch.tv/{slug}",
                f"Twitch • Clip {slug}",
            )

    if host == "twitch.tv" and len(segments) >= 2 and segments[0].lower() == "videos" and segments[1].isdigit():
        video_id = segments[1]
        return (
            "Twitch",
            f"https://www.twitch.tv/videos/{video_id}",
            f"Twitch • VOD {video_id}",
        )

    if host == "twitch.tv" and len(segments) == 1:
        channel = segments[0]
        if (
            channel.casefold() not in TWITCH_RESERVED_PATHS
            and re.fullmatch(r"[A-Za-z0-9_]+", channel)
        ):
            return (
                "Twitch",
                f"https://www.twitch.tv/{channel.casefold()}",
                f"Twitch • @{channel}",
            )

    return None


def extract_supported_links(
    text: str,
    include_suppressed: bool = False,
    include_preconverted: bool = True,
    include_fixembed: bool = False,
) -> List[SupportedLink]:
    """Extract supported URLs, optionally leaving pre-converted proxy links alone."""
    links: List[SupportedLink] = []
    for match in URL_PATTERN.finditer(text):
        raw_url = match.group(0).rstrip(TRAILING_PUNCTUATION)
        end = match.start() + len(raw_url)
        suppressed = match.start() > 0 and end < len(text) and text[match.start() - 1] == "<" and text[end] == ">"
        if suppressed and not include_suppressed:
            continue
        hostname = _hostname(raw_url)
        allow_first_party = include_fixembed and hostname == "fixembed.app"
        if not include_preconverted and hostname in PRECONVERTED_HOSTS and not allow_first_party:
            continue

        canonical = _canonicalize(raw_url)
        if canonical:
            service, canonical_url, display_text = canonical
            language = None
            mode = None
            if service == "Twitter":
                segments = [segment for segment in urlparse(_unwrap_fixembed_url(raw_url)).path.split("/") if segment]
                for modifier in segments[3:]:
                    if re.fullmatch(r"[A-Za-z]{2}", modifier):
                        language = modifier.lower()
                    elif modifier.lower() in {"gallery", "mosaic"}:
                        mode = modifier.lower()
            links.append(SupportedLink(service, canonical_url, display_text, match.start(), end, language, mode))
    return links


def build_fixembed_url(link: SupportedLink, quality: Optional[str] = None) -> str:
    """Build the public FixEmbed URL for a canonical supported link."""
    url = f"https://fixembed.app/embed?url={quote(link.canonical_url, safe='')}&v={EMBED_REVISION}"
    if quality:
        url = f"{url}&quality={quote(quality, safe='')}"
    if link.language:
        url = f"{url}&lang={quote(link.language, safe='')}"
    if link.mode:
        url = f"{url}&mode={quote(link.mode, safe='')}"
    return url


def build_automatic_url(
    link: SupportedLink,
    quality: Optional[str] = None,
    twitter_provider: Optional[str] = None,
) -> str:
    """Build an automatic-conversion URL, honoring the temporary X provider switch."""
    provider = (twitter_provider or "fixembed").strip().lower()
    if link.service != "Twitter" or provider not in {"fxtwitter", "fixupx"}:
        return build_fixembed_url(link, quality)

    parsed = urlparse(link.canonical_url)
    path = parsed.path.rstrip("/")
    if link.language:
        path = f"{path}/{link.language}"
    if link.mode:
        path = f"{path}/{link.mode}"
    return urlunparse(("https", f"{provider}.com", path, "", "", ""))


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
