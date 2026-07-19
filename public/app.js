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
document.getElementById('msgInput').addEventListener('keydown', e => { if (e.key === 'Enter') sendMessage(); });
document.getElementById('backBtn').onclick = () => chatScreen.classList.remove('chat-open');

function initial(name) { return (name || '?').trim()[0].toUpperCase(); }

async function doAuth(url) {
  authError.textContent = '';
  const username = document.getElementById('authUsername').value.trim();
  const password = document.getElementById('authPassword').value;
  try {
    const res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) { authError.textContent = data.error || 'Ошибка'; return; }
    token = data.token; myName = data.username;
    localStorage.setItem('token', token);
    localStorage.setItem('username', myName);
    showChat();
  } catch (e) { authError.textContent = 'Не удалось связаться с сервером'; }
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
  document.getElementById('meAvatar').setAttribute('data-initial', initial(myName));
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
    div.innerHTML = `<span class="avatar" data-initial="${initial(u)}"></span><span class="contact-name">${u}</span><span class="dot" data-dot="${u}"></span>`;
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
      document.querySelectorAll('[data-dot]').forEach(dot => dot.classList.toggle('online', onlineSet.has(dot.dataset.dot)));
    } else if (data.type === 'message') {
      const m = data.message;
      if (currentContact && (m.from === currentContact || m.to === currentContact)) renderMessage(m);
    } else if (data.type === 'signal') {
      handleSignal(data.from, data.payload);
    }
  };
  ws.onclose = () => setTimeout(connectWS, 2000);
}

async function openChat(user) {
  currentContact = user;
  chatScreen.classList.add('chat-open');
  document.querySelectorAll('.contact').forEach(c => c.classList.toggle('active', c.dataset.user === user));
  document.getElementById('chatTitle').textContent = user;
  document.getElementById('chatAvatar').setAttribute('data-initial', initial(user));
  document.getElementById('msgInput').disabled = false;
  document.getElementById('sendBtn').disabled = false;
  document.getElementById('micBtn').disabled = false;
  const box = document.getElementById('messages');
  box.innerHTML = '';
  const res = await fetch(`/api/messages/${encodeURIComponent(user)}`, { headers: { Authorization: 'Bearer ' + token } });
  const history = await res.json();
  history.forEach(renderMessage);
}

function formatTime(ts) {
  const d = new Date(ts);
  return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
}

function renderMessage(m) {
  const box = document.getElementById('messages');
  const wrap = document.createElement('div');
  wrap.className = 'bubble-wrap ' + (m.from === myName ? 'mine' : 'theirs');
  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  if (m.kind === 'image') {
    bubble.innerHTML = `<img class="msg-image" src="${m.fileUrl}">`;
  } else if (m.kind === 'voice') {
    bubble.innerHTML = `<audio class="msg-voice" controls src="${m.fileUrl}"></audio>`;
  } else if (m.kind === 'file') {
    bubble.innerHTML = `<a class="file-chip" href="${m.fileUrl}" target="_blank" download><span class="file-icon">📄</span><span>${m.fileName || 'Файл'}</span></a>`;
  } else {
    bubble.textContent = m.text;
  }

  const time = document.createElement('div');
  time.className = 'msg-time';
  time.textContent = formatTime(m.ts);

  wrap.appendChild(bubble);
  wrap.appendChild(time);
  box.appendChild(wrap);
  box.scrollTop = box.scrollHeight;
}

function sendMessage() {
  const input = document.getElementById('msgInput');
  const text = input.value.trim();
  if (!text || !currentContact || !ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify({ type: 'message', to: currentContact, kind: 'text', text }));
  input.value = '';
}

document.getElementById('attachBtn').onclick = () => document.getElementById('fileInput').click();
document.getElementById('fileInput').onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file || !currentContact) return;
  const uploaded = await uploadFile(file);
  if (!uploaded) return;
  const kind = file.type.startsWith('image/') ? 'image' : 'file';
  ws.send(JSON.stringify({ type: 'message', to: currentContact, kind, fileUrl: uploaded.url, fileName: uploaded.name }));
};

