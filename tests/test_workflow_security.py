import re
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
WORKFLOW_DIRECTORY = REPO_ROOT / ".github" / "workflows"
ACTION_REFERENCE = re.compile(r"\buses:\s*([^\s#]+)(?:\s+#\s*(v\d+))?")
FULL_COMMIT_SHA = re.compile(r"[0-9a-f]{40}")
MINIMUM_NODE24_MAJORS = {
    "actions/checkout": 7,
    "actions/setup-python": 6,
    "actions/setup-node": 7,
    "actions/upload-artifact": 7,
    "docker/login-action": 4,
}


class WorkflowSecurityTests(unittest.TestCase):
    def action_references(self):
        for workflow in sorted(WORKFLOW_DIRECTORY.glob("*.y*ml")):
            for line_number, line in enumerate(workflow.read_text(encoding="utf-8").splitlines(), 1):
                match = ACTION_REFERENCE.search(line)
                if match:
                    yield workflow, line_number, match.group(1), match.group(2)

    def test_third_party_actions_are_pinned_to_full_commit_shas(self):
        violations = []
        for workflow, line_number, reference, _version in self.action_references():
            if reference.startswith("./") or reference.startswith("docker://"):
                continue
            _action, separator, revision = reference.rpartition("@")
            if not separator or not FULL_COMMIT_SHA.fullmatch(revision):
                violations.append(f"{workflow.relative_to(REPO_ROOT)}:{line_number} {reference}")

        self.assertEqual([], violations, "Unpinned workflow actions:\n" + "\n".join(violations))

    def test_pinned_actions_document_supported_node24_release_majors(self):
        violations = []
        for workflow, line_number, reference, version in self.action_references():
            action, _separator, _revision = reference.rpartition("@")
            minimum_major = MINIMUM_NODE24_MAJORS.get(action)
            documented_major = int(version[1:]) if version else None
            if minimum_major is not None and (
                documented_major is None or documented_major < minimum_major
            ):
                violations.append(
                    f"{workflow.relative_to(REPO_ROOT)}:{line_number} "
                    f"{action} requires a v{minimum_major}+ release comment"
                )

        self.assertEqual([], violations, "Deprecated action runtimes:\n" + "\n".join(violations))


if __name__ == "__main__":
    unittest.main()
