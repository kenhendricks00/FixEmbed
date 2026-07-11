"""Discord role synchronization for active FixEmbed Premium subscribers."""

import logging

import discord


def entitlement_is_active(entitlement) -> bool:
    """Return whether an entitlement currently grants Premium access."""
    return not getattr(entitlement, "deleted", False) and not entitlement.is_expired()


async def sync_supporter_role(
    client,
    entitlement,
    premium_sku_id: int,
    support_guild_id: int,
    supporter_role_id: int,
    *,
    active: bool | None = None,
) -> bool:
    """Apply one entitlement's active state to its purchaser's Supporters role."""
    if int(entitlement.sku_id) != int(premium_sku_id):
        return False

    user_id = getattr(entitlement, "user_id", None)
    if not user_id:
        return False

    guild = client.get_guild(int(support_guild_id))
    if guild is None:
        logging.warning("Premium role sync skipped: support guild is unavailable")
        return False

    role = guild.get_role(int(supporter_role_id))
    if role is None:
        logging.error("Premium role sync skipped: Supporters role is unavailable")
        return False

    member = guild.get_member(int(user_id))
    if member is None and hasattr(guild, "fetch_member"):
        try:
            member = await guild.fetch_member(int(user_id))
        except (discord.NotFound, discord.Forbidden, discord.HTTPException):
            return False
    if member is None:
        return False

    should_have_role = entitlement_is_active(entitlement) if active is None else active
    has_role = role in member.roles
    try:
        if should_have_role and not has_role:
            await member.add_roles(role, reason="Active FixEmbed Premium entitlement")
            return True
        if not should_have_role and has_role:
            await member.remove_roles(role, reason="FixEmbed Premium entitlement ended")
            return True
    except (discord.Forbidden, discord.HTTPException) as error:
        logging.error("Premium role sync failed for user %s: %s", user_id, error)
    return False


async def reconcile_supporter_roles(
    client,
    premium_sku_id: int,
    support_guild_id: int,
    supporter_role_id: int,
) -> None:
    """Reconcile all active Premium purchasers against the Supporters role."""
    guild = client.get_guild(int(support_guild_id))
    role = guild.get_role(int(supporter_role_id)) if guild else None
    if guild is None or role is None:
        logging.warning("Premium role reconciliation skipped: support guild or role unavailable")
        return

    entitlements_by_user: dict[int, list] = {}
    async for entitlement in client.entitlements(
        limit=None,
        skus=[discord.Object(id=int(premium_sku_id))],
        exclude_ended=False,
    ):
        user_id = getattr(entitlement, "user_id", None)
        if int(entitlement.sku_id) != int(premium_sku_id) or not user_id:
            continue
        entitlements_by_user.setdefault(int(user_id), []).append(entitlement)

    for entitlements in entitlements_by_user.values():
        active_entitlement = next(
            (entitlement for entitlement in entitlements if entitlement_is_active(entitlement)),
            None,
        )
        representative = active_entitlement or entitlements[0]
        await sync_supporter_role(
            client,
            representative,
            premium_sku_id,
            support_guild_id,
            supporter_role_id,
            active=active_entitlement is not None,
        )


async def sync_supporter_role_for_member(
    client,
    member,
    premium_sku_id: int,
    support_guild_id: int,
    supporter_role_id: int,
) -> None:
    """Grant Premium purchasers their role when they join the support server later."""
    if member.guild.id != int(support_guild_id):
        return

    async for entitlement in client.entitlements(
        limit=None,
        skus=[discord.Object(id=int(premium_sku_id))],
        user=member,
        exclude_ended=False,
    ):
        if entitlement_is_active(entitlement):
            await sync_supporter_role(
                client,
                entitlement,
                premium_sku_id,
                support_guild_id,
                supporter_role_id,
            )
            return
