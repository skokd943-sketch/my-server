const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-please';
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const POSTS_FILE = path.join(DATA_DIR, 'posts.json');
const STORIES_FILE = path.join(DATA_DIR, 'stories.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const STORY_TTL_MS = 24 * 60 * 60 * 1000;

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');
if (!fs.existsSync(MESSAGES_FILE)) fs.writeFileSync(MESSAGES_FILE, '[]');
if (!fs.existsSync(POSTS_FILE)) fs.writeFileSync(POSTS_FILE, '[]');
if (!fs.existsSync(STORIES_FILE)) fs.writeFileSync(STORIES_FILE, '[]');

function readJSON(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJSON(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }

function migrateUsers() {
  const users = readJSON(USERS_FILE);
  let changed = false;
  users.forEach(u => {
    if (u.bio === undefined) { u.bio = ''; changed = true; }
    if (u.verified === undefined) { u.verified = u.username.toLowerCase() === 'bog'; changed = true; }
    if (u.role === undefined) { u.role = u.username.toLowerCase() === 'bog' ? 'OWNER' : null; changed = true; }
  });
  if (changed) writeJSON(USERS_FILE, users);
}
migrateUsers();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    cb(null, Date.now() + '-' + Math.random().toString(36).slice(2, 8) + ext);
  }
});
const upload = multer({ storage, limits: { fileSize: 60 * 1024 * 1024 }, fileFilter: (req, file, cb) => cb(null, true) });

function publicUser(u) {
  return { username: u.username, bio: u.bio || '', verified: !!u.verified, role: u.role || null, createdAt: u.createdAt };
}

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.replace('Bearer ', '');
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    res.status(401).json({ error: 'Не авторизован' });
  }
}

app.post('/api/register', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password || username.length < 3 || password.length < 4) {
    return res.status(400).json({ error: 'Логин от 3 символов, пароль от 4 символов' });
  }
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return res.status(400).json({ error: 'Логин: только латиница, цифры и подчёркивание' });
  }
  const users = readJSON(USERS_FILE);
  if (users.find(u => u.username.toLowerCase() === username.toLowerCase())) {
    return res.status(400).json({ error: 'Такой пользователь уже есть' });
  }
  const hash = bcrypt.hashSync(password, 10);
  const isBog = username.toLowerCase() === 'bog';
  const user = { username, hash, createdAt: Date.now(), bio: '', verified: isBog, role: isBog ? 'OWNER' : null };
  users.push(user);
  writeJSON(USERS_FILE, users);
  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, username, profile: publicUser(user) });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const users = readJSON(USERS_FILE);
  const user = users.find(u => u.username.toLowerCase() === (username || '').toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.hash)) {
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }
  const token = jwt.sign({ username: user.username }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, username: user.username, profile: publicUser(user) });
});

app.get('/api/users', auth, (req, res) => {
  const users = readJSON(USERS_FILE);
  res.json(users.map(u => u.username).filter(n => n !== req.user.username));
});

app.get('/api/search', auth, (req, res) => {
  const q = String(req.query.q || '').toLowerCase().trim();
  if (!q) return res.json([]);
  const users = readJSON(USERS_FILE);
  const results = users
    .filter(u => u.username.toLowerCase() !== req.user.username.toLowerCase())
    .filter(u => u.username.toLowerCase().includes(q))
    .slice(0, 20)
    .map(publicUser);
  res.json(results);
});

app.get('/api/profile/:username', auth, (req, res) => {
  const users = readJSON(USERS_FILE);
  const user = users.find(u => u.username.toLowerCase() === req.params.username.toLowerCase());
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  res.json(publicUser(user));
});

app.put('/api/profile', auth, (req, res) => {
  const { bio } = req.body || {};
  const users = readJSON(USERS_FILE);
  const user = users.find(u => u.username === req.user.username);
  if (!user) return res.status(404).json({ error: 'Не найден' });
  user.bio = String(bio || '').slice(0, 200);
  writeJSON(USERS_FILE, users);
  res.json(publicUser(user));
});

app.get('/api/messages/:withUser', auth, (req, res) => {
  const messages = readJSON(MESSAGES_FILE);
  const me = req.user.username;
  const other = req.params.withUser;
  const thread = messages.filter(m =>
    (m.from === me && m.to === other) || (m.from === other && m.to === me)
  );
  res.json(thread);
});

