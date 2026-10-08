"""Make untrusted text safe inside bot-authored Discord markdown.

Post titles, display names and section titles come straight from the source
site, so every masked link built from them goes through ``masked_link``.

What Discord does with a masked link's label, checked by posting each case in
Test #0001 #embedded-testing on Oct 8, 2026 (#103):

- A label holding ``@everyone`` or ``@here`` is refused and the raw markdown
  shows, even with a zero-width space after the ``@``: Discord ignores it
  there. A fullwidth ``\uff20`` (U+FF20) keeps the link, and so do ``<\uff20&1>`` and
  ``<\uff031>`` for role, user and channel mentions.
- Backslash escapes are not read inside a label. ``\\)``, ``\\[``, ``\\*`` and
  ``\\\\`` all show their backslash, so labels are never escaped.
- Balanced ``[OC]``-style brackets and ``(parens)`` are fine as they are. A
  ``]`` without its ``[`` would end the label early, so unpaired brackets
  become fullwidth ``\uff3b``/``\uff3d``. A backslash right before a bracket, or at the
  end, would swallow it, so that backslash becomes ``\uff3c``.
- A label containing a URL is refused, even as ``https\uff1a//`` with a fullwidth
  colon. A bare domain such as ``example.org/x`` is fine. Such a label falls
  back to the plain text followed by the link (``masked_link``), so the card
  never shows raw markdown.
- Bold and italic markdown inside a label still render.

Bodies only need ``neutralize_mentions``: a mention copied from another site
never pings (``allowed_mentions`` blocks it) but still renders as a pill, for
example ``<@&1234567>`` as @unknown-role (#96). Outside a link a zero-width
space after the ``@`` or ``#`` keeps the text readable while Discord no longer
sees a mention, the same trick ``discord.utils.escape_mentions`` uses. Mentions
inside code spans, code blocks and URLs are left as they are: they never render
there and a URL must keep its bytes.

``@everyone`` and ``@here`` are broken wherever they appear, whatever comes
before or after them (``@everyones``, ``@here_x``, ``ops@here.com``). Discord
reads the mention at the ``@`` without a word boundary, so these still parse,
and ``discord.utils.escape_mentions`` has no boundary either. Other ``@`` text
such as ``someone@example.com`` or ``@heroes`` is left alone.

Both helpers are idempotent. ``escaped=True`` takes text that was
markdown-escaped once (DeviantArt's ``escape_markdown``, Pixiv's author names):
a label drops those escapes, since Discord would show them, and the plain
fallback keeps them.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Callable

ZWSP = "\u200b"
FULLWIDTH_AT = "\uff20"
FULLWIDTH_HASH = "\uff03"
_FULLWIDTH_BRACKETS = {"[": "\uff3b", "]": "\uff3d"}
FULLWIDTH_BACKSLASH = "\uff3c"

# Inline code (one or two backtick fences), fenced code blocks, and bare URLs.
# A backslash-escaped backtick is literal text and never opens a span.
_PROTECTED = re.compile(
    r"(?<!\\)```[\s\S]*?```"
    r"|(?<!\\)``[^\n]*?``"
    r"|(?<!\\)`[^`\n]+`"
    r"|https?://[^\s<>\"]+"
)
# No word boundary on either side: ``@everyones`` and ``x@here`` still parse.
_BROADCAST_MENTION = re.compile(r"@(everyone|here)")
_ANGLE_MENTION = re.compile(r"<([@#])(?!\u200b)")
# Label forms also take text a body pass already broke with a zero-width space.
_LABEL_BROADCAST = re.compile(r"@\u200b?(everyone|here)")
_LABEL_ANGLE = re.compile(r"<([@#])\u200b?")
# A markdown escape: backslash before ASCII punctuation.
_MARKDOWN_ESCAPE = re.compile(r"\\([!-/:-@\[-`{-~])")
# A bracket pair Discord keeps inside a label: nothing nested, and not ``[x](``.
_SIMPLE_PAIR = re.compile(r"\[[^\[\]]*\](?!\()")
_SWALLOWING_BACKSLASH = re.compile(r"\\(?=[\[\]]|$)")
_LINE_BREAK = re.compile(r"\s*[\r\n]+\s*")
_UNSAFE_LABEL = re.compile(r"@(everyone|here)|<[@#]|\\(?=[\[\]]|$)|[\r\n]")


def _outside_protected(text: str, transform: Callable[[str], str]) -> str:
    parts: list[str] = []
    cursor = 0
    for match in _PROTECTED.finditer(text):
        parts.append(transform(text[cursor:match.start()]))
        parts.append(match.group(0))
        cursor = match.end()
    parts.append(transform(text[cursor:]))
    return "".join(parts)


def _break_mentions(text: str) -> str:
    text = _BROADCAST_MENTION.sub(f"@{ZWSP}\\1", text)
    return _ANGLE_MENTION.sub(f"<\\1{ZWSP}", text)


def _break_label_mentions(text: str) -> str:
    text = _LABEL_BROADCAST.sub(f"{FULLWIDTH_AT}\\1", text)
    return _LABEL_ANGLE.sub(
        lambda match: "<" + (FULLWIDTH_AT if match.group(1) == "@" else FULLWIDTH_HASH),
        text,
    )


def _fullwidth_brackets(text: str) -> str:
    return text.replace("[", _FULLWIDTH_BRACKETS["["]).replace("]", _FULLWIDTH_BRACKETS["]"])


def _pair_brackets(text: str) -> str:
    """Keep simple ``[...]`` pairs and make every other bracket fullwidth."""
    parts: list[str] = []
    cursor = 0
    for match in _SIMPLE_PAIR.finditer(text):
        parts.append(_fullwidth_brackets(text[cursor:match.start()]))
        parts.append(match.group(0))
        cursor = match.end()
    parts.append(_fullwidth_brackets(text[cursor:]))
    return "".join(parts)


def neutralize_mentions(text: str) -> str:
    """Show ``@everyone``, ``@here``, ``<@id>``, ``<@&id>``, ``<#id>`` as text."""
    if not text:
        return text
    return _outside_protected(text, _break_mentions)


