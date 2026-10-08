"""Build bot-authored Reddit cards from FixEmbed metadata."""

from __future__ import annotations

from typing import Any, Mapping, Optional
import re
from urllib.parse import parse_qs, urlencode, urlparse

import aiohttp
import discord

from component_emojis import application_emoji, format_component_stats
from embed_footer import FooterBranding, build_component_footer, translated_source_name
from card_preferences import CardPreferences, apply_caption_preferences
from markdown_safety import masked_link_label, neutralize_mentions
from timestamp_utils import parse_post_timestamp


FIXEMBED_API = "https://fixembed.app/api/embed"
REDDIT_COLOR = 0xFF4500
FIXEMBED_EMOJI_ID = 1525580543503106148
REDDIT_EMOJI_ID = 1526267589808881684


def _split_title(value: Any) -> tuple[str, str]:
    raw = str(value or "Reddit post").strip()
    subreddit, separator, title = raw.partition(" • ")
    if separator and subreddit.casefold().startswith("r/"):
        return subreddit, title
    return "Reddit", raw


def _section_text(section: Mapping[str, Any]) -> str:
    title = str(section.get("title") or "Linked content").strip()
    url = str(section.get("url") or "").strip()
    body = neutralize_mentions(str(section.get("body") or "").strip())
    heading = (
        f"### [{masked_link_label(title)}]({url})"
        if url
        else f"### {neutralize_mentions(title)}"
    )
    return "\n".join(part for part in (heading, body[:900]) if part)


def _parent_post_section(sections: list[Any]) -> Optional[Mapping[str, Any]]:
    return next(
        (
            section
            for section in sections
            if isinstance(section, Mapping)
            and section.get("kind") == "quote"
            and str(section.get("body") or "").strip().casefold() == "parent post"
            and str(section.get("url") or "").strip().startswith(("https://", "http://"))
        ),
        None,
    )



def _is_unavailable_comment_payload(payload: Mapping[str, Any], sections: list[Any]) -> bool:
    title = str(payload.get("title") or "")
    if "comment unavailable" in title.casefold():
        return True
    return any(
        isinstance(section, Mapping)
        and section.get("kind") == "tombstone"
        and "unavailable" in str(section.get("title") or "").casefold()
        for section in sections
    )


def is_reddit_comment_permalink(url: str) -> bool:
    """True when a Reddit URL targets a specific comment id."""
    if parse_qs(urlparse(url).query).get("comment"):
        return True
    # Match Worker parseRedditUrl: /comments/{post}/{slug|comment}/{commentId}
    return bool(
        re.search(
            r"reddit\.com/r/[^/]+/comments/[^/]+/[^/]+/([a-z0-9]+)(?:/|\?|#|$)",
            url,
            re.IGNORECASE,
        )
    )


def keeps_native_reddit_og_on_failure(service: str, url: str) -> bool:
    """True when a failed card build should leave Discord's native Reddit card alone.

    The Worker now returns a success:true tombstone payload only when Reddit says a
    comment is gone (404, [deleted]/[removed], or missing from a live listing). Any
    exception while building a Reddit comment card therefore means Reddit was
    unreachable (rate limit, 5xx, block, timeout), not that the comment was deleted.
    """
    return service == "Reddit" and is_reddit_comment_permalink(url)


def _build_unavailable_comment_layout(
    payload: Mapping[str, Any],
    converted_url: Optional[str] = None,
    footer_branding: Optional[FooterBranding] = None,
    card_preferences: Optional[CardPreferences] = None,
) -> discord.ui.LayoutView:
    """Render a clean FixEmbed failure card for deleted/missing comments."""
    subreddit, _ = _split_title(payload.get("title"))
    source_url = str(payload.get("url") or "").strip()
    description = str(
        payload.get("description")
        or "This Reddit comment was deleted or is no longer available."
    ).strip()
    preferences = card_preferences or CardPreferences()
    header_text = "\n".join(
        part
        for part in (
            f"**{subreddit}**",
            "### Comment unavailable",
            description,
        )
        if part
    )
    children: list[discord.ui.Item[Any]] = [
        discord.ui.TextDisplay(header_text),
        discord.ui.Separator(),
        discord.ui.TextDisplay(
            build_component_footer(
                fixembed_emoji=f"<:fixembed:{FIXEMBED_EMOJI_ID}>",
                platform_emoji=f"<:reddit:{REDDIT_EMOJI_ID}>",
                platform_name="Reddit",
                source_url=source_url,
                converted_url=converted_url,
                timestamp=None,
                branding=footer_branding,
            )
        ),
    ]
    view = discord.ui.LayoutView(timeout=None)
    view.add_item(discord.ui.Container(*children, accent_color=preferences.accent_or(REDDIT_COLOR)))
    return view


