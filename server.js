const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);

// Configure Socket.IO for production
const io = socketIo(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' 
      ? ["https://b-messenger.onrender.com", "https://*.onrender.com"]
      : "http://localhost:3000",
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

// Middleware
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? ["https://b-messenger.onrender.com", "https://*.onrender.com"]
    : "http://localhost:3000",
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use('/uploads', express.static('uploads'));
app.use(express.static(path.join(__dirname, 'public')));

// Environment variables
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/bmessenger';
const JWT_SECRET = process.env.JWT_SECRET || 'b-messenger-secret-key-2024-production-safe';
const PORT = process.env.PORT || 3000;

// MongoDB Schemas (same as before, keep your existing schemas)
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, index: true },
  displayName: { type: String, required: true },
  avatar: { type: String, default: '' },
  about: { type: String, default: 'Hey there! I am using B MESSENGER' },
  onlineStatus: { type: Boolean, default: false },
  lastSeen: { type: Date, default: Date.now },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  password: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const conversationSchema = new mongoose.Schema({
  type: { type: String, enum: ['private', 'group'], required: true },
  participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  groupName: { type: String },
  groupAvatar: { type: String },
  admins: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  createdAt: { type: Date, default: Date.now },
  lastMessage: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
  lastActivity: { type: Date, default: Date.now }
});

const messageSchema = new mongoose.Schema({
  conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true },
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  content: { type: String, required: true },
  messageType: { type: String, enum: ['text', 'image', 'video', 'file', 'system'], default: 'text' },
  status: { type: String, enum: ['sending', 'sent', 'delivered', 'read'], default: 'sent' },
  deleted: { type: Boolean, default: false },
  deletedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

messageSchema.index({ conversationId: 1, createdAt: -1 });
messageSchema.index({ content: 'text' });

const adminFlagSchema = new mongoose.Schema({
  messageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', required: true },
  conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true },
  reason: { type: String, required: true },
  severity: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
  reviewed: { type: Boolean, default: false },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewedAt: { type: Date },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Conversation = mongoose.model('Conversation', conversationSchema);
const Message = mongoose.model('Message', messageSchema);
const AdminFlag = mongoose.model('AdminFlag', adminFlagSchema);

// File upload setup for production
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'uploads/';
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|mp4|mp3|pdf|doc|docx|txt/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error('File type not allowed'));
  }
});

// Authentication middleware (same as before)
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, async (err, user) => {
    if (err) {
      return res.status(403).json({ success: false, error: 'Invalid token' });
    }
    
    try {
      const dbUser = await User.findById(user.userId).select('-password');
      if (!dbUser) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }
      
      req.user = dbUser;
      next();
    } catch (error) {
      res.status(500).json({ success: false, error: 'Server error' });
    }
  });
};

const isAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }
  next();
};

// In-memory stores for real-time status
const userSockets = new Map();
const typingUsers = new Map();
const onlineUsers = new Set();

// API Routes (same as before, but add error handling)

// 1. Health check endpoint for Render
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'B MESSENGER'
  });
});

// 2. Authentication Routes (keep your existing routes)
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, displayName, password } = req.body;

    if (!username || !displayName || !password) {
      return res.status(400).json({ success: false, error: 'All fields are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
    }

    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ success: false, error: 'Username already taken' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = new User({
      username,
      displayName,
      password: hashedPassword,
      avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=0088cc&color=fff`,
      about: 'Hey there! I am using B MESSENGER'
    });

    await user.save();

    const token = jwt.sign(
      { userId: user._id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      success: true,
      message: 'Account created successfully',
      token,
      user: {
        _id: user._id,
        username: user.username,
        displayName: user.displayName,
        avatar: user.avatar,
        about: user.about,
        role: user.role
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ success: false, error: 'Registration failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Username and password required' });
    }

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    user.lastSeen = new Date();
    await user.save();

    const token = jwt.sign(
      { userId: user._id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        _id: user._id,
        username: user.username,
        displayName: user.displayName,
        avatar: user.avatar,
        about: user.about,
        role: user.role,
        onlineStatus: user.onlineStatus
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, error: 'Login failed' });
  }
});

app.get('/api/auth/verify', authenticateToken, (req, res) => {
  res.json({
    success: true,
    user: req.user
  });
});

// ... Keep all your other API routes as they were ...

// Serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Socket.IO Handling (same as before)
io.on('connection', (socket) => {
  console.log('🔌 New socket connection:', socket.id);

  socket.on('authenticate', async (token) => {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = await User.findById(decoded.userId);
      
      if (!user) {
        socket.emit('auth-error', 'User not found');
        return;
      }

      userSockets.set(user._id.toString(), socket.id);
      onlineUsers.add(user._id.toString());

      user.onlineStatus = true;
      user.lastSeen = new Date();
      await user.save();

      socket.userId = user._id.toString();
      socket.username = user.username;
      socket.role = user.role;

      socket.join(`user:${user._id}`);

      const conversations = await Conversation.find({
        participants: user._id
      });
      
      conversations.forEach(conv => {
        socket.join(`conversation:${conv._id}`);
      });

      socket.broadcast.emit('user-online', {
        userId: user._id.toString(),
        timestamp: new Date()
      });

      console.log(`✅ ${user.username} authenticated`);

    } catch (error) {
      console.error('Authentication error:', error);
      socket.emit('auth-error', 'Invalid token');
    }
  });

  // ... Keep all your other socket events as they were ...
  
  socket.on('disconnect', async () => {
    try {
      if (socket.userId) {
        const user = await User.findById(socket.userId);
        if (user) {
          user.onlineStatus = false;
          user.lastSeen = new Date();
          await user.save();
        }
        
        onlineUsers.delete(socket.userId);
        userSockets.delete(socket.userId);
        
        socket.broadcast.emit('user-offline', {
          userId: socket.userId,
          timestamp: new Date()
        });
        
        console.log(`❌ ${socket.username} disconnected`);
      }
    } catch (error) {
      console.error('Disconnect error:', error);
    }
  });
});

// Connect to MongoDB with retry logic
const connectWithRetry = () => {
  console.log('🔌 Attempting MongoDB connection...');
  
  mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  })
  .then(() => {
    console.log('✅ Connected to MongoDB successfully!');
    
    // Start server after successful connection
    server.listen(PORT, () => {
      console.log('='.repeat(60));
      console.log('🚀 B MESSENGER - WhatsApp/Telegram Clone');
      console.log('='.repeat(60));
      console.log(`✅ Server running on port ${PORT}`);
      console.log(`✅ Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`✅ MongoDB: Connected`);
      console.log(`✅ Real-time: Socket.IO enabled`);
      console.log(`✅ Features: WhatsApp UI + Telegram Search + Admin Dashboard`);
      console.log(`🔗 Open: http://localhost:${PORT}`);
      console.log('='.repeat(60));
      
      // Create uploads directory if it doesn't exist
      if (!fs.existsSync('uploads')) {
        fs.mkdirSync('uploads', { recursive: true });
      }
    });
  })
  .catch(err => {
    console.error('❌ MongoDB connection failed:', err.message);
    console.log('🔄 Retrying connection in 5 seconds...');
    setTimeout(connectWithRetry, 5000);
  });
};

// Start the connection process
connectWithRetry();

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Closing server...');
  server.close(() => {
    console.log('Server closed');
    mongoose.connection.close(false, () => {
      console.log('MongoDB connection closed');
      process.exit(0);
    });
  });
});
