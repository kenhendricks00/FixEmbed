import unittest

from card_conformance import BUILDERS


def gallery_items(component):
    if not isinstance(component, dict):
        return []
    items = list(component.get("items", ())) if component.get("type") == 12 else []
    for child in component.get("components", ()):
        items.extend(gallery_items(child))
    return items


class SensitiveMediaTests(unittest.TestCase):
    def test_every_platform_renderer_spoilers_media_marked_sensitive(self):
        payload = {
            "title": "Sensitive post",
            "description": "Source-marked sensitive content",
            "url": "https://example.com/post",
            "authorName": "Creator",
            "authorHandle": "@creator",
            "authorUrl": "https://example.com/creator",
            "image": "https://example.com/media.jpg",
            "sensitive": True,
        }

        for platform, builder in BUILDERS.items():
            with self.subTest(platform=platform):
                components = builder(payload).to_components()
                items = gallery_items(components[0])
                self.assertTrue(items, "expected a rendered media item")
                self.assertTrue(
                    all(item.get("spoiler") is True for item in items),
                    "source-marked sensitive media must be hidden by Discord",
                )
