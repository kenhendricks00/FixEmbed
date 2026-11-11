import asyncio
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

from fixembed import atproto
from fixembed.links import build_fixembed_url, extract_supported_links, social_service

WSOCIAL_DID = "did:plc:e3bwgswz6lniwjadqqfno3c4"
MU_AUTHOR_DID = "did:plc:vggsjzvhakoa7l2m2mguqv4w"
WSOCIAL_POST = "https://wsocial.eu/profile/wsocial.eu/post/3mzy5hts2g22i"
MU_POST = "https://mu.social/profile/elenarossini.com/post/3mzfkhszhlc2l"
MU_DID_POST = f"https://mu.social/profile/{MU_AUTHOR_DID}/post/3mzfkhszhlc2l"


class FakeAppView:
    """Answers the two public AppView calls the bot makes, and records them."""

    def __init__(self, handles=None, posts=None, delay=0.0, status=None):
        self.handles = handles or {}
        self.posts = posts or set()
        self.delay = delay
        self.status = status
        self.calls = []

    async def __call__(self, session, url):
        self.calls.append(url)
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.status:
            return self.status, None
        parsed = urlparse(url)
        query = parse_qs(parsed.query)
        if parsed.path.endswith("com.atproto.identity.resolveHandle"):
            did = self.handles.get(query["handle"][0])
            return (200, {"did": did}) if did else (400, {"error": "InvalidRequest"})
        uri = query["uris"][0]
        return 200, {"posts": [{"uri": uri}] if uri in self.posts else []}

    def lookups(self, kind):
        return [call for call in self.calls if kind in call]


def default_appview(**overrides):
    return FakeAppView(
        handles={"wsocial.eu": WSOCIAL_DID, "elenarossini.com": MU_AUTHOR_DID},
        posts={
            f"at://{WSOCIAL_DID}/app.bsky.feed.post/3mzy5hts2g22i",
            f"at://{MU_AUTHOR_DID}/app.bsky.feed.post/3mzfkhszhlc2l",
        },
        **overrides,
    )


