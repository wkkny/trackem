#!/bin/sh
set -eu

PROJECT_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
APP_PATH="$PROJECT_ROOT/dist/Trackem.app"
CONTENTS_PATH="$APP_PATH/Contents"

swift build --package-path "$PROJECT_ROOT/macos" -c release
BIN_PATH=$(swift build --package-path "$PROJECT_ROOT/macos" -c release --show-bin-path)

rm -rf "$APP_PATH"
mkdir -p "$CONTENTS_PATH/MacOS" "$CONTENTS_PATH/Resources"
cp "$BIN_PATH/Trackem" "$CONTENTS_PATH/MacOS/Trackem"
cp "$PROJECT_ROOT/macos/Info.plist" "$CONTENTS_PATH/Info.plist"
cp "$PROJECT_ROOT/build/icon.icns" "$CONTENTS_PATH/Resources/icon.icns"
chmod 755 "$CONTENTS_PATH/MacOS/Trackem"

if command -v codesign >/dev/null 2>&1; then
  codesign --force --deep --sign - "$APP_PATH"
fi

echo "Built $APP_PATH"
