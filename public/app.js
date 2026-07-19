const authScreen = document.getElementById('authScreen');
const chatScreen = document.getElementById('chatScreen');
const authError = document.getElementById('authError');

let token = localStorage.getItem('token');
let myName = localStorage.getItem('username');
let ws = null;
let currentContact = null;
let onlineSet = new Set();

if (token && myName) showChat();

document.getElementById('loginBtn').onclick = () => doAuth('/api/login');
document.getElementById('registerBtn').onclick = () => doAuth('/api/register');
document.getElementById('logoutBtn').onclick = logout;
document.getElementById('sendBtn').onclick = sendMessage;
document.getElementById('msgInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') sendMessage();
});

async function doAuth(url) {
  authError.textContent = '';
  const username = document.getElementById('authUsername').value.trim();
  const password = document.getElementById('authPassword').value;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) { authError.textContent = data.error || 'Ошибка'; return; }
    token = data.token;
    myName = data.username;
    localStorage.setItem('token', token);
    localStorage.setItem('username', myName);
    showChat();
  } catch (e) {
    authError.textContent = 'Не удалось связаться с сервером';
  }
}

function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('username');
  if (ws) ws.close();
  location.reload();
}

async function showChat() {
  authScreen.classList.add('hidden');
  chatScreen.classList.remove('hidden');
  document.getElementById('meName').textContent = myName;
  await loadContacts();
  connectWS();
}

async function loadContacts() {
  const res = await fetch('/api/users', { headers: { Authorization: 'Bearer ' + token } });
  const users = await res.json();
  const list = document.getElementById('contactList');
  list.innerHTML = '';
  users.forEach(u => {
    const div = document.createElement('div');
    div.className = 'contact';
    div.dataset.user = u;
    div.innerHTML = `<span>${u}</span><span class="dot" data-dot="${u}"></span>`;
    div.onclick = () => openChat(u);
    list.appendChild(div);
  });
}

function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws?token=${token}`);
  ws.onmessage = (e) => {
    const data = JSON.parse(e.data);
    if (data.type === 'presence') {
      onlineSet = new Set(data.online);
      document.querySelectorAll('[data-dot]').forEach(dot => {
        dot.classList.toggle('online', onlineSet.has(dot.dataset.dot));
      });
    } else if (data.type === 'message') {
      const m = data.message;
      if (currentContact && (m.from === currentContact || m.to === currentContact)) {
        renderMessage(m);
      }
    }
  };
  ws.onclose = () => setTimeout(connectWS, 2000);
}

async function openChat(user) {
  currentContact = user;
  document.querySelectorAll('.contact').forEach(c => c.classList.toggle('active', c.dataset.user === user));
  document.getElementById('chatHeader').textContent = user;
  document.getElementById('msgInput').disabled = false;
  document.getElementById('sendBtn').disabled = false;
  const box = document.getElementById('messages');
  box.innerHTML = '';
  const res = await fetch(`/api/messages/${encodeURIComponent(user)}`, { headers: { Authorization: 'Bearer ' + token } });
  const history = await res.json();
  history.forEach(renderMessage);
}

function renderMessage(m) {
  const box = document.getElementById('messages');
  const div = document.createElement('div');
  div.className = 'bubble ' + (m.from === myName ? 'mine' : 'theirs');
  div.textContent = m.text;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function sendMessage() {
  const input = document.getElementById('msgInput');
  const text = input.value.trim();
  if (!text || !currentContact || !ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify({ type: 'message', to: currentContact, text }));
  input.value = '';
}
