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

const META_FILE = path.join(__dirname, 'metadata.json');
const USERS_FILE = path.join(__dirname, 'users.json');

function getData(file) {
  if (!fs.existsSync(file)) return {};
  try { return JSON.parse(fs.readFileSync(file)); } catch (e) { return {}; }
}

function saveData(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// Ensure default admin exists
function initAdmin() {
  const users = getData(USERS_FILE);
  if (!users['admin']) {
    users['admin'] = { password: 'password123', role: 'admin', uploaderStatus: 'approved' };
    saveData(USERS_FILE, users);
  }
}
initAdmin();

// Register / Login
app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  
  const users = getData(USERS_FILE);
  if (users[username]) return res.status(400).json({ error: 'User already exists' });

  users[username] = {
    password,
    role: 'user',
    uploaderStatus: 'none' // 'none', 'pending', 'approved'
  };
  saveData(USERS_FILE, users);

  res.json({ success: true, username, role: 'user', uploaderStatus: 'none' });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const users = getData(USERS_FILE);
  const user = users[username];

  if (!user || user.password !== password) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  res.json({ success: true, username, role: user.role, uploaderStatus: user.uploaderStatus });
});

// Apply to become a creator/uploader
app.post('/api/apply-creator', (req, res) => {
  const { username } = req.body;
  const users = getData(USERS_FILE);
  if (users[username]) {
    users[username].uploaderStatus = 'pending';
    saveData(USERS_FILE, users);
    return res.json({ success: true });
  }
  res.status(404).json({ error: 'User not found' });
});

// Admin: Get applications and users
app.get('/api/admin/users', (req, res) => {
  const users = getData(USERS_FILE);
  const safeUsers = Object.keys(users).map(u => ({
    username: u,
    role: users[u].role,
    uploaderStatus: users[u].uploaderStatus
  }));
  res.json(safeUsers);
});

// Admin: Approve/Reject uploader status
app.post('/api/admin/update-status', (req, res) => {
  const { username, status } = req.body; // 'approved' or 'rejected'
  const users = getData(USERS_FILE);
  if (users[username]) {
    users[username].uploaderStatus = status;
    saveData(USERS_FILE, users);
    return res.json({ success: true });
  }
  res.status(404).json({ error: 'User not found' });
});

// Video Upload (Approved Creators & Admins Only)
app.post('/api/upload', upload.single('video'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No video file uploaded' });
  const username = req.body.uploader || 'Anonymous';

  const meta = getData(META_FILE);
  meta[req.file.filename] = {
    title: req.body.title || req.file.originalname,
    category: req.body.category || 'Uncategorized',
    tags: req.body.tags ? req.body.tags.split(',').map(t => t.trim()) : [],
    uploader: username,
    views: 0,
    likes: 0,
    createdAt: Date.now()
  };
  saveData(META_FILE, meta);

  res.json({ filename: req.file.filename });
});

app.get('/api/videos', (req, res) => {
  fs.readdir(UPLOAD_DIR, (err, files) => {
    if (err) return res.status(500).json({ error: 'Failed to read media storage' });
    const meta = getData(META_FILE);

    const videos = files
      .filter(f => f.match(/\.(mp4|webm|mov|mkv)$/i))
      .map((file, index) => {
        const data = meta[file] || { title: file, category: 'Uncategorized', uploader: 'Admin', views: 0, likes: 0, tags: [] };
        return {
          id: index + 1,
          filename: file,
          title: data.title,
          category: data.category,
          tags: data.tags || [],
          uploader: data.uploader,
          views: data.views || 0,
          likes: data.likes || 0,
          createdAt: data.createdAt || 0
        };
      });
    res.json(videos);
  });
});

app.post('/api/view/:filename', (req, res) => {
  const meta = getData(META_FILE);
  const file = req.params.filename;
  if (meta[file]) {
    meta[file].views = (meta[file].views || 0) + 1;
    saveData(META_FILE, meta);
  }
  res.json({ success: true });
});

app.post('/api/like/:filename', (req, res) => {
  const meta = getData(META_FILE);
  const file = req.params.filename;
  if (meta[file]) {
    meta[file].likes = (meta[file].likes || 0) + 1;
    saveData(META_FILE, meta);
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
