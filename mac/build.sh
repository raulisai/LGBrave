#!/bin/zsh
# Builds "Luma LG.app" (menu-bar status + one-click connection) into ~/Applications.
set -e
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
NODE="${NODE:-$(command -v node)}"
[ -x "$NODE" ] || { echo "No encuentro node. Instálalo o usa NODE=/ruta/a/node"; exit 1; }
APP="$HOME/Applications/Luma LG.app"
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
<key>CFBundleVersion</key><string>1</string>
<key>LSUIElement</key><true/>
</dict></plist>
PLIST
printf '{"root":"%s","node":"%s"}\n' "$ROOT" "$NODE" > "$APP/Contents/Resources/config.json"
codesign --force --sign - "$APP" >/dev/null 2>&1 || true
echo "Listo: $APP"
