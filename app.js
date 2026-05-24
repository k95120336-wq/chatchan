// ─── Socket ───
const socket = io({
  transports: ['polling', 'websocket'],
});

// ─── State ───
let mySocketId = '';
let currentNickname = '';
let currentAvatar = '';  // base64 from local, never sent in history
let replyTarget = null;
let pendingImage = null;

// ─── DOM ───
const $ = id => document.getElementById(id);
const loginScreen = $('login-screen');
const chatScreen = $('chat-screen');
const nicknameInput = $('nickname-input');
const passwordInput = $('password-input');
const avatarInput = $('avatar-input');
const avatarPreview = $('avatar-preview');
const avatarText = $('avatar-text');
const loginBtn = $('login-btn');
const loginError = $('login-error');
const msgBox = $('messages-container');
const messageInput = $('message-input');
const sendBtn = $('send-btn');
const imageBtn = $('image-btn');
const imageInput = $('image-input');
const onlineCount = $('online-count');
const replyIndicator = $('reply-indicator');
const replyText = $('reply-text');
const cancelReply = $('cancel-reply');

// ─── Local user restore ───
// We store the last known nickname only (not base64 avatar, it's too big)
try {
  const saved = JSON.parse(localStorage.getItem('chatchan_user'));
  if (saved && saved.nickname) nicknameInput.value = saved.nickname;
} catch (e) {}

function saveUser() {
  localStorage.setItem('chatchan_user', JSON.stringify({ nickname: currentNickname }));
}

// ─── Avatar picker (login screen) ───
avatarInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    currentAvatar = ev.target.result;
    avatarPreview.innerHTML = `<img src="${currentAvatar}" alt="">`;
    avatarText.style.display = 'none';
  };
  reader.readAsDataURL(file);
});

// ─── Login ───
loginBtn.addEventListener('click', () => {
  const nickname = nicknameInput.value.trim() || ('匿名用户' + Math.random().toString(36).slice(2, 6));
  const password = passwordInput.value.trim();
  if (!password) { loginError.textContent = '请输入房间密码'; return; }
  currentNickname = nickname;
  loginBtn.disabled = true;
  loginBtn.textContent = '连接中...';
  socket.emit('join', { password, user: { nickname, avatar: currentAvatar } });
});

passwordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') loginBtn.click(); });
nicknameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') passwordInput.focus(); });

// ─── Socket events ───
socket.on('join_error', (msg) => {
  loginError.textContent = msg;
  loginBtn.disabled = false;
  loginBtn.textContent = '进入聊天室';
});

socket.on('joined', (data) => {
  mySocketId = data.yourId;
  saveUser();
  loginScreen.classList.add('hidden');
  chatScreen.classList.remove('hidden');
  loginBtn.disabled = false;
  loginBtn.textContent = '进入聊天室';
  messageInput.focus();
});

socket.on('history', renderBatch);
socket.on('message', (msg) => { renderOne(msg); scrollNow(); });
socket.on('online_users', (users) => { onlineCount.textContent = `${users.length} 人在线`; });

// ─── Send ───
function sendMessage() {
  const text = messageInput.value.trim();
  if (!text && !pendingImage) return;
  socket.emit('chat_message', { text, replyTo: replyTarget, image: pendingImage || '' });
  messageInput.value = '';
  pendingImage = null;
  clearReply();
  autoResize();
}

sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});
messageInput.addEventListener('input', autoResize);
function autoResize() {
  messageInput.style.height = 'auto';
  messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
}

// ─── Image upload ───
imageBtn.addEventListener('click', () => imageInput.click());
imageInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 5e6) { alert('图片不能超过5MB'); return; }
  try {
    const fd = new FormData();
    fd.append('image', file);
    const res = await fetch('/upload', { method: 'POST', body: fd });
    const data = await res.json();
    pendingImage = data.url;
    messageInput.placeholder = '图片已添加，输入文字或直接发送...';
    messageInput.focus();
  } catch (err) { alert('上传失败'); }
  e.target.value = '';
});

// ─── Reply ───
function setReply(msg) {
  replyTarget = { id: msg.id, sender: msg.sender.nickname, text: msg.text, image: msg.image };
  replyText.textContent = `回复 @${msg.sender.nickname}: ${msg.image ? '[图片]' : (msg.text || '')}`;
  replyIndicator.classList.remove('hidden');
  messageInput.focus();
}
function clearReply() { replyTarget = null; replyIndicator.classList.add('hidden'); }
cancelReply.addEventListener('click', clearReply);

