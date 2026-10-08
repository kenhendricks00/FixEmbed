"""Make untrusted text safe inside bot-authored Discord markdown.

Discord drops a masked link (``[label](url)``) and shows the raw markdown when
the label contains a mention such as ``@everyone``, ``@here``, ``<@id>``,
``<@&role>`` or ``<#channel>`` (#103). A stray ``[``, ``]``, ``)`` or ``\\`` in
the label can also end it early or eat the closing bracket. Post titles,
display names and section titles come straight from the source site, so every
label built from them goes through ``masked_link_label``.

Bodies only need ``neutralize_mentions``: a mention copied from another site
never pings (``allowed_mentions`` blocks it) but still renders as a pill, for
example ``<@&1234567>`` as @unknown-role (#96). A zero-width space after the
``@`` or ``#`` keeps the text readable while Discord no longer sees a mention,
the same trick ``discord.utils.escape_mentions`` uses.

In bodies, mentions inside code spans, code blocks and URLs are left as they
are: they never render there and a URL must keep its bytes. A label is only
display text, and a code span inside it does not stop Discord from seeing the
mention and dropping the link, so ``masked_link_label`` breaks mentions
everywhere in the label, code and URLs included. The zero-width space is
invisible either way.

``@everyone`` and ``@here`` are broken wherever they appear, whatever comes
before or after them (``@everyones``, ``@here_x``, ``ops@here.com``). Discord
reads the mention at the ``@`` without a word boundary, so these still parse,
and ``discord.utils.escape_mentions`` has no boundary either. Other ``@`` text
such as ``someone@example.com`` or ``@heroes`` is left alone.

Both helpers are idempotent on mentions, and ``masked_link_label(..., escaped=True)`` takes text that was
already markdown-escaped once (DeviantArt's ``escape_markdown``, Pixiv's
author names) and only escapes what is still live, so nothing is escaped twice.
"""

from __future__ import annotations

import re
from typing import Callable

ZWSP = "\u200b"

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
_LABEL_SPECIAL = re.compile(r"[\\\[\])]")
# In already-escaped text, a ``[``, ``]`` or ``)`` preceded by an even number
# of backslashes (zero included) is still live, and so is a trailing backslash.
_LIVE_LABEL_SPECIAL = re.compile(r"(?<!\\)((?:\\\\)*)([\[\])]|\\$)")


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


def _escape_label(text: str) -> str:
    return _LABEL_SPECIAL.sub(r"\\\g<0>", text)


def _escape_live_label(text: str) -> str:
    return _LIVE_LABEL_SPECIAL.sub(r"\1\\\2", text)


def neutralize_mentions(text: str) -> str:
    """Show ``@everyone``, ``@here``, ``<@id>``, ``<@&id>``, ``<#id>`` as text."""
    if not text:
        return text
    return _outside_protected(text, _break_mentions)


def masked_link_label(text: str, *, escaped: bool = False) -> str:
    """Return text that Discord keeps as the label of a ``[label](url)`` link.

    Raw text gets every ``\\``, ``[``, ``]`` and ``)`` backslash-escaped. Pass
    ``escaped=True`` for text that was markdown-escaped once already; then only
    a still-live ``[``, ``]``, ``)`` or trailing backslash is escaped.
    """
    if not text:
        return text
    # Escaping and mention breaking cover URLs and code too: Discord's link
    # rule ends the label at the first live ``]`` no matter where it sits, and
    # a mention inside backticks in the label still makes Discord drop the link.
    escape = _escape_live_label if escaped else _escape_label
    return escape(_break_mentions(text))
