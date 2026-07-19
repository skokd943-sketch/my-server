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
const UPLOADS_DIR = path.join(__dirname, 'uploads');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');
if (!fs.existsSync(MESSAGES_FILE)) fs.writeFileSync(MESSAGES_FILE, '[]');

function readJSON(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJSON(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

// Настройка CORS для Render
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    cb(null, Date.now() + '-' + Math.random().toString(36).slice(2, 8) + ext);
  }
});
const upload = multer({ 
  storage, 
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    // Разрешаем все типы файлов
    cb(null, true);
  }
});

app.post('/api/register', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password || username.length < 3 || password.length < 4) {
    return res.status(400).json({ error: 'Логин от 3 символов, пароль от 4 символов' });
  }
  const users = readJSON(USERS_FILE);
  if (users.find(u => u.username === username)) {
    return res.status(400).json({ error: 'Такой пользователь уже есть' });
  }
  const hash = bcrypt.hashSync(password, 10);
  users.push({ username, hash, createdAt: Date.now() });
  writeJSON(USERS_FILE, users);
  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, username });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const users = readJSON(USERS_FILE);
  const user = users.find(u => u.username === username);
  if (!user || !bcrypt.compareSync(password, user.hash)) {
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }
  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, username });
});

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

app.get('/api/users', auth, (req, res) => {
  const users = readJSON(USERS_FILE);
  res.json(users.map(u => u.username).filter(n => n !== req.user.username));
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
  const protocol = req.protocol;
  const host = req.get('host');
  const url = `${protocol}://${host}/uploads/${req.file.filename}`;
  res.json({
    url: url,
    name: req.file.originalname,
    mimetype: req.file.mimetype,
    size: req.file.size
  });
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
      
      // Отправляем ОБОИМ участникам
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
      const target = online.get(data.to);
      if (target && target.readyState === WebSocket.OPEN) {
        target.send(payload);
      }
    }

    if (data.type === 'signal') {
      const target = online.get(data.to);
      if (target && target.readyState === WebSocket.OPEN) {
        target.send(JSON.stringify({ 
          type: 'signal', 
          from: username, 
          payload: data.payload 
        }));
      } else if (data.payload && data.payload.kind === 'offer') {
        ws.send(JSON.stringify({ 
          type: 'signal', 
          from: data.to, 
          payload: { kind: 'unavailable' } 
        }));
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
