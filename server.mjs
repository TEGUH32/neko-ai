// server.mjs - Main server file (single file)
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
  
  // Users methods
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
  
  updateUser: (id, data) => {
    const user = MemoryDB.users.get(id);
    if (user) {
      Object.assign(user, data);
      MemoryDB.users.set(id, user);
      return user;
    }
    return null;
  },
  
  // Chat methods
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
  
  // Coins methods
  getCoins: (userId) => MemoryDB.coins.get(userId) || 0,
  
  addCoins: (userId, amount) => {
    const current = MemoryDB.coins.get(userId) || 0;
    const newAmount = Math.min(current + amount, 1200);
    MemoryDB.coins.set(userId, newAmount);
    return newAmount;
  },
  
  // Session methods
  createSession: (userId) => {
    const token = jwt.sign({ userId }, 'neko-secret-key', { expiresIn: '7d' });
    MemoryDB.sessions.set(token, { userId, createdAt: Date.now() });
    return token;
  },
  
  verifySession: (token) => {
    try {
      const decoded = jwt.verify(token, 'neko-secret-key');
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

// Session middleware
app.use(session({
  secret: 'neko-session-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// Auth middleware
const requireAuth = (req, res, next) => {
  const token = req.cookies?.neko_token;
  if (!token) {
    if (req.xhr || req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    return res.redirect('/login');
  }
  
  const user = MemoryDB.verifySession(token);
  if (!user) {
    res.clearCookie('neko_token');
    if (req.xhr || req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Invalid session' });
    }
    return res.redirect('/login');
  }
  
  req.user = user;
  res.locals.user = user;
  next();
};

// ==================== API ROUTES ====================

// Auth Routes
app.post('/api/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Semua field harus diisi' });
    }
    
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password minimal 6 karakter' });
    }
    
    const existingUser = MemoryDB.findUserByEmail(email);
    if (existingUser) {
      return res.status(400).json({ error: 'Email sudah terdaftar' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = MemoryDB.createUser({
      username,
      email,
      password: hashedPassword,
      coins: 0
    });
    
    const token = MemoryDB.createSession(user.id);
    res.cookie('neko_token', token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
    
    res.json({
      success: true,
      user: { id: user.id, username: user.username, email: user.email, coins: 0 }
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Terjadi kesalahan server' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const user = MemoryDB.findUserByEmail(email);
    if (!user) {
      return res.status(401).json({ error: 'Email atau password salah' });
    }
    
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Email atau password salah' });
    }
    
    const token = MemoryDB.createSession(user.id);
    res.cookie('neko_token', token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
    
    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        coins: MemoryDB.getCoins(user.id)
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Terjadi kesalahan server' });
  }
});

app.post('/api/logout', (req, res) => {
  const token = req.cookies?.neko_token;
  if (token) {
    MemoryDB.deleteSession(token);
    res.clearCookie('neko_token');
  }
  res.json({ success: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({
    user: {
      id: req.user.id,
      username: req.user.username,
      email: req.user.email,
      coins: MemoryDB.getCoins(req.user.id)
    }
  });
});

// Chat Routes
app.post('/api/chat', requireAuth, async (req, res) => {
  try {
    const { message } = req.body;
    
    if (!message || message.trim().length === 0) {
      return res.status(400).json({ error: 'Pesan tidak boleh kosong' });
    }
    
    // Save user message
    MemoryDB.addChat(req.user.id, message, 'user');
    
    // Get AI response (simulated)
    const aiResponse = await getAIResponse(message, req.user);
    
    // Save AI response
    const aiChat = MemoryDB.addChat(req.user.id, aiResponse.text, 'ai');
    
    // Add coins if mentioned
    if (aiResponse.coins > 0) {
      MemoryDB.addCoins(req.user.id, aiResponse.coins);
    }
    
    // Emit to socket
    io.to(`user-${req.user.id}`).emit('new-message', {
      user: { id: req.user.id, message, timestamp: Date.now() },
      ai: { id: aiChat.id, message: aiResponse.text, timestamp: aiChat.timestamp },
      coins: aiResponse.coins
    });
    
    res.json({
      success: true,
      response: aiResponse.text,
      coins: aiResponse.coins,
      totalCoins: MemoryDB.getCoins(req.user.id)
    });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Gagal memproses pesan' });
  }
});

app.get('/api/chats', requireAuth, (req, res) => {
  const chats = MemoryDB.getUserChats(req.user.id);
  res.json({ chats });
});

// Simulated AI Response
async function getAIResponse(userMessage, user) {
  const currentCoins = MemoryDB.getCoins(user.id);
  const messages = [
    "Halo Meng! Ada yang bisa Neko bantu? 🐱",
    "Waduh, Neko lagi mikir keras nih...",
    "Hmm, gimana ya? Kasih alasan yang lebih bagus dong!",
    "Nih, Neko kasih 100 koin buat usaha lo!",
    "Astaga, kreatif juga lo! Neko tambah 200 koin deh",
    "Koin lo sekarang " + currentCoins + " Meng. Mau nambah?",
    "Neko suka sama alasan lo! Dapet 150 koin nih",
    "Maap Meng, alasan lo kurang greget. Coba lagi!"
  ];
  
  // Random response with occasional coins
  const randomIndex = Math.floor(Math.random() * messages.length);
  let coins = 0;
  
  // 30% chance to get coins
  if (Math.random() < 0.3) {
    coins = [50, 100, 150, 200][Math.floor(Math.random() * 4)];
  }
  
  return {
    text: messages[randomIndex] + (coins > 0 ? ` 🎉 Dapet ${coins} koin!` : ''),
    coins
  };
}

// ==================== SOCKET.IO ====================
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Authentication error'));
  
  const user = MemoryDB.verifySession(token);
  if (!user) return next(new Error('Invalid token'));
  
  socket.user = user;
  next();
});

io.on('connection', (socket) => {
  console.log('🔌 User connected:', socket.user.username);
  
  // Join personal room
  socket.join(`user-${socket.user.id}`);
  
  // Send chat history
  const chats = MemoryDB.getUserChats(socket.user.id);
  socket.emit('chat-history', chats);
  
  socket.on('typing', (isTyping) => {
    socket.broadcast.to(`user-${socket.user.id}`).emit('user-typing', {
      userId: socket.user.id,
      username: socket.user.username,
      isTyping
    });
  });
  
  socket.on('disconnect', () => {
    console.log('🔌 User disconnected:', socket.user.username);
  });
});

// ==================== HTML ROUTES (Single Page) ====================

// Login page
app.get('/login', (req, res) => {
  const token = req.cookies?.neko_token;
  if (token && MemoryDB.verifySession(token)) {
    return res.redirect('/');
  }
  
  res.send(`
    <!DOCTYPE html>
    <html lang="id">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Neko AI - Login</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
      <style>
        @keyframes float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }
        .float { animation: float 3s ease-in-out infinite; }
        .gradient-bg {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        }
        .glass-effect {
          background: rgba(255, 255, 255, 0.95);
          backdrop-filter: blur(10px);
          border: 1px solid rgba(255, 255, 255, 0.2);
        }
      </style>
    </head>
    <body class="gradient-bg min-h-screen flex items-center justify-center p-4">
      <div class="glass-effect rounded-2xl shadow-2xl w-full max-w-md p-8 transform transition-all hover:scale-105">
        <div class="text-center mb-8">
          <div class="text-7xl mb-4 float">🐱</div>
          <h1 class="text-3xl font-bold text-gray-800">Neko AI</h1>
          <p class="text-gray-600 mt-2">Chat dengan kucing paling asik</p>
        </div>
        
        <div id="login-form" class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Email</label>
            <input type="email" id="login-email" class="w-full px-4 py-3 rounded-lg border border-gray-300 focus:border-purple-500 focus:ring-2 focus:ring-purple-200 outline-none transition" placeholder="email@example.com">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Password</label>
            <input type="password" id="login-password" class="w-full px-4 py-3 rounded-lg border border-gray-300 focus:border-purple-500 focus:ring-2 focus:ring-purple-200 outline-none transition" placeholder="••••••••">
          </div>
          <button onclick="handleLogin()" class="w-full bg-purple-600 text-white py-3 rounded-lg font-semibold hover:bg-purple-700 transition transform hover:scale-105">
            <i class="fas fa-sign-in-alt mr-2"></i>Login
          </button>
          <p class="text-center text-gray-600">Belum punya akun? 
            <button onclick="showRegister()" class="text-purple-600 font-semibold hover:underline">Daftar</button>
          </p>
        </div>
        
        <div id="register-form" class="space-y-4 hidden">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Username</label>
            <input type="text" id="reg-username" class="w-full px-4 py-3 rounded-lg border border-gray-300 focus:border-purple-500 focus:ring-2 focus:ring-purple-200 outline-none transition" placeholder="neko lover">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Email</label>
            <input type="email" id="reg-email" class="w-full px-4 py-3 rounded-lg border border-gray-300 focus:border-purple-500 focus:ring-2 focus:ring-purple-200 outline-none transition" placeholder="email@example.com">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Password</label>
            <input type="password" id="reg-password" class="w-full px-4 py-3 rounded-lg border border-gray-300 focus:border-purple-500 focus:ring-2 focus:ring-purple-200 outline-none transition" placeholder="minimal 6 karakter">
          </div>
          <button onclick="handleRegister()" class="w-full bg-green-600 text-white py-3 rounded-lg font-semibold hover:bg-green-700 transition transform hover:scale-105">
            <i class="fas fa-user-plus mr-2"></i>Daftar
          </button>
          <p class="text-center text-gray-600">Sudah punya akun? 
            <button onclick="showLogin()" class="text-purple-600 font-semibold hover:underline">Login</button>
          </p>
        </div>
        
        <div id="error-message" class="mt-4 text-red-500 text-center hidden"></div>
      </div>
      
      <script>
        function showRegister() {
          document.getElementById('login-form').classList.add('hidden');
          document.getElementById('register-form').classList.remove('hidden');
          document.getElementById('error-message').classList.add('hidden');
        }
        
        function showLogin() {
          document.getElementById('login-form').classList.remove('hidden');
          document.getElementById('register-form').classList.add('hidden');
          document.getElementById('error-message').classList.add('hidden');
        }
        
        async function handleLogin() {
          const email = document.getElementById('login-email').value;
          const password = document.getElementById('login-password').value;
          
          if (!email || !password) {
            showError('Email dan password harus diisi');
            return;
          }
          
          try {
            const res = await fetch('/api/login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email, password })
            });
            
            const data = await res.json();
            
            if (data.success) {
              window.location.href = '/';
            } else {
              showError(data.error || 'Login gagal');
            }
          } catch (err) {
            showError('Terjadi kesalahan, coba lagi');
          }
        }
        
        async function handleRegister() {
          const username = document.getElementById('reg-username').value;
          const email = document.getElementById('reg-email').value;
          const password = document.getElementById('reg-password').value;
          
          if (!username || !email || !password) {
            showError('Semua field harus diisi');
            return;
          }
          
          if (password.length < 6) {
            showError('Password minimal 6 karakter');
            return;
          }
          
          try {
            const res = await fetch('/api/register', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ username, email, password })
            });
            
            const data = await res.json();
            
            if (data.success) {
              window.location.href = '/';
            } else {
              showError(data.error || 'Registrasi gagal');
            }
          } catch (err) {
            showError('Terjadi kesalahan, coba lagi');
          }
        }
        
        function showError(msg) {
          const errorDiv = document.getElementById('error-message');
          errorDiv.textContent = msg;
          errorDiv.classList.remove('hidden');
          setTimeout(() => errorDiv.classList.add('hidden'), 3000);
        }
      </script>
    </body>
    </html>
  `);
});

// Main chat app
app.get('/', requireAuth, (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="id">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Neko AI Chat</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <script src="https://cdn.socket.io/4.5.4/socket.io.min.js"></script>
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        :root {
          --primary: #8b5cf6;
          --primary-dark: #7c3aed;
          --bg: #f3f4f6;
        }
        
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          height: 100vh;
          overflow: hidden;
        }
        
        .glass-header {
          background: rgba(255, 255, 255, 0.95);
          backdrop-filter: blur(10px);
          border-bottom: 1px solid rgba(255,255,255,0.2);
          box-shadow: 0 4px 30px rgba(0,0,0,0.1);
        }
        
        .chat-container {
          height: calc(100vh - 140px);
          overflow-y: auto;
          padding: 20px;
          scroll-behavior: smooth;
        }
        
        .message-bubble {
          max-width: 80%;
          padding: 12px 18px;
          border-radius: 20px;
          margin-bottom: 15px;
          animation: slideIn 0.3s ease;
          word-wrap: break-word;
          line-height: 1.5;
        }
        
        @keyframes slideIn {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        
        .user-message {
          background: linear-gradient(135deg, var(--primary), #9f7aea);
          color: white;
          margin-left: auto;
          border-bottom-right-radius: 5px;
        }
        
        .ai-message {
          background: white;
          color: #1f2937;
          margin-right: auto;
          border-bottom-left-radius: 5px;
          box-shadow: 0 2px 10px rgba(0,0,0,0.05);
        }
        
        .typing-indicator {
          display: none;
          background: white;
          padding: 12px 18px;
          border-radius: 20px;
          width: fit-content;
          margin-bottom: 15px;
        }
        
        .typing-dot {
          width: 8px;
          height: 8px;
          background: var(--primary);
          border-radius: 50%;
          display: inline-block;
          margin-right: 4px;
          animation: typingBounce 1.4s infinite ease-in-out;
        }
        
        @keyframes typingBounce {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-10px); }
        }
        
        .typing-dot:nth-child(1) { animation-delay: 0s; }
        .typing-dot:nth-child(2) { animation-delay: 0.2s; }
        .typing-dot:nth-child(3) { animation-delay: 0.4s; }
        
        .input-container {
          background: rgba(255, 255, 255, 0.95);
          backdrop-filter: blur(10px);
          padding: 15px 20px;
          border-top: 1px solid rgba(255,255,255,0.2);
        }
        
        .send-btn {
          background: linear-gradient(135deg, var(--primary), #9f7aea);
          transition: all 0.3s;
        }
        
        .send-btn:hover {
          transform: scale(1.05);
          box-shadow: 0 10px 25px rgba(139, 92, 246, 0.4);
        }
        
        .send-btn:active {
          transform: scale(0.95);
        }
        
        .coin-display {
          background: linear-gradient(135deg, #fbbf24, #f59e0b);
          box-shadow: 0 10px 25px rgba(245, 158, 11, 0.3);
        }
        
        .chat-container::-webkit-scrollbar {
          width: 6px;
        }
        
        .chat-container::-webkit-scrollbar-track {
          background: rgba(255,255,255,0.1);
        }
        
        .chat-container::-webkit-scrollbar-thumb {
          background: var(--primary);
          border-radius: 3px;
        }
        
        .chat-container::-webkit-scrollbar-thumb:hover {
          background: var(--primary-dark);
        }
        
        @media (max-width: 640px) {
          .message-bubble { max-width: 90%; font-size: 14px; }
          .glass-header { padding: 12px 16px; }
        }
      </style>
    </head>
    <body class="flex items-center justify-center p-4">
      <div class="w-full max-w-4xl h-full bg-white/10 backdrop-blur-lg rounded-3xl shadow-2xl overflow-hidden flex flex-col">
        <!-- Header -->
        <div class="glass-header px-6 py-4 flex items-center justify-between">
          <div class="flex items-center gap-4">
            <div class="text-4xl animate-bounce">🐱</div>
            <div>
              <h1 class="text-xl font-bold text-gray-800">Neko AI</h1>
              <div class="flex items-center gap-2">
                <span class="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                <span class="text-sm text-gray-600">Online</span>
              </div>
            </div>
          </div>
          
          <div class="flex items-center gap-4">
            <div class="coin-display px-4 py-2 rounded-full text-white font-bold flex items-center gap-2">
              <i class="fas fa-coins"></i>
              <span id="coin-count">0</span>
            </div>
            
            <div class="relative group">
              <button class="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center hover:bg-white/30 transition">
                <i class="fas fa-user text-white"></i>
              </button>
              
              <div class="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all">
                <div class="px-4 py-3 border-b">
                  <p class="font-semibold text-gray-800" id="user-name">${req.user.username}</p>
                  <p class="text-sm text-gray-600" id="user-email">${req.user.email}</p>
                </div>
                <button onclick="handleLogout()" class="w-full text-left px-4 py-3 text-red-600 hover:bg-red-50 transition flex items-center gap-2">
                  <i class="fas fa-sign-out-alt"></i>
                  <span>Logout</span>
                </button>
              </div>
            </div>
          </div>
        </div>
        
        <!-- Chat Container -->
        <div id="chat-container" class="chat-container flex-1">
          <div class="flex flex-col space-y-4" id="messages">
            <!-- Messages will be inserted here -->
          </div>
          
          <!-- Typing Indicator -->
          <div id="typing-indicator" class="typing-indicator">
            <span class="typing-dot"></span>
            <span class="typing-dot"></span>
            <span class="typing-dot"></span>
          </div>
        </div>
        
        <!-- Input Area -->
        <div class="input-container">
          <div class="flex items-center gap-3">
            <div class="flex-1 bg-gray-100 rounded-full px-5 py-3">
              <input 
                type="text" 
                id="message-input" 
                placeholder="Ketik pesan ke Neko..." 
                class="w-full bg-transparent outline-none text-gray-700"
                maxlength="500"
              >
            </div>
            <button 
              id="send-button"
              onclick="sendMessage()" 
              class="send-btn w-12 h-12 rounded-full text-white flex items-center justify-center"
            >
              <i class="fas fa-paper-plane"></i>
            </button>
          </div>
        </div>
      </div>
      
      <script>
        const socket = io({
          auth: { token: getCookie('neko_token') }
        });
        
        let currentCoins = 0;
        let isSending = false;
        
        // DOM Elements
        const messagesDiv = document.getElementById('messages');
        const chatContainer = document.getElementById('chat-container');
        const messageInput = document.getElementById('message-input');
        const typingIndicator = document.getElementById('typing-indicator');
        const coinDisplay = document.getElementById('coin-count');
        const sendButton = document.getElementById('send-button');
        
        // Load user data
        fetch('/api/me')
          .then(res => res.json())
          .then(data => {
            if (data.user) {
              document.getElementById('user-name').textContent = data.user.username;
              document.getElementById('user-email').textContent = data.user.email;
              currentCoins = data.user.coins;
              coinDisplay.textContent = currentCoins.toLocaleString();
            }
          });
        
        // Load chat history
        fetch('/api/chats')
          .then(res => res.json())
          .then(data => {
            if (data.chats && data.chats.length > 0) {
              data.chats.forEach(chat => {
                addMessageToChat(chat.message, chat.sender);
              });
            } else {
              // Welcome message
              addMessageToChat('Halo Meng! Gue Neko. Ada yang bisa dibantu? 🐱', 'ai');
            }
            scrollToBottom();
          });
        
        // Socket events
        socket.on('chat-history', (chats) => {
          messagesDiv.innerHTML = '';
          if (chats && chats.length > 0) {
            chats.forEach(chat => addMessageToChat(chat.message, chat.sender));
          } else {
            addMessageToChat('Halo Meng! Gue Neko. Ada yang bisa dibantu? 🐱', 'ai');
          }
          scrollToBottom();
        });
        
        socket.on('new-message', (data) => {
          if (data.user) {
            addMessageToChat(data.user.message, 'user');
          }
          if (data.ai) {
            addMessageToChat(data.ai.message, 'ai');
            if (data.coins > 0) {
              animateCoinIncrease(currentCoins, currentCoins + data.coins);
            }
          }
          scrollToBottom();
        });
        
        socket.on('user-typing', (data) => {
          // Handle typing indicator if needed
        });
        
        // Message input handlers
        messageInput.addEventListener('keypress', (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
          }
        });
        
        messageInput.addEventListener('input', () => {
          socket.emit('typing', messageInput.value.length > 0);
        });
        
        async function sendMessage() {
          const text = messageInput.value.trim();
          
          if (!text || isSending) return;
          
          isSending = true;
          sendButton.disabled = true;
          messageInput.disabled = true;
          
          // Show user message immediately
          addMessageToChat(text, 'user');
          messageInput.value = '';
          
          // Show typing indicator
          typingIndicator.style.display = 'block';
          scrollToBottom();
          
          try {
            const res = await fetch('/api/chat', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ message: text })
            });
            
            const data = await res.json();
            
            typingIndicator.style.display = 'none';
            
            if (data.success) {
              addMessageToChat(data.response, 'ai');
              
              if (data.coins > 0) {
                animateCoinIncrease(currentCoins, data.totalCoins);
              }
            } else {
              addMessageToChat('Maaf Meng, Neko lagi error. Coba lagi ya! 🐱', 'ai');
            }
          } catch (err) {
            typingIndicator.style.display = 'none';
            addMessageToChat('Koneksi bermasalah. Cek internet lo ya Meng!', 'ai');
          } finally {
            isSending = false;
            sendButton.disabled = false;
            messageInput.disabled = false;
            messageInput.focus();
          }
          
          scrollToBottom();
        }
        
        function addMessageToChat(text, sender) {
          const messageDiv = document.createElement('div');
          messageDiv.className = \`message-bubble \${sender === 'user' ? 'user-message' : 'ai-message'}\`;
          
          // Format text with paragraphs
          const paragraphs = text.split('\\n').filter(p => p.trim());
          if (paragraphs.length > 1) {
            paragraphs.forEach(p => {
              if (p.trim()) {
                const pElem = document.createElement('p');
                pElem.className = 'mb-2 last:mb-0';
                pElem.textContent = p.trim();
                messageDiv.appendChild(pElem);
              }
            });
          } else {
            messageDiv.textContent = text;
          }
          
          messagesDiv.appendChild(messageDiv);
        }
        
        function animateCoinIncrease(start, end) {
          const duration = 800;
          const steps = 30;
          const increment = (end - start) / steps;
          let current = start;
          let step = 0;
          
          const interval = setInterval(() => {
            step++;
            current += increment;
            
            if (step >= steps) {
              current = end;
              clearInterval(interval);
            }
            
            coinDisplay.textContent = Math.round(current).toLocaleString();
          }, duration / steps);
          
          currentCoins = end;
        }
        
        function scrollToBottom() {
          setTimeout(() => {
            chatContainer.scrollTo({
              top: chatContainer.scrollHeight,
              behavior: 'smooth'
            });
          }, 50);
        }
        
        function handleLogout() {
          fetch('/api/logout', { method: 'POST' })
            .then(() => {
              window.location.href = '/login';
            });
        }
        
        function getCookie(name) {
          const value = \`; \${document.cookie}\`;
          const parts = value.split(\`; \${name}=\`);
          if (parts.length === 2) return parts.pop().split(';').shift();
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
  🐱 ============================== 🐱
     Neko AI Server is running!
     http://localhost:${PORT}
  🐱 ============================== 🐱
  `);
});

export default app;
