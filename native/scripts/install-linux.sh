#!/usr/bin/env bash
set -e

EXTENSION_ID="aigaiddilbifffjcgfocgiaceflchjdn"
APP_NAME="com.vidown.native"
MANIFEST_NAME="$APP_NAME.json"

# Build binary for Linux
echo "Building vidown-native for Linux..."
cd "$(dirname "$0")/.."

# Detect architecture
ARCH=$(uname -m)
if [ "$ARCH" = "x86_64" ]; then
    GOARCH="amd64"
elif [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
    GOARCH="arm64"
else
    echo "Unsupported architecture: $ARCH"
    exit 1
fi

echo "  → Building for $ARCH (GOARCH=$GOARCH)..."
GOOS=linux GOARCH=$GOARCH go build -o vidown-native cmd/vidown-native/main.go

# Get absolute path to binary
BINARY_PATH="$(pwd)/vidown-native"
echo "✓ Binary created: $BINARY_PATH"

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
