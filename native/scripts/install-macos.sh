#!/usr/bin/env bash
set -e

EXTENSION_ID="aigaiddilbifffjcgfocgiaceflchjdn"
APP_NAME="com.vidown.native"
MANIFEST_NAME="$APP_NAME.json"

# Build universal binary for both Intel and Apple Silicon
echo "Building vidown-native for macOS (Universal Binary)..."
cd "$(dirname "$0")/.."

echo "  → Building for Apple Silicon (arm64)..."
GOOS=darwin GOARCH=arm64 go build -o vidown-native-arm64 cmd/vidown-native/main.go

echo "  → Building for Intel (amd64)..."
GOOS=darwin GOARCH=amd64 go build -o vidown-native-amd64 cmd/vidown-native/main.go

echo "  → Creating universal binary..."
lipo -create -output vidown-native vidown-native-arm64 vidown-native-amd64

# Clean up architecture-specific binaries
rm vidown-native-arm64 vidown-native-amd64

echo "  → Packaging as macOS app bundle..."
# Create .app bundle structure
APP_BUNDLE="vidown-native.app"
rm -rf "$APP_BUNDLE"
mkdir -p "$APP_BUNDLE/Contents/MacOS"
mkdir -p "$APP_BUNDLE/Contents/Resources"

# Move binary into bundle
mv vidown-native "$APP_BUNDLE/Contents/MacOS/"
chmod +x "$APP_BUNDLE/Contents/MacOS/vidown-native"

# Create Info.plist
cat > "$APP_BUNDLE/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>vidown-native</string>
    <key>CFBundleIdentifier</key>
    <string>com.vidown.native</string>
    <key>CFBundleName</key>
    <string>Vidown Native</string>
    <key>CFBundleVersion</key>
    <string>1.0.0</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0.0</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>LSUIElement</key>
    <true/>
</dict>
</plist>
PLIST

# Get absolute path to binary inside .app
BINARY_PATH="$(pwd)/$APP_BUNDLE/Contents/MacOS/vidown-native"
echo "✓ App bundle created: $(pwd)/$APP_BUNDLE"
lipo -info "$BINARY_PATH"

# Create manifest from template
MANIFEST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
mkdir -p "$MANIFEST_DIR"

cat > "$MANIFEST_DIR/$MANIFEST_NAME" <<EOF
{
  "name": "$APP_NAME",
  "description": "Vidown Native Companion for HLS/DASH downloads",
  "path": "$BINARY_PATH",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$EXTENSION_ID/"
  ]
}
EOF

echo "✓ Installed to: $MANIFEST_DIR/$MANIFEST_NAME"
echo "✓ Binary path: $BINARY_PATH"
echo ""
echo "Test with: echo '{\"type\":\"hello\"}' | $BINARY_PATH"
