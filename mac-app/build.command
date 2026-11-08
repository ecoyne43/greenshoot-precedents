#!/bin/bash
# Builds Precedents for Mac and puts it in ~/Applications. Double-click in Finder (or: bash build.command).
# The first time, macOS may install Apple's Command Line Tools; run this again when that finishes.
cd "$(dirname "$0")"
exec > >(tee build.log) 2>&1
echo "Building Precedents ($(date))"

if ! xcode-select -p >/dev/null 2>&1 || ! command -v swiftc >/dev/null 2>&1; then
  echo "Apple's Command Line Tools are needed. A window will ask to install them."
  echo "When the install finishes, double-click build.command again."
  xcode-select --install
  exit 1
fi

APP_NAME="Precedents.app"
OUT="build/$APP_NAME"
DEST="$HOME/Applications/$APP_NAME"
rm -rf build
mkdir -p "$OUT/Contents/MacOS" "$OUT/Contents/Resources"

swiftc -O -swift-version 5 -target "$(uname -m)-apple-macos13.0" main.swift \
  -o "$OUT/Contents/MacOS/Precedents" \
  -framework Cocoa -framework WebKit -framework Carbon -framework ServiceManagement || {
  echo; echo "BUILD FAILED (the errors are above, and saved in build.log)"; exit 1; }

cp Info.plist "$OUT/Contents/Info.plist"
cp ../public/desk.html ../public/desk.css ../public/desk.js "$OUT/Contents/Resources/" || { echo "Panel files missing from ../public"; exit 1; }
# App icon from the extension's icon, if the Mac's tools can make one (not essential).
if command -v iconutil >/dev/null && command -v sips >/dev/null; then
  ICON=build/Precedents.iconset; mkdir -p "$ICON"
  for s in 16 32 128 256 512; do
    sips -z $s $s ../public/extension/icons/128.png --out "$ICON/icon_${s}x${s}.png" >/dev/null 2>&1
    sips -z $((s*2)) $((s*2)) ../public/extension/icons/128.png --out "$ICON/icon_${s}x${s}@2x.png" >/dev/null 2>&1
  done
  iconutil -c icns "$ICON" -o "$OUT/Contents/Resources/AppIcon.icns" 2>/dev/null && \
    /usr/libexec/PlistBuddy -c "Add :CFBundleIconFile string AppIcon" "$OUT/Contents/Info.plist" 2>/dev/null
fi
codesign --force --sign - --identifier au.greenshoot.precedents "$OUT" || echo "(signing skipped)"

# Replace any running copy, install, and start it.
pkill -x Precedents 2>/dev/null; sleep 0.5
mkdir -p "$HOME/Applications"
rm -rf "$DEST" && cp -R "$OUT" "$DEST"
open "$DEST"
echo
echo "Done. Precedents is running (the photo-stack icon in the menu bar)."
echo "Control-Option-P: find a precedent.   Control-Option-O: send a screenshot to the inbox."
