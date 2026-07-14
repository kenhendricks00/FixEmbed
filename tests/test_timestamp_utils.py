import unittest

from timestamp_utils import parse_post_timestamp


class TimestampUtilsTests(unittest.TestCase):
    def test_parses_supported_original_post_timestamp_formats(self):
        self.assertEqual(
            parse_post_timestamp("2026-05-27T21:03:02.000Z"),
            1779915782,
        )
        self.assertEqual(parse_post_timestamp("2026-05-27T21:03:02"), 1779915782)
        self.assertEqual(
            parse_post_timestamp("Sun Jul 12 00:00:00 +0000 2026"),
            1783814400,
        )
        self.assertEqual(parse_post_timestamp(1783969200), 1783969200)
        self.assertEqual(parse_post_timestamp(1783969200000), 1783969200)

    def test_missing_or_invalid_timestamp_does_not_fabricate_conversion_time(self):
        self.assertIsNone(parse_post_timestamp(None))
        self.assertIsNone(parse_post_timestamp(""))
        self.assertIsNone(parse_post_timestamp("not-a-date"))
        self.assertIsNone(parse_post_timestamp(0))
        self.assertIsNone(parse_post_timestamp(float("nan")))
        self.assertIsNone(parse_post_timestamp(10**30))


if __name__ == "__main__":
    unittest.main()
