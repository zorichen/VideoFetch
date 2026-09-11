#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h}"
BUILD="$ROOT/build"
FINAL_APP="$BUILD/VideoFetch.app"
ARCHIVE="$BUILD/VideoFetch-0.10.0-macOS-AppleSilicon.zip"
STAGE=$(mktemp -d "${TMPDIR:-/tmp}/video-download-assistant.XXXXXX")
APP="$STAGE/VideoFetch.app"
SDK="$(xcrun --sdk macosx --show-sdk-path)"
MODULE_CACHE="$BUILD/ModuleCache"
trap 'rm -rf "$STAGE"' EXIT

mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources" "$MODULE_CACHE"
swiftc \
  -parse-as-library \
  -sdk "$SDK" \
  -target arm64-apple-macosx13.0 \
  -module-cache-path "$MODULE_CACHE" \
  -framework SwiftUI \
  -framework AppKit \
  "$ROOT"/Sources/*.swift \
  -o "$APP/Contents/MacOS/VideoFetch"
cp "$ROOT/Info.plist" "$APP/Contents/Info.plist"
cp "$ROOT/Tools/ffmpeg" "$APP/Contents/Resources/ffmpeg"
cp "$ROOT/Assets/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"
cp "$ROOT/../LICENSE" "$APP/Contents/Resources/LICENSE"
chmod +x "$APP/Contents/Resources/ffmpeg"
xattr -cr "$APP"
xattr -d com.apple.FinderInfo "$APP" 2>/dev/null || true
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true
codesign --force --deep --sign - "$APP"
ditto -c -k --keepParent --norsrc --noextattr --noqtn --noacl "$APP" "$ARCHIVE"
ditto --norsrc --noextattr --noqtn --noacl "$APP" "$FINAL_APP"
xattr -d com.apple.FinderInfo "$FINAL_APP" 2>/dev/null || true
xattr -dr com.apple.quarantine "$FINAL_APP" 2>/dev/null || true
print "$ARCHIVE"
