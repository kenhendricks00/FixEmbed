import unittest
from types import SimpleNamespace

from message_context import format_tagged_users


class MessageContextTests(unittest.TestCase):
    def test_tagged_users_are_preserved_without_repeating_the_sender(self):
        mentions = [
            SimpleNamespace(id=10),
            SimpleNamespace(id=20),
            SimpleNamespace(id=20),
            SimpleNamespace(id=30),
        ]

        result = format_tagged_users(mentions, author_id=10)

        self.assertEqual(result, "Tagged: <@20>, <@30>")

    def test_no_tagged_users_produces_no_context_line(self):
        self.assertIsNone(format_tagged_users([], author_id=10))


if __name__ == "__main__":
    unittest.main()
