import express from 'express';
import multer from 'multer';
import { spawn, exec } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Setup directories
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const TEMP_DIR = path.join(__dirname, 'temp');
const EXPORTS_DIR = path.join(__dirname, 'exports');

for (const dir of [UPLOADS_DIR, TEMP_DIR, EXPORTS_DIR]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const cleanName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}_${cleanName}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 * 1024 } // 50GB max
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/temp', express.static(TEMP_DIR));
app.use('/exports', express.static(EXPORTS_DIR));

// Active encoding jobs
const activeJobs = new Map();

/**
 * Universal video path resolver:
 * Seamlessly resolves absolute paths, /exports/ URLs, /temp/ URLs, or local filenames.
 */
function resolveVideoPath(targetPath) {
  if (!targetPath) return null;
  const decoded = decodeURIComponent(targetPath.trim());
  if (fs.existsSync(decoded)) return decoded;

  if (decoded.startsWith('/exports/')) {
    const p = path.join(EXPORTS_DIR, path.basename(decoded));
    if (fs.existsSync(p)) return p;
  }
  if (decoded.startsWith('/temp/')) {
    const p = path.join(TEMP_DIR, path.basename(decoded));
    if (fs.existsSync(p)) return p;
  }
  if (decoded.startsWith('/uploads/')) {
    const p = path.join(UPLOADS_DIR, path.basename(decoded));
    if (fs.existsSync(p)) return p;
  }

  // Check by base filename in known storage folders
  const base = path.basename(decoded);
  for (const dir of [EXPORTS_DIR, UPLOADS_DIR, TEMP_DIR]) {
    const p = path.join(dir, base);
    if (fs.existsSync(p)) return p;
  }

  return null;
}

/**
 * Execute a command and return promise with stdout
 */
function execPromise(command) {
  return new Promise((resolve, reject) => {
    exec(command, { maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        return reject(new Error(stderr || stdout || error.message));
      }
      resolve(stdout);
    });
  });
}

/**
 * Get video metadata using ffprobe
 */
async function probeVideo(filePath) {
  const resolved = resolveVideoPath(filePath);
  if (!resolved) {
    throw new Error(`File does not exist: ${filePath}`);
  }

  const cmd = `ffprobe -v quiet -print_format json -show_format -show_streams "${resolved}"`;
  const output = await execPromise(cmd);
  const data = JSON.parse(output);

  const videoStream = data.streams?.find(s => s.codec_type === 'video');
  const audioStreams = data.streams?.filter(s => s.codec_type === 'audio') || [];
  const subtitleStreams = data.streams?.filter(s => s.codec_type === 'subtitle') || [];

  if (!videoStream) {
    throw new Error('No video stream found in file');
  }

  // Calculate FPS
  let fps = 24;
  if (videoStream.r_frame_rate) {
    const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
    if (den && den > 0) fps = Math.round((num / den) * 100) / 100;
  }

  const duration = parseFloat(data.format?.duration || videoStream.duration || 0);
  const width = parseInt(videoStream.width, 10);
  const height = parseInt(videoStream.height, 10);

  return {
    path: resolved,
    filename: path.basename(resolved),
    format: data.format?.format_name,
    duration,
    durationFormatted: formatDuration(duration),
    size: parseInt(data.format?.size || 0, 10),
    sizeFormatted: formatBytes(parseInt(data.format?.size || 0, 10)),
    bitrate: parseInt(data.format?.bit_rate || 0, 10),
    video: {
      codec: videoStream.codec_name,
      profile: videoStream.profile,
      width,
      height,
      aspectRatio: videoStream.display_aspect_ratio || `${width}:${height}`,
      fps,
      pixFmt: videoStream.pix_fmt
    },
    audioTracks: audioStreams.map((a, i) => ({
      index: a.index,
      codec: a.codec_name,
      channels: a.channels,
      language: a.tags?.language || `Track ${i + 1}`,
      title: a.tags?.title || `${a.codec_name.toUpperCase()} ${a.channels}ch`
    })),
    subtitles: subtitleStreams.map((s, i) => ({
      index: s.index,
      codec: s.codec_name,
      language: s.tags?.language || `Sub ${i + 1}`,
      title: s.tags?.title || s.codec_name
    }))
  };
}