async function uploadFile(file) {
  const form = new FormData();
  form.append('file', file);
  try {
    const res = await fetch('/api/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: form });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) { return null; }
}

let mediaRecorder = null;
let recordedChunks = [];
let recordStart = 0;
const micBtn = document.getElementById('micBtn');

micBtn.addEventListener('mousedown', startRecording);
micBtn.addEventListener('touchstart', (e) => { e.preventDefault(); startRecording(); });
micBtn.addEventListener('mouseup', stopRecording);
micBtn.addEventListener('touchend', (e) => { e.preventDefault(); stopRecording(); });
micBtn.addEventListener('mouseleave', stopRecording);

async function startRecording() {
  if (!currentContact || mediaRecorder) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordedChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    recordStart = Date.now();
    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
    mediaRecorder.onstop = async () => {
      const duration = Math.round((Date.now() - recordStart) / 1000);
      const blob = new Blob(recordedChunks, { type: 'audio/webm' });
      stream.getTracks().forEach(t => t.stop());
      mediaRecorder = null;
      if (duration < 1) return;
      const file = new File([blob], 'voice.webm', { type: 'audio/webm' });
      const uploaded = await uploadFile(file);
      if (!uploaded) return;
      ws.send(JSON.stringify({ type: 'message', to: currentContact, kind: 'voice', fileUrl: uploaded.url, duration }));
    };
    mediaRecorder.start();
    micBtn.classList.add('recording');
  } catch (e) {
    alert('Нет доступа к микрофону');
  }
}
function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  micBtn.classList.remove('recording');
}

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
let pc = null;
let localStream = null;
let callPeer = null;
let isCaller = false;

const callOverlay = document.getElementById('callOverlay');
const remoteVideo = document.getElementById('remoteVideo');
const localVideo = document.getElementById('localVideo');
const callName = document.getElementById('callName');
const callStatus = document.getElementById('callStatus');
const callAvatar = document.getElementById('callAvatar');
const acceptBtn = document.getElementById('acceptCallBtn');
const declineBtn = document.getElementById('declineCallBtn');

document.getElementById('callAudioBtn').onclick = () => startCall(false);
document.getElementById('callVideoBtn').onclick = () => startCall(true);
declineBtn.onclick = () => endCall(true);

function sendSignal(to, payload) { ws.send(JSON.stringify({ type: 'signal', to, payload })); }

async function startCall(withVideo) {
  if (!currentContact) return;
  callPeer = currentContact;
  isCaller = true;
  showCallUI(callPeer, 'Вызов…', false);
  localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: withVideo });
  localVideo.srcObject = localStream;
  createPeerConnection();
  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  sendSignal(callPeer, { kind: 'offer', sdp: offer, video: withVideo });
}

function createPeerConnection() {
  pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  pc.onicecandidate = (e) => { if (e.candidate) sendSignal(callPeer, { kind: 'ice', candidate: e.candidate }); };
  pc.ontrack = (e) => { remoteVideo.srcObject = e.streams[0]; callStatus.textContent = 'в разговоре'; };
  pc.onconnectionstatechange = () => {
    if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) endCall(false);
  };
}

function showCallUI(withUser, status, showAccept) {
  callOverlay.classList.remove('hidden');
  callName.textContent = withUser;
  callAvatar.setAttribute('data-initial', initial(withUser));
  callStatus.textContent = status;
  acceptBtn.classList.toggle('hidden', !showAccept);
}

let pendingOffer = null;

async function handleSignal(from, payload) {
  if (payload.kind === 'unavailable') {
    alert('Пользователь не в сети');
    endCall(false);
    return;
  }
  if (payload.kind === 'offer') {
    callPeer = from;
    isCaller = false;
    pendingOffer = payload;
    showCallUI(from, payload.video ? 'Входящий видеозвонок' : 'Входящий звонок', true);
    acceptBtn.onclick = () => acceptIncomingCall(payload.video);
    return;
  }
  if (payload.kind === 'answer') {
    await pc.setRemoteDescription(payload.sdp);
    return;
  }
  if (payload.kind === 'ice') {
    if (pc) { try { await pc.addIceCandidate(payload.candidate); } catch (e) {} }
    return;
  }
  if (payload.kind === 'end') {
    endCall(false);
  }
}

async function acceptIncomingCall(withVideo) {
  acceptBtn.classList.add('hidden');
  callStatus.textContent = 'соединение…';
  localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: withVideo });
  localVideo.srcObject = localStream;
  createPeerConnection();
  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  await pc.setRemoteDescription(pendingOffer.sdp);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  sendSignal(callPeer, { kind: 'answer', sdp: answer });
}

function endCall(notify) {
  if (notify && callPeer) sendSignal(callPeer, { kind: 'end' });
  if (pc) { pc.close(); pc = null; }
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  remoteVideo.srcObject = null;
  localVideo.srcObject = null;
  callOverlay.classList.add('hidden');
  callPeer = null;
  pendingOffer = null;
}
