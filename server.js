const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const app = express();
app.use(cors());
app.use(express.json());

const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

app.use(express.static(path.join(__dirname, 'public')));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`)
});
const upload = multer({ storage });

// Metadata file to track views, categories, likes
const META_FILE = path.join(__dirname, 'metadata.json');
function getMetadata() {
  if (!fs.existsSync(META_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(META_FILE)); } catch (e) { return {}; }
}
function saveMetadata(data) {
  fs.writeFileSync(META_FILE, JSON.stringify(data, null, 2));
}

app.post('/api/upload', upload.single('video'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No video file uploaded' });
  
  const meta = getMetadata();
  meta[req.file.filename] = {
    title: req.body.title || req.file.originalname,
    category: req.body.category || 'Uncategorized',
    views: 0,
    likes: 0,
    createdAt: Date.now()
  };
  saveMetadata(meta);

  res.json({ filename: req.file.filename });
});

app.get('/api/videos', (req, res) => {
  fs.readdir(UPLOAD_DIR, (err, files) => {
    if (err) return res.status(500).json({ error: 'Failed to read media storage' });
    const meta = getMetadata();
    
    const videos = files
      .filter(f => f.match(/\.(mp4|webm|mov|mkv)$/i))
      .map((file, index) => {
        const data = meta[file] || { title: file, category: 'Uncategorized', views: 0, likes: 0 };
        return {
          id: index + 1,
          filename: file,
          title: data.title,
          category: data.category,
          views: data.views || 0,
          likes: data.likes || 0
        };
      });
    res.json(videos);
  });
});

app.post('/api/view/:filename', (req, res) => {
  const meta = getMetadata();
  const file = req.params.filename;
  if (meta[file]) {
    meta[file].views = (meta[file].views || 0) + 1;
    saveMetadata(meta);
  }
  res.json({ success: true });
});

app.post('/api/like/:filename', (req, res) => {
  const meta = getMetadata();
  const file = req.params.filename;
  if (meta[file]) {
    meta[file].likes = (meta[file].likes || 0) + 1;
    saveMetadata(meta);
    return res.json({ success: true, likes: meta[file].likes });
  }
  res.status(404).json({ error: 'Not found' });
});

app.get('/api/stream/:filename', (req, res) => {
  const filePath = path.join(UPLOAD_DIR, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).send('Media file not found');

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = (end - start) + 1;
    const file = fs.createReadStream(filePath, { start, end });
    const head = {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': 'video/mp4',
    };
    res.writeHead(206, head);
    file.pipe(res);
  } else {
    const head = {
      'Content-Length': fileSize,
      'Content-Type': 'video/mp4',
    };
    res.writeHead(200, head);
    fs.createReadStream(filePath).pipe(res);
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`EreziHub active on port ${PORT}`));
    