function formatDuration(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return `${h > 0 ? `${h}:` : ''}${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Build FFmpeg filtergraph for text removal boxes
 */
function buildFiltergraph(boxes, videoWidth, videoHeight, globalAlgorithm = 'delogo', blurSigma = 12) {
  if (!boxes || boxes.length === 0) {
    return null;
  }

  // Check for smart crop mode
  if (globalAlgorithm === 'crop' || boxes.some(b => b.algorithm === 'crop')) {
    let cropH = videoHeight;
    for (const b of boxes) {
      const by = Math.floor(b.y || 0);
      if (by > videoHeight * 0.4) {
        cropH = Math.min(cropH, by);
      }
    }
    if (cropH % 2 !== 0) cropH -= 1;
    cropH = Math.max(120, cropH);
    return `crop=${videoWidth}:${cropH}:0:0`;
  }

  // Normalize each box to ensure it's inside video bounds and dimensions are even integers
  const validBoxes = boxes.map(b => {
    let x = Math.max(0, Math.floor(b.x));
    let y = Math.max(0, Math.floor(b.y));
    let w = Math.floor(b.w);
    let h = Math.floor(b.h);

    // Make dimensions even for filter compatibility
    if (w % 2 !== 0) w += 1;
    if (h % 2 !== 0) h += 1;

    // Clamp within bounds
    if (x + w > videoWidth) w = videoWidth - x;
    if (y + h > videoHeight) h = videoHeight - y;

    // Minimum size for filters
    w = Math.max(4, w);
    h = Math.max(4, h);

    const algo = b.algorithm || globalAlgorithm || 'delogo';
    return { x, y, w, h, algo };
  }).filter(b => b.w >= 4 && b.h >= 4);

  if (validBoxes.length === 0) return null;

  // Build filter list
  const filterParts = [];
  const hasBlur = validBoxes.some(b => b.algo === 'blur');

  if (!hasBlur) {
    // Sequential chain of delogo and drawbox filters
    const chain = validBoxes.map(b => {
      if (b.algo === 'letterbox') {
        return `drawbox=x=${b.x}:y=${b.y}:w=${b.w}:h=${b.h}:color=black:t=fill`;
      } else {
        // delogo
        return `delogo=x=${b.x}:y=${b.y}:w=${b.w}:h=${b.h}:show=0`;
      }
    }).join(',');

    return chain;
  }

  // Complex filtergraph when blur is used
  validBoxes.forEach((b, idx) => {
    const isFirst = idx === 0;
    const isLast = idx === validBoxes.length - 1;
    const prevPad = isFirst ? '' : `[tmp${idx - 1}]`;
    const nextPad = isLast ? '' : `[tmp${idx}]`;

    if (b.algo === 'letterbox') {
      filterParts.push(`${prevPad}drawbox=x=${b.x}:y=${b.y}:w=${b.w}:h=${b.h}:color=black:t=fill${nextPad}`);
    } else if (b.algo === 'blur') {
      const splitA = `[sp_a${idx}]`;
      const splitB = `[sp_b${idx}]`;
      const cropPad = `[cr${idx}]`;
      const blurPad = `[bl${idx}]`;

      filterParts.push(`${prevPad}split=2${splitA}${splitB}`);
      filterParts.push(`${splitB}crop=w=${b.w}:h=${b.h}:x=${b.x}:y=${b.y},gblur=sigma=${blurSigma}${cropPad}`);
      filterParts.push(`${splitA}${cropPad}overlay=x=${b.x}:y=${b.y}${nextPad}`);
    } else {
      filterParts.push(`${prevPad}delogo=x=${b.x}:y=${b.y}:w=${b.w}:h=${b.h}:show=0${nextPad}`);
    }
  });

  return filterParts.join(';');
}

/* ========================================================================= */
/* API Routes                                                                */
/* ========================================================================= */

/**
 * Scan standard local directories for quick loading
 */
app.get('/api/local-files', async (req, res) => {
  try {
    const searchDirs = [
      '/home/beast/Videos',
      '/home/beast/Downloads',
      '/home/beast/Desktop',
      UPLOADS_DIR,
      EXPORTS_DIR
    ];

    const results = [];
    const validExts = new Set(['.mp4', '.mkv', '.mov', '.webm', '.avi', '.ts']);

    for (const dir of searchDirs) {
      if (!fs.existsSync(dir)) continue;

      try {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const ext = path.extname(file).toLowerCase();
          if (validExts.has(ext)) {
            const fullPath = path.join(dir, file);
            try {
              const stat = fs.statSync(fullPath);
              if (stat.isFile()) {
                results.push({
                  name: file,
                  path: fullPath,
                  size: formatBytes(stat.size),
                  sizeBytes: stat.size,
                  modified: stat.mtime,
                  directory: path.basename(dir)
                });
              }
            } catch {
              // skip unreadable
            }
          }
        }
      } catch {
        // ignore unreadable dir
      }
    }

    res.json({ files: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Inspect video metadata
 */
app.get('/api/inspect', async (req, res) => {
  const filePath = req.query.path;
  const resolved = resolveVideoPath(filePath);

  if (!resolved) {
    return res.status(404).json({ error: `File not found: ${filePath}` });
  }

  try {
    const meta = await probeVideo(resolved);
    res.json(meta);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Upload video file
 */
app.post('/api/upload', upload.single('video'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No video file provided' });
  }

  try {
    const meta = await probeVideo(req.file.path);
    res.json({
      message: 'Upload successful',
      file: {
        path: req.file.path,
        filename: req.file.filename,
        originalName: req.file.originalname,
        metadata: meta
      }
    });
  } catch (err) {
    res.status(500).json({ error: `File uploaded but metadata probe failed: ${err.message}` });
  }
});

/**
 * Stream video with HTTP 206 Partial Content (Supports scrubbing)
 */
app.get('/api/stream', (req, res) => {
  const filePath = req.query.path;
  const resolved = resolveVideoPath(filePath);

  if (!resolved) {
    return res.status(404).send('Video not found');
  }

  const stat = fs.statSync(resolved);
  const fileSize = stat.size;
  const range = req.headers.range;

  const ext = path.extname(resolved).toLowerCase();
  const mimeType = ext === '.mkv' ? 'video/x-matroska' : ext === '.webm' ? 'video/webm' : 'video/mp4';

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = end - start + 1;
    const file = fs.createReadStream(resolved, { start, end });
    const head = {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': mimeType
    };
    res.writeHead(206, head);
    file.pipe(res);
  } else {
    const head = {
      'Content-Length': fileSize,
      'Content-Type': mimeType,
      'Accept-Ranges': 'bytes'
    };
    res.writeHead(200, head);
    fs.createReadStream(resolved).pipe(res);
  }
});

/**
 * Extract a single frame at a specific timestamp as JPEG
 */
app.get('/api/frame', async (req, res) => {
  const filePath = req.query.path;
  const resolved = resolveVideoPath(filePath);
  const time = parseFloat(req.query.time || 0);

  if (!resolved) {
    return res.status(400).json({ error: 'Invalid video path' });
  }

  const frameFileName = `frame_${Date.now()}_${Math.floor(time * 1000)}.jpg`;
  const framePath = path.join(TEMP_DIR, frameFileName);

  try {
    const cmd = `ffmpeg -ss ${time} -i "${resolved}" -vframes 1 -q:v 2 "${framePath}" -y`;
    await execPromise(cmd);

    res.sendFile(framePath, (err) => {
      fs.unlink(framePath, () => {});
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Generate Before / After Preview for text removal
 */
app.post('/api/preview-filter', async (req, res) => {
  const {
    videoPath,
    timestamp = 0,
    boxes = [],
    globalAlgorithm = 'precision_inpaint',
    blurSigma = 12,
    sensitivity = 65,
    dilation = 2,
    previewMask = false
  } = req.body;

  const resolved = resolveVideoPath(videoPath);
  if (!resolved) {
    return res.status(400).json({ error: `Invalid video path: ${videoPath}` });
  }

  try {
    const meta = await probeVideo(resolved);
    const videoWidth = meta.video.width;
    const videoHeight = meta.video.height;

    const baseName = `preview_${Date.now()}`;
    const origFramePath = path.join(TEMP_DIR, `${baseName}_orig.jpg`);
    const filteredFramePath = path.join(TEMP_DIR, `${baseName}_filtered.jpg`);

    // 1. Extract original frame
    await execPromise(`ffmpeg -ss ${timestamp} -i "${resolved}" -vframes 1 -q:v 2 "${origFramePath}" -y`);

    if (!boxes || boxes.length === 0) {
      fs.copyFileSync(origFramePath, filteredFramePath);
    } else if (['precision_inpaint', 'seamless_clone', 'directional', 'crop'].includes(globalAlgorithm)) {
      // Use Python OpenCV Precision Engine
      const pyBin = path.join(__dirname, 'venv', 'bin', 'python3');
      const scriptPath = path.join(__dirname, 'inpaint_engine.py');
      const maskFlag = previewMask ? '--mask-only' : '';
      const boxesStr = JSON.stringify(boxes);

      const pyCmd = `"${pyBin}" "${scriptPath}" --input "${origFramePath}" --output "${filteredFramePath}" --boxes '${boxesStr}' --sensitivity ${sensitivity} --dilation ${dilation} --algorithm "${globalAlgorithm}" ${maskFlag}`;
      await execPromise(pyCmd);
    } else {
      // Standard FFmpeg filtergraph (delogo, letterbox, blur)
      const filtergraph = buildFiltergraph(boxes, videoWidth, videoHeight, globalAlgorithm, blurSigma);
      if (filtergraph) {
        const filterCmd = `ffmpeg -ss ${timestamp} -i "${resolved}" -vf "${filtergraph}" -vframes 1 -q:v 2 "${filteredFramePath}" -y`;
        await execPromise(filterCmd);
      } else {
        fs.copyFileSync(origFramePath, filteredFramePath);
      }
    }

    res.json({
      originalUrl: `/temp/${path.basename(origFramePath)}`,
      filteredUrl: `/temp/${path.basename(filteredFramePath)}`,
      timestamp,
      videoWidth,
      videoHeight,
      boxesApplied: boxes.length,
      mode: globalAlgorithm
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Start Full Video Text Removal Job
 */
app.post('/api/process-video', async (req, res) => {
  const {
    videoPath,
    boxes = [],
    globalAlgorithm = 'precision_inpaint',
    blurSigma = 12,
    sensitivity = 65,
    dilation = 2,
    qualityMode = 'visually-lossless',
    crfValue = 14,
    startTime = null,
    endTime = null,
    outputName = null
  } = req.body;

  const resolved = resolveVideoPath(videoPath);
  if (!resolved) {
    return res.status(400).json({ error: `Valid input video path required: ${videoPath}` });
  }

  if (!boxes || boxes.length === 0) {
    return res.status(400).json({ error: 'At least one text removal bounding box is required' });
  }

  try {
    const meta = await probeVideo(resolved);
    const videoWidth = meta.video.width;
    const videoHeight = meta.video.height;
    const totalDuration = meta.duration;

    const jobId = `job_${Date.now()}`;
    let filtergraph = null;

    if (globalAlgorithm === 'crop' || boxes.some(b => b.algorithm === 'crop')) {
      // Smart Border Crop: 100% untouched native video quality with zero blur
      let lowestY = videoHeight;
      for (const b of boxes) {
        const by = Math.floor(b.y || 0);
        if (by > videoHeight * 0.4) {
          lowestY = Math.min(lowestY, by);
        }
      }
      if (lowestY % 2 !== 0) lowestY -= 1;
      const cropH = lowestY < videoHeight ? Math.max(120, lowestY) : videoHeight;
      filtergraph = `crop=${videoWidth}:${cropH}:0:0`;
    } else if (['precision_inpaint', 'seamless_clone', 'directional'].includes(globalAlgorithm)) {
      // Extract sample frame to generate 2D precision mask
      const sampleFrame = path.join(TEMP_DIR, `sample_${jobId}.jpg`);
      const tempMaskPath = path.join(TEMP_DIR, `mask_${jobId}.png`);
      const refTime = startTime || 0;

      await execPromise(`ffmpeg -ss ${refTime} -i "${resolved}" -vframes 1 -q:v 2 "${sampleFrame}" -y`);
      
      const pyBin = path.join(__dirname, 'venv', 'bin', 'python3');
      const scriptPath = path.join(__dirname, 'inpaint_engine.py');
      const boxesStr = JSON.stringify(boxes);
      const pyCmd = `"${pyBin}" "${scriptPath}" --input "${sampleFrame}" --output "${tempMaskPath}" --boxes '${boxesStr}' --sensitivity ${sensitivity} --dilation ${dilation} --generate-video-mask`;
      await execPromise(pyCmd);

      // FFmpeg removelogo with single quotes around mask path
      filtergraph = `removelogo='${tempMaskPath}'`;
    } else {
      filtergraph = buildFiltergraph(boxes, videoWidth, videoHeight, globalAlgorithm, blurSigma);
    }

    if (!filtergraph) {
      return res.status(400).json({ error: 'Invalid bounding boxes provided' });
    }

    const ext = path.extname(resolved) || '.mp4';
    const cleanBase = path.basename(resolved, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    const finalFilename = outputName || `${cleanBase}_vido_clean${ext}`;
    const outputPath = path.join(EXPORTS_DIR, finalFilename);

    // Determine CRF
    let crf = 14;
    let preset = 'slow';
    if (qualityMode === 'lossless') {
      crf = 0; // True lossless
      preset = 'slow';
    } else if (qualityMode === 'visually-lossless') {
      crf = 14; // Perceptually lossless
      preset = 'slow';
    } else if (qualityMode === 'balanced') {
      crf = 18;
      preset = 'medium';
    } else if (qualityMode === 'custom') {
      crf = parseInt(crfValue, 10) || 14;
    }

    // Build FFmpeg arguments
    const ffmpegArgs = [];

    // Optional Start Time trim
    if (startTime !== null && startTime !== undefined && startTime > 0) {
      ffmpegArgs.push('-ss', startTime.toString());
    }

    // Input file
    ffmpegArgs.push('-i', resolved);

    // Optional Duration / End Time trim
    if (endTime !== null && endTime !== undefined && endTime > (startTime || 0)) {
      const duration = endTime - (startTime || 0);
      ffmpegArgs.push('-t', duration.toString());
    }

    // Video Filter
    ffmpegArgs.push('-vf', filtergraph);

    // Video Encoding: H.264 high fidelity
    ffmpegArgs.push('-c:v', 'libx264');
    ffmpegArgs.push('-crf', crf.toString());
    ffmpegArgs.push('-preset', preset);
    ffmpegArgs.push('-pix_fmt', 'yuv420p');

    // Audio & Subtitles: DIRECT STREAM COPY (100% Zero-Loss Audio & Subtitles)
    ffmpegArgs.push('-c:a', 'copy');
    ffmpegArgs.push('-c:s', 'copy');

    // Map all streams (preserves multi-language audio, atmos, subtitles)
    ffmpegArgs.push('-map', '0');

    // Progress to stdout
    ffmpegArgs.push('-progress', 'pipe:1');
    ffmpegArgs.push('-nostats');
    ffmpegArgs.push('-y', outputPath);

    // Spawn process
    const proc = spawn('ffmpeg', ffmpegArgs);

    const job = {
      id: jobId,
      inputPath: resolved,
      outputPath,
      outputFilename: finalFilename,
      downloadUrl: `/exports/${finalFilename}`,
      status: 'processing',
      progress: 0,
      fps: 0,
      speed: '0x',
      currentTime: 0,
      totalDuration: (endTime && startTime) ? (endTime - startTime) : totalDuration,
      qualityMode,
      crf,
      startedAt: Date.now(),
      error: null,
      process: proc,
      clients: new Set()
    };

    activeJobs.set(jobId, job);

    // Parse progress
    proc.stdout.on('data', (data) => {
      const text = data.toString();
      const lines = text.split('\n');

      let outTimeSec = null;
      let fps = null;
      let speed = null;

      for (const line of lines) {
        if (line.startsWith('out_time_ms=')) {
          const ms = parseInt(line.split('=')[1], 10);
          if (!isNaN(ms)) outTimeSec = ms / 1000000;
        } else if (line.startsWith('fps=')) {
          fps = parseFloat(line.split('=')[1]);
        } else if (line.startsWith('speed=')) {
          speed = line.split('=')[1].trim();
        } else if (line.startsWith('progress=end')) {
          job.progress = 100;
        }
      }

      if (outTimeSec !== null) {
        job.currentTime = outTimeSec;
        if (job.totalDuration > 0) {
          const pct = Math.min(99.9, Math.max(0, (outTimeSec / job.totalDuration) * 100));
          job.progress = Math.round(pct * 10) / 10;
        }
      }
      if (fps !== null) job.fps = fps;
      if (speed !== null) job.speed = speed;

      broadcastJobUpdate(job);
    });

    proc.stderr.on('data', (data) => {
      const msg = data.toString();
      job.lastLog = msg.slice(-200);
    });

    proc.on('close', (code) => {
      if (code === 0) {
        job.status = 'completed';
        job.progress = 100;
        job.completedAt = Date.now();
        try {
          const stat = fs.statSync(outputPath);
          job.outputSize = stat.size;
          job.outputSizeFormatted = formatBytes(stat.size);
        } catch {}
      } else {
        if (job.status !== 'cancelled') {
          job.status = 'failed';
          job.error = `FFmpeg exited with error code ${code}`;
        }
      }
      broadcastJobUpdate(job);
    });

    proc.on('error', (err) => {
      job.status = 'failed';
      job.error = err.message;
      broadcastJobUpdate(job);
    });

    res.json({
      message: 'Processing started',
      jobId,
      outputFilename: finalFilename
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function broadcastJobUpdate(job) {
  const payload = JSON.stringify({
    id: job.id,
    status: job.status,
    progress: job.progress,
    currentTime: job.currentTime,
    currentTimeFormatted: formatDuration(job.currentTime),
    totalDuration: job.totalDuration,
    totalDurationFormatted: formatDuration(job.totalDuration),
    fps: job.fps,
    speed: job.speed,
    downloadUrl: job.downloadUrl,
    outputFilename: job.outputFilename,
    outputPath: job.outputPath,
    outputSize: job.outputSizeFormatted,
    error: job.error
  });

  for (const client of job.clients) {
    client.write(`data: ${payload}\n\n`);
  }
}

/**
 * SSE endpoint for live progress streaming
 */
app.get('/api/job-status/:id', (req, res) => {
  const jobId = req.params.id;
  const job = activeJobs.get(jobId);

  if (!job) {
    return res.status(404).send('Job not found');
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  job.clients.add(res);
  broadcastJobUpdate(job);

  req.on('close', () => {
    job.clients.delete(res);
  });
});

/**
 * Cancel a running job
 */
app.post('/api/cancel-job/:id', (req, res) => {
  const jobId = req.params.id;
  const job = activeJobs.get(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  if (job.process && job.status === 'processing') {
    job.status = 'cancelled';
    job.process.kill('SIGTERM');
    broadcastJobUpdate(job);
    return res.json({ message: 'Job cancelled' });
  }

  res.json({ message: 'Job was not processing' });
});

/**
 * Generate a 1080p sample demo video with overlaid top banner text
 */
app.post('/api/generate-sample', async (req, res) => {
  const samplePath = path.join(TEMP_DIR, 'vido_demo_sample.mp4');

  try {
    if (!fs.existsSync(samplePath)) {
      const vf = [
        'testsrc=duration=10:size=1920x1080:rate=30',
        'drawbox=x=0:y=0:w=1920:h=120:color=black@0.75:t=fill',
        'drawtext=text=\'WWW.1TAMILMV.STYLE - EXCLUSIVE TRUE WEB-DL\':x=(w-text_w)/2:y=45:fontsize=44:fontcolor=white:shadowcolor=black@0.8:shadowx=2:shadowy=2',
        'drawbox=x=0:y=960:w=1920:h=120:color=black:t=fill',
        'drawtext=text=\'[Subtitles] This is an overlaid text line to remove\':x=(w-text_w)/2:y=1000:fontsize=32:fontcolor=yellow'
      ].join(',');

      const cmd = `ffmpeg -f lavfi -i "${vf}" -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=48000 -c:v libx264 -crf 16 -c:a aac -t 10 "${samplePath}" -y`;
      await execPromise(cmd);
    }

    const meta = await probeVideo(samplePath);
    res.json({
      message: 'Demo sample ready',
      path: samplePath,
      metadata: meta
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Periodic cleanup of temp preview frames older than 1 hour
setInterval(() => {
  try {
    const files = fs.readdirSync(TEMP_DIR);
    const now = Date.now();
    for (const f of files) {
      if (f.startsWith('frame_') || f.startsWith('preview_') || f.startsWith('sample_') || f.startsWith('mask_')) {
        const p = path.join(TEMP_DIR, f);
        const stat = fs.statSync(p);
        if (now - stat.mtimeMs > 3600000) {
          fs.unlinkSync(p);
        }
      }
    }
  } catch {}
}, 600000);

app.listen(PORT, () => {
  console.log(`\n🚀 VIDO Server running at http://localhost:${PORT}`);
  console.log(`📁 Video Exports Directory: ${EXPORTS_DIR}\n`);
});
