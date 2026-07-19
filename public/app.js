// ===== ИНИЦИАЛИЗАЦИЯ =====
const authScreen = document.getElementById('authScreen');
const chatScreen = document.getElementById('chatScreen');
const authError = document.getElementById('authError');

let token = localStorage.getItem('token');
let myName = localStorage.getItem('username');
let ws = null;
let currentContact = null;
let onlineSet = new Set();

if (token && myName) showChat();

// ===== ОБРАБОТЧИКИ =====
document.getElementById('loginBtn').onclick = () => doAuth('/api/login');
document.getElementById('registerBtn').onclick = () => doAuth('/api/register');
document.getElementById('logoutBtn').onclick = logout;
document.getElementById('sendBtn').onclick = sendMessage;
document.getElementById('msgInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') sendMessage();
});
document.getElementById('backBtn').onclick = () => chatScreen.classList.remove('chat-open');

// ===== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ =====
function initial(name) {
    return (name || '?').trim().charAt(0).toUpperCase();
}

// ===== АВТОРИЗАЦИЯ =====
async function doAuth(url) {
    authError.textContent = '';
    const username = document.getElementById('authUsername').value.trim();
    const password = document.getElementById('authPassword').value;
    
    if (!username || !password) {
        authError.textContent = 'Заполните все поля';
        return;
    }
    
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        
        if (!res.ok) {
            authError.textContent = data.error || 'Ошибка';
            return;
        }
        
        token = data.token;
        myName = data.username;
        localStorage.setItem('token', token);
        localStorage.setItem('username', myName);
        showChat();
    } catch (e) {
        authError.textContent = 'Не удалось связаться с сервером';
        console.error(e);
    }
}

function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    if (ws) ws.close();
    location.reload();
}

// ===== ПОКАЗ ЧАТА =====
async function showChat() {
    authScreen.classList.add('hidden');
    chatScreen.classList.remove('hidden');
    document.getElementById('meName').textContent = myName;
    document.getElementById('meAvatar').setAttribute('data-initial', initial(myName));
    await loadContacts();
    connectWS();
}
