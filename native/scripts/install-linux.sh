#!/usr/bin/env bash
set -e

EXTENSION_ID="aigaiddilbifffjcgfocgiaceflchjdn"
APP_NAME="com.vidown.native"
MANIFEST_NAME="$APP_NAME.json"

# Build binary
echo "Building vidown-native for Linux..."
cd "$(dirname "$0")/.."
go build -o vidown-native cmd/vidown-native/main.go

# Get absolute path to binary
BINARY_PATH="$(pwd)/vidown-native"
echo "Binary: $BINARY_PATH"

# Create manifest from template
MANIFEST_DIR="$HOME/.config/google-chrome/NativeMessagingHosts"
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
