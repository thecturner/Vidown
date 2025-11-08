# Vidown - Video Downloader

A Chrome extension that detects and downloads videos from web pages with smart format detection and automatic conversion.

## Features

- **Dual Detection Methods**
  - Network monitoring for video file requests
  - DOM parsing for `<video>` elements
  - Real-time blob URL detection

- **Smart Downloads**
  - Shows video size and format before downloading
  - Automatic conversion to MP4 for non-MP4 formats
  - Progress tracking with speed indicators
  - Download history with location and size tracking

- **Configurable Options**
  - Custom download location
  - Auto-convert toggle
  - Badge display settings
  - History limit configuration

## Installation

### From Source

1. Clone this repository:
   ```bash
   git clone https://github.com/thecturner/Vidown.git
   ```

2. Open Chrome and navigate to `chrome://extensions/`

3. Enable "Developer mode" in the top right

4. Click "Load unpacked"

5. Select the `Vidown` directory

## Usage

1. **Detect Videos**
   - Navigate to any page with videos
   - Extension badge shows count of detected videos
   - Click the extension icon to view available videos

2. **Download Videos**
   - Click download button next to any detected video
   - Progress bar shows download status
   - Videos are automatically converted to MP4 if needed

3. **View History**
   - Recent downloads appear in the popup
   - Shows filename, size, location, and timestamp

4. **Configure Settings**
   - Right-click extension icon → Options
   - Set download folder, conversion preferences, and more

## Supported Formats

### Direct Download
- MP4, MOV, WebM, AVI, WMV, FLV, MKV, M4V, 3GP

### Streaming (Detected)
- HLS (.m3u8)
- DASH (.mpd)

### Auto-Conversion
Non-MP4 videos are automatically converted using FFmpeg.wasm with:
- H.264 codec
- AAC audio (128k bitrate)
- CRF 23 quality
- Fast start flag for streaming

## Architecture

### Components

- **manifest.json** - Chrome extension configuration (Manifest V3)
- **popup.html/js** - Extension popup UI and download logic
- **content_script.js** - DOM video detection and blob interception
- **inject.js** - Lightweight blob URL interceptor
- **service_worker.js** - Background network monitoring
- **options.html/js** - Settings page

### Detection Flow

1. **Network Videos**
   - Service worker monitors `webRequest` for video URLs
   - Captures Content-Length headers for file sizes
   - Updates badge with video count

2. **Blob Videos**
   - Injected script intercepts `URL.createObjectURL()`
   - Reads blob.size property (instant, no I/O)
   - Forwards metadata to service worker

3. **DOM Videos**
   - Content script queries for `<video>` elements
   - Extracts source URLs and metadata
   - Returns dimensions, duration, and sources

## Performance

The extension is designed for minimal performance impact:

- **Passive monitoring** - No active scanning until popup opens
- **Lightweight interception** - Only reads blob.size (instant)
- **Async messaging** - Doesn't block blob creation
- **Selective tracking** - Only video blobs > 512KB

## Permissions

- `scripting` - Inject content scripts for video detection
- `activeTab` - Access current tab for DOM parsing
- `storage` - Save settings and download history
- `webRequest` - Monitor network requests for videos
- `webNavigation` - Detect page navigations
- `downloads` - Download videos
- `<all_urls>` - Detect videos on any website

## Development

### Structure

```
Vidown/
├── manifest.json          # Extension configuration
├── popup.html            # Popup UI
├── popup.js              # Popup logic
├── options.html          # Settings page UI
├── options.js            # Settings logic
├── content_script.js     # DOM detection
├── inject.js             # Blob interceptor
└── service_worker.js     # Background monitoring
```

### Building

No build process required. The extension runs directly from source files.

### Testing

1. Load extension in Chrome
2. Navigate to test pages (YouTube, Vimeo, etc.)
3. Check badge count and popup display
4. Test downloads and conversions

## Known Limitations

- Network monitoring only detects direct video file URLs
- FFmpeg.wasm uses H.264 (not H.265/HEVC)
- CORS restrictions may prevent some downloads
- HLS/DASH streams detected but not auto-downloaded

## License

MIT License - See LICENSE file for details

## Version History

- **1.5** - Optimized blob detection performance
- **1.4** - Performance improvements
- **1.3** - Added blob URL interception
- **1.2** - Added options page
- **1.1** - Enhanced download buttons
- **1.0** - Initial release

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
