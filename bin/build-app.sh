#!/usr/bin/env bash
# Builds "Control Room.app" (notifier + launchd launcher) into the directory given, ad-hoc signed.
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
out="${1:?usage: build-app.sh <dir>}"
app="$out/Control Room.app"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp "$repo/native/Info.plist" "$app/Contents/Info.plist"
swiftc -O -o "$app/Contents/MacOS/Control Room" "$repo/native/Notifier.swift"
swiftc -O -o "$app/Contents/MacOS/control-room-server" "$repo/native/Server.swift"

# Icon from the PWA's SVG.
if qlmanage -t -s 1024 -o "$work" "$repo/src/ui/public/icon.svg" >/dev/null 2>&1; then
  set_dir="$work/AppIcon.iconset"
  mkdir -p "$set_dir"
  for s in 16 32 128 256 512; do
    sips -z $s $s "$work/icon.svg.png" --out "$set_dir/icon_${s}x${s}.png" >/dev/null
    sips -z $((s * 2)) $((s * 2)) "$work/icon.svg.png" --out "$set_dir/icon_${s}x${s}@2x.png" >/dev/null
  done
  iconutil -c icns -o "$app/Contents/Resources/AppIcon.icns" "$set_dir"
fi

codesign --force --sign - "$app/Contents/MacOS/control-room-server"
codesign --force --sign - "$app"
echo "built $app"
