#!/usr/bin/env python3
"""Create the Chrome distribution with the project's license included."""
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

root = Path(__file__).resolve().parents[1]
source = root / "VideoCaptureExtension"
version = json.loads((source / "manifest.json").read_text(encoding="utf-8"))["version"]
short_version = ".".join(version.split(".")[:2])
destination = root / "outputs" / f"视频下载助手-Chrome扩展-{short_version}.zip"
destination.parent.mkdir(exist_ok=True)
with ZipFile(destination, "w", ZIP_DEFLATED) as archive:
    for file in sorted(source.rglob("*")):
        if file.is_file() and not any(part.startswith(".") for part in file.relative_to(source).parts):
            archive.write(file, file.relative_to(root).as_posix())
    archive.write(root / "LICENSE", "VideoCaptureExtension/LICENSE")
    archive.write(root / "LICENSE", "LICENSE")
with ZipFile(destination) as archive:
    assert archive.testzip() is None
    for file in source.rglob("*"):
        if file.is_file() and not any(part.startswith(".") for part in file.relative_to(source).parts):
            assert archive.read(file.relative_to(root).as_posix()) == file.read_bytes()
    assert archive.read("VideoCaptureExtension/LICENSE") == (root / "LICENSE").read_bytes()
print(destination)
