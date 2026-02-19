// server.mjs - Professional AI Chat Interface
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// ==================== IN-MEMORY DATABASE ====================
const MemoryDB = {
  users: new Map(),
  sessions: new Map(),
  chats: new Map(),
  coins: new Map(),
  
  createUser: (userData) => {
    const id = crypto.randomBytes(16).toString('hex');
    const user = { id, ...userData, createdAt: Date.now() };
    MemoryDB.users.set(id, user);
    return user;
  },
  
  findUserByEmail: (email) => {
    for (const user of MemoryDB.users.values()) {
      if (user.email === email) return user;
    }
    return null;
  },
  
  findUserById: (id) => MemoryDB.users.get(id),
  
  addChat: (userId, message, sender) => {
    const userChats = MemoryDB.chats.get(userId) || [];
    const chat = {
      id: crypto.randomBytes(8).toString('hex'),
      userId,
      message,
      sender,
      timestamp: Date.now()
    };
    userChats.push(chat);
    MemoryDB.chats.set(userId, userChats);
    return chat;
  },
  
  getUserChats: (userId) => MemoryDB.chats.get(userId) || [],
  
  getCoins: (userId) => MemoryDB.coins.get(userId) || 0,
  
  addCoins: (userId, amount) => {
    const current = MemoryDB.coins.get(userId) || 0;
    const newAmount = Math.min(current + amount, 99999);
    MemoryDB.coins.set(userId, newAmount);
    return newAmount;
  },
  
  createSession: (userId) => {
    const token = jwt.sign({ userId }, 'neko-pro-secret-key', { expiresIn: '7d' });
    MemoryDB.sessions.set(token, { userId, createdAt: Date.now() });
    return token;
  },
  
  verifySession: (token) => {
    try {
      const decoded = jwt.verify(token, 'neko-pro-secret-key');
      const session = MemoryDB.sessions.get(token);
      if (!session) return null;
      return MemoryDB.users.get(decoded.userId);
    } catch {
      return null;
    }
  },
  
  deleteSession: (token) => MemoryDB.sessions.delete(token)
};

// ==================== MIDDLEWARE ====================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static('public'));

