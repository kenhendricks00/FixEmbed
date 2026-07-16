import json
from pathlib import Path
import tempfile
import unittest
import zipfile

from scripts.build_sparkedhost_bundle import (
    BUNDLE_MANIFEST_NAME,
    BundleVerificationError,
    build_bundle,
    collect_deployment_files,
    verify_bundle,
)


class SparkedHostBundleTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        (self.root / "main.py").write_text("print('ready')\n", encoding="utf-8")
        (self.root / "a.py").write_text("VALUE = 1\n", encoding="utf-8")
        (self.root / "b.py").write_text("LABEL = 'café'\n", encoding="utf-8")
        (self.root / "requirements.txt").write_text("discord.py==2.6.4\n", encoding="utf-8")
        (self.root / "LICENSE").write_text("AGPL-3.0-or-later\n", encoding="utf-8")
        (self.root / ".env").write_text("BOT_TOKEN=secret\n", encoding="utf-8")
        (self.root / "tests").mkdir()
        (self.root / "tests" / "not_runtime.py").write_text("raise AssertionError\n", encoding="utf-8")

    def tearDown(self):
        self.temporary_directory.cleanup()

    def test_collects_every_root_python_file_and_required_runtime_metadata(self):
        paths = collect_deployment_files(self.root)

        self.assertEqual(
            ("LICENSE", "a.py", "b.py", "main.py", "requirements.txt"),
            tuple(path.as_posix() for path in paths),
        )

    def test_bundle_is_deterministic_and_self_verifying(self):
        first = self.root / "dist" / "first.zip"
        second = self.root / "dist" / "second.zip"

        first_manifest = build_bundle(self.root, first)
        second_manifest = build_bundle(self.root, second)

        self.assertEqual(first.read_bytes(), second.read_bytes())
        self.assertEqual(first_manifest, second_manifest)
        verified = verify_bundle(first)
        self.assertEqual(first_manifest, verified)
        self.assertEqual(
            ["LICENSE", "a.py", "b.py", "main.py", "requirements.txt"],
            [entry["path"] for entry in verified["files"]],
        )
        with zipfile.ZipFile(first) as archive:
            self.assertEqual(
                [
                    "LICENSE",
                    "a.py",
                    "b.py",
                    "main.py",
                    "requirements.txt",
                    BUNDLE_MANIFEST_NAME,
                ],
                sorted(archive.namelist()),
            )

    def test_verification_rejects_a_partial_upload_bundle(self):
        complete = self.root / "dist" / "complete.zip"
        partial = self.root / "dist" / "partial.zip"
        build_bundle(self.root, complete)

        with zipfile.ZipFile(complete) as source, zipfile.ZipFile(partial, "w") as target:
            for name in source.namelist():
                if name != "b.py":
                    target.writestr(name, source.read(name))

        with self.assertRaisesRegex(BundleVerificationError, "b.py"):
            verify_bundle(partial)

    def test_verification_rejects_unexpected_or_unsafe_archive_paths(self):
        bundle = self.root / "dist" / "unsafe.zip"
        bundle.parent.mkdir(parents=True, exist_ok=True)
        manifest = {"formatVersion": 1, "files": []}
        with zipfile.ZipFile(bundle, "w") as archive:
            archive.writestr(BUNDLE_MANIFEST_NAME, json.dumps(manifest))
            archive.writestr("../escape.py", "pass\n")

        with self.assertRaisesRegex(BundleVerificationError, "unsafe"):
            verify_bundle(bundle)

    def test_verification_rejects_a_manifest_without_the_runtime_entrypoint(self):
        bundle = self.root / "dist" / "empty.zip"
        bundle.parent.mkdir(parents=True, exist_ok=True)
        manifest = {
            "formatVersion": 1,
            "bundleType": "sparkedhost-root",
            "entrypoint": "main.py",
            "files": [],
        }
        with zipfile.ZipFile(bundle, "w") as archive:
            archive.writestr(BUNDLE_MANIFEST_NAME, json.dumps(manifest))

        with self.assertRaisesRegex(BundleVerificationError, "main.py"):
            verify_bundle(bundle)


if __name__ == "__main__":
    unittest.main()