def _comment_quote_section(sections: list[Any]) -> Optional[Mapping[str, Any]]:
    return next(
        (
            section
            for section in sections
            if isinstance(section, Mapping)
            and section.get("kind") == "quote"
            and section is not _parent_post_section(sections)
            and (
                str(section.get("title") or "").strip().casefold().startswith("comment by ")
                or bool(str(section.get("body") or "").strip())
            )
        ),
        None,
    )


def _is_comment_payload(payload: Mapping[str, Any], sections: list[Any]) -> bool:
    title = str(payload.get("title") or "")
    if " • Comment on " in title or title.casefold().endswith("• comment"):
        return True
    return _parent_post_section(sections) is not None or _comment_quote_section(sections) is not None


def _blockquote_comment(section: Mapping[str, Any]) -> str:
    """Components V2 quote block: markdown blockquote with the quote emoji."""
    author = str(section.get("authorName") or "").strip().lstrip("@")
    title = str(section.get("title") or "").strip()
    if not author and title.casefold().startswith("comment by "):
        author = title.split(":", 1)[0][len("Comment by ") :].strip().lstrip("@")
    author_url = str(section.get("authorUrl") or "").strip()
    body = neutralize_mentions(str(section.get("body") or "").strip())
    if len(body) > 3000:
        body = f"{body[:2997].rstrip()}…"

    if author and author_url:
        author_text = f"[{masked_link_label(author)}]({author_url})"
    else:
        author_text = neutralize_mentions(author) or "unknown"
    heading = f"> {application_emoji('quote')} Comment by {author_text}:"
    if not body:
        return heading
    quoted_body = "\n".join(
        f"> {line}" if line else "> \u200b" for line in body.splitlines()
    )
    return f"{heading}\n> \u200b\n{quoted_body}"


