#!/bin/bash
set -euo pipefail

APP_NAME="Hermes"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DIST="$SCRIPT_DIR/dist"
BUNDLE="$DIST/$APP_NAME.app"
CONTENTS="$BUNDLE/Contents"

echo "→ Cleaning dist/"
rm -rf "$DIST"
mkdir -p "$CONTENTS/MacOS" "$CONTENTS/Resources/server"

echo "→ Installing production dependencies"
cp "$SCRIPT_DIR/package.json" "$CONTENTS/Resources/server/"
npm install --omit=dev --prefix "$CONTENTS/Resources/server" --silent

echo "→ Copying server"
cp "$SCRIPT_DIR/server.js" "$CONTENTS/Resources/server/"

echo "→ Writing launcher"
cat > "$CONTENTS/MacOS/$APP_NAME" << 'LAUNCHER'
#!/bin/bash

RESOURCES="$(cd "$(dirname "$0")/../Resources" && pwd)"
SERVER_DIR="$RESOURCES/server"
PORT="${PORT:-3333}"

# Discover node — covers mise, homebrew arm64/x86, nvm, system
NODE=""
for CANDIDATE in \
  "$HOME/.local/bin/node" \
  "$HOME/.local/share/mise/shims/node" \
  "$HOME/.mise/shims/node" \
  /opt/homebrew/bin/node \
  /usr/local/bin/node \
  "$HOME/.nvm/versions/node/$(ls "$HOME/.nvm/versions/node" 2>/dev/null | sort -V | tail -1)/bin/node" \
  /usr/bin/node; do
  if [ -x "$CANDIDATE" ]; then
    NODE="$CANDIDATE"
    break
  fi
done

if [ -z "$NODE" ]; then
  osascript -e 'display alert "Hermes — Node.js not found" message "Install Node.js from nodejs.org or via Homebrew:\n\n  brew install node\n\nThen relaunch Hermes." as critical buttons {"OK"} default button "OK"'
  exit 1
fi

# Read Airtable creds from Keychain (silently — missing is fine)
AIRTABLE_API_KEY=$(security find-generic-password -a justjack -s com.justjack.airtable_api_key -w 2>/dev/null || true)
AIRTABLE_BASE_ID=$(security find-generic-password -a justjack -s com.justjack.airtable_base_id -w 2>/dev/null || true)
AIRTABLE_TABLE=$(security find-generic-password -a justjack -s com.justjack.airtable_table -w 2>/dev/null || true)
export AIRTABLE_API_KEY AIRTABLE_BASE_ID AIRTABLE_TABLE PORT

# If server already running on this port, just open the browser
if curl -sf --max-time 1 "http://localhost:$PORT/api/state" > /dev/null 2>&1; then
  open "http://localhost:$PORT"
  exit 0
fi

# Start server
cd "$SERVER_DIR"
"$NODE" server.js &
SERVER_PID=$!

# Wait up to 6s for server to be ready
for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
  sleep 0.5
  if curl -sf --max-time 1 "http://localhost:$PORT/api/state" > /dev/null 2>&1; then
    break
  fi
done

open "http://localhost:$PORT"

# Keep app alive in Dock while server runs
wait $SERVER_PID
LAUNCHER
chmod +x "$CONTENTS/MacOS/$APP_NAME"

echo "→ Writing Info.plist"
cat > "$CONTENTS/Info.plist" << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>Hermes</string>
  <key>CFBundleDisplayName</key>
  <string>Hermes</string>
  <key>CFBundleIdentifier</key>
  <string>com.justjack.hermes-dashboard</string>
  <key>CFBundleVersion</key>
  <string>1.0</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>CFBundleExecutable</key>
  <string>Hermes</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleSignature</key>
  <string>????</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSAllowsLocalNetworking</key>
    <true/>
  </dict>
</dict>
</plist>
PLIST

echo "→ Ad-hoc signing"
codesign --force --deep --sign - "$BUNDLE" 2>/dev/null && echo "  signed ok" || echo "  (skipped — codesign unavailable)"

echo "→ Creating Hermes.zip"
cd "$DIST"
zip -qr "$SCRIPT_DIR/Hermes.zip" "$APP_NAME.app"

SIZE=$(du -sh "$SCRIPT_DIR/Hermes.zip" | cut -f1)
echo ""
echo "✓ Built: Hermes.zip ($SIZE)"
echo ""
echo "  Install:  unzip -o Hermes.zip -d /Applications/"
echo "  Launch:   open /Applications/Hermes.app"
echo ""
