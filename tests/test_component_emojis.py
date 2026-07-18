import unittest

from component_emojis import APPLICATION_EMOJI_IDS, application_emoji, format_component_stats


class ComponentEmojiTests(unittest.TestCase):
    def test_application_emoji_registry_uses_the_uploaded_ids(self):
        self.assertEqual(
            APPLICATION_EMOJI_IDS,
            {
                "quote": 1526256046786609164,
                "upvote": 1526256000641007616,
                "downvote": 1526255999210487859,
                "coins": 1526369937013342350,
                "bookmark": 1526255813268733962,
                "views": 1526255708683636896,
                "like": 1526255244483362866,
                "repost": 1526255036072591450,
                "comment": 1526254715250282506,
                "share": 1527880479305498744,
                "x_government": 1527644261208690778,
                "x_premium": 1527644259308798113,
                "x_organization": 1527642128300118129,
            },
        )

    def test_shared_activity_stats_use_application_emojis(self):
        rendered = format_component_stats(
            "\U0001f4ac 12  \U0001f501 34  \u2764\ufe0f 56  \U0001f441\ufe0f 78"
        )

        self.assertEqual(
            rendered,
            "  ".join(
                (
                    f"{application_emoji('comment')} 12",
                    f"{application_emoji('repost')} 34",
                    f"{application_emoji('like')} 56",
                    f"{application_emoji('views')} 78",
                )
            ),
        )

    def test_reddit_uses_upvote_instead_of_like(self):
        rendered = format_component_stats("\u2764\ufe0f 2.5K  \U0001f4ac 287", platform="reddit")

        self.assertEqual(
            rendered,
            f"{application_emoji('upvote')} 2.5K  {application_emoji('comment')} 287",
        )

    def test_bilibili_coin_stats_use_the_uploaded_coins_emoji(self):
        rendered = format_component_stats("\U0001fa99 456", platform="bilibili")

        self.assertEqual(rendered, f"{application_emoji('coins')} 456")

    def test_tiktok_uses_share_instead_of_repost(self):
        rendered = format_component_stats("\U0001f501 3.3M", platform="tiktok")

        self.assertEqual(rendered, f"{application_emoji('share')} 3.3M")


if __name__ == "__main__":
    unittest.main()
