// ffmpeg-wrapper.js - FFmpeg operations wrapper

const { spawn } = require('child_process');

async function convertVideo(inputPath, outputPath, options) {
  const { container, codec, audio } = options;

  console.error('[FFmpeg] Converting:', inputPath, '->', outputPath);

  const args = ['-i', inputPath];

  // Video codec
  if (codec === 'copy') {
    args.push('-c:v', 'copy');
  } else if (codec === 'h264') {
    args.push('-c:v', 'libx264', '-crf', '23', '-preset', 'medium');
  } else if (codec === 'hevc') {
    args.push('-c:v', 'libx265', '-crf', '28', '-preset', 'medium');
  }

  // Audio codec
  if (audio === 'copy') {
    args.push('-c:a', 'copy');
  } else if (audio === 'aac') {
    args.push('-c:a', 'aac', '-b:a', '128k');
  } else if (audio === 'opus') {
    args.push('-c:a', 'libopus', '-b:a', '128k');
  } else if (audio === 'mp3') {
    args.push('-c:a', 'libmp3lame', '-b:a', '192k');
  }

  // Container-specific options
  if (container === 'mp4') {
    args.push('-movflags', '+faststart');
  }

  args.push('-y', outputPath);

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', args);

    ffmpeg.stderr.on('data', (data) => {
      // Parse progress if needed
      console.error('[FFmpeg]', data.toString().trim());
    });

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

async function mergeAudioVideo(videoPath, audioPath, outputPath) {
  console.error('[FFmpeg] Merging A+V:', videoPath, audioPath, '->', outputPath);

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

async function extractAudio(inputPath, outputPath, format = 'mp3') {
  console.error('[FFmpeg] Extracting audio:', inputPath, '->', outputPath);

  const codecMap = {
    'mp3': ['libmp3lame', '192k'],
    'aac': ['aac', '128k'],
    'opus': ['libopus', '128k'],
    'm4a': ['aac', '128k']
  };

  const [codec, bitrate] = codecMap[format] || codecMap.mp3;

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-i', inputPath,
      '-vn',
      '-c:a', codec,
      '-b:a', bitrate,
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

async function muxSubtitles(videoPath, subtitlePath, outputPath) {
  console.error('[FFmpeg] Muxing subtitles:', videoPath, subtitlePath, '->', outputPath);

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-i', videoPath,
      '-i', subtitlePath,
      '-c', 'copy',
      '-c:s', 'mov_text',
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

module.exports = {
  convertVideo,
  mergeAudioVideo,
  extractAudio,
  muxSubtitles
};
