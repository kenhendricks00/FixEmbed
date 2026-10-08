"""Formatting helpers for context preserved from replaced Discord messages."""

import discord


def no_mentions() -> discord.AllowedMentions:
    """Mentions for anything that carries third-party text.

    Cards, link text, titles, captions, author names and comment bodies come
    from other sites or other users, so an ``@everyone`` or ``<@&role>`` in
    them must never ping anyone.
    """
    return discord.AllowedMentions.none()


def sender_allowed_mentions(author, *, ping_author: bool) -> discord.AllowedMentions:
    """Mentions for the delete-mode "Sent by" text: at most the original poster.

    Tagged users, roles, @everyone and @here stay visible but silent.
    """
    return discord.AllowedMentions(
        everyone=False,
        users=[author] if ping_author else [],
        roles=False,
        replied_user=False,
    )


def format_tagged_users(mentions, author_id: int) -> str | None:
    """Return visible mention markup for tagged users without duplicating the sender."""
    tagged_ids = []
    seen_ids = {int(author_id)}
    for member in mentions:
        member_id = int(member.id)
        if member_id not in seen_ids:
            seen_ids.add(member_id)
            tagged_ids.append(member_id)

    if not tagged_ids:
        return None
    return "Tagged: " + ", ".join(f"<@{member_id}>" for member_id in tagged_ids)
