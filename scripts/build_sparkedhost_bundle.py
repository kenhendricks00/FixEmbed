"""Build and verify a complete, deterministic SparkedHost deployment bundle."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
from typing import Any
import zipfile


REPO_ROOT = Path(__file__).resolve().parents[1]
BUNDLE_MANIFEST_NAME = "sparkedhost-manifest.json"
REQUIRED_RUNTIME_FILES = ("requirements.txt", "LICENSE")
OPTIONAL_RUNTIME_FILES = (
    ".env.example",
    "manifest.json",
    "conformance/production.json",
)
FIXED_ZIP_TIMESTAMP = (1980, 1, 1, 0, 0, 0)


class BundleVerificationError(ValueError):
    """Raised when a deployment bundle is incomplete or internally inconsistent."""


def _safe_relative_path(value: object) -> str:
    if not isinstance(value, str):
        raise BundleVerificationError(f"unsafe bundle path: {value!r}")
    path = value
    parsed = PurePosixPath(path)
    if (
        not path
        or "\\" in path
        or parsed.is_absolute()
        or ".." in parsed.parts
        or path != parsed.as_posix()
    ):
        raise BundleVerificationError(f"unsafe bundle path: {path!r}")
    return path


def collect_deployment_files(root: Path) -> tuple[Path, ...]:
    """Return every root Python file plus reviewed runtime metadata paths."""
    root = root.resolve()
    relative_paths = {path.relative_to(root) for path in root.glob("*.py")}

    for required in REQUIRED_RUNTIME_FILES:
        path = root / required
        if not path.is_file():
            raise FileNotFoundError(f"required deployment file is missing: {required}")
        relative_paths.add(Path(required))

    for optional in OPTIONAL_RUNTIME_FILES:
        if (root / optional).is_file():
            relative_paths.add(Path(optional))

    ordered = tuple(sorted(relative_paths, key=lambda path: path.as_posix()))
    for relative in ordered:
        source = root / relative
        if source.is_symlink() or not source.is_file():
            raise BundleVerificationError(
                f"deployment source must be a regular file: {relative.as_posix()}"
            )
        _safe_relative_path(relative.as_posix())
    return ordered


def _manifest_for(root: Path, paths: tuple[Path, ...]) -> dict[str, Any]:
    files = []
    for relative in paths:
        content = (root / relative).read_bytes()
        files.append(
            {
                "path": relative.as_posix(),
                "sha256": hashlib.sha256(content).hexdigest(),
                "size": len(content),
            }
        )
    return {
        "formatVersion": 1,
        "bundleType": "sparkedhost-root",
        "entrypoint": "main.py",
        "files": files,
    }


def _zip_info(name: str) -> zipfile.ZipInfo:
    info = zipfile.ZipInfo(name, FIXED_ZIP_TIMESTAMP)
    info.create_system = 3
    info.external_attr = 0o100644 << 16
    info.compress_type = zipfile.ZIP_DEFLATED
    return info


def build_bundle(root: Path, output: Path) -> dict[str, Any]:
    """Create a deterministic archive and verify it before returning."""
    root = root.resolve()
    output = output.resolve()
    paths = collect_deployment_files(root)
    manifest = _manifest_for(root, paths)
    manifest_bytes = (
        json.dumps(manifest, indent=2, sort_keys=True, ensure_ascii=False) + "\n"
    ).encode("utf-8")

    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr(
            _zip_info(BUNDLE_MANIFEST_NAME),
            manifest_bytes,
            compresslevel=9,
        )
        for relative in paths:
            archive.writestr(
                _zip_info(relative.as_posix()),
                (root / relative).read_bytes(),
                compresslevel=9,
            )

    verify_bundle(output)
    sidecar = output.with_name(f"{output.stem}.manifest.json")
    sidecar.write_bytes(manifest_bytes)
    return manifest


def verify_bundle(bundle: Path) -> dict[str, Any]:
    """Reject partial, modified, duplicate, or path-unsafe deployment archives."""
    try:
        archive = zipfile.ZipFile(bundle)
    except (OSError, zipfile.BadZipFile) as error:
        raise BundleVerificationError(f"invalid deployment archive: {error}") from error

    with archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise BundleVerificationError("deployment archive contains duplicate paths")
        for name in names:
            _safe_relative_path(name)
        if BUNDLE_MANIFEST_NAME not in names:
            raise BundleVerificationError("deployment archive is missing its manifest")

        try:
            manifest = json.loads(archive.read(BUNDLE_MANIFEST_NAME))
        except (KeyError, json.JSONDecodeError, UnicodeDecodeError) as error:
            raise BundleVerificationError("deployment manifest is invalid") from error

        if not isinstance(manifest, dict) or manifest.get("formatVersion") != 1:
            raise BundleVerificationError("unsupported deployment manifest format")
        if manifest.get("bundleType") != "sparkedhost-root":
            raise BundleVerificationError("unsupported deployment bundle type")
        if manifest.get("entrypoint") != "main.py":
            raise BundleVerificationError("deployment entrypoint must be main.py")
        entries = manifest.get("files")
        if not isinstance(entries, list):
            raise BundleVerificationError("deployment manifest files must be a list")

        expected_names = {BUNDLE_MANIFEST_NAME}
        seen_paths: set[str] = set()
        for entry in entries:
            if not isinstance(entry, dict):
                raise BundleVerificationError("deployment manifest has an invalid file entry")
            path = _safe_relative_path(entry.get("path"))
            if path in seen_paths:
                raise BundleVerificationError(f"duplicate deployment manifest path: {path}")
            seen_paths.add(path)
            expected_names.add(path)
            if path not in names:
                raise BundleVerificationError(f"deployment archive is missing {path}")

            content = archive.read(path)
            if entry.get("size") != len(content):
                raise BundleVerificationError(f"deployment size mismatch for {path}")
            digest = hashlib.sha256(content).hexdigest()
            if entry.get("sha256") != digest:
                raise BundleVerificationError(f"deployment checksum mismatch for {path}")

        required_paths = {"main.py", *REQUIRED_RUNTIME_FILES}
        missing_required = sorted(required_paths - seen_paths)
        if missing_required:
            raise BundleVerificationError(
                "deployment manifest is missing required paths: "
                + ", ".join(missing_required)
            )

        unexpected = sorted(set(names) - expected_names)
        if unexpected:
            raise BundleVerificationError(
                "deployment archive contains unexpected paths: " + ", ".join(unexpected)
            )
        missing = sorted(expected_names - set(names))
        if missing:
            raise BundleVerificationError(
                "deployment archive is missing paths: " + ", ".join(missing)
            )
        return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output",
        type=Path,
        default=REPO_ROOT / "dist" / "fixembed-sparkedhost.zip",
        help="archive path to create",
    )
    parser.add_argument(
        "--verify",
        type=Path,
        help="verify an existing archive instead of building one",
    )
    arguments = parser.parse_args()

    if arguments.verify:
        manifest = verify_bundle(arguments.verify)
        print(
            f"Verified {arguments.verify} with {len(manifest['files'])} deployment files"
        )
        return

    manifest = build_bundle(REPO_ROOT, arguments.output)
    print(
        f"Built {arguments.output} with {len(manifest['files'])} deployment files"
    )


if __name__ == "__main__":
    main()