def build_reddit_layout(
    payload: Mapping[str, Any],
    converted_url: Optional[str] = None,
    footer_branding: Optional[FooterBranding] = None,
    card_preferences: Optional[CardPreferences] = None,
) -> discord.ui.LayoutView:
    """Build a Reddit Components V2 card using only remote media URLs."""
    sections = payload.get("sections") if isinstance(payload.get("sections"), list) else []
    if _is_unavailable_comment_payload(payload, sections):
        return _build_unavailable_comment_layout(
            payload,
            converted_url,
            footer_branding,
            card_preferences,
        )

    subreddit, post_title = _split_title(payload.get("title"))
    author = str(payload.get("authorName") or "u/unknown").strip().lstrip("@")
    author_url = str(payload.get("authorUrl") or "").strip()
    subreddit_icon = str(payload.get("authorAvatar") or "").strip()
    source_url = str(payload.get("url") or "").strip()
    is_comment = _is_comment_payload(payload, sections)
    parent_post = _parent_post_section(sections) if is_comment else None
    comment_quote = _comment_quote_section(sections) if is_comment else None
    parent_post_url = str(parent_post.get("url") or "").strip() if parent_post else ""
    parent_post_title = str(parent_post.get("title") or "").strip() if parent_post else ""
    if is_comment and parent_post and str(parent_post.get("authorName") or "").strip():
        author = str(parent_post.get("authorName") or "").strip().lstrip("@")
        author_url = str(parent_post.get("authorUrl") or "").strip()
    linked_article = None if is_comment else next(
        (
            section
            for section in sections
            if isinstance(section, Mapping)
            and section.get("kind") == "link-card"
            and str(section.get("url") or "").strip().startswith(("https://", "http://"))
        ),
        None,
    )
    linked_article_url = (
        str(linked_article.get("url") or "").strip() if linked_article else ""
    )

    author_text = (
        f"[{masked_link_label(author)}]({author_url})"
        if author_url
        else neutralize_mentions(author)
    )
    identity = f"**{subreddit}**  ·  Posted by {author_text}"
    preferences = card_preferences or CardPreferences()
    description = str(payload.get("description") or payload.get("caption") or "").strip()
    description = apply_caption_preferences(description, preferences)
    description = neutralize_mentions(description)
    if len(description) > 3000:
        description = f"{description[:2997].rstrip()}…"

    if is_comment:
        display_title = (
            parent_post_title
            or post_title.removeprefix("Comment on ").strip()
            or "Reddit post"
        )
        title_text = (
            f"### [{masked_link_label(display_title)}]({parent_post_url})"
            if parent_post_url
            else f"### {neutralize_mentions(display_title)}"
        )
        header_description = ""
    else:
        title_text = (
            f"### [{masked_link_label(post_title)}]({linked_article_url})"
            if linked_article_url
            else f"### {neutralize_mentions(post_title)}"
        )
        header_description = description
    header_text = "\n".join(part for part in (identity, title_text, header_description) if part)

    children: list[discord.ui.Item[Any]] = []
    if subreddit_icon:
        children.append(
            discord.ui.Section(
                header_text,
                accessory=discord.ui.Thumbnail(
                    subreddit_icon,
                    description=f"{subreddit} icon",
                ),
            )
        )
    else:
        children.append(discord.ui.TextDisplay(header_text))

    if linked_article_url:
        children.append(discord.ui.TextDisplay(linked_article_url))

    if is_comment and comment_quote:
        children.append(discord.ui.TextDisplay(_blockquote_comment(comment_quote)))
    elif is_comment and description:
        children.append(
            discord.ui.TextDisplay(
                _blockquote_comment(
                    {
                        "authorName": str(payload.get("authorName") or "").strip(),
                        "authorUrl": str(payload.get("authorUrl") or "").strip(),
                        "body": description,
                    }
                )
            )
        )

    video = payload.get("video")
    video_url = str(video.get("url") or "") if isinstance(video, Mapping) else ""
    image_urls = payload.get("images") if isinstance(payload.get("images"), list) else []
    fallback_image = str(payload.get("image") or "").strip()
    if is_comment:
        media_urls = [fallback_image] if fallback_image else []
    elif video_url:
        media_urls = [video_url]
    elif image_urls:
        media_urls = [str(url) for url in image_urls if url]
    elif fallback_image:
        media_urls = [fallback_image]
    else:
        media_urls = []

    if media_urls:
        children.append(
            discord.ui.MediaGallery(
                *(
                    discord.MediaGalleryItem(
                        url,
                        description=(parent_post_title or post_title)[:1024] or None,
                        spoiler=preferences.content_visibility.should_spoiler(payload),
                    )
                    for url in media_urls[:10]
                )
            )
        )

    rendered_sections = [
        _section_text(section)
        for section in sections[:4]
        if isinstance(section, Mapping)
        and section is not linked_article
        and section is not parent_post
        and section is not comment_quote
    ]
    if rendered_sections:
        children.append(discord.ui.Separator())
        children.extend(discord.ui.TextDisplay(section) for section in rendered_sections if section)

    stats = format_component_stats(
        str(payload.get("stats") or "").strip(),
        platform="reddit",
    )
    if stats and preferences.show_stats:
        children.append(discord.ui.TextDisplay(f"-# {stats}"))

    children.append(discord.ui.Separator())
    children.append(
        discord.ui.TextDisplay(
            build_component_footer(
                fixembed_emoji=f"<:fixembed:{FIXEMBED_EMOJI_ID}>",
                platform_emoji=f"<:reddit:{REDDIT_EMOJI_ID}>",
                platform_name="Reddit",
                source_url=source_url,
                converted_url=converted_url,
                timestamp=parse_post_timestamp(payload.get("timestamp")),
                branding=footer_branding,
                translated_from=translated_source_name(payload),
            )
        )
    )

    view = discord.ui.LayoutView(timeout=None)
    view.add_item(discord.ui.Container(*children, accent_color=preferences.accent_or(REDDIT_COLOR)))
    return view


async def _fetch_reddit_payload(
    source_url: str,
    translation_language: Optional[str] = None,
) -> Mapping[str, Any]:
    query = {"url": source_url}
    if translation_language:
        query["lang"] = translation_language
    api_url = f"{FIXEMBED_API}?{urlencode(query)}"
    timeout = aiohttp.ClientTimeout(total=15)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.get(api_url) as response:
            response.raise_for_status()
            body = await response.json()

    if not body.get("success") or body.get("platform") != "reddit":
        raise ValueError("FixEmbed did not return Reddit metadata")
    return body.get("data") or {}


async def fetch_reddit_layout(
    source_url: str,
    converted_url: Optional[str] = None,
    footer_branding: Optional[FooterBranding] = None,
    card_preferences: Optional[CardPreferences] = None,
    *,
    translation_language: Optional[str] = None,
) -> discord.ui.LayoutView:
    """Fetch first-party metadata and return a Reddit Components V2 card."""
    return build_reddit_layout(
        await _fetch_reddit_payload(source_url, translation_language),
        converted_url,
        footer_branding,
        card_preferences,
    )
