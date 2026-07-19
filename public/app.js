const authScreen = document.getElementById('authScreen');
const appShell = document.getElementById('appShell');
const authError = document.getElementById('authError');

let token = localStorage.getItem('token');
let myName = localStorage.getItem('username');
let myProfile = null;
let ws = null;
let currentContact = null;
let onlineSet = new Set();

if (token && myName) showApp();

function initial(name) { return (name || '?').trim().charAt(0).toUpperCase(); }

function avatarStyle(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return `background: linear-gradient(135deg, hsl(${hue},75%,60%), hsl(${(hue + 45) % 360},75%,45%));`;
}
function setAvatar(el, name) {
  el.setAttribute('data-initial', initial(name));
  el.setAttribute('style', avatarStyle(name));
}
function nameWithBadge(username, verified) {
  return escapeHtml(username) + (verified ? ' <span class="badge-check">✓</span>' : '');
}
function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
async function api(url, options = {}) {
  const headers = Object.assign({}, options.headers || {}, { Authorization: 'Bearer ' + token });
  const res = await fetch(url, Object.assign({}, options, { headers }));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Ошибка сервера');
  return data;
}

document.getElementById('loginBtn').onclick = () => doAuth('/api/login');
document.getElementById('registerBtn').onclick = () => doAuth('/api/register');
document.getElementById('logoutBtn').onclick = logout;

async function doAuth(url) {
  authError.textContent = '';
  const username = document.getElementById('authUsername').value.trim();
  const password = document.getElementById('authPassword').value;
  if (!username || !password) { authError.textContent = 'Заполните все поля'; return; }
  try {
    const res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) { authError.textContent = data.error || 'Ошибка'; return; }
    token = data.token; myName = data.username; myProfile = data.profile || null;
    localStorage.setItem('token', token);
    localStorage.setItem('username', myName);
    showApp();
  } catch (e) { authError.textContent = 'Не удалось связаться с сервером'; }
}

function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('username');
  if (ws) ws.close();
  location.reload();
}

async function showApp() {
  authScreen.classList.add('hidden');
  appShell.classList.remove('hidden');
  try { myProfile = await api('/api/profile/' + encodeURIComponent(myName)); } catch (e) {}
  renderMyProfile();
  await loadContacts();
  connectWS();
  loadStories();
  setupNav();
}

function setupNav() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.onclick = () => switchPage(btn.dataset.page);
  });
}
function switchPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('hidden', p.id !== pageId));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.page === pageId));
  if (pageId === 'pageFeed') loadFeed();
  if (pageId === 'pageProfile') renderMyProfile();
}

function renderMyProfile() {
  if (!myProfile) return;
  setAvatar(document.getElementById('myProfileAvatar'), myName);
  document.getElementById('myProfileName').innerHTML = nameWithBadge(myName, myProfile.verified);
  const roleEl = document.getElementById('myProfileRole');
  if (myProfile.role) { roleEl.textContent = myProfile.role; roleEl.classList.remove('hidden'); }
  else roleEl.classList.add('hidden');
  document.getElementById('myBioInput').value = myProfile.bio || '';
}
document.getElementById('saveBioBtn').onclick = async () => {
  const bio = document.getElementById('myBioInput').value.trim();
  try {
    myProfile = await api('/api/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bio }) });
    renderMyProfile();
  } catch (e) { alert('Не удалось сохранить'); }
};

const searchOverlay = document.getElementById('searchOverlay');
document.getElementById('searchOpenBtn').onclick = () => {
  searchOverlay.classList.remove('hidden');
  document.getElementById('searchInput').value = '';
  document.getElementById('searchResults').innerHTML = '';
  document.getElementById('searchInput').focus();
};
document.getElementById('searchCloseBtn').onclick = () => searchOverlay.classList.add('hidden');

let searchTimer = null;
document.getElementById('searchInput').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  searchTimer = setTimeout(() => runSearch(q), 300);
});
async function runSearch(q) {
  const box = document.getElementById('searchResults');
  if (!q) { box.innerHTML = ''; return; }
  try {
    const results = await api('/api/search?q=' + encodeURIComponent(q));
    if (!results.length) { box.innerHTML = '<div class="search-empty">Никого не найдено</div>'; return; }
    box.innerHTML = '';
    results.forEach(u => {
      const div = document.createElement('div');
      div.className = 'search-result';
      div.innerHTML = `<span class="avatar" style="${avatarStyle(u.username)}" data-initial="${initial(u.username)}"></span><span>${nameWithBadge(u.username, u.verified)}</span>`;
      div.onclick = () => { searchOverlay.classList.add('hidden'); openOtherProfile(u.username); };
      box.appendChild(div);
    });
  } catch (e) {}
}

