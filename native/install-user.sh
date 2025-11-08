#!/bin/bash
# install-user.sh - Install Vidown Native Messaging Host (user-space, no sudo)

set -e

echo "=== Vidown Native Messaging Host Installer (User-Space) ==="
echo

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js is not installed."
    echo "Please install Node.js from https://nodejs.org/"
    exit 1
fi

echo "Node.js version: $(node --version)"

# Check for ffmpeg
if ! command -v ffmpeg &> /dev/null; then
    echo "WARNING: ffmpeg is not installed."
    echo "HLS/DASH downloads and conversions will not work without ffmpeg."
    echo "Install with: brew install ffmpeg"
    echo
fi

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Extension ID
EXT_ID="aigaiddilbifffjcgfocgiaceflchjdn"

# Install location in user's home
INSTALL_DIR="$HOME/.local/share/vidown-native"
BIN_DIR="$HOME/.local/bin"

# Create directories
mkdir -p "$INSTALL_DIR"
mkdir -p "$BIN_DIR"

echo "Installing to: $INSTALL_DIR"

# Copy all files
cp vidown-native.js "$INSTALL_DIR/"
cp hls-downloader.js "$INSTALL_DIR/"
cp dash-downloader.js "$INSTALL_DIR/"
cp ffmpeg-wrapper.js "$INSTALL_DIR/"
cp -r node_modules "$INSTALL_DIR/"
cp package.json "$INSTALL_DIR/"

# Create wrapper script in bin
cat > "$BIN_DIR/vidown-native" << 'WRAPPER'
#!/bin/bash
exec node "$HOME/.local/share/vidown-native/vidown-native.js" "$@"
WRAPPER

chmod +x "$BIN_DIR/vidown-native"

# Update manifest with correct path and extension ID
cat > "$INSTALL_DIR/com.vidown.native.json" << EOF
{
  "name": "com.vidown.native",
  "description": "Vidown Native Messaging Host",
  "path": "$BIN_DIR/vidown-native",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$EXT_ID/"
  ]
}
EOF

# Install manifest for Chrome
CHROME_MANIFEST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
mkdir -p "$CHROME_MANIFEST_DIR"
cp "$INSTALL_DIR/com.vidown.native.json" "$CHROME_MANIFEST_DIR/com.vidown.native.json"

echo
echo "=== Installation Complete ==="
echo
echo "Installed to: $INSTALL_DIR"
echo "Executable: $BIN_DIR/vidown-native"
echo "Manifest: $CHROME_MANIFEST_DIR/com.vidown.native.json"
echo
echo "To test the installation:"
echo "  1. Restart Chrome"
echo "  2. Open Vidown extension"
echo "  3. Go to Settings tab"
echo "  4. Click 'Test Connection'"
echo
echo "Manual test command:"
echo "  echo '{\"cmd\":\"ping\"}' | $BIN_DIR/vidown-native"
echo