class AtprotoLinkParsingTests(unittest.TestCase):
    def test_bsky_app_keeps_the_trusted_fast_path(self):
        links = extract_supported_links(
            "https://bsky.app/profile/creator.bsky.social/post/abc123 "
            "https://bskyx.app/profile/creator.bsky.social/post/abc123"
        )
        self.assertEqual([link.service for link in links], ["Bluesky", "Bluesky"])
        self.assertEqual(
            {link.canonical_url for link in links},
            {"https://bsky.app/profile/creator.bsky.social/post/abc123"},
        )
        self.assertTrue(all(link.atproto_post is None for link in links))

    def test_other_app_hosts_are_candidates_that_keep_their_host(self):
        links = extract_supported_links(
            f"{WSOCIAL_POST}?ref_src=embed "
            "https://www.wsocial.eu/public/profile/wsocial.eu/post/3mzy5hts2g22i "
            "https://mu.social/profile/ElenaRossini.com/post/3mzfkhszhlc2l. "
            f"{MU_DID_POST} "
            "https://mu.social/profile/did%3Aplc%3Avggsjzvhakoa7l2m2mguqv4w/post/3mzfkhszhlc2l "
            "https://app.example-social.net/profile/did:web:alice.example-social.net/post/3mzfkhszhlc2l",
            include_preconverted=False,
        )

        self.assertEqual([link.service for link in links], ["Bluesky"] * 6)
        self.assertEqual(
            [link.canonical_url for link in links],
            [
                WSOCIAL_POST,
                "https://www.wsocial.eu/profile/wsocial.eu/post/3mzy5hts2g22i",
                MU_POST,
                MU_DID_POST,
                MU_DID_POST,
                "https://app.example-social.net/profile/did:web:alice.example-social.net/post/3mzfkhszhlc2l",
            ],
        )
        self.assertEqual(links[0].display_text, "AT Protocol • wsocial.eu")
        self.assertEqual(
            links[0].atproto_post,
            atproto.AtprotoPost("https://wsocial.eu", "wsocial.eu", "3mzy5hts2g22i"),
        )
        self.assertEqual(links[3].atproto_post.actor, MU_AUTHOR_DID)
        self.assertEqual(
            build_fixembed_url(links[0]),
            "https://fixembed.app/embed?url=https%3A%2F%2Fwsocial.eu%2Fprofile%2Fwsocial.eu"
            "%2Fpost%2F3mzy5hts2g22i&v=154",
        )
        # Host-only classification stays limited to hosts known without a lookup.
        self.assertIsNone(social_service(WSOCIAL_POST))

    def test_invalid_hosts_handles_dids_and_rkeys_are_not_candidates(self):
        rejected = [
            "http://wsocial.eu/profile/wsocial.eu/post/3mzy5hts2g22i",
            "https://wsocial.eu:8443/profile/wsocial.eu/post/3mzy5hts2g22i",
            "https://user@wsocial.eu/profile/wsocial.eu/post/3mzy5hts2g22i",
            "https://203.0.113.9/profile/wsocial.eu/post/3mzy5hts2g22i",
            "https://localhost/profile/wsocial.eu/post/3mzy5hts2g22i",
            "https://intranet/profile/wsocial.eu/post/3mzy5hts2g22i",
            # Big non-AT Protocol sites are skipped without a lookup.
            "https://github.com/profile/alice.dev/post/3mzy5hts2g22i",
            "https://m.facebook.com/profile/alice.dev/post/3mzy5hts2g22i",
            "https://www.youtube.com/profile/alice.dev/post/3mzy5hts2g22i",
            # Bad handles.
            "https://mu.social/profile/alice/post/3mzfkhszhlc2l",
            "https://mu.social/profile/bad_handle.com/post/3mzfkhszhlc2l",
            "https://mu.social/profile/alice..com/post/3mzfkhszhlc2l",
            "https://mu.social/profile/-alice.com/post/3mzfkhszhlc2l",
            "https://mu.social/profile/alice.local/post/3mzfkhszhlc2l",
            "https://mu.social/profile/alice.com%2Fx/post/3mzfkhszhlc2l",
            # Bad DIDs.
            "https://mu.social/profile/did:plc:short/post/3mzfkhszhlc2l",
            "https://mu.social/profile/did:plc:VGGSJZVHAKOA7L2M2MGUQV4W/post/3mzfkhszhlc2l",
            "https://mu.social/profile/did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK/post/3mzfkhszhlc2l",
            "https://mu.social/profile/did:web:localhost%3A8080/post/3mzfkhszhlc2l",
            # Bad rkeys: not TIDs.
            "https://mu.social/profile/alice.com/post/abc123",
            "https://mu.social/profile/alice.com/post/3MZFKHSZHLC2L",
            "https://mu.social/profile/alice.com/post/kmzfkhszhlc2l",
            "https://mu.social/profile/alice.com/post/3mzfkhszhlc2la",
            "https://mu.social/profile/alice.com/post/3mzfkhszhlc21",
            # Other path shapes.
            "https://mu.social/profile/alice.com/post/3mzfkhszhlc2l/likes",
            "https://mu.social/profile/alice.com",
            "https://mu.social/users/alice.com/post/3mzfkhszhlc2l",
        ]
        for url in rejected:
            with self.subTest(url=url):
                self.assertIsNone(atproto.parse_atproto_post_url(url))
                self.assertEqual(extract_supported_links(url), [])


class AtprotoVerificationTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        atproto.clear_caches()
        self.addCleanup(atproto.clear_caches)

    async def verify(self, text, appview):
        with patch("fixembed.atproto._fetch_json", appview):
            return await atproto.verify_atproto_links(extract_supported_links(text))

    async def test_verified_wsocial_and_mu_links_are_kept_and_bsky_needs_no_lookup(self):
        appview = default_appview()
        links = await self.verify(
            f"https://bsky.app/profile/creator.bsky.social/post/abc123 {WSOCIAL_POST} "
            f"{MU_POST} {MU_DID_POST}",
            appview,
        )

        self.assertEqual(
            [link.canonical_url for link in links],
            [
                "https://bsky.app/profile/creator.bsky.social/post/abc123",
                WSOCIAL_POST,
                MU_POST,
                MU_DID_POST,
            ],
        )
        # Two handles resolved; the DID-form link needs no handle lookup.
        self.assertEqual(len(appview.lookups("resolveHandle")), 2)
        self.assertNotIn("creator.bsky.social", " ".join(appview.calls))

    async def test_non_atproto_host_with_the_same_path_is_dropped_silently(self):
        appview = default_appview()
        links = await self.verify(
            "https://news.example-blog.com/profile/someone.example-blog.com/post/3mzy5hts2g22i "
            "https://x.com/jack/status/20",
            appview,
        )

        self.assertEqual([link.service for link in links], ["Twitter"])
        self.assertEqual(len(appview.lookups("resolveHandle")), 1)
        self.assertEqual(appview.lookups("getPosts"), [])

    async def test_missing_post_and_unknown_did_are_dropped(self):
        appview = default_appview()
        links = await self.verify(
            # The handle resolves but the post does not exist.
            "https://wsocial.eu/profile/wsocial.eu/post/3mzfkhszhlc2l "
            # A well-formed DID with no such post.
            "https://mu.social/profile/did:plc:aaaaaaaaaaaaaaaaaaaaaaaa/post/3mzfkhszhlc2l",
            appview,
        )
        self.assertEqual(links, [])
        self.assertEqual(len(appview.lookups("getPosts")), 2)

    async def test_hits_and_misses_are_cached(self):
        appview = default_appview()
        text = (
            f"{WSOCIAL_POST} "
            "https://news.example-blog.com/profile/someone.example-blog.com/post/3mzy5hts2g22i"
        )
        first = await self.verify(text, appview)
        calls_after_first = len(appview.calls)
        second = await self.verify(text, appview)

        self.assertEqual([link.canonical_url for link in first], [WSOCIAL_POST])
        self.assertEqual([link.canonical_url for link in second], [WSOCIAL_POST])
        self.assertEqual(calls_after_first, 3)
        self.assertEqual(len(appview.calls), calls_after_first)

    async def test_outages_are_cached_briefly_as_failures(self):
        appview = FakeAppView(status=503)
        self.assertEqual(await self.verify(WSOCIAL_POST, appview), [])
        self.assertEqual(await self.verify(WSOCIAL_POST, appview), [])
        self.assertEqual(len(appview.calls), 1)
        cached, did = atproto._did_cache.get("wsocial.eu")
        self.assertTrue(cached)
        self.assertIsNone(did)

    async def test_lookups_per_message_are_capped(self):
        handles = {f"user{index}.example-social.net": f"did:plc:{'a' * 23}{chr(ord('a') + index)}" for index in range(6)}
        posts = {f"at://{did}/app.bsky.feed.post/3mzfkhszhlc2l" for did in handles.values()}
        appview = FakeAppView(handles=handles, posts=posts)
        urls = [
            f"https://app{index}.example-social.net/profile/user{index}.example-social.net/post/3mzfkhszhlc2l"
            for index in range(6)
        ]

        links = await self.verify(" ".join(urls), appview)

        self.assertEqual(atproto.MAX_LOOKUPS_PER_MESSAGE, 3)
        self.assertEqual([link.canonical_url for link in links], urls[:3])
        self.assertEqual(len(appview.lookups("resolveHandle")), 3)

        # Once cached, earlier links no longer use the budget, so later ones get checked.
        appview.calls.clear()
        links = await self.verify(" ".join(urls), appview)
        self.assertEqual([link.canonical_url for link in links], urls)
        self.assertEqual(len(appview.lookups("resolveHandle")), 3)

    async def test_duplicate_links_cost_one_lookup(self):
        appview = default_appview()
        links = await self.verify(" ".join([WSOCIAL_POST] * 5), appview)
        self.assertEqual(len(links), 5)
        self.assertEqual(len(appview.calls), 2)

    async def test_slow_lookups_are_dropped_at_the_deadline(self):
        appview = default_appview(delay=5)
        loop = asyncio.get_running_loop()
        started = loop.time()
        with patch.object(atproto, "VERIFY_DEADLINE_SECONDS", 0.05):
            links = await self.verify(f"{WSOCIAL_POST} https://x.com/jack/status/20", appview)

        self.assertLess(loop.time() - started, 1)
        self.assertEqual([link.service for link in links], ["Twitter"])
        # Nothing about the slow host is cached, so a later message retries it.
        self.assertEqual(atproto._did_cache.get("wsocial.eu"), (False, None))

    def test_deadline_fits_discord_interaction_window(self):
        self.assertLess(atproto.VERIFY_DEADLINE_SECONDS, 3)
        self.assertLessEqual(atproto.REQUEST_TIMEOUT_SECONDS, atproto.VERIFY_DEADLINE_SECONDS)


if __name__ == "__main__":
    unittest.main()