app.use(session({
  secret: 'neko-pro-session',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

const requireAuth = (req, res, next) => {
  const token = req.cookies?.neko_token;
  if (!token) return res.redirect('/login');
  
  const user = MemoryDB.verifySession(token);
  if (!user) {
    res.clearCookie('neko_token');
    return res.redirect('/login');
  }
  
  req.user = user;
  res.locals.user = user;
  next();
};

// ==================== API ROUTES ====================

app.post('/api/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) return res.status(400).json({ error: 'Field wajib diisi' });
    if (password.length < 6) return res.status(400).json({ error: 'Password minimal 6 karakter' });
    if (MemoryDB.findUserByEmail(email)) return res.status(400).json({ error: 'Email sudah ada' });
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = MemoryDB.createUser({ username, email, password: hashedPassword, coins: 0 });
    const token = MemoryDB.createSession(user.id);
    
    res.cookie('neko_token', token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
    res.json({ success: true, user: { id: user.id, username: user.username, email: user.email, coins: 0 } });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = MemoryDB.findUserByEmail(email);
    if (!user || !await bcrypt.compare(password, user.password)) {
      return res.status(401).json({ error: 'Email atau password salah' });
    }
    
    const token = MemoryDB.createSession(user.id);
    res.cookie('neko_token', token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
    res.json({ success: true, user: { id: user.id, username: user.username, email: user.email, coins: MemoryDB.getCoins(user.id) } });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/logout', (req, res) => {
  const token = req.cookies?.neko_token;
  if (token) MemoryDB.deleteSession(token);
  res.clearCookie('neko_token');
  res.json({ success: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: { id: req.user.id, username: req.user.username, email: req.user.email, coins: MemoryDB.getCoins(req.user.id) } });
});

app.post('/api/chat', requireAuth, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: 'Pesan kosong' });
    
    MemoryDB.addChat(req.user.id, message, 'user');
    
    // Simulated AI Delay & Logic
    await new Promise(r => setTimeout(r, 1000 + Math.random() * 1000));
    
    const currentCoins = MemoryDB.getCoins(req.user.id);
    let responseText = "Halo! Ada yang bisa Neko bantu hari ini? 🐱";
    let coinsEarned = 0;
    
    // Simple logic for demo variety
    const lowerMsg = message.toLowerCase();
    if (lowerMsg.includes('halo') || lowerMsg.includes('hi')) {
      responseText = "Hai Meng! Siap ngobrol apa nih?";
    } else if (lowerMsg.includes('kabar') || lowerMsg.includes('apa kabar')) {
      responseText = "Neko sehat-sehat aja! Kamu gimana?";
    } else if (lowerMsg.includes('siapa')) {
      responseText = "Gue Neko, asisten virtual kucing paling keren!";
    } else if (Math.random() > 0.7) {
      coinsEarned = Math.floor(Math.random() * 5) * 10 + 10; // 10, 20, 30, 40, 50
      MemoryDB.addCoins(req.user.id, coinsEarned);
      responseText = `Wah menarik! Neko kasih ${coinsEarned} koin buat lo! 🎉`;
    } else {
      const responses = [
        "Oke, mengerti.",
        "Bisa dijelaskan lebih lanjut?",
        "Hmm, poin yang bagus!",
        "Neko setuju sama itu.",
        "Menarik banget pembahasannya."
      ];
      responseText = responses[Math.floor(Math.random() * responses.length)];
    }
    
    const aiChat = MemoryDB.addChat(req.user.id, responseText, 'ai');
    
    io.to(`user-${req.user.id}`).emit('new-message', {
      ai: { id: aiChat.id, message: responseText, timestamp: aiChat.timestamp },
      coins: coinsEarned
    });
    
    res.json({ success: true, response: responseText, coins: coinsEarned, totalCoins: MemoryDB.getCoins(req.user.id) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Gagal memproses' });
  }
});

app.get('/api/chats', requireAuth, (req, res) => {
  res.json({ chats: MemoryDB.getUserChats(req.user.id) });
});

// ==================== SOCKET.IO ====================
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Auth error'));
  const user = MemoryDB.verifySession(token);
  if (!user) return next(new Error('Invalid token'));
  socket.user = user;
  next();
});

io.on('connection', (socket) => {
  socket.join(`user-${socket.user.id}`);
  socket.emit('chat-history', MemoryDB.getUserChats(socket.user.id));
  socket.on('disconnect', () => {});
});

// ==================== HTML TEMPLATES ====================

