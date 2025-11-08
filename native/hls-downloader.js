// hls-downloader.js - HLS (m3u8) stream downloader

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const Parser = require('m3u8-parser').Parser;
const { spawn } = require('child_process');

async function downloadHLS(masterUrl, headers, onProgress) {
  console.error('[HLS] Starting download:', masterUrl);

  // Fetch master playlist
  const masterContent = await fetchText(masterUrl, headers);
  const parser = new Parser();
  parser.push(masterContent);
  parser.end();
  const manifest = parser.manifest;

  // Choose best variant
  let mediaUrl = masterUrl;
  if (manifest.playlists && manifest.playlists.length > 0) {
    // Sort by bandwidth, pick highest
    const sorted = manifest.playlists.sort((a, b) => (b.attributes?.BANDWIDTH || 0) - (a.attributes?.BANDWIDTH || 0));
    const best = sorted[0];
    mediaUrl = resolveUrl(masterUrl, best.uri);
    console.error('[HLS] Selected variant:', best.attributes?.BANDWIDTH, 'bps');
  }

  // Fetch media playlist
  const mediaContent = await fetchText(mediaUrl, headers);
  const mediaParser = new Parser();
  mediaParser.push(mediaContent);
  mediaParser.end();
  const mediaManifest = mediaParser.manifest;

  const segments = mediaManifest.segments || [];
  if (segments.length === 0) {
    throw new Error('No segments found in HLS stream');
  }

  console.error('[HLS] Found', segments.length, 'segments');

  // Download all segments
  const tmpDir = path.join(require('os').tmpdir(), `vidown-hls-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const segmentPaths = [];
  let totalBytes = 0;
  let downloadedBytes = 0;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const segmentUrl = resolveUrl(mediaUrl, segment.uri);
    const segmentPath = path.join(tmpDir, `segment-${i.toString().padStart(5, '0')}.ts`);

    const bytes = await downloadSegment(segmentUrl, segmentPath, headers);
    downloadedBytes += bytes;
    totalBytes = downloadedBytes; // Estimate

    onProgress({
      bytesReceived: downloadedBytes,
      totalBytes: null // Unknown for HLS
    });

    segmentPaths.push(segmentPath);
  }

  // Concatenate segments using ffmpeg
  console.error('[HLS] Concatenating segments...');
  const outputPath = path.join(require('os').tmpdir(), `vidown-hls-${Date.now()}.mp4`);
  await concatenateSegments(segmentPaths, outputPath);

  // Clean up temp directory
  segmentPaths.forEach(p => fs.unlinkSync(p));
  fs.rmdirSync(tmpDir);

  console.error('[HLS] Download complete:', outputPath);
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

async function downloadSegment(url, outputPath, headers) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const writeStream = fs.createWriteStream(outputPath);
    let bytes = 0;

    protocol.get(url, { headers }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      res.on('data', chunk => bytes += chunk.length);
      res.pipe(writeStream);

      writeStream.on('finish', () => {
        writeStream.close();
        resolve(bytes);
      });
    }).on('error', reject);
  });
}

async function concatenateSegments(segmentPaths, outputPath) {
  // Create concat file
  const concatFile = outputPath + '.txt';
  const concatContent = segmentPaths.map(p => `file '${p}'`).join('\n');
  fs.writeFileSync(concatFile, concatContent);

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-f', 'concat',
      '-safe', '0',
      '-i', concatFile,
      '-c', 'copy',
      '-movflags', '+faststart',
      '-y',
      outputPath
    ]);

    ffmpeg.on('error', reject);
    ffmpeg.on('exit', (code) => {
      fs.unlinkSync(concatFile);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });
  });
}

function resolveUrl(baseUrl, relativeUrl) {
  if (relativeUrl.startsWith('http')) return relativeUrl;
  const base = new URL(baseUrl);
  return new URL(relativeUrl, base).toString();
}

module.exports = { downloadHLS };
