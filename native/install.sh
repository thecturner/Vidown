#!/bin/bash
# install.sh - Install Vidown Native Messaging Host

set -e

echo "=== Vidown Native Messaging Host Installer ==="
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

# Install dependencies
echo "Installing npm dependencies..."
npm install

# Get extension ID
echo
echo "Enter your Vidown Chrome extension ID:"
echo "(Find it at chrome://extensions/ - it looks like 'abcdefghijklmnopqrstuvwxyz123456')"
read -p "Extension ID: " EXT_ID

if [ -z "$EXT_ID" ]; then
    echo "ERROR: Extension ID cannot be empty"
    exit 1
fi

# Update manifest with extension ID
echo "Updating manifest..."
sed "s/EXTENSION_ID_PLACEHOLDER/$EXT_ID/g" com.vidown.native.json > com.vidown.native.tmp.json

# Copy executable to /usr/local/bin
echo "Installing executable..."
sudo cp vidown-native.js /usr/local/bin/vidown-native
sudo chmod +x /usr/local/bin/vidown-native

# Copy node_modules to /usr/local/lib/vidown-native
echo "Installing node_modules..."
sudo mkdir -p /usr/local/lib/vidown-native
sudo cp -r node_modules /usr/local/lib/vidown-native/
sudo cp hls-downloader.js /usr/local/lib/vidown-native/
sudo cp dash-downloader.js /usr/local/lib/vidown-native/
sudo cp ffmpeg-wrapper.js /usr/local/lib/vidown-native/

# Update paths in vidown-native
echo "Updating module paths..."
sudo sed -i '' "s|require('./hls-downloader')|require('/usr/local/lib/vidown-native/hls-downloader')|g" /usr/local/bin/vidown-native
sudo sed -i '' "s|require('./dash-downloader')|require('/usr/local/lib/vidown-native/dash-downloader')|g" /usr/local/bin/vidown-native
sudo sed -i '' "s|require('./ffmpeg-wrapper')|require('/usr/local/lib/vidown-native/ffmpeg-wrapper')|g" /usr/local/bin/vidown-native

# Install manifest for Chrome
CHROME_MANIFEST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
mkdir -p "$CHROME_MANIFEST_DIR"
cp com.vidown.native.tmp.json "$CHROME_MANIFEST_DIR/com.vidown.native.json"
rm com.vidown.native.tmp.json

echo
echo "=== Installation Complete ==="
echo
echo "Native messaging host installed to: /usr/local/bin/vidown-native"
echo "Manifest installed to: $CHROME_MANIFEST_DIR/com.vidown.native.json"
echo
echo "To test the installation:"
echo "  1. Restart Chrome"
echo "  2. Open Vidown extension"
echo "  3. Go to Settings tab"
echo "  4. Click 'Test Connection'"
echo
echo "If you see errors, check Chrome's logs at chrome://extensions/"
echo
