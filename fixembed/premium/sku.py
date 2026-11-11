"""Resolve the configured Premium SKU to one Discord can actually sell."""

import logging

import discord


def parse_sku_id(raw):
    """Return the SKU snowflake from an environment value, or None when unusable."""
    value = (raw or "").strip()
    if not value:
        return None
    if not value.isdigit():
        logging.error("PREMIUM_SKU_ID is not a numeric SKU ID; Premium is disabled.")
        return None
    return int(value)


def _is_purchasable_subscription(sku) -> bool:
    return sku.type is discord.SKUType.subscription and sku.flags.available


async def resolve_premium_sku(client, sku_id):
    """Return a purchasable subscription SKU ID for the Premium button.

    Discord labels a Premium button "Product Unavailable" when its SKU cannot be
    bought, most often because the ID is the auto-generated subscription group
    rather than the subscription itself. When exactly one purchasable
    subscription exists it is used instead, so purchases and entitlement checks
    keep working until the environment is corrected.
    """
    if sku_id is None:
        return None
    try:
        skus = await client.fetch_skus()
    except Exception as error:
        logging.warning("Could not verify PREMIUM_SKU_ID %s: %s", sku_id, error)
        return sku_id

    configured = next((sku for sku in skus if sku.id == sku_id), None)
    if configured is not None and _is_purchasable_subscription(configured):
        return sku_id

    candidates = [sku for sku in skus if _is_purchasable_subscription(sku)]
    described = (
        f"{configured.type.name} SKU {configured.name!r} (available={configured.flags.available})"
        if configured is not None
        else "not a SKU of this application"
    )
    if len(candidates) == 1:
        replacement = candidates[0]
        logging.error(
            "PREMIUM_SKU_ID %s is %s; using purchasable subscription SKU %s (%r). "
            "Set PREMIUM_SKU_ID=%s.",
            sku_id,
            described,
            replacement.id,
            replacement.name,
            replacement.id,
        )
        return replacement.id
    logging.error(
        "PREMIUM_SKU_ID %s is %s; purchasable subscription SKUs: %s. Premium is disabled.",
        sku_id,
        described,
        ", ".join(f"{sku.id} ({sku.name!r})" for sku in candidates) or "none",
    )
    return None
