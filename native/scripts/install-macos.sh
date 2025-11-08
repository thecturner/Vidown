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

# Get absolute path to binary
BINARY_PATH="$(pwd)/vidown-native"
echo "✓ Universal binary created: $BINARY_PATH"
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
