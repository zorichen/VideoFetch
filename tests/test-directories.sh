#!/bin/zsh
set -euo pipefail
ROOT="${0:A:h:h}"
STAGE=$(mktemp -d "${TMPDIR:-/tmp}/vda-directory-tests.XXXXXX")
trap 'rm -rf "$STAGE"' EXIT
swiftc -parse-as-library -module-cache-path "$STAGE/cache" \
  "$ROOT/VideoDownloadAssistant/Sources/DirectorySettings.swift" \
  "$ROOT/tests/DirectorySettingsTests.swift" -o "$STAGE/tests"
"$STAGE/tests"