// Login Page
app.get('/login', (req, res) => {
  if (req.cookies?.neko_token && MemoryDB.verifySession(req.cookies.neko_token)) return res.redirect('/');
  
  res.send(`
    <!DOCTYPE html>
    <html lang="id">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Login - Neko AI</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
      <style>
        body { background-color: #343541; color: #ececf1; font-family: 'Söhne', 'ui-sans-serif', 'system-ui', sans-serif; }
        .input-dark { background-color: #40414f; border: 1px solid #565869; color: white; }
        .input-dark:focus { border-color: #8e8ea0; outline: none; }
        .btn-primary { background-color: #10a37f; transition: background 0.2s; }
        .btn-primary:hover { background-color: #1a7f64; }
      </style>
    </head>
    <body class="flex h-screen w-full items-center justify-center bg-[#343541]">
      <div class="w-full max-w-md p-6">
        <div class="text-center mb-8">
          <h1 class="text-3xl font-bold mb-2">Neko AI</h1>
          <p class="text-gray-400">Masuk untuk melanjutkan</p>
        </div>
        
        <div id="auth-form" class="bg-[#202123] p-6 rounded-lg shadow-lg">
          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium mb-1 text-gray-300">Email</label>
              <input type="email" id="email" class="w-full p-3 rounded-md input-dark" placeholder="nama@email.com">
            </div>
            <div>
              <label class="block text-sm font-medium mb-1 text-gray-300">Password</label>
              <input type="password" id="password" class="w-full p-3 rounded-md input-dark" placeholder="••••••••">
            </div>
            <button onclick="handleAuth()" class="w-full py-3 rounded-md btn-primary text-white font-semibold">
              <span id="btn-text">Masuk</span>
            </button>
          </div>
          
          <div class="mt-4 text-center text-sm text-gray-400">
            <span id="toggle-text">Belum punya akun?</span>
            <button onclick="toggleMode()" class="text-blue-400 hover:underline ml-1" id="toggle-btn">Daftar</button>
          </div>
          
          <div id="error-msg" class="mt-4 text-red-400 text-center text-sm hidden"></div>
        </div>
      </div>

      <script>
        let isLogin = true;
        function toggleMode() {
          isLogin = !isLogin;
          document.getElementById('btn-text').textContent = isLogin ? 'Masuk' : 'Daftar';
          document.getElementById('toggle-text').textContent = isLogin ? 'Belum punya akun?' : 'Sudah punya akun?';
          document.getElementById('toggle-btn').textContent = isLogin ? 'Daftar' : 'Masuk';
          document.getElementById('error-msg').classList.add('hidden');
        }
        
        async function handleAuth() {
          const email = document.getElementById('email').value;
          const password = document.getElementById('password').value;
          const url = isLogin ? '/api/login' : '/api/register';
          const errorMsg = document.getElementById('error-msg');
          
          try {
            const res = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                email, 
                password, 
                username: isLogin ? undefined : email.split('@')[0] 
              })
            });
            const data = await res.json();
            
            if (data.success) {
              window.location.href = '/';
            } else {
              errorMsg.textContent = data.error || 'Terjadi kesalahan';
              errorMsg.classList.remove('hidden');
            }
          } catch (e) {
            errorMsg.textContent = 'Koneksi error';
            errorMsg.classList.remove('hidden');
          }
        }
      </script>
    </body>
    </html>
  `);
});

