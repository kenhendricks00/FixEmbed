"""Fail CI when release-facing FixEmbed versions drift apart."""

import json
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]


def read_version(path: Path) -> str:
    return json.loads(path.read_text(encoding="utf-8"))["version"]


def main() -> None:
    main_source = (ROOT / "main.py").read_text(encoding="utf-8")
    match = re.search(r'^VERSION = "([^"]+)"$', main_source, re.MULTILINE)
    if not match:
        raise SystemExit("main.py does not declare VERSION")

    expected = match.group(1)
    versions = {
        "manifest.json": read_version(ROOT / "manifest.json"),
        "service/package.json": read_version(ROOT / "service" / "package.json"),
        "service/package-lock.json": read_version(ROOT / "service" / "package-lock.json"),
    }
    mismatches = {name: version for name, version in versions.items() if version != expected}
    if mismatches:
        details = ", ".join(f"{name}={version}" for name, version in mismatches.items())
        raise SystemExit(f"Release version mismatch: main.py={expected}; {details}")

    changelog = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
    if not re.search(rf"^## v{re.escape(expected)} \(", changelog, re.MULTILINE):
        raise SystemExit(f"CHANGELOG.md has no v{expected} release heading")

    print(f"Release metadata is aligned at v{expected}")


if __name__ == "__main__":
    main()
