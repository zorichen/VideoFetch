#!/usr/bin/env python3
"""Verify releases and write SHA-256 checksums (Python 3.11+).

macOS ditto stores UTF-8 filenames without setting the ZIP UTF-8 flag.
"""
import hashlib
import json
import plistlib
from pathlib import Path
from zipfile import ZipFile

root = Path(__file__).resolve().parents[1]
output = root / "outputs"
archives = sorted(output.glob("*.zip"))
assert len(archives) == 2, "Keep exactly the two current release packages"
license_bytes = (root / "LICENSE").read_bytes()
for file in archives:
    with ZipFile(file, metadata_encoding="utf-8") as archive:
        assert archive.testzip() is None, f"Damaged archive: {file.name}"
        if "Chrome" in file.name:
            source = root / "VideoCaptureExtension"
            for item in source.rglob("*"):
                if item.is_file() and not any(p.startswith(".") for p in item.relative_to(source).parts):
                    assert archive.read(item.relative_to(root).as_posix()) == item.read_bytes(), item
            assert json.loads(archive.read("VideoCaptureExtension/manifest.json"))["version"] == "1.2.0"
            assert archive.read("VideoCaptureExtension/LICENSE") == license_bytes
        else:
            prefix = "视频下载助手-0.9.app/Contents/"
            info = plistlib.loads(archive.read(prefix + "Info.plist"))
            source_info = plistlib.loads((root / "VideoDownloadAssistant/Info.plist").read_bytes())
            assert info == source_info
            assert info["CFBundleShortVersionString"] == "0.9.0"
            assert archive.read(prefix + "Resources/LICENSE") == license_bytes
            assert len(archive.read(prefix + "MacOS/VideoDownloadAssistant")) > 0
            assert prefix + "_CodeSignature/CodeResources" in archive.namelist()
        print(f"PASS: {file.name}")
checksums = "".join(f"{hashlib.sha256(file.read_bytes()).hexdigest()}  {file.name}\n" for file in archives)
(output / "SHA256SUMS.txt").write_text(checksums, encoding="utf-8", newline="\n")
print(checksums, end="")