const otherProfileOverlay = document.getElementById('otherProfileOverlay');
document.getElementById('otherProfileCloseBtn').onclick = () => otherProfileOverlay.classList.add('hidden');
let otherProfileUsername = null;

async function openOtherProfile(username) {
  if (username === myName) { switchPage('pageProfile'); return; }
  try {
    const profile = await api('/api/profile/' + encodeURIComponent(username));
    otherProfileUsername = username;
    setAvatar(document.getElementById('otherProfileAvatar'), username);
    document.getElementById('otherProfileName').innerHTML = nameWithBadge(username, profile.verified);
    const roleEl = document.getElementById('otherProfileRole');
    if (profile.role) { roleEl.textContent = profile.role; roleEl.classList.remove('hidden'); }
    else roleEl.classList.add('hidden');
    document.getElementById('otherProfileBio').textContent = profile.bio || '';
    otherProfileOverlay.classList.remove('hidden');
  } catch (e) { alert('Профиль не найден'); }
}
document.getElementById('otherProfileMsgBtn').onclick = () => {
  otherProfileOverlay.classList.add('hidden');
  switchPage('pageChats');
  openChat(otherProfileUsername);
};

async function loadContacts() {
  try {
    const users = await api('/api/users');
    const list = document.getElementById('contactList');
    list.innerHTML = '';
    users.forEach(u => {
      const div = document.createElement('div');
      div.className = 'contact';
      div.dataset.user = u;
      div.innerHTML = `<span class="avatar" style="${avatarStyle(u)}" data-initial="${initial(u)}"></span><span class="contact-name">${escapeHtml(u)}</span><span class="dot" data-dot="${u}"></span>`;
      div.onclick = () => openChat(u);
      list.appendChild(div);
    });
  } catch (e) { console.error('Error loading contacts:', e); }
}

