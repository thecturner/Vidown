// dash-downloader.js - DASH (MPD) stream downloader

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { parseManifest } = require('mpd-parser');
const { spawn } = require('child_process');

async function downloadDASH(mpdUrl, headers, onProgress) {
  console.error('[DASH] Starting download:', mpdUrl);

  // Fetch MPD manifest
  const mpdContent = await fetchText(mpdUrl, headers);
  const manifest = parseManifest(mpdContent, { manifestUri: mpdUrl });

  // Select best video and audio adaptation sets
  const videoSet = selectBestVideo(manifest);
  const audioSet = selectBestAudio(manifest);

  if (!videoSet) {
    throw new Error('No video adaptation set found');
  }

  console.error('[DASH] Video:', videoSet.id, 'Audio:', audioSet?.id || 'none');

  // Download video segments
  const tmpDir = path.join(require('os').tmpdir(), `vidown-dash-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const videoPath = await downloadAdaptationSet(videoSet, tmpDir, 'video', headers, onProgress);
  let audioPath = null;

  if (audioSet) {
    audioPath = await downloadAdaptationSet(audioSet, tmpDir, 'audio', headers, () => {});
  }

  // Merge video and audio
  const outputPath = path.join(require('os').tmpdir(), `vidown-dash-${Date.now()}.mp4`);

  if (audioPath) {
    await mergeVideoAudio(videoPath, audioPath, outputPath);
    fs.unlinkSync(videoPath);
    fs.unlinkSync(audioPath);
  } else {
    // Video only
    fs.renameSync(videoPath, outputPath);
  }

  fs.rmdirSync(tmpDir);

  console.error('[DASH] Download complete:', outputPath);
  return outputPath;
}

async function fetchText(url, headers) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    protocol.get(url, { headers }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function selectBestVideo(manifest) {
  const videoSets = manifest.playlists.filter(p => p.attributes.CODECS?.startsWith('avc') || p.attributes.CODECS?.startsWith('hvc'));
  if (videoSets.length === 0) return null;

  // Sort by bandwidth
  videoSets.sort((a, b) => (b.attributes.BANDWIDTH || 0) - (a.attributes.BANDWIDTH || 0));
  return videoSets[0];
}

function selectBestAudio(manifest) {
  const audioSets = manifest.playlists.filter(p => p.attributes.CODECS?.startsWith('mp4a') || p.attributes.CODECS?.startsWith('opus'));
  if (audioSets.length === 0) return null;

  // Pick first
  return audioSets[0];
}

async function downloadAdaptationSet(adaptationSet, tmpDir, type, headers, onProgress) {
  const segments = adaptationSet.segments || [];
  if (segments.length === 0) {
    throw new Error(`No segments in ${type} adaptation set`);
  }

  console.error(`[DASH] Downloading ${segments.length} ${type} segments`);

  const outputPath = path.join(tmpDir, `${type}.mp4`);
  const writeStream = fs.createWriteStream(outputPath);
  let downloadedBytes = 0;

  for (const segment of segments) {
    const segmentUrl = segment.resolvedUri;
    const bytes = await downloadSegmentToStream(segmentUrl, writeStream, headers);
    downloadedBytes += bytes;
    onProgress({ bytesReceived: downloadedBytes, totalBytes: null });
  }

  writeStream.end();
  await new Promise(resolve => writeStream.on('finish', resolve));

  return outputPath;
}

async function downloadSegmentToStream(url, writeStream, headers) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    let bytes = 0;

    protocol.get(url, { headers }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      res.on('data', chunk => {
        bytes += chunk.length;
        writeStream.write(chunk);
      });

      res.on('end', () => resolve(bytes));
    }).on('error', reject);
  });
}

async function mergeVideoAudio(videoPath, audioPath, outputPath) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-i', videoPath,
      '-i', audioPath,
      '-c', 'copy',
      '-movflags', '+faststart',
      '-y',
      outputPath
    ]);

    ffmpeg.on('error', reject);
    ffmpeg.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });
  });
}

module.exports = { downloadDASH };
