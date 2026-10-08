"""Source-level guard for #71: Reddit outages must not render a deleted-comment card."""

import ast
import unittest
from pathlib import Path


MAIN_SOURCE = Path(__file__).resolve().parents[1].joinpath("main.py").read_text(
    encoding="utf-8"
)


def _card_build_exception_handlers(tree: ast.AST) -> list[ast.ExceptHandler]:
    """Except branches whose try body calls build_components_v2_link."""
    handlers = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Try):
            continue
        # Only the innermost try: the card build is a direct statement of its body.
        calls_card_builder = any(
            isinstance(statement, (ast.Assign, ast.Expr))
            and any(
                isinstance(inner, ast.Call)
                and isinstance(inner.func, ast.Name)
                and inner.func.id == "build_components_v2_link"
                for inner in ast.walk(statement)
            )
            for statement in node.body
        )
        if calls_card_builder:
            handlers.extend(node.handlers)
    return handlers


class RedditCommentOutageSourceTests(unittest.TestCase):
    def setUp(self):
        self.tree = ast.parse(MAIN_SOURCE)
        self.handlers = _card_build_exception_handlers(self.tree)

    def test_both_card_build_paths_are_found(self):
        # Slash command and automatic on_message paths.
        self.assertEqual(len(self.handlers), 2)

    def test_exception_branches_use_the_native_og_helper(self):
        for handler in self.handlers:
            with self.subTest(line=handler.lineno):
                source = ast.get_source_segment(MAIN_SOURCE, handler) or ""
                self.assertIn("keeps_native_reddit_og_on_failure(", source)
                self.assertNotIn("is_reddit_comment_permalink(", source)

    def test_exception_branches_no_longer_build_the_unavailable_layout(self):
        self.assertNotIn("build_reddit_comment_unavailable_layout", MAIN_SOURCE)
        for handler in self.handlers:
            with self.subTest(line=handler.lineno):
                source = ast.get_source_segment(MAIN_SOURCE, handler) or ""
                self.assertNotIn("ComponentsV2Delivery(", source)
                self.assertNotIn("rich_card_built = True", source)

    def test_command_path_falls_back_to_the_plain_link(self):
        command_handler = min(self.handlers, key=lambda handler: handler.lineno)
        source = ast.get_source_segment(MAIN_SOURCE, command_handler) or ""
        self.assertIn(
            "await interaction.followup.send(fallback_url, allowed_mentions=no_mentions())",
            source,
        )

    def test_automatic_path_skips_reddit_comment_outages(self):
        automatic_handler = max(self.handlers, key=lambda handler: handler.lineno)
        source = ast.get_source_segment(MAIN_SOURCE, automatic_handler) or ""
        self.assertIn("if keeps_native_reddit_og_on_failure(", source)
        self.assertIn("kept_native_preview = True", source)
        self.assertIn("formatted_links.append(automatic_url)", source)


if __name__ == "__main__":
    unittest.main()
