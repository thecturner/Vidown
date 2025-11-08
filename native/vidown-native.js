#!/usr/bin/env node
// vidown-native.js - Native messaging host for Vidown

const fs = require('fs');
const path = require('path');
const { downloadHLS } = require('./hls-downloader');
const { downloadDASH } = require('./dash-downloader');
const { convertVideo, mergeAudioVideo } = require('./ffmpeg-wrapper');

// Native Messaging uses stdin/stdout for JSON communication
// Messages are length-prefixed: 4 bytes (uint32 little-endian) + JSON

const activeJobs = new Map();

// Read a message from stdin
function readMessage() {
  return new Promise((resolve) => {
    const lengthBuffer = Buffer.alloc(4);
    process.stdin.read(4, (err, bytesRead, buf) => {
      if (err || bytesRead < 4) {
        resolve(null);
        return;
      }

      const length = buf.readUInt32LE(0);
      const messageBuffer = Buffer.alloc(length);

      process.stdin.read(length, (err, bytesRead, buf) => {
        if (err || bytesRead < length) {
          resolve(null);
          return;
        }

        try {
          const message = JSON.parse(buf.toString('utf8'));
          resolve(message);
        } catch (parseErr) {
          sendMessage({ event: 'error', error: `Parse error: ${parseErr.message}` });
          resolve(null);
        }
      });
    });
  });
}

// Send a message to stdout
function sendMessage(msg) {
  const json = JSON.stringify(msg);
  const buffer = Buffer.from(json, 'utf8');
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32LE(buffer.length, 0);

  process.stdout.write(lengthBuffer);
  process.stdout.write(buffer);
}

// Handle download command
async function handleDownload(msg) {
  const { id, mode, url, headers, convert, mergeAV, muxSubtitles } = msg;

  if (!id || !url) {
    sendMessage({ event: 'error', id, error: 'Missing id or url' });
    return;
  }

  const job = {
    id,
    mode,
    url,
    headers: headers || {},
    convert,
    mergeAV,
    muxSubtitles,
    bytesReceived: 0,
    totalBytes: null,
    speedBps: 0,
    etaSec: null,
    startTime: Date.now(),
    lastUpdate: Date.now()
  };

  activeJobs.set(id, job);

  try {
    let tmpPath;

    // Download based on mode
    if (mode === 'hls') {
      tmpPath = await downloadHLS(url, headers, (progress) => {
        updateProgress(job, progress);
      });
    } else if (mode === 'dash') {
      tmpPath = await downloadDASH(url, headers, (progress) => {
        updateProgress(job, progress);
      });
    } else if (mode === 'http') {
      tmpPath = await downloadHTTP(url, headers, (progress) => {
        updateProgress(job, progress);
      });
    } else {
      throw new Error(`Unsupported mode: ${mode}`);
    }

    // Post-process: conversion, merging, etc.
    let finalPath = tmpPath;

    if (convert && convert.container !== 'copy') {
      const convertedPath = tmpPath.replace(/\.\w+$/, `.${convert.container}`);
      await convertVideo(tmpPath, convertedPath, convert);
      fs.unlinkSync(tmpPath); // Remove temp file
      finalPath = convertedPath;
    }

    // Done
    sendMessage({ event: 'done', id, path: finalPath });
    activeJobs.delete(id);
  } catch (err) {
    sendMessage({ event: 'error', id, error: err.message });
    activeJobs.delete(id);
  }
}

// Update progress
function updateProgress(job, progress) {
  const { bytesReceived, totalBytes } = progress;

  job.bytesReceived = bytesReceived;
  job.totalBytes = totalBytes || job.totalBytes;

  const now = Date.now();
  const dt = (now - job.lastUpdate) / 1000;

  if (dt > 0.5) {
    // Calculate speed
    const dBytes = bytesReceived - (job.lastBytesReceived || 0);
    job.speedBps = Math.floor(dBytes / dt);
    job.lastBytesReceived = bytesReceived;
    job.lastUpdate = now;

    // Calculate ETA
    if (job.totalBytes && job.speedBps > 0) {
      const remaining = job.totalBytes - bytesReceived;
      job.etaSec = Math.ceil(remaining / job.speedBps);
    }

    // Send progress update
    sendMessage({
      event: 'progress',
      id: job.id,
      bytesReceived: job.bytesReceived,
      totalBytes: job.totalBytes,
      speedBps: job.speedBps,
      etaSec: job.etaSec
    });
  }
}

// Simple HTTP download
async function downloadHTTP(url, headers, onProgress) {
  const https = require('https');
  const http = require('http');
  const tmpPath = path.join(require('os').tmpdir(), `vidown-${Date.now()}.tmp`);

  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const writeStream = fs.createWriteStream(tmpPath);
    let bytesReceived = 0;
    let totalBytes = null;

    const req = protocol.get(url, { headers }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      totalBytes = parseInt(res.headers['content-length'], 10) || null;

      res.on('data', (chunk) => {
        bytesReceived += chunk.length;
        onProgress({ bytesReceived, totalBytes });
      });

      res.pipe(writeStream);

      writeStream.on('finish', () => {
        writeStream.close();
        resolve(tmpPath);
      });
    });

    req.on('error', (err) => {
      fs.unlinkSync(tmpPath);
      reject(err);
    });
  });
}

// Main loop
async function main() {
  console.error('[Vidown Native] Starting...');

  // Set stdin to binary mode
  process.stdin.setEncoding(null);
  process.stdin.pause();

  while (true) {
    const msg = await readMessage();
    if (!msg) break;

    console.error('[Vidown Native] Received:', msg.cmd);

    if (msg.cmd === 'download') {
      handleDownload(msg).catch((err) => {
        console.error('[Vidown Native] Error:', err);
      });
    } else if (msg.cmd === 'ping') {
      sendMessage({ event: 'pong' });
    } else {
      sendMessage({ event: 'error', error: `Unknown command: ${msg.cmd}` });
    }
  }

  console.error('[Vidown Native] Exiting...');
}

// Handle errors
process.on('uncaughtException', (err) => {
  console.error('[Vidown Native] Uncaught exception:', err);
  process.exit(1);
});

process.on('SIGINT', () => {
  console.error('[Vidown Native] Received SIGINT, exiting...');
  process.exit(0);
});

main();
