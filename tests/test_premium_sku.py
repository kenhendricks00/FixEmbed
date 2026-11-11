import unittest

import discord

from fixembed.premium.sku import parse_sku_id, resolve_premium_sku

GROUP_ID = 1482847857688969318
SUBSCRIPTION_ID = 1482847857688969321
APPLICATION_ID = 1173820242305224764


def sku(sku_id, sku_type, flags, name):
    return discord.SKU(
        state=None,
        data={
            "id": str(sku_id),
            "type": sku_type,
            "application_id": str(APPLICATION_ID),
            "name": name,
            "slug": name.lower().replace(" ", "-"),
            "flags": flags,
        },
    )


# Shapes match FixEmbed's published store listing: the group is not purchasable.
LIVE_SKUS = [
    sku(GROUP_ID, 6, 128, "Guild Subscription Group"),
    sku(SUBSCRIPTION_ID, 5, 132, "Premium"),
]


class FakeClient:
    def __init__(self, skus=None, error=None):
        self.skus = skus
        self.error = error

    async def fetch_skus(self):
        if self.error:
            raise self.error
        return list(self.skus)


class ParseSkuIdTests(unittest.TestCase):
    def test_numeric_value_with_whitespace_parses(self):
        self.assertEqual(parse_sku_id(f" {SUBSCRIPTION_ID}\n"), SUBSCRIPTION_ID)

    def test_unset_or_blank_value_disables_premium(self):
        for raw in (None, "", "   "):
            with self.subTest(raw=raw):
                self.assertIsNone(parse_sku_id(raw))

    def test_placeholder_value_disables_premium_and_logs(self):
        with self.assertLogs(level="ERROR"):
            self.assertIsNone(parse_sku_id("your_premium_sku_id"))


class ResolvePremiumSkuTests(unittest.IsolatedAsyncioTestCase):
    async def test_purchasable_subscription_is_kept(self):
        resolved = await resolve_premium_sku(FakeClient(LIVE_SKUS), SUBSCRIPTION_ID)
        self.assertEqual(resolved, SUBSCRIPTION_ID)

    async def test_subscription_group_resolves_to_its_purchasable_subscription(self):
        with self.assertLogs(level="ERROR") as logs:
            resolved = await resolve_premium_sku(FakeClient(LIVE_SKUS), GROUP_ID)
        self.assertEqual(resolved, SUBSCRIPTION_ID)
        self.assertIn(f"PREMIUM_SKU_ID={SUBSCRIPTION_ID}", logs.output[0])
        self.assertIn("subscription_group", logs.output[0])

    async def test_foreign_id_resolves_when_one_subscription_is_purchasable(self):
        with self.assertLogs(level="ERROR"):
            resolved = await resolve_premium_sku(FakeClient(LIVE_SKUS), 42)
        self.assertEqual(resolved, SUBSCRIPTION_ID)

    async def test_no_purchasable_subscription_disables_premium(self):
        unpublished = [sku(GROUP_ID, 6, 128, "Group"), sku(SUBSCRIPTION_ID, 5, 128, "Premium")]
        with self.assertLogs(level="ERROR") as logs:
            resolved = await resolve_premium_sku(FakeClient(unpublished), SUBSCRIPTION_ID)
        self.assertIsNone(resolved)
        self.assertIn("none", logs.output[0])

    async def test_ambiguous_subscriptions_disable_premium(self):
        skus = LIVE_SKUS + [sku(7, 5, 132, "Premium Plus")]
        with self.assertLogs(level="ERROR"):
            self.assertIsNone(await resolve_premium_sku(FakeClient(skus), GROUP_ID))

    async def test_lookup_failure_keeps_configured_id(self):
        client = FakeClient(error=RuntimeError("gateway down"))
        with self.assertLogs(level="WARNING"):
            self.assertEqual(await resolve_premium_sku(client, GROUP_ID), GROUP_ID)

    async def test_unset_sku_skips_lookup(self):
        client = FakeClient(error=AssertionError("must not fetch"))
        self.assertIsNone(await resolve_premium_sku(client, None))


if __name__ == "__main__":
    unittest.main()
