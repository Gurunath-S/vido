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

app.listen(PORT, () => {
  console.log(`VIDO Studio server listening on port ${PORT}`);
});
