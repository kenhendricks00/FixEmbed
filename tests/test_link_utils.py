import unittest

from link_utils import build_fixembed_url, extract_supported_links, social_service


class SocialServiceTests(unittest.TestCase):
    def test_bluesky_handle_ending_in_x_com_is_not_twitter(self):
        url = "https://bsky.app/profile/xbox.com/post/3ld7g4iiaps2n"
        self.assertEqual(social_service(url), "Bluesky")

    def test_preconverted_bluesky_url_is_supported(self):
        url = "https://bskyx.app/profile/example.bsky.social/post/3lask667wfj2b"
        self.assertEqual(social_service(url), "Bluesky")

    def test_unknown_host_is_not_classified_by_path_substrings(self):
        self.assertIsNone(social_service("https://example.org/x.com/user/status/123"))

    def test_extract_supported_links_preserves_order_and_metadata(self):
        links = extract_supported_links(
            "first https://x.com/openai/status/123 then "
            "https://www.reddit.com/r/python/comments/abc123/example/"
        )

        self.assertEqual([link.service for link in links], ["Twitter", "Reddit"])
        self.assertEqual([link.display_text for link in links], ["Twitter • openai", "Reddit • r/python"])
        self.assertEqual(links[0].canonical_url, "https://x.com/openai/status/123")

    def test_extract_supported_links_ignores_angle_bracket_suppression(self):
        links = extract_supported_links(
            "<https://x.com/openai/status/123> https://bsky.app/profile/bsky.app/post/456"
        )

        self.assertEqual(len(links), 1)
        self.assertEqual(links[0].service, "Bluesky")

    def test_extract_supported_links_normalizes_existing_fixembed_urls(self):
        links = extract_supported_links(
            "https://fixembed.app/embed?url=https%3A%2F%2Fx.com%2Fopenai%2Fstatus%2F123"
        )

        self.assertEqual(len(links), 1)
        self.assertEqual(links[0].canonical_url, "https://x.com/openai/status/123")
        self.assertEqual(links[0].display_text, "Twitter • openai")

    def test_extract_supported_links_normalizes_known_proxy_domains(self):
        links = extract_supported_links(
            "https://fxtwitter.com/openai/status/123 "
            "https://bskyx.app/profile/example.bsky.social/post/456"
        )

        self.assertEqual(
            [link.canonical_url for link in links],
            [
                "https://x.com/openai/status/123",
                "https://bsky.app/profile/example.bsky.social/post/456",
            ],
        )

    def test_build_fixembed_url_encodes_the_canonical_url_and_quality(self):
        link = extract_supported_links("https://x.com/openai/status/123")[0]

        self.assertEqual(
            build_fixembed_url(link, quality="high"),
            "https://fixembed.app/embed?url=https%3A%2F%2Fx.com%2Fopenai%2Fstatus%2F123&quality=high",
        )


if __name__ == "__main__":
    unittest.main()
