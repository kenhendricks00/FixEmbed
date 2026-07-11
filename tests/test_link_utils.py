import unittest

from link_utils import social_service


class SocialServiceTests(unittest.TestCase):
    def test_bluesky_handle_ending_in_x_com_is_not_twitter(self):
        url = "https://bsky.app/profile/xbox.com/post/3ld7g4iiaps2n"
        self.assertEqual(social_service(url), "Bluesky")

    def test_preconverted_bluesky_url_is_supported(self):
        url = "https://bskyx.app/profile/example.bsky.social/post/3lask667wfj2b"
        self.assertEqual(social_service(url), "Bluesky")

    def test_unknown_host_is_not_classified_by_path_substrings(self):
        self.assertIsNone(social_service("https://example.org/x.com/user/status/123"))


if __name__ == "__main__":
    unittest.main()