function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws?token=${token}`);
  ws.onmessage = (e) => {
    try {
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
    } catch (err) { console.error('WS message error:', err); }
  };
  ws.onclose = () => setTimeout(connectWS, 2000);
  ws.onerror = (err) => console.error('WS error:', err);
}

document.getElementById('sendBtn').onclick = sendMessage;
document.getElementById('msgInput').addEventListener('keydown', e => { if (e.key === 'Enter') sendMessage(); });
document.getElementById('backBtn').onclick = () => document.getElementById('pageChats').classList.remove('chat-open');

async function openChat(user) {
  currentContact = user;
  document.getElementById('pageChats').classList.add('chat-open');
  document.querySelectorAll('.contact').forEach(c => c.classList.toggle('active', c.dataset.user === user));
  document.getElementById('chatTitle').textContent = user;
  setAvatar(document.getElementById('chatAvatar'), user);
  document.getElementById('msgInput').disabled = false;
  document.getElementById('sendBtn').disabled = false;
  document.getElementById('micBtn').disabled = false;
  const box = document.getElementById('messages');
  box.innerHTML = '';
  try {
    const history = await api('/api/messages/' + encodeURIComponent(user));
    history.forEach(renderMessage);
  } catch (e) { console.error('Error loading messages:', e); }
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
    bubble.innerHTML = `<img class="msg-image" src="${m.fileUrl}" onerror="this.style.display='none'">`;
  } else if (m.kind === 'voice') {
    bubble.innerHTML = `<audio class="msg-voice" controls src="${m.fileUrl}"></audio>`;
  } else if (m.kind === 'file') {
    const name = m.fileName || 'Файл';
    bubble.innerHTML = `<a class="file-chip" href="${m.fileUrl}" target="_blank" download><span class="file-icon">📄</span><span>${escapeHtml(name)}</span></a>`;
  } else {
    bubble.textContent = m.text || '';
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
  if (!uploaded) { alert('Не удалось загрузить файл'); return; }
  const kind = file.type.startsWith('image/') ? 'image' : 'file';
  ws.send(JSON.stringify({ type: 'message', to: currentContact, kind, fileUrl: uploaded.url, fileName: uploaded.name }));
};

async function uploadFile(file) {
  const form = new FormData();
  form.append('file', file);
  try {
    const res = await fetch('/api/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: form });
    if (!res.ok) { console.error('Upload error:', await res.json()); return null; }
    return await res.json();
  } catch (e) { console.error('Upload exception:', e); return null; }
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
      if (duration < 1) { alert('Слишком короткое сообщение'); return; }
      const file = new File([blob], `voice_${Date.now()}.webm`, { type: 'audio/webm' });
      const uploaded = await uploadFile(file);
      if (!uploaded) { alert('Не удалось загрузить голосовое сообщение'); return; }
      ws.send(JSON.stringify({ type: 'message', to: currentContact, kind: 'voice', fileUrl: uploaded.url, fileName: uploaded.name, duration }));
    };
    mediaRecorder.start();
    micBtn.classList.add('recording');
  } catch (e) {
    alert('Нет доступа к микрофону. Разрешите доступ в настройках.');
    console.error('Mic error:', e);
  }
}
function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  micBtn.classList.remove('recording');
}

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' }
];
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

function sendSignal(to, payload) { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'signal', to, payload })); }

async function startCall(withVideo) {
  if (!currentContact) return;
  if (!ws || ws.readyState !== 1) { alert('Нет соединения с сервером'); return; }
  callPeer = currentContact;
  isCaller = true;
  showCallUI(callPeer, 'Вызов…', false);
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: withVideo });
    localVideo.srcObject = localStream;
    createPeerConnection();
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sendSignal(callPeer, { kind: 'offer', sdp: offer, video: withVideo });
    callStatus.textContent = 'Ожидание ответа…';
  } catch (e) {
    alert('Нет доступа к камере/микрофону');
    console.error('Call start error:', e);
    endCall(false);
  }
}

function createPeerConnection() {
  pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  pc.onicecandidate = (e) => { if (e.candidate) sendSignal(callPeer, { kind: 'ice', candidate: e.candidate }); };
  pc.ontrack = (e) => { remoteVideo.srcObject = e.streams[0]; callStatus.textContent = 'в разговоре'; };
  pc.onconnectionstatechange = () => { if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) endCall(false); };
  pc.oniceconnectionstatechange = () => { if (pc.iceConnectionState === 'failed') endCall(false); };
}

function showCallUI(withUser, status, showAccept) {
  callOverlay.classList.remove('hidden');
  callName.textContent = withUser;
  setAvatar(callAvatar, withUser);
  callStatus.textContent = status;
  acceptBtn.classList.toggle('hidden', !showAccept);
}

let pendingOffer = null;

async function handleSignal(from, payload) {
  if (payload.kind === 'unavailable') { alert('Пользователь не в сети или занят'); endCall(false); return; }
  if (payload.kind === 'offer') {
    callPeer = from; isCaller = false; pendingOffer = payload;
    showCallUI(from, payload.video ? 'Входящий видеозвонок 📹' : 'Входящий звонок 📞', true);
    acceptBtn.onclick = () => acceptIncomingCall(payload.video);
    return;
  }
  if (payload.kind === 'answer') { if (pc) await pc.setRemoteDescription(payload.sdp); return; }
  if (payload.kind === 'ice') { if (pc) { try { await pc.addIceCandidate(payload.candidate); } catch (e) { console.error('ICE error:', e); } } return; }
  if (payload.kind === 'end') endCall(false);
}

async function acceptIncomingCall(withVideo) {
  acceptBtn.classList.add('hidden');
  callStatus.textContent = 'соединение…';
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: withVideo });
    localVideo.srcObject = localStream;
    createPeerConnection();
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    await pc.setRemoteDescription(pendingOffer.sdp);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    sendSignal(callPeer, { kind: 'answer', sdp: answer });
  } catch (e) {
    alert('Ошибка подключения к звонку');
    console.error('Accept call error:', e);
    endCall(false);
  }
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

const storyFileInput = document.createElement('input');
storyFileInput.type = 'file';
storyFileInput.accept = 'image/*,video/*';
storyFileInput.hidden = true;
document.body.appendChild(storyFileInput);

let storiesData = [];

async function loadStories() {
  try {
    storiesData = await api('/api/stories');
    renderStoriesBar();
  } catch (e) { console.error('Stories load error:', e); }
}

function renderStoriesBar() {
  const bar = document.getElementById('storiesBar');
  bar.innerHTML = '';

  const mine = storiesData.find(g => g.username === myName);
  const myCircle = document.createElement('div');
  myCircle.className = 'story-circle';
  myCircle.innerHTML = `
    <div class="story-ring ${mine ? '' : 'empty'}">
      <span class="avatar" style="${avatarStyle(myName)}" data-initial="${initial(myName)}"></span>
      <span class="story-add-badge">+</span>
    </div>
    <span class="story-label">Вы</span>`;
  myCircle.onclick = () => {
    if (mine) openStoryViewer(mine);
    else storyFileInput.click();
  };
  bar.appendChild(myCircle);

  storiesData.filter(g => g.username !== myName).forEach(group => {
    const el = document.createElement('div');
    el.className = 'story-circle';
    el.innerHTML = `
      <div class="story-ring">
        <span class="avatar" style="${avatarStyle(group.username)}" data-initial="${initial(group.username)}"></span>
      </div>
      <span class="story-label">${escapeHtml(group.username)}</span>`;
    el.onclick = () => openStoryViewer(group);
    bar.appendChild(el);
  });
}

storyFileInput.onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const uploaded = await uploadFile(file);
  if (!uploaded) { alert('Не удалось загрузить историю'); return; }
  const kind = file.type.startsWith('video/') ? 'video' : 'image';
  try {
    await api('/api/stories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileUrl: uploaded.url, kind }) });
    loadStories();
  } catch (e) { alert('Не удалось опубликовать историю'); }
};

const storyViewerOverlay = document.getElementById('storyViewerOverlay');
let storyQueue = [];
let storyIndex = 0;
let storyTimer = null;

function openStoryViewer(group) {
  storyQueue = group.items;
  storyIndex = 0;
  document.getElementById('storyUsername').innerHTML = nameWithBadge(group.username, group.verified);
  setAvatar(document.getElementById('storyAvatar'), group.username);
  buildStoryProgress();
  storyViewerOverlay.classList.remove('hidden');
  showStoryItem();
}
function buildStoryProgress() {
  const box = document.getElementById('storyProgress');
  box.innerHTML = '';
  storyQueue.forEach(() => {
    const seg = document.createElement('div');
    seg.className = 'seg';
    seg.innerHTML = '<div class="fill"></div>';
    box.appendChild(seg);
  });
}
function showStoryItem() {
  clearTimeout(storyTimer);
  const segs = document.querySelectorAll('#storyProgress .seg');
  segs.forEach((s, i) => {
    s.classList.toggle('done', i < storyIndex);
    const fill = s.querySelector('.fill');
    fill.style.width = i < storyIndex ? '100%' : '0%';
  });

  const item = storyQueue[storyIndex];
  const wrap = document.getElementById('storyMediaWrap');
  wrap.innerHTML = '';
  if (item.kind === 'video') {
    const v = document.createElement('video');
    v.src = item.fileUrl; v.autoplay = true; v.playsInline = true; v.controls = false;
    v.onended = nextStory;
    wrap.appendChild(v);
    const activeSeg = segs[storyIndex]?.querySelector('.fill');
    v.ontimeupdate = () => { if (activeSeg && v.duration) activeSeg.style.width = (v.currentTime / v.duration * 100) + '%'; };
  } else {
    const img = document.createElement('img');
    img.src = item.fileUrl;
    wrap.appendChild(img);
    const activeSeg = segs[storyIndex]?.querySelector('.fill');
    const duration = 5000; const start = Date.now();
    const tick = () => {
      const pct = Math.min(100, (Date.now() - start) / duration * 100);
      if (activeSeg) activeSeg.style.width = pct + '%';
      if (pct < 100) storyTimer = setTimeout(tick, 50);
    };
    tick();
    storyTimer = setTimeout(nextStory, duration);
  }
}
function nextStory() {
  storyIndex++;
  if (storyIndex >= storyQueue.length) { closeStoryViewer(); return; }
  showStoryItem();
}
function prevStory() {
  if (storyIndex === 0) return;
  storyIndex--;
  showStoryItem();
}
function closeStoryViewer() {
  clearTimeout(storyTimer);
  document.getElementById('storyMediaWrap').innerHTML = '';
  storyViewerOverlay.classList.add('hidden');
}
document.getElementById('storyCloseBtn').onclick = closeStoryViewer;
document.getElementById('storyTapLeft').onclick = prevStory;
document.getElementById('storyTapRight').onclick = nextStory;

let feedObserver = null;

async function loadFeed() {
  const box = document.getElementById('feedContainer');
  try {
    const posts = await api('/api/posts');
    box.innerHTML = '';
    if (!posts.length) { box.innerHTML = '<div class="feed-empty">Пока нет постов.<br>Нажмите «+», чтобы опубликовать первый!</div>'; return; }
    if (feedObserver) feedObserver.disconnect();
    feedObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        const video = entry.target.querySelector('video');
        if (!video) return;
        if (entry.isIntersecting) video.play().catch(() => {});
        else video.pause();
      });
    }, { threshold: 0.6 });

    posts.forEach(post => {
      const item = document.createElement('div');
      item.className = 'feed-item';
      const media = post.kind === 'video'
        ? `<video src="${post.fileUrl}" muted loop playsinline></video>`
        : `<img src="${post.fileUrl}">`;
      item.innerHTML = `
        ${media}
        <div class="feed-overlay">
          <div class="feed-author"><span class="avatar" style="${avatarStyle(post.username)}" data-initial="${initial(post.username)}"></span>${nameWithBadge(post.username, post.verified)}</div>
          ${post.caption ? `<div class="feed-caption">${escapeHtml(post.caption)}</div>` : ''}
        </div>`;
      item.querySelector('.feed-author').onclick = () => openOtherProfile(post.username);
      box.appendChild(item);
      feedObserver.observe(item);
    });
  } catch (e) { console.error('Feed load error:', e); }
}

let composeFile = null;

document.getElementById('composeOpenBtn').onclick = () => document.getElementById('postFileInput').click();
document.getElementById('postFileInput').onchange = (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  composeFile = file;
  const preview = document.getElementById('composePreview');
  preview.innerHTML = '';
  const url = URL.createObjectURL(file);
  if (file.type.startsWith('video/')) {
    preview.innerHTML = `<video src="${url}" controls playsinline></video>`;
  } else {
    preview.innerHTML = `<img src="${url}">`;
  }
  document.getElementById('composeCaption').value = '';
  document.getElementById('composeOverlay').classList.remove('hidden');
};
document.getElementById('composeCloseBtn').onclick = () => document.getElementById('composeOverlay').classList.add('hidden');

document.getElementById('composePublishBtn').onclick = async () => {
  if (!composeFile) return;
  const btn = document.getElementById('composePublishBtn');
  btn.disabled = true; btn.textContent = 'Публикация…';
  try {
    const uploaded = await uploadFile(composeFile);
    if (!uploaded) throw new Error('upload failed');
    const kind = composeFile.type.startsWith('video/') ? 'video' : 'image';
    const caption = document.getElementById('composeCaption').value.trim();
    await api('/api/posts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileUrl: uploaded.url, kind, caption }) });
    document.getElementById('composeOverlay').classList.add('hidden');
    composeFile = null;
    loadFeed();
  } catch (e) {
    alert('Не удалось опубликовать пост');
  } finally {
    btn.disabled = false; btn.textContent = 'Опубликовать';
  }
};