app.post('/api/upload', auth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не получен' });
  res.json({
    url: '/uploads/' + req.file.filename,
    name: req.file.originalname,
    mimetype: req.file.mimetype,
    size: req.file.size
  });
});

app.post('/api/posts', auth, (req, res) => {
  const { fileUrl, kind, caption } = req.body || {};
  if (!fileUrl || !['image', 'video'].includes(kind)) {
    return res.status(400).json({ error: 'Некорректные данные поста' });
  }
  const users = readJSON(USERS_FILE);
  const author = users.find(u => u.username === req.user.username);
  const post = {
    id: Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    username: req.user.username,
    verified: !!(author && author.verified),
    kind,
    fileUrl,
    caption: String(caption || '').slice(0, 500),
    ts: Date.now()
  };
  const posts = readJSON(POSTS_FILE);
  posts.unshift(post);
  writeJSON(POSTS_FILE, posts.slice(0, 300));
  res.json(post);
});

app.get('/api/posts', auth, (req, res) => {
  const posts = readJSON(POSTS_FILE);
  res.json(posts);
});

app.post('/api/stories', auth, (req, res) => {
  const { fileUrl, kind } = req.body || {};
  if (!fileUrl || !['image', 'video'].includes(kind)) {
    return res.status(400).json({ error: 'Некорректные данные истории' });
  }
  const story = {
    id: Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    username: req.user.username,
    kind,
    fileUrl,
    ts: Date.now(),
    expiresAt: Date.now() + STORY_TTL_MS
  };
  const stories = readJSON(STORIES_FILE);
  stories.push(story);
  writeJSON(STORIES_FILE, stories);
  res.json(story);
});

app.get('/api/stories', auth, (req, res) => {
  const now = Date.now();
  const users = readJSON(USERS_FILE);
  const verifiedSet = new Set(users.filter(u => u.verified).map(u => u.username));
  const stories = readJSON(STORIES_FILE).filter(s => s.expiresAt > now);
  const byUser = {};
  stories.forEach(s => {
    if (!byUser[s.username]) byUser[s.username] = [];
    byUser[s.username].push({ id: s.id, kind: s.kind, fileUrl: s.fileUrl, ts: s.ts });
  });
  const groups = Object.keys(byUser).map(username => ({
    username,
    verified: verifiedSet.has(username),
    items: byUser[username].sort((a, b) => a.ts - b.ts)
  })).sort((a, b) => {
    const lastA = a.items[a.items.length - 1].ts;
    const lastB = b.items[b.items.length - 1].ts;
    return lastB - lastA;
  });
  res.json(groups);
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });
const online = new Map();

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get('token');
  let username;
  try {
    username = jwt.verify(token, JWT_SECRET).username;
  } catch (e) {
    ws.close();
    return;
  }
  online.set(username, ws);
  broadcastPresence();

  ws.on('message', (raw) => {
    let data;
    try { data = JSON.parse(raw); } catch (e) { return; }

    if (data.type === 'message') {
      const msg = {
        id: Date.now() + '-' + Math.random().toString(36).slice(2, 8),
        from: username,
        to: data.to,
        kind: data.kind || 'text',
        text: String(data.text || '').slice(0, 4000),
        fileUrl: data.fileUrl || null,
        fileName: data.fileName || null,
        duration: data.duration || null,
        ts: Date.now()
      };
      const messages = readJSON(MESSAGES_FILE);
      messages.push(msg);
      writeJSON(MESSAGES_FILE, messages);

      const payload = JSON.stringify({ type: 'message', message: msg });
      if (ws.readyState === WebSocket.OPEN) ws.send(payload);
      const target = online.get(data.to);
      if (target && target.readyState === WebSocket.OPEN) target.send(payload);
    }

    if (data.type === 'signal') {
      const target = online.get(data.to);
      if (target && target.readyState === WebSocket.OPEN) {
        target.send(JSON.stringify({ type: 'signal', from: username, payload: data.payload }));
      } else if (data.payload && data.payload.kind === 'offer') {
        ws.send(JSON.stringify({ type: 'signal', from: data.to, payload: { kind: 'unavailable' } }));
      }
    }
  });

  ws.on('close', () => {
    online.delete(username);
    broadcastPresence();
  });
});

function broadcastPresence() {
  const list = JSON.stringify({ type: 'presence', online: Array.from(online.keys()) });
  for (const ws of online.values()) {
    if (ws.readyState === WebSocket.OPEN) ws.send(list);
  }
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Сервер запущен: http://localhost:${PORT}`);
});
