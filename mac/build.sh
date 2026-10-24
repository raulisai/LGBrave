#!/bin/zsh
# Builds "Luma LG.app" (menu-bar «● LG»: Holy's traffic light, Doctor and controls; Luma in a
# submenu) into ~/Applications and restarts it. LUMA_ROOT: Luma's checkout (default: the main one).
set -e
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
LUMA_ROOT="${LUMA_ROOT:-$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')}"
[ -f "$LUMA_ROOT/scripts/luma-control.mjs" ] || LUMA_ROOT=""
NODE="${NODE:-$(command -v node)}"
[ -x "$NODE" ] || { echo "No encuentro node. Instálalo o usa NODE=/ruta/a/node"; exit 1; }
APP="$HOME/Applications/Luma LG.app"
pkill -x LumaMenu 2>/dev/null || true
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
swiftc -O -o "$APP/Contents/MacOS/LumaMenu" mac/LumaMenu.swift
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>Luma LG</string>
<key>CFBundleDisplayName</key><string>Luma LG</string>
<key>CFBundleIdentifier</key><string>com.lgapp.lab.menu</string>
<key>CFBundleExecutable</key><string>LumaMenu</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>2</string>
<key>LSUIElement</key><true/>
</dict></plist>
PLIST
if [ -n "$LUMA_ROOT" ]; then
  printf '{"holyRoot":"%s","lumaRoot":"%s","node":"%s"}\n' "$ROOT" "$LUMA_ROOT" "$NODE" > "$APP/Contents/Resources/config.json"
else
  printf '{"holyRoot":"%s","node":"%s"}\n' "$ROOT" "$NODE" > "$APP/Contents/Resources/config.json"
fi
codesign --force --sign - "$APP" >/dev/null 2>&1 || true
open "$APP"
echo "Listo: $APP"