def masked_link_label(text: str, *, escaped: bool = False) -> str:
    """Return text that Discord keeps as the label of a ``[label](url)`` link.

    Mentions get a fullwidth ``＠``/``＃``, unpaired brackets and a backslash
    that would swallow one become fullwidth, and line breaks become spaces.
    Nothing is backslash-escaped. ``escaped=True`` first drops the markdown
    escapes of text that was escaped once already. The result can still hold a
    URL, which Discord refuses; ``masked_link`` checks for that.
    """
    if not text:
        return text
    if escaped:
        text = _MARKDOWN_ESCAPE.sub(r"\1", text)
    # Mention breaking covers code and URLs too: a mention inside backticks in
    # the label still makes Discord drop the link.
    text = _break_label_mentions(_LINE_BREAK.sub(" ", text.strip()))
    return _SWALLOWING_BACKSLASH.sub(FULLWIDTH_BACKSLASH, _pair_brackets(text))


def is_linkable_label(label: str) -> bool:
    """True when Discord renders ``[label](url)`` as a link (see module notes)."""
    if not label or _UNSAFE_LABEL.search(label):
        return False
    if "//" in unicodedata.normalize("NFKC", label):
        return False
    return not re.search(r"[\[\]]", _SIMPLE_PAIR.sub("", label))


def masked_link(text: str, url: str, *, escaped: bool = False) -> str:
    """Return ``[label](url)``, or the plain text and ``(<url>)`` when Discord
    would refuse the label, so a card never shows raw link markdown."""
    # Outside a link the markdown escapes of ``escaped`` text still work.
    plain = neutralize_mentions(text)
    if not url:
        return plain
    label = masked_link_label(text, escaped=escaped)
    if is_linkable_label(label):
        return f"[{label}]({url})"
    return f"{plain} (<{url}>)" if plain else f"<{url}>"
