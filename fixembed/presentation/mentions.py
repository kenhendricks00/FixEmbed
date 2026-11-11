"""Formatting helpers for context preserved from replaced Discord messages."""


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
