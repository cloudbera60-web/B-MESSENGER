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
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static('uploads'));
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/bmessenger';
const JWT_SECRET = process.env.JWT_SECRET || 'b-messenger-secret-key-2024';

// MongoDB Schemas
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

// File upload setup
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

// Authentication middleware
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
const userSockets = new Map(); // userId -> socketId
const typingUsers = new Map(); // conversationId -> Set(userId)
const onlineUsers = new Set(); // Set of userIds

// API Routes

// 1. Authentication Routes
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, displayName, password } = req.body;

    // Validation
    if (!username || !displayName || !password) {
      return res.status(400).json({ success: false, error: 'All fields are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
    }

    // Check if user exists
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ success: false, error: 'Username already taken' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = new User({
      username,
      displayName,
      password: hashedPassword,
      avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=0088cc&color=fff`,
      about: 'Hey there! I am using B MESSENGER'
    });

    await user.save();

    // Generate JWT token
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

    // Find user
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    // Check password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    // Update last seen
    user.lastSeen = new Date();
    await user.save();

    // Generate JWT token
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

// 2. User Management
app.get('/api/users/search', authenticateToken, async (req, res) => {
  try {
    const { query } = req.query;
    const currentUserId = req.user._id;

    if (!query || query.length < 2) {
      return res.json({ success: true, users: [] });
    }

    const users = await User.find({
      $or: [
        { username: { $regex: query, $options: 'i' } },
        { displayName: { $regex: query, $options: 'i' } }
      ],
      _id: { $ne: currentUserId }
    }).select('-password').limit(20);

    // Add online status from memory
    const usersWithStatus = users.map(user => ({
      ...user.toObject(),
      isOnline: onlineUsers.has(user._id.toString())
    }));

    res.json({ success: true, users: usersWithStatus });

  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ success: false, error: 'Search failed' });
  }
});

app.get('/api/users/all', authenticateToken, async (req, res) => {
  try {
    const currentUserId = req.user._id;
    const users = await User.find({ _id: { $ne: currentUserId } })
      .select('-password')
      .sort({ displayName: 1 });

    const usersWithStatus = users.map(user => ({
      ...user.toObject(),
      isOnline: onlineUsers.has(user._id.toString())
    }));

    res.json({ success: true, users: usersWithStatus });

  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ success: false, error: 'Failed to get users' });
  }
});

app.get('/api/users/:userId', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.params.userId).select('-password');
    
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const userWithStatus = {
      ...user.toObject(),
      isOnline: onlineUsers.has(user._id.toString())
    };

    res.json({ success: true, user: userWithStatus });

  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ success: false, error: 'Failed to get user' });
  }
});

app.put('/api/users/profile', authenticateToken, async (req, res) => {
  try {
    const { displayName, about, avatar } = req.body;
    const updates = {};

    if (displayName) updates.displayName = displayName;
    if (about !== undefined) updates.about = about;
    if (avatar) updates.avatar = avatar;
    updates.updatedAt = new Date();

    const user = await User.findByIdAndUpdate(
      req.user._id,
      updates,
      { new: true }
    ).select('-password');

    res.json({
      success: true,
      message: 'Profile updated',
      user
    });

  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ success: false, error: 'Failed to update profile' });
  }
});

// 3. Conversations
app.get('/api/conversations', authenticateToken, async (req, res) => {
  try {
    const conversations = await Conversation.find({
      participants: req.user._id
    })
    .populate('participants', 'username displayName avatar onlineStatus lastSeen')
    .populate('lastMessage')
    .populate('admins', 'username displayName')
    .sort({ lastActivity: -1 });

    // Add unread counts and last message details
    const formattedConversations = await Promise.all(
      conversations.map(async (conv) => {
        const unreadCount = await Message.countDocuments({
          conversationId: conv._id,
          senderId: { $ne: req.user._id },
          status: { $in: ['sent', 'delivered'] }
        });

        const lastMessage = await Message.findById(conv.lastMessage)
          .populate('senderId', 'displayName');

        let chatName = conv.groupName;
        let chatAvatar = conv.groupAvatar;
        
        if (conv.type === 'private') {
          const otherParticipant = conv.participants.find(
            p => p._id.toString() !== req.user._id.toString()
          );
          if (otherParticipant) {
            chatName = otherParticipant.displayName;
            chatAvatar = otherParticipant.avatar;
          }
        }

        return {
          _id: conv._id,
          type: conv.type,
          name: chatName,
          avatar: chatAvatar,
          participants: conv.participants,
          admins: conv.admins,
          lastMessage: lastMessage ? {
            _id: lastMessage._id,
            content: lastMessage.content,
            senderName: lastMessage.senderId.displayName,
            senderId: lastMessage.senderId._id,
            messageType: lastMessage.messageType,
            status: lastMessage.status,
            createdAt: lastMessage.createdAt
          } : null,
          unreadCount,
          lastActivity: conv.lastActivity,
          createdAt: conv.createdAt
        };
      })
    );

    res.json({ success: true, conversations: formattedConversations });

  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({ success: false, error: 'Failed to get conversations' });
  }
});

app.post('/api/conversations/private', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ success: false, error: 'User ID required' });
    }

    // Check if conversation already exists
    const existingConversation = await Conversation.findOne({
      type: 'private',
      participants: { $all: [req.user._id, userId], $size: 2 }
    });

    if (existingConversation) {
      return res.json({
        success: true,
        conversation: existingConversation,
        isNew: false
      });
    }

    // Create new conversation
    const conversation = new Conversation({
      type: 'private',
      participants: [req.user._id, userId]
    });

    await conversation.save();

    // Populate user details
    await conversation.populate('participants', 'username displayName avatar onlineStatus lastSeen');

    res.status(201).json({
      success: true,
      conversation,
      isNew: true
    });

  } catch (error) {
    console.error('Create conversation error:', error);
    res.status(500).json({ success: false, error: 'Failed to create conversation' });
  }
});

app.post('/api/conversations/group', authenticateToken, async (req, res) => {
  try {
    const { name, participantIds } = req.body;
    
    if (!name || !participantIds || participantIds.length === 0) {
      return res.status(400).json({ success: false, error: 'Group name and participants required' });
    }

    const allParticipants = [...participantIds, req.user._id];

    const conversation = new Conversation({
      type: 'group',
      groupName: name,
      participants: allParticipants,
      admins: [req.user._id]
    });

    await conversation.save();

    // Create system message
    const systemMessage = new Message({
      conversationId: conversation._id,
      senderId: req.user._id,
      content: `${req.user.displayName} created group "${name}"`,
      messageType: 'system'
    });

    await systemMessage.save();

    // Update conversation last message
    conversation.lastMessage = systemMessage._id;
    conversation.lastActivity = new Date();
    await conversation.save();

    // Populate details
    await conversation.populate('participants', 'username displayName avatar');
    await conversation.populate('admins', 'username displayName');

    res.status(201).json({
      success: true,
      conversation
    });

  } catch (error) {
    console.error('Create group error:', error);
    res.status(500).json({ success: false, error: 'Failed to create group' });
  }
});

// 4. Messages
app.get('/api/messages/:conversationId', authenticateToken, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { limit = 50, before } = req.query;

    // Check if user is part of conversation
    const conversation = await Conversation.findOne({
      _id: conversationId,
      participants: req.user._id
    });

    if (!conversation) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    let query = { conversationId, deleted: { $ne: true } };
    
    if (before) {
      query.createdAt = { $lt: new Date(before) };
    }

    const messages = await Message.find(query)
      .populate('senderId', 'username displayName avatar')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .lean();

    // Mark messages as read
    const unreadMessages = messages.filter(msg => 
      msg.senderId._id.toString() !== req.user._id.toString() &&
      msg.status !== 'read'
    );

    if (unreadMessages.length > 0) {
      await Message.updateMany(
        { 
          _id: { $in: unreadMessages.map(m => m._id) },
          status: { $ne: 'read' }
        },
        { 
          $set: { 
            status: 'read',
            updatedAt: new Date()
          } 
        }
      );
    }

    messages.reverse();

    res.json({ success: true, messages });

  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ success: false, error: 'Failed to get messages' });
  }
});

app.post('/api/messages/search', authenticateToken, async (req, res) => {
  try {
    const { query } = req.body;
    
    if (!query) {
      return res.json({ success: true, messages: [] });
    }

    // Get user's conversations
    const conversations = await Conversation.find({
      participants: req.user._id
    }).select('_id');

    const conversationIds = conversations.map(c => c._id);

    const messages = await Message.find({
      conversationId: { $in: conversationIds },
      content: { $regex: query, $options: 'i' },
      deleted: { $ne: true }
    })
    .populate('senderId', 'displayName')
    .populate('conversationId', 'type groupName')
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

    res.json({ success: true, messages });

  } catch (error) {
    console.error('Search messages error:', error);
    res.status(500).json({ success: false, error: 'Search failed' });
  }
});

// 5. File Upload
app.post('/api/upload', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const fileUrl = `/uploads/${req.file.filename}`;
    
    res.json({
      success: true,
      file: {
        url: fileUrl,
        filename: req.file.filename,
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size
      }
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ success: false, error: 'Upload failed' });
  }
});

// 6. Admin Routes
app.get('/api/admin/users', authenticateToken, isAdmin, async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    res.json({ success: true, users });
  } catch (error) {
    console.error('Admin get users error:', error);
    res.status(500).json({ success: false, error: 'Failed to get users' });
  }
});

app.get('/api/admin/conversations', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { type, page = 1, limit = 20 } = req.query;
    const query = type ? { type } : {};
    
    const conversations = await Conversation.find(query)
      .populate('participants', 'username displayName')
      .populate('lastMessage')
      .sort({ lastActivity: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .lean();

    const total = await Conversation.countDocuments(query);

    res.json({
      success: true,
      conversations,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / limit)
    });

  } catch (error) {
    console.error('Admin get conversations error:', error);
    res.status(500).json({ success: false, error: 'Failed to get conversations' });
  }
});

app.get('/api/admin/messages', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { conversationId, userId, keyword, startDate, endDate, page = 1, limit = 50 } = req.query;
    
    let query = { deleted: { $ne: true } };
    
    if (conversationId) query.conversationId = conversationId;
    if (userId) query.senderId = userId;
    if (keyword) query.content = { $regex: keyword, $options: 'i' };
    
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const messages = await Message.find(query)
      .populate('senderId', 'username displayName')
      .populate('conversationId', 'type groupName')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .lean();

    const total = await Message.countDocuments(query);

    res.json({
      success: true,
      messages,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / limit)
    });

  } catch (error) {
    console.error('Admin get messages error:', error);
    res.status(500).json({ success: false, error: 'Failed to get messages' });
  }
});

app.get('/api/admin/flags', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { reviewed, severity } = req.query;
    
    let query = {};
    if (reviewed !== undefined) query.reviewed = reviewed === 'true';
    if (severity) query.severity = severity;

    const flags = await AdminFlag.find(query)
      .populate('messageId')
      .populate('conversationId')
      .populate('reviewedBy', 'username displayName')
      .sort({ createdAt: -1 })
      .lean();

    res.json({ success: true, flags });

  } catch (error) {
    console.error('Admin get flags error:', error);
    res.status(500).json({ success: false, error: 'Failed to get flags' });
  }
});

app.post('/api/admin/flags/:flagId/review', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { flagId } = req.params;
    const { action } = req.body; // 'approve', 'dismiss'

    const flag = await AdminFlag.findById(flagId);
    if (!flag) {
      return res.status(404).json({ success: false, error: 'Flag not found' });
    }

    flag.reviewed = true;
    flag.reviewedBy = req.user._id;
    flag.reviewedAt = new Date();

    if (action === 'approve') {
      // Delete the flagged message
      await Message.findByIdAndUpdate(flag.messageId, { deleted: true });
    }

    await flag.save();

    res.json({ success: true, message: 'Flag reviewed successfully' });

  } catch (error) {
    console.error('Review flag error:', error);
    res.status(500).json({ success: false, error: 'Failed to review flag' });
  }
});

// Serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Socket.IO Handling
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

      // Store socket connection
      userSockets.set(user._id.toString(), socket.id);
      onlineUsers.add(user._id.toString());

      // Update user online status
      user.onlineStatus = true;
      user.lastSeen = new Date();
      await user.save();

      socket.userId = user._id.toString();
      socket.username = user.username;
      socket.role = user.role;

      // Join user's room
      socket.join(`user:${user._id}`);

      // Join conversation rooms
      const conversations = await Conversation.find({
        participants: user._id
      });
      
      conversations.forEach(conv => {
        socket.join(`conversation:${conv._id}`);
      });

      // Notify others about online status
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

  socket.on('join-conversation', async (conversationId) => {
    try {
      socket.join(`conversation:${conversationId}`);
      
      // Mark messages as read
      await Message.updateMany(
        {
          conversationId,
          senderId: { $ne: socket.userId },
          status: { $ne: 'read' }
        },
        {
          $set: { status: 'read', updatedAt: new Date() }
        }
      );

      // Notify others
      socket.to(`conversation:${conversationId}`).emit('messages-read', {
        conversationId,
        readerId: socket.userId
      });

    } catch (error) {
      console.error('Join conversation error:', error);
    }
  });

  socket.on('send-message', async (data, callback) => {
    try {
      const { conversationId, content, messageType = 'text' } = data;
      
      if (!conversationId || !content) {
        callback({ success: false, error: 'Missing data' });
        return;
      }

      // Check if user is in conversation
      const conversation = await Conversation.findOne({
        _id: conversationId,
        participants: socket.userId
      });

      if (!conversation) {
        callback({ success: false, error: 'Not in conversation' });
        return;
      }

      // Create message
      const message = new Message({
        conversationId,
        senderId: socket.userId,
        content,
        messageType,
        status: 'sent'
      });

      await message.save();

      // Update conversation
      conversation.lastMessage = message._id;
      conversation.lastActivity = new Date();
      await conversation.save();

      // Populate sender info
      await message.populate('senderId', 'username displayName avatar');

      // Auto-flag sensitive content
      const sensitiveKeywords = ['badword', 'spam', 'scam']; // Add more
      const hasSensitiveContent = sensitiveKeywords.some(keyword => 
        content.toLowerCase().includes(keyword)
      );

      if (hasSensitiveContent) {
        const flag = new AdminFlag({
          messageId: message._id,
          conversationId,
          reason: 'Sensitive content detected',
          severity: 'medium'
        });
        await flag.save();
      }

      // Prepare message data
      const messageData = {
        ...message.toObject(),
        senderId: {
          _id: message.senderId._id,
          username: message.senderId.username,
          displayName: message.senderId.displayName,
          avatar: message.senderId.avatar
        }
      };

      // Send to conversation room
      io.to(`conversation:${conversationId}`).emit('new-message', messageData);

      // Notify participants about new message (except sender)
      conversation.participants.forEach(participantId => {
        if (participantId.toString() !== socket.userId) {
          const participantSocket = userSockets.get(participantId.toString());
          if (participantSocket) {
            // Mark as delivered
            message.status = 'delivered';
            message.save();
            
            io.to(participantSocket).emit('message-delivered', {
              messageId: message._id,
              conversationId
            });
          }
        }
      });

      callback({ success: true, message: messageData });

    } catch (error) {
      console.error('Send message error:', error);
      callback({ success: false, error: 'Failed to send message' });
    }
  });

  socket.on('typing-start', (data) => {
    const { conversationId } = data;
    
    if (!typingUsers.has(conversationId)) {
      typingUsers.set(conversationId, new Set());
    }
    
    typingUsers.get(conversationId).add(socket.userId);
    
    socket.to(`conversation:${conversationId}`).emit('user-typing', {
      conversationId,
      userId: socket.userId,
      isTyping: true
    });
  });

  socket.on('typing-stop', (data) => {
    const { conversationId } = data;
    
    if (typingUsers.has(conversationId)) {
      typingUsers.get(conversationId).delete(socket.userId);
      
      if (typingUsers.get(conversationId).size === 0) {
        typingUsers.delete(conversationId);
      }
    }
    
    socket.to(`conversation:${conversationId}`).emit('user-typing', {
      conversationId,
      userId: socket.userId,
      isTyping: false
    });
  });

  socket.on('message-read', async (data) => {
    try {
      const { messageId } = data;
      
      const message = await Message.findById(messageId);
      if (!message) return;
      
      if (message.senderId.toString() !== socket.userId) {
        message.status = 'read';
        message.updatedAt = new Date();
        await message.save();
        
        // Notify sender
        const senderSocket = userSockets.get(message.senderId.toString());
        if (senderSocket) {
          io.to(senderSocket).emit('message-read', {
            messageId: message._id,
            readerId: socket.userId
          });
        }
      }
    } catch (error) {
      console.error('Message read error:', error);
    }
  });

  socket.on('disconnect', async () => {
    try {
      if (socket.userId) {
        // Update user status
        const user = await User.findById(socket.userId);
        if (user) {
          user.onlineStatus = false;
          user.lastSeen = new Date();
          await user.save();
        }
        
        // Remove from online users
        onlineUsers.delete(socket.userId);
        userSockets.delete(socket.userId);
        
        // Notify others
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

// Connect to MongoDB and start server
mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log('✅ Connected to MongoDB');
    
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
      console.log('='.repeat(60));
      console.log('🚀 B MESSENGER - WhatsApp/Telegram Clone');
      console.log('='.repeat(60));
      console.log(`✅ Server running on port ${PORT}`);
      console.log(`✅ MongoDB: ${MONGODB_URI}`);
      console.log(`✅ Real-time: Socket.IO enabled`);
      console.log(`✅ Features: WhatsApp UI + Telegram Search + Admin Dashboard`);
      console.log(`🔗 Open: http://localhost:${PORT}`);
      console.log('='.repeat(60));
    });
  })
  .catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });
