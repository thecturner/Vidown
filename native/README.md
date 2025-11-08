# Vidown Native Messaging Host

Native companion app for Vidown browser extension. Handles HLS/DASH downloads, ffmpeg conversions, and audio+video merging.

## Features

- **HLS (m3u8) Downloads**: Parse master playlist, select best variant, download segments, concatenate with ffmpeg
- **DASH (MPD) Downloads**: Parse MPD manifest, download video/audio tracks separately, merge with ffmpeg
- **FFmpeg Conversions**: Convert videos to MP4/MKV/WebM with configurable codecs
- **Audio+Video Merging**: Combine separate audio and video tracks
- **Subtitle Muxing**: Embed subtitles into video files
- **Progress Streaming**: Real-time download progress sent to extension

## Requirements

- **Node.js** 16.0.0 or higher
- **ffmpeg** (install via `brew install ffmpeg`)

## Installation

1. Navigate to the `native/` directory
2. Run the installer:
   ```bash
   ./install.sh
   ```
3. Enter your Vidown extension ID when prompted
   - Find it at `chrome://extensions/`
   - Enable "Developer mode" to see extension IDs
4. Restart Chrome

## Testing

1. Open Vidown extension
2. Go to **Settings** tab
3. Click **Test Connection**
4. Should see "Connected" status

## Message Protocol

### Download Request
```json
{
  "cmd": "download",
  "id": "job-123",
  "mode": "hls|dash|http",
  "url": "https://example.com/video.m3u8",
  "headers": {
    "Cookie": "session=abc123"
  },
  "convert": {
    "container": "mp4",
    "codec": "copy|h264|hevc",
    "audio": "copy|aac|opus|mp3"
  },
  "mergeAV": true,
  "muxSubtitles": false
}
```

### Progress Update
```json
{
  "event": "progress",
  "id": "job-123",
  "bytesReceived": 1234567,
  "totalBytes": 9876543,
  "speedBps": 4200000,
  "etaSec": 2
}
```

### Completion
```json
{
  "event": "done",
  "id": "job-123",
  "path": "/var/folders/tmp/vidown-1234.mp4"
}
```

### Error
```json
{
  "event": "error",
  "id": "job-123",
  "error": "HTTP 404"
}
```

## Architecture

- **vidown-native.js**: Main entry point, handles Native Messaging protocol (stdin/stdout)
- **hls-downloader.js**: HLS stream parser and downloader
- **dash-downloader.js**: DASH manifest parser and downloader
- **ffmpeg-wrapper.js**: FFmpeg operations (convert, merge, extract, mux)

## Troubleshooting

### "Could not connect to native app"

1. Check installation:
   ```bash
   ls -la /usr/local/bin/vidown-native
   ls -la ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/com.vidown.native.json
   ```

2. Verify manifest JSON:
   ```bash
   cat ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/com.vidown.native.json
   ```
   - Check that `allowed_origins` contains your extension ID

3. Test manually:
   ```bash
   echo '{"cmd":"ping"}' | /usr/local/bin/vidown-native
   ```
   - Should receive `{"event":"pong"}`

4. Check Chrome logs:
   - Open `chrome://extensions/`
   - Click "service worker" link under Vidown
   - Look for Native Messaging errors

### "ffmpeg command not found"

Install ffmpeg:
```bash
brew install ffmpeg
```

## Uninstallation

```bash
sudo rm /usr/local/bin/vidown-native
sudo rm -rf /usr/local/lib/vidown-native
rm ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/com.vidown.native.json
```

## Development

Run native host in standalone mode for testing:
```bash
node vidown-native.js
```

Then send JSON messages via stdin (length-prefixed):
```javascript
const msg = { cmd: 'ping' };
const json = JSON.stringify(msg);
const buffer = Buffer.from(json, 'utf8');
const length = Buffer.alloc(4);
length.writeUInt32LE(buffer.length, 0);
process.stdout.write(length);
process.stdout.write(buffer);
```