// Main Chat Interface
app.get('/', requireAuth, (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="id">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Neko AI</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <script src="https://cdn.socket.io/4.5.4/socket.io.min.js"></script>
      <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
      <style>
        /* Modern AI Chat Theme */
        :root {
          --bg-dark: #343541;
          --sidebar-dark: #202123;
          --input-bg: #40414f;
          --text-primary: #ececf1;
          --text-secondary: #c5c5d2;
          --user-msg-bg: #343541; /* Transparent/Darker */
          --ai-msg-bg: #444654; /* Slightly lighter */
        }

        body {
          background-color: var(--bg-dark);
          color: var(--text-primary);
          font-family: 'Söhne', 'ui-sans-serif', 'system-ui', -apple-system, sans-serif;
          display: flex;
          height: 100vh;
          overflow: hidden;
        }

        /* Scrollbar styling */
        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #565869; border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: #8e8ea0; }

        /* Sidebar */
        .sidebar {
          background-color: var(--sidebar-dark);
          display: flex;
          flex-direction: column;
          padding: 10px;
          transition: transform 0.3s ease;
          z-index: 20;
        }
        
        .new-chat-btn {
          border: 1px solid #565869;
          border-radius: 5px;
          padding: 10px;
          display: flex;
          align-items: center;
          gap: 10px;
          color: white;
          cursor: pointer;
          transition: background 0.2s;
          font-size: 14px;
        }
        .new-chat-btn:hover { background-color: #2b2c2f; }

        /* Chat Area */
        .chat-area {
          flex: 1;
          display: flex;
          flex-direction: column;
          position: relative;
          background-color: var(--bg-dark);
        }

        .messages-container {
          flex: 1;
          overflow-y: auto;
          padding-bottom: 150px; /* Space for input */
          scroll-behavior: smooth;
        }

        .message-row {
          border-bottom: 1px solid rgba(0,0,0,0.1);
          padding: 24px 0;
          width: 100%;
        }
        
        .message-row.ai { background-color: var(--ai-msg-bg); }
        .message-row.user { background-color: var(--bg-dark); }

        .message-content {
          max-width: 800px;
          margin: 0 auto;
          display: flex;
          gap: 20px;
          padding: 0 20px;
          line-height: 1.6;
          font-size: 16px;
        }

        .avatar {
          width: 30px;
          height: 30px;
          border-radius: 2px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        
        .avatar-ai { background-color: #10a37f; }
        .avatar-user { background-color: #5436DA; }

        .text-bubble { flex: 1; word-wrap: break-word; }
        .text-bubble p { margin-bottom: 1em; }
        .text-bubble p:last-child { margin-bottom: 0; }

        /* Input Area */
        .input-area-wrapper {
          position: absolute;
          bottom: 0;
          left: 0;
          width: 100%;
          background-image: linear-gradient(180deg, rgba(53,53,65,0), #343541 20%);
          padding: 20px;
          padding-bottom: 30px;
        }

        .input-box {
          max-width: 800px;
          margin: 0 auto;
          position: relative;
          background-color: var(--input-bg);
          border: 1px solid rgba(32,33,35,0.5);
          border-radius: 12px;
          box-shadow: 0 0 15px rgba(0,0,0,0.1);
          display: flex;
          align-items: flex-end;
          padding: 10px 10px 10px 16px;
        }

        textarea {
          background: transparent;
          border: none;
          color: white;
          width: 100%;
          resize: none;
          max-height: 200px;
          height: 24px;
            padding-right: 40px;
          outline: none;
          line-height: 24px;
          font-family: inherit;
        }

        .send-btn {
          background: transparent;
          border: none;
          color: #8e8ea0;
          cursor: pointer;
          padding: 4px 8px;
          border-radius: 4px;
          transition: all 0.2s;
        }
        
        .send-btn.active { background-color: #19c37d; color: white; }
        .send-btn:disabled { cursor: not-allowed; opacity: 0.5; }

        /* Typing Indicator */
        .typing-dots { display: flex; gap: 4px; padding: 10px 0; }
        .dot {
          width: 8px; height: 8px; background: #8e8ea0; border-radius: 50%;
          animation: bounce 1.4s infinite ease-in-out both;
        }
        .dot:nth-child(1) { animation-delay: -0.32s; }
        .dot:nth-child(2) { animation-delay: -0.16s; }
        @keyframes bounce { 0%, 80%, 100% { transform: scale(0); } 40% { transform: scale(1); } }

        /* Mobile Sidebar Toggle */
        .mobile-menu-btn { display: none; }
        
        @media (max-width: 768px) {
          .sidebar {
            position: fixed;
            height: 100%;
            transform: translateX(-100%);
          }
          .sidebar.open { transform: translateX(0); }
          .mobile-menu-btn { display: block; color: white; font-size: 20px; }
          .message-content { padding: 0 10px; gap: 10px; }
          .input-area-wrapper { padding: 10px; }
        }
        
        /* Coin Badge */
        .coin-badge {
          background: rgba(16, 163, 127, 0.2);
          color: #10a37f;
          padding: 4px 10px;
          border-radius: 12px;
          font-size: 12px;
          font-weight: bold;
          display: flex;
          align-items: center;
          gap: 5px;
        }
      </style>
    </head>
    <body>
      
      <!-- SIDEBAR -->
      <aside class="sidebar w-64 md:flex flex-col" id="sidebar">
        <button onclick="resetChat()" class="new-chat-btn mb-4">
          <i class="fas fa-plus"></i>
          <span>Chat Baru</span>
        </button>

        <div class="flex-1 overflow-y-auto">
          <div class="text-xs text-gray-500 font-medium px-2 py-2">Hari Ini</div>
          <div class="text-sm text-gray-300 px-2 py-2 hover:bg-[#2A2B32] rounded cursor-pointer flex items-center gap-2">
            <i class="fas fa-message text-xs"></i> Neko AI Chat
          </div>
        </div>

        <div class="border-t border-gray-700 pt-4 mt-4">
          <div class="flex items-center gap-3 px-2 py-2 hover:bg-[#2A2B32] rounded cursor-pointer" onclick="logout()">
            <div class="avatar avatar-user w-8 h-8 text-xs text-white">
              ${req.user.username.substring(0,2).toUpperCase()}
            </div>
            <div class="flex-1 text-sm truncate text-white">${req.user.username}</div>
            <i class="fas fa-sign-out-alt text-gray-400"></i>
          </div>
        </div>
      </aside>

      <!-- Overlay for mobile -->
      <div id="sidebar-overlay" class="fixed inset-0 bg-black/50 z-10 hidden md:hidden" onclick="toggleSidebar()"></div>

      <!-- MAIN CHAT AREA -->
      <main class="chat-area">
        <!-- Header (Mobile Only) -->
        <div class="md:hidden flex items-center justify-between p-4 border-b border-gray-700">
          <button onclick="toggleSidebar()" class="mobile-menu-btn">
            <i class="fas fa-bars"></i>
          </button>
          <span class="font-semibold">Neko AI</span>
          <div class="coin-badge">
            <i class="fas fa-coins"></i> <span id="mobile-coin">0</span>
          </div>
        </div>

        <!-- Messages -->
        <div id="messages-container" class="messages-container">
          <!-- Welcome Message -->
          <div class="message-row ai">
            <div class="message-content">
              <div class="avatar avatar-ai"><i class="fas fa-cat text-white text-sm"></i></div>
              <div class="text-bubble">
                <p>Halo ${req.user.username}! Saya Neko AI. Ada yang bisa saya bantu hari ini? 🐱</p>
              </div>
            </div>
          </div>
          <!-- Chat history will be loaded here -->
        </div>

        <!-- Input Area -->
        <div class="input-area-wrapper">
          <div class="flex justify-between items-center mb-2 text-xs text-gray-400 max-w-[800px] mx-auto px-2">
            <span>Neko AI mungkin membuat kesalahan. Pertimbangkan untuk memeriksa informasi penting.</span>
          </div>
          <div class="input-box">
            <textarea id="user-input" rows="1" placeholder="Kirim pesan ke Neko..."></textarea>
            <button id="send-btn" class="send-btn" disabled>
              <i class="fas fa-paper-plane"></i>
            </button>
          </div>
          <div class="text-center mt-2 text-xs text-gray-500 hidden md:block">
            <span class="coin-badge mx-auto mt-2">
              <i class="fas fa-coins"></i> <span id="desktop-coin">0</span>
            </span>
          </div>
        </div>
      </main>

      <script>
        const socket = io({ auth: { token: getCookie('neko_token') } });
        let coinCount = 0;

        // Elements
        const messagesContainer = document.getElementById('messages-container');
        const userInput = document.getElementById('user-input');
        const sendBtn = document.getElementById('send-btn');
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        
        // Auto resize textarea
        userInput.addEventListener('input', function() {
          this.style.height = 'auto';
          this.style.height = (this.scrollHeight) + 'px';
          if(this.value.trim().length > 0) {
            sendBtn.classList.add('active');
            sendBtn.disabled = false;
          } else {
            sendBtn.classList.remove('active');
            sendBtn.disabled = true;
          }
        });

        // Send Message
        async function sendMessage() {
          const text = userInput.value.trim();
          if (!text) return;

          // UI Updates
          appendMessage('user', text);
          userInput.value = '';
          userInput.style.height = '24px'; // Reset height
          sendBtn.classList.remove('active');
          sendBtn.disabled = true;

          // Show Typing
          const typingId = showTyping();

          try {
            const res = await fetch('/api/chat', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ message: text })
            });
            const data = await res.json();
            
            removeTyping(typingId);
            
            if (data.success) {
              appendMessage('ai', data.response);
              if (data.coins > 0) updateCoins(data.totalCoins);
            }
          } catch (err) {
            removeTyping(typingId);
            appendMessage('ai', 'Maaf, terjadi kesalahan koneksi.');
          }
        }

        // Keyboard Enter
        userInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
          }
        });

        sendBtn.addEventListener('click', sendMessage);

        // Helper: Append Message
        function appendMessage(role, text) {
          const div = document.createElement('div');
          div.className = \`message-row \${role}\`;
          const icon = role === 'ai' ? 'fa-cat' : 'fa-user';
          const avatarClass = role === 'ai' ? 'avatar-ai' : 'avatar-user';
          const initials = role === 'user' ? '${req.user.username.substring(0,2).toUpperCase()}' : '';
          
          div.innerHTML = \`
            <div class="message-content">
              <div class="avatar \${avatarClass}">
                \${role === 'ai' ? '<i class="fas fa-cat text-white text-sm"></i>' : '<span class="text-xs text-white">'+initials+'</span>'}
              </div>
              <div class="text-bubble">
                <p>\${text}</p>
              </div>
            </div>
          \`;
          messagesContainer.appendChild(div);
          scrollToBottom();
        }

        // Helper: Typing Indicator
        function showTyping() {
          const id = 'typing-' + Date.now();
          const div = document.createElement('div');
          div.id = id;
          div.className = 'message-row ai';
          div.innerHTML = \`
            <div class="message-content">
              <div class="avatar avatar-ai"><i class="fas fa-cat text-white text-sm"></i></div>
              <div class="text-bubble">
                <div class="typing-dots">
                  <div class="dot"></div><div class="dot"></div><div class="dot"></div>
                </div>
              </div>
            </div>
          \`;
          messagesContainer.appendChild(div);
          scrollToBottom();
          return id;
        }

        function removeTyping(id) {
          const el = document.getElementById(id);
          if (el) el.remove();
        }

        function scrollToBottom() {
          messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }

        // Load Initial Data
        (async function init() {
          // User Data
          const meRes = await fetch('/api/me');
          const meData = await meRes.json();
          if (meData.user) updateCoins(meData.user.coins);

          // Chat History
          const chatRes = await fetch('/api/chats');
          const chatData = await chatRes.json();
          if (chatData.chats && chatData.chats.length > 0) {
            // Remove welcome message if history exists
            if(messagesContainer.children.length > 0 && messagesContainer.children[0].classList.contains('ai')) {
                messagesContainer.innerHTML = '';
            }
            chatData.chats.forEach(c => appendMessage(c.sender, c.message));
            scrollToBottom();
          }
        })();

        // Socket Events
        socket.on('new-message', (data) => {
           // Optional: Real-time updates if other tabs are open
           if (data.ai) appendMessage('ai', data.ai.message);
           if (data.coins > 0) updateCoins(data.coins); // socket sends increment or total logic depends on backend
        });

        // Sidebar Toggle
        function toggleSidebar() {
          sidebar.classList.toggle('open');
          overlay.classList.toggle('hidden');
        }

        function resetChat() {
           if(confirm("Mulai chat baru? Chat saat ini akan hilang dari layar.")) {
              messagesContainer.innerHTML = '';
              appendMessage('ai', 'Halo! Siap memulai obrolan baru? 🐱');
              if(window.innerWidth <= 768) toggleSidebar();
           }
        }

        function updateCoins(amount) {
          coinCount = amount;
          document.getElementById('desktop-coin').textContent = coinCount;
          document.getElementById('mobile-coin').textContent = coinCount;
        }

        function logout() {
           fetch('/api/logout', { method: 'POST' }).then(() => window.location.href = '/login');
        }

        function getCookie(name) {
          const value = "; " + document.cookie;
          const parts = value.split("; " + name + "=");
          if (parts.length == 2) return parts.pop().split(";").shift();
        }
      </script>
    </body>
    </html>
  `);
});

// ==================== START SERVER ====================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`
  🐱 =========================================
     Neko AI Professional Server Ready!
     URL: http://localhost:${PORT}
     Mode: Single File (No DB Required)
  🐱 =========================================
  `);
});

export default app;
