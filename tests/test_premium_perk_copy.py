import re
import unittest
from pathlib import Path

from translations import TRANSLATIONS


# Canonical paid perk list (English). Must match real entitlement gating —
# default translation is free and must never appear here.
CANONICAL_PREMIUM_PERKS_EN = (
    "Custom social card colors",
    "Card style controls",
    "Server-branded footers",
    "Bot and webhook auto-fixing",
    "Member and role exclusions",
    "Private 30-day analytics",
    "No 'Sent by' label",
    "Supporters role",
)

TRANSLATION_CLAIM_PATTERNS = (
    re.compile(r"translat", re.I),
    re.compile(r"traduc", re.I),
    re.compile(r"uebersetz", re.I),
    re.compile(r"übersetz", re.I),
)


class PremiumPerkCopyTests(unittest.TestCase):
    def test_english_premium_perks_match_canonical_paid_list(self):
        perks = TRANSLATIONS["en"]["premium_perks"].splitlines()
        self.assertEqual(list(CANONICAL_PREMIUM_PERKS_EN), perks)

    def test_no_locale_claims_translation_is_premium(self):
        for lang, catalog in TRANSLATIONS.items():
            perks = catalog["premium_perks"]
            for pattern in TRANSLATION_CLAIM_PATTERNS:
                self.assertIsNone(
                    pattern.search(perks),
                    f"{lang} premium_perks still claims translation as Premium: {perks!r}",
                )

    def test_every_locale_lists_the_same_number_of_paid_perks(self):
        expected = len(CANONICAL_PREMIUM_PERKS_EN)
        for lang, catalog in TRANSLATIONS.items():
            lines = [line for line in catalog["premium_perks"].splitlines() if line.strip()]
            self.assertEqual(expected, len(lines), f"{lang} perk count mismatch: {lines}")

    def test_website_premium_section_matches_paid_feature_set(self):
        site = Path(__file__).resolve().parents[1].joinpath(
            "service/src/utils/static_site.ts"
        ).read_text(encoding="utf-8")
        premium_section = site.split('id="premium"', 1)[1].split("</section>", 1)[0]
        lowered = premium_section.lower()

        required_phrases = (
            "custom card colors",
            "card style",
            "branded footers",
            "webhook",
            "exclusions",
            "30-day analytics",
            "sent by",
            "supporters",
        )
        for phrase in required_phrases:
            self.assertIn(phrase, lowered, f"website #premium missing {phrase!r}")

        # Translation must be framed as free, not sold as a Premium perk.
        self.assertIn("translation stay free", lowered)
        self.assertNotIn("default x translation", lowered)


if __name__ == "__main__":
    unittest.main()
