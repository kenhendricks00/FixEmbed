"""Application entry point. Importing this module never connects to Discord."""

import logging
import os

from dotenv import load_dotenv


def run():
    load_dotenv()
    token = os.getenv("BOT_TOKEN")
    if not token:
        raise SystemExit(
            "Set BOT_TOKEN in the environment or .env before starting FixEmbed."
        )

    logging.basicConfig(level=logging.INFO)
    from .deployment import PRODUCTION_API_BASE, api_base, test_guild_id

    try:
        base, only_guild = api_base(), test_guild_id()
    except ValueError as error:
        raise SystemExit(str(error)) from error
    if base != PRODUCTION_API_BASE or only_guild is not None:
        logging.warning(
            "Test instance: card metadata from %s, acting only in guild %s",
            base,
            only_guild or "(all)",
        )
    from . import commands, events  # noqa: F401 -- register callbacks
    from .premium.sku import parse_sku_id
    from .runtime import client

    client.premium_sku_id = parse_sku_id(os.getenv("PREMIUM_SKU_ID"))
    client.run(token)
