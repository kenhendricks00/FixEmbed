import unittest
from urllib.parse import parse_qs, urlparse

from install_links import (
    DISCORD_CLIENT_ID,
    SERVER_INSTALL_PERMISSIONS,
    SERVER_INSTALL_URL,
    USER_INSTALL_URL,
    build_install_controls,
)


class InstallLinksTests(unittest.TestCase):
    def test_user_install_targets_the_person_install_context(self):
        parsed = urlparse(USER_INSTALL_URL)
        query = parse_qs(parsed.query)

        self.assertEqual(parsed.netloc, "discord.com")
        self.assertEqual(query["client_id"], [DISCORD_CLIENT_ID])
        self.assertEqual(query["integration_type"], ["1"])
        self.assertEqual(query["scope"], ["applications.commands"])

    def test_server_install_targets_the_guild_install_context(self):
        parsed = urlparse(SERVER_INSTALL_URL)
        query = parse_qs(parsed.query)

        self.assertEqual(parsed.netloc, "discord.com")
        self.assertEqual(query["client_id"], [DISCORD_CLIENT_ID])
        self.assertEqual(query["integration_type"], ["0"])
        self.assertEqual(query["scope"], ["bot applications.commands"])
        self.assertEqual(query["permissions"], [str(SERVER_INSTALL_PERMISSIONS)])
        self.assertNotEqual(SERVER_INSTALL_URL, USER_INSTALL_URL)

    def test_install_controls_offer_both_distinct_choices(self):
        rows = build_install_controls()

        self.assertEqual(len(rows), 1)
        self.assertEqual([button.label for button in rows[0]], [
            "Install to My Account",
            "Add to Server",
        ])
        self.assertEqual([button.url for button in rows[0]], [
            USER_INSTALL_URL,
            SERVER_INSTALL_URL,
        ])


if __name__ == "__main__":
    unittest.main()
