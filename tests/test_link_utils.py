import unittest

from link_utils import build_fixembed_url, chunk_lines, extract_supported_links, social_service


class SocialServiceTests(unittest.TestCase):
    def test_bluesky_handle_ending_in_x_com_is_not_twitter(self):
        url = "https://bsky.app/profile/xbox.com/post/3ld7g4iiaps2n"
        self.assertEqual(social_service(url), "Bluesky")

    def test_preconverted_bluesky_url_is_supported(self):
        url = "https://bskyx.app/profile/example.bsky.social/post/3lask667wfj2b"
        self.assertEqual(social_service(url), "Bluesky")

    def test_unknown_host_is_not_classified_by_path_substrings(self):
        self.assertIsNone(social_service("https://example.org/x.com/user/status/123"))

    def test_instagram_share_url_is_forwarded_to_first_party_resolver(self):
        url = "https://www.instagram.com/share/reel/BAAAAExample/?utm_source=ig_web_copy_link"

        links = extract_supported_links(url)

        self.assertEqual(len(links), 1)
        self.assertEqual(links[0].service, "Instagram")
        self.assertEqual(
            links[0].canonical_url,
            "https://www.instagram.com/share/reel/BAAAAExample/",
        )

    def test_youtube_community_post_is_supported(self):
        url = "https://www.youtube.com/post/UgkxExample123?si=tracking"

        links = extract_supported_links(url)

        self.assertEqual(len(links), 1)
        self.assertEqual(links[0].service, "YouTube")
        self.assertEqual(
            links[0].canonical_url,
            "https://www.youtube.com/post/UgkxExample123",
        )

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
            "https://fixembed.app/embed?url=https%3A%2F%2Fx.com%2Fopenai%2Fstatus%2F123&v=145"
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

    def test_extract_supported_links_can_ignore_preconverted_proxy_domains(self):
        links = extract_supported_links(
            "https://fixupx.com/openai/status/123 "
            "https://fxtwitter.com/openai/status/456 "
            "https://vxtwitter.com/openai/status/789 "
            "https://bskyx.app/profile/example.bsky.social/post/abc "
            "https://fixembed.app/embed?url=https%3A%2F%2Fx.com%2Fopenai%2Fstatus%2F111 "
            "https://x.com/openai/status/999",
            include_preconverted=False,
        )

        self.assertEqual(len(links), 1)
        self.assertEqual(links[0].canonical_url, "https://x.com/openai/status/999")

    def test_build_fixembed_url_encodes_the_canonical_url_and_quality(self):
        link = extract_supported_links("https://x.com/openai/status/123")[0]

        self.assertEqual(
            build_fixembed_url(link, quality="high"),
            "https://fixembed.app/embed?url=https%3A%2F%2Fx.com%2Fopenai%2Fstatus%2F123&v=150&quality=high",
        )

    def test_build_fixembed_url_preserves_twitter_translation_suffix(self):
        link = extract_supported_links("https://x.com/openai/status/123/es")[0]

        self.assertEqual(
            build_fixembed_url(link),
            "https://fixembed.app/embed?url=https%3A%2F%2Fx.com%2Fopenai%2Fstatus%2F123&v=150&lang=es",
        )

    def test_build_fixembed_url_preserves_gallery_and_mosaic_modifiers(self):
        gallery = extract_supported_links("https://x.com/openai/status/123/gallery")[0]
        mosaic = extract_supported_links("https://x.com/openai/status/456/es/mosaic")[0]

        self.assertEqual(
            build_fixembed_url(gallery),
            "https://fixembed.app/embed?url=https%3A%2F%2Fx.com%2Fopenai%2Fstatus%2F123&v=150&mode=gallery",
        )
        self.assertEqual(
            build_fixembed_url(mosaic),
            "https://fixembed.app/embed?url=https%3A%2F%2Fx.com%2Fopenai%2Fstatus%2F456&v=150&lang=es&mode=mosaic",
        )

    def test_chunk_lines_preserves_every_line_within_discord_limits(self):
        lines = [f"link-{index}-" + ("x" * 700) for index in range(5)]

        chunks = chunk_lines(lines, max_length=1900)

        self.assertTrue(all(len(chunk) <= 1900 for chunk in chunks))
        self.assertEqual("\n".join(chunks), "\n".join(lines))


if __name__ == "__main__":
    unittest.main()