// ═══════════════════════════════════
//  RENDER ENGINE
// ═══════════════════════════════════

const MAX_DOM_MSGS = 200;
let domCount = 0;

function createMsgElement(msg) {
  const isSelf = msg.senderId === mySocketId;
  const div = document.createElement('div');
  div.className = `msg ${isSelf ? 'msg-self' : 'msg-other'}`;
  div.dataset.msgId = msg.id;

  // Avatar
  const a = document.createElement('div');
  a.className = 'msg-avatar';
  // For self messages: show own avatar if set
  // For others: show from msg.sender.avatar (if it's a URL)
  const avatarUrl = isSelf && currentAvatar ? currentAvatar : (msg.sender.avatar || '');
  if (avatarUrl) {
    a.innerHTML = `<img src="${avatarUrl}" alt="">`;
  } else {
    a.textContent = msg.sender.nickname.charAt(0).toUpperCase();
  }

  // Body
  const body = document.createElement('div');
  body.className = 'msg-body';

  // Nickname
  const n = document.createElement('div');
  n.className = 'msg-nickname';
  n.textContent = msg.sender.nickname;

  // Bubble
  const bu = document.createElement('div');
  bu.className = 'msg-bubble';

  // Reply preview
  if (msg.replyTo) {
    const rp = document.createElement('div');
    rp.className = 'msg-reply-preview';
    rp.textContent = `@${msg.replyTo.sender}: ${msg.replyTo.image ? '[图片]' : (msg.replyTo.text || '')}`;
    bu.appendChild(rp);
  }

  // Text
  if (msg.text) {
    const t = document.createElement('span');
    t.className = 'msg-text';
    t.textContent = msg.text;
    bu.appendChild(t);
  }

  // Image
  if (msg.image) {
    const img = document.createElement('img');
    img.className = 'msg-image';
    img.loading = 'lazy';
    img.src = msg.image;
    bu.appendChild(img);
  }

  // Time
  const tm = document.createElement('div');
  tm.className = 'msg-time';
  const d = new Date(msg.time);
  tm.textContent = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;

  body.append(n, bu, tm);
  div.append(a, body);
  return div;
}

function createSystemElement(text) {
  const div = document.createElement('div');
  div.className = 'msg-system';
  div.textContent = text;
  return div;
}

function renderBatch(messages) {
  const frag = document.createDocumentFragment();
  for (const m of messages) {
    if (domCount >= MAX_DOM_MSGS) trimDom();
    frag.appendChild(m.type === 'system' ? createSystemElement(m.text) : createMsgElement(m));
    domCount++;
  }
  msgBox.appendChild(frag);
  scrollNow();
}

function renderOne(msg) {
  if (domCount >= MAX_DOM_MSGS) trimDom();
  const el = msg.type === 'system' ? createSystemElement(msg.text) : createMsgElement(msg);
  msgBox.appendChild(el);
  domCount++;
}

function trimDom() {
  const kids = msgBox.children;
  const nuke = Math.min(20, kids.length);
  for (let i = 0; i < nuke; i++) kids[0].remove();
  domCount -= nuke;
}

// ─── Event delegation: reply + image click ───
msgBox.addEventListener('click', (e) => {
  if (e.target.tagName === 'IMG' && e.target.classList.contains('msg-image')) {
    window.open(e.target.src, '_blank');
    return;
  }
  const bubble = e.target.closest('.msg-bubble');
  if (!bubble) return;
  const msgDiv = bubble.closest('.msg');
  if (!msgDiv) return;
  const n = msgDiv.querySelector('.msg-nickname');
  const t = msgDiv.querySelector('.msg-text');
  const img = msgDiv.querySelector('.msg-image');
  setReply({
    id: msgDiv.dataset.msgId,
    sender: { nickname: n ? n.textContent : '' },
    text: t ? t.textContent : '',
    image: img ? img.src : '',
  });
});

// ─── Smooth scroll (requestAnimationFrame) ───
let scrollPending = false;
function scrollNow() {
  if (scrollPending) return;
  scrollPending = true;
  requestAnimationFrame(() => {
    msgBox.scrollTop = msgBox.scrollHeight;
    scrollPending = false;
  });
}
