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


function execPromise(command) {
  return new Promise((resolve, reject) => {
    exec(command, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) return reject(new Error(stderr || stdout || error.message));
      resolve(stdout);
    });
  });
}

async function probeVideo(filePath) {
  const cmd = `ffprobe -v quiet -print_format json -show_format -show_streams "${filePath}"`;
  const output = await execPromise(cmd);
  const data = JSON.parse(output);
  const videoStream = data.streams?.find(s => s.codec_type === 'video');
  const audioStreams = data.streams?.filter(s => s.codec_type === 'audio') || [];
  const subtitleStreams = data.streams?.filter(s => s.codec_type === 'subtitle') || [];
  if (!videoStream) throw new Error('No video stream found in file');
  let fps = 24;
  if (videoStream.r_frame_rate) {
    const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
    if (den && den > 0) fps = Math.round((num / den) * 100) / 100;
  }
  const duration = parseFloat(data.format?.duration || videoStream.duration || 0);
  const width = parseInt(videoStream.width, 10);
  const height = parseInt(videoStream.height, 10);
  return {
    path: filePath,
    filename: path.basename(filePath),
    format: data.format?.format_name,
    duration,
    size: parseInt(data.format?.size || 0, 10),
    video: { codec: videoStream.codec_name, width, height, fps, pixFmt: videoStream.pix_fmt },
    audioTracks: audioStreams.map((a, i) => ({ index: a.index, codec: a.codec_name })),
    subtitles: subtitleStreams.map((s, i) => ({ index: s.index, codec: s.codec_name }))
  };
}

app.get('/api/local-files', async (req, res) => {
  try {
    const searchDirs = [
      path.join(process.env.HOME || '/home/beast', 'Downloads'),
      path.join(process.env.HOME || '/home/beast', 'Videos'),
      path.join(process.env.HOME || '/home/beast', 'Desktop'),
      UPLOADS_DIR,
      EXPORTS_DIR
    ];
    const files = [];
    const validExts = new Set(['.mp4', '.mkv', '.mov', '.webm', '.avi', '.ts']);
    for (const d of searchDirs) {
      if (fs.existsSync(d)) {
        const list = fs.readdirSync(d);
        for (const f of list) {
          if (validExts.has(path.extname(f).toLowerCase())) {
            const p = path.join(d, f);
            try {
              const stat = fs.statSync(p);
              files.push({ name: f, path: p, size: stat.size, dir: path.basename(d) });
            } catch(e) {}
          }
        }
      }
    }
    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/inspect', async (req, res) => {
  try {
    const filePath = req.query.path;
    if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
    const info = await probeVideo(filePath);
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/upload', upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const info = await probeVideo(req.file.path);
    res.json({ success: true, file: info });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`VIDO Studio server listening on port ${PORT}`);
});
