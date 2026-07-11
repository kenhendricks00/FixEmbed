import unittest
from types import SimpleNamespace

from premium_roles import sync_supporter_role


class FakeMember:
    def __init__(self, user_id, roles=None):
        self.id = user_id
        self.roles = list(roles or [])
        self.added = []
        self.removed = []

    async def add_roles(self, role, reason=None):
        self.added.append((role, reason))
        if role not in self.roles:
            self.roles.append(role)

    async def remove_roles(self, role, reason=None):
        self.removed.append((role, reason))
        if role in self.roles:
            self.roles.remove(role)


class FakeGuild:
    def __init__(self, guild_id, role, member):
        self.id = guild_id
        self._role = role
        self._member = member

    def get_role(self, role_id):
        return self._role if self._role.id == role_id else None

    def get_member(self, user_id):
        return self._member if self._member.id == user_id else None


class FakeClient:
    def __init__(self, guild):
        self._guild = guild

    def get_guild(self, guild_id):
        return self._guild if self._guild.id == guild_id else None


class PremiumSupporterRoleTests(unittest.IsolatedAsyncioTestCase):
    async def test_active_premium_entitlement_grants_supporter_role(self):
        role = SimpleNamespace(id=222)
        member = FakeMember(333)
        client = FakeClient(FakeGuild(111, role, member))
        entitlement = SimpleNamespace(sku_id=444, user_id=333, deleted=False, is_expired=lambda: False)

        changed = await sync_supporter_role(client, entitlement, 444, 111, 222)

        self.assertTrue(changed)
        self.assertEqual(member.added[0][0], role)
        self.assertEqual(member.removed, [])

    async def test_expired_premium_entitlement_removes_supporter_role(self):
        role = SimpleNamespace(id=222)
        member = FakeMember(333, roles=[role])
        client = FakeClient(FakeGuild(111, role, member))
        entitlement = SimpleNamespace(sku_id=444, user_id=333, deleted=False, is_expired=lambda: True)

        changed = await sync_supporter_role(client, entitlement, 444, 111, 222)

        self.assertTrue(changed)
        self.assertEqual(member.removed[0][0], role)
        self.assertEqual(member.added, [])

    async def test_other_skus_do_not_change_supporter_role(self):
        role = SimpleNamespace(id=222)
        member = FakeMember(333)
        client = FakeClient(FakeGuild(111, role, member))
        entitlement = SimpleNamespace(sku_id=999, user_id=333, deleted=False, is_expired=lambda: False)

        changed = await sync_supporter_role(client, entitlement, 444, 111, 222)

        self.assertFalse(changed)
        self.assertEqual(member.added, [])
        self.assertEqual(member.removed, [])

    async def test_missing_support_server_member_is_safely_ignored(self):
        role = SimpleNamespace(id=222)
        other_member = FakeMember(999)
        client = FakeClient(FakeGuild(111, role, other_member))
        entitlement = SimpleNamespace(sku_id=444, user_id=333, deleted=False, is_expired=lambda: False)

        changed = await sync_supporter_role(client, entitlement, 444, 111, 222)

        self.assertFalse(changed)


if __name__ == '__main__':
    unittest.main()
