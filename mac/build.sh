#!/bin/zsh
# Build the common Holy/Luma menu before replacing the previous application.
set -eu
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
NODE="${NODE:-$(command -v node || true)}"
[ -x "$NODE" ] || { echo "No encuentro Node.js. Instálalo o usa NODE=/ruta/a/node"; exit 1; }
NODE="$("$NODE" -p 'process.execPath')"
APP="$HOME/Applications/Luma LG.app"
mkdir -p "$HOME/Applications"
BUILD_DIR="$(mktemp -d "$HOME/Applications/.luma-menu.XXXXXX")"
cleanup() {
  if [ -d "$BUILD_DIR/previous.app" ] && [ ! -d "$APP" ]; then mv "$BUILD_DIR/previous.app" "$APP"; fi
  rm -rf "$BUILD_DIR"
}
trap cleanup EXIT
STAGED_APP="$BUILD_DIR/Luma LG.app"
mkdir -p "$STAGED_APP/Contents/MacOS" "$STAGED_APP/Contents/Resources"
swiftc -O -o "$STAGED_APP/Contents/MacOS/LumaMenu" mac/LumaMenu.swift
cat > "$STAGED_APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>Holy y Luma</string>
<key>CFBundleDisplayName</key><string>Holy y Luma</string>
<key>CFBundleIdentifier</key><string>com.lgapp.lab.menu</string>
<key>CFBundleExecutable</key><string>LumaMenu</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>2</string>
<key>LSUIElement</key><true/>
</dict></plist>
PLIST
"$NODE" -e 'require("node:fs").writeFileSync(process.argv[1], JSON.stringify({root:process.argv[2],node:process.argv[3]}))' "$STAGED_APP/Contents/Resources/config.json" "$ROOT" "$NODE"
plutil -lint "$STAGED_APP/Contents/Info.plist" >/dev/null
codesign --force --sign - "$STAGED_APP"
if [ -e "$APP" ]; then mv "$APP" "$BUILD_DIR/previous.app"; fi
mv "$STAGED_APP" "$APP"
if [ "${LUMA_AUTOSTART:-0}" = "1" ]; then "$NODE" scripts/holy/autostart.mjs on; fi
echo "Listo: $APP (Holy y Luma). Inicio automático de sesión: ${LUMA_AUTOSTART:-0}"
