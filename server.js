const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  transports: ['polling', 'websocket'],
  allowUpgrades: true,
  pingInterval: 25000,
  pingTimeout: 20000,
  maxHttpBufferSize: 5e6,
});

const ROOM_PASSWORD = '199796';
const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5e6 } });

// ─── Static ───
app.use(express.static(__dirname, { maxAge: '30m', etag: true }));

// ─── Serve uploaded images ───
app.get('/img/:filename', (req, res) => {
  const { filename } = req.params;
  if (filename.includes('..') || filename.includes('/')) return res.status(400).end();
  const filepath = path.join(UPLOAD_DIR, filename);
  if (!fs.existsSync(filepath)) return res.status(404).end();
  res.set('Cache-Control', 'public, max-age=86400');
  res.sendFile(filepath);
});

// ─── Upload image ───
app.post('/upload', upload.single('image'), (req, res) => {
  if (!req.file || req.file.size < 20) return res.status(400).json({ error: 'No data' });
  const raw = req.file.buffer;
  const sig = raw.slice(0, 4).toString('hex');
  const extMap = {
    '89504e47': 'png', 'ffd8ffe0': 'jpg', 'ffd8ffe1': 'jpg',
    'ffd8ffe2': 'jpg', 'ffd8ffe3': 'jpg', '47494638': 'gif',
    '52494646': 'webp',
  };
  const ext = extMap[sig] || 'jpg';
  const filename = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
  fs.writeFile(path.join(UPLOAD_DIR, filename), raw, (err) => {
    if (err) return res.status(500).json({ error: 'Write failed' });
    res.json({ url: `/img/${filename}` });
  });
});

// ─── Chat state ───
const chatHistory = [];
const onlineUsers = {};

// Trim history to last N
function trimHistory(max) {
  while (chatHistory.length > max) chatHistory.shift();
}

// Only keep last 150 messages of history instead of 500
const MAX_HISTORY = 150;

io.on('connection', (socket) => {
  let user = { nickname: '匿名用户', avatar: '' };
  let verified = false;

  // ─── Join ───
  socket.on('join', ({ password, user: u }) => {
    if (password !== ROOM_PASSWORD) {
      return socket.emit('join_error', '密码错误');
    }
    user.nickname = (u.nickname || '').trim().slice(0, 20) || '匿名用户';
    user.avatar = u.avatar || '';
    verified = true;

    // Add to room
    socket.join('room');
    onlineUsers[socket.id] = { nickname: user.nickname, avatar: user.avatar };
    io.to('room').emit('online_users', Object.values(onlineUsers));

    // Send history (strip avatars from history to keep payload small)
    const hist = chatHistory.slice(-MAX_HISTORY).map(m => {
      if (m.type === 'user' && m.sender) {
        return { ...m, sender: { ...m.sender, avatar: '' } };
      }
      return m;
    });
    socket.emit('history', hist);
    socket.emit('joined', { yourId: socket.id });

    // Broadcast join
    const sys = makeSys(`${user.nickname} 进入了聊天室`);
    chatHistory.push(sys);
    trimHistory(MAX_HISTORY);
    socket.to('room').emit('message', sys);
  });

  // ─── Chat message ───
  socket.on('chat_message', (data) => {
    if (!verified) return;
    const msg = {
      id: `${Date.now()}-${socket.id}-${Math.random().toString(36).slice(2, 5)}`,
      type: 'user',
      senderId: socket.id,
      sender: { nickname: user.nickname, avatar: user.avatar },
      text: (data.text || '').trim().slice(0, 2000),
      image: data.image || '',
      replyTo: data.replyTo || null,
      time: Date.now(),
    };
    chatHistory.push(msg);
    trimHistory(MAX_HISTORY);
    io.to('room').emit('message', msg);
  });

  // ─── Disconnect ───
  socket.on('disconnect', () => {
    if (verified) {
      delete onlineUsers[socket.id];
      io.to('room').emit('online_users', Object.values(onlineUsers));
      const sys = makeSys(`${user.nickname} 离开了聊天室`);
      chatHistory.push(sys);
      trimHistory(MAX_HISTORY);
      socket.to('room').emit('message', sys);
    }
  });

  function makeSys(text) {
    return { id: `${Date.now()}-sys`, type: 'system', text, time: Date.now() };
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`尝尝好吃吗 聊天室运行在 http://0.0.0.0:${PORT}`);
});
