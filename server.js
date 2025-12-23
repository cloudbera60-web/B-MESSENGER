const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcrypt');
const multer = require('multer');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// MongoDB Connection
const MONGODB_URI = "mongodb+srv://ellyongiro8:QwXDXE6tyrGpUTNb@cluster0.tyxcmm9.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";
const DB_NAME = 'whatsapp_clone';

// Collections
const COLLECTIONS = {
  USERS: 'users',
  MESSAGES: 'messages',
  CHATS: 'chats',
  STATUS: 'status',
  CALLS: 'calls',
  SETTINGS: 'settings'
};

// File Upload Configuration
const storage = multer.diskStorage({
  destination: 'uploads/',
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|mp3|mp4|pdf|txt/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error('File type not allowed'));
  }
});

let db;
let mongoClient;

// Connect to MongoDB
async function connectToDatabase() {
  try {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    console.log('✅ Connected to MongoDB');
    
    db = client.db(DB_NAME);
    mongoClient = client;
    
    // Create indexes
    await db.collection(COLLECTIONS.USERS).createIndex({ phone: 1 }, { unique: true });
    await db.collection(COLLECTIONS.USERS).createIndex({ email: 1 }, { unique: true, sparse: true });
    await db.collection(COLLECTIONS.MESSAGES).createIndex({ chatId: 1, timestamp: -1 });
    await db.collection(COLLECTIONS.CHATS).createIndex({ participants: 1 });
    await db.collection(COLLECTIONS.MESSAGES).createIndex({ 'location.coordinates': '2dsphere' });
    
    return client;
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error);
    process.exit(1);
  }
}

// Utility Functions
function generateUserId() {
  return crypto.randomBytes(16).toString('hex');
}

function generateChatId(user1, user2) {
  return [user1, user2].sort().join('_');
}

function formatTime(date) {
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}

// In-memory storage for real-time connections
const onlineUsers = new Map(); // userId -> socketId
const typingUsers = new Map(); // chatId -> Set of userIds

// ==================== API ROUTES ====================

// 1. USER REGISTRATION
app.post('/api/auth/register', async (req, res) => {
  try {
    const { phone, name, password, email } = req.body;
    
    if (!phone || !name || !password) {
      return res.status(400).json({ success: false, error: 'Phone, name and password are required' });
    }
    
    if (password.length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
    }
    
    // Check if user already exists
    const existingUser = await db.collection(COLLECTIONS.USERS).findOne({
      $or: [{ phone }, { email: email || '' }]
    });
    
    if (existingUser) {
      return res.status(409).json({ 
        success: false, 
        error: existingUser.phone === phone ? 'Phone number already registered' : 'Email already registered' 
      });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = generateUserId();
    
    // Create user object
    const userData = {
      userId,
      phone,
      name,
      email: email || null,
      password: hashedPassword,
      avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=25D366&color=fff&size=200`,
      about: "Hey there! I'm using WhatsApp",
      lastSeen: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      privacy: {
        lastSeen: 'everyone',
        profilePhoto: 'everyone',
        status: 'everyone',
        readReceipts: true
      },
      notification: {
        message: true,
        group: true,
        call: true,
        vibration: true,
        sound: 'default'
      }
    };
    
    // Save user to database
    await db.collection(COLLECTIONS.USERS).insertOne(userData);
    
    // Create default settings
    await db.collection(COLLECTIONS.SETTINGS).insertOne({
      userId,
      theme: 'light',
      wallpaper: 'default',
      fontSize: 'medium',
      chat: {
        enterToSend: true,
        mediaVisibility: true,
        saveToCameraRoll: true
      },
      storage: {
        autoDownload: {
          photos: 'wifi',
          audio: 'wifi',
          video: 'wifi',
          documents: 'wifi'
        }
      },
      createdAt: new Date()
    });
    
    // Remove password from response
    const { password: _, ...userWithoutPassword } = userData;
    
    res.status(201).json({
      success: true,
      message: 'Registration successful',
      user: userWithoutPassword
    });
    
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ success: false, error: 'Registration failed' });
  }
});

// 2. USER LOGIN
app.post('/api/auth/login', async (req, res) => {
  try {
    const { phone, password } = req.body;
    
    if (!phone || !password) {
      return res.status(400).json({ success: false, error: 'Phone and password required' });
    }
    
    // Find user
    const user = await db.collection(COLLECTIONS.USERS).findOne({ phone });
    
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    
    // Verify password
    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ success: false, error: 'Invalid password' });
    }
    
    // Update last seen
    await db.collection(COLLECTIONS.USERS).updateOne(
      { phone },
      { $set: { lastSeen: new Date() } }
    );
    
    // Remove password from response
    const { password: _, ...userWithoutPassword } = user;
    
    res.json({
      success: true,
      message: 'Login successful',
      user: userWithoutPassword
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, error: 'Login failed' });
  }
});

// 3. GET USER PROFILE
app.get('/api/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    const user = await db.collection(COLLECTIONS.USERS).findOne(
      { userId },
      { projection: { password: 0 } }
    );
    
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    
    res.json({ success: true, user });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ success: false, error: 'Failed to get user' });
  }
});

// 4. UPDATE PROFILE
app.put('/api/users/:userId/profile', async (req, res) => {
  try {
    const { userId } = req.params;
    const { name, about, avatar } = req.body;
    
    const updateData = {
      updatedAt: new Date()
    };
    
    if (name) updateData.name = name;
    if (about !== undefined) updateData.about = about;
    if (avatar) updateData.avatar = avatar;
    
    await db.collection(COLLECTIONS.USERS).updateOne(
      { userId },
      { $set: updateData }
    );
    
    res.json({ success: true, message: 'Profile updated' });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ success: false, error: 'Failed to update profile' });
  }
});

// 5. SEARCH USERS
app.get('/api/users/search/:query', async (req, res) => {
  try {
    const { query } = req.params;
    const { userId } = req.query; // Exclude current user
    
    const searchFilter = {
      $or: [
        { name: { $regex: query, $options: 'i' } },
        { phone: { $regex: query, $options: 'i' } },
        { email: { $regex: query, $options: 'i' } }
      ],
      userId: { $ne: userId }
    };
    
    const users = await db.collection(COLLECTIONS.USERS)
      .find(searchFilter, { projection: { password: 0 } })
      .limit(50)
      .toArray();
    
    res.json({ success: true, users });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ success: false, error: 'Search failed' });
  }
});

// 6. GET CHATS LIST
app.get('/api/chats/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Get all chats where user is a participant
    const chats = await db.collection(COLLECTIONS.CHATS)
      .aggregate([
        {
          $match: {
            participants: userId,
            archived: { $ne: true }
          }
        },
        {
          $lookup: {
            from: COLLECTIONS.MESSAGES,
            let: { chatId: '$_id' },
            pipeline: [
              { $match: { $expr: { $eq: ['$chatId', '$$chatId'] } } },
              { $sort: { timestamp: -1 } },
              { $limit: 1 }
            ],
            as: 'lastMessage'
          }
        },
        {
          $lookup: {
            from: COLLECTIONS.USERS,
            let: { otherParticipant: { $arrayElemAt: [{ $filter: { input: '$participants', as: 'p', cond: { $ne: ['$$p', userId] } } }, 0] } },
            pipeline: [
              { $match: { $expr: { $eq: ['$userId', '$$otherParticipant'] } } },
              { $project: { name: 1, avatar: 1, phone: 1, about: 1, lastSeen: 1 } }
            ],
            as: 'contactInfo'
          }
        },
        {
          $addFields: {
            lastMessage: { $arrayElemAt: ['$lastMessage', 0] },
            contactInfo: { $arrayElemAt: ['$contactInfo', 0] },
            unreadCount: {
              $cond: {
                if: { $eq: ['$type', 'private'] },
                then: {
                  $size: {
                    $filter: {
                      input: '$unreadMessages',
                      as: 'msg',
                      cond: { $eq: ['$$msg.userId', userId] }
                    }
                  }
                },
                else: 0
              }
            }
          }
        },
        { $sort: { 'lastMessage.timestamp': -1 } }
      ])
      .toArray();
    
    // Format response
    const formattedChats = chats.map(chat => ({
      id: chat._id.toString(),
      type: chat.type,
      name: chat.name || chat.contactInfo?.name,
      avatar: chat.avatar || chat.contactInfo?.avatar,
      participants: chat.participants,
      lastMessage: chat.lastMessage ? {
        id: chat.lastMessage._id.toString(),
        text: chat.lastMessage.text,
        sender: chat.lastMessage.senderId === userId ? 'You' : chat.contactInfo?.name,
        timestamp: chat.lastMessage.timestamp,
        type: chat.lastMessage.type,
        status: chat.lastMessage.status
      } : null,
      unreadCount: chat.unreadCount || 0,
      timestamp: chat.lastMessage?.timestamp || chat.updatedAt,
      isOnline: onlineUsers.has(chat.contactInfo?.userId)
    }));
    
    res.json({ success: true, chats: formattedChats });
  } catch (error) {
    console.error('Get chats error:', error);
    res.status(500).json({ success: false, error: 'Failed to get chats' });
  }
});

// 7. GET MESSAGES
app.get('/api/messages/:chatId', async (req, res) => {
  try {
    const { chatId } = req.params;
    const { limit = 50, before } = req.query;
    
    const query = { chatId: new ObjectId(chatId) };
    if (before) {
      query.timestamp = { $lt: new Date(before) };
    }
    
    const messages = await db.collection(COLLECTIONS.MESSAGES)
      .find(query)
      .sort({ timestamp: -1 })
      .limit(parseInt(limit))
      .toArray();
    
    // Reverse for chronological order
    messages.reverse();
    
    // Format messages
    const formattedMessages = messages.map(msg => ({
      id: msg._id.toString(),
      text: msg.text,
      senderId: msg.senderId,
      timestamp: msg.timestamp,
      type: msg.type,
      status: msg.status,
      file: msg.file,
      location: msg.location,
      replyTo: msg.replyTo
    }));
    
    res.json({ success: true, messages: formattedMessages });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ success: false, error: 'Failed to get messages' });
  }
});

// 8. CREATE OR GET CHAT
app.post('/api/chats/create', async (req, res) => {
  try {
    const { userId, contactId } = req.body;
    
    if (!userId || !contactId) {
      return res.status(400).json({ success: false, error: 'User ID and contact ID required' });
    }
    
    // Check if chat already exists
    const existingChat = await db.collection(COLLECTIONS.CHATS).findOne({
      type: 'private',
      participants: { $all: [userId, contactId], $size: 2 }
    });
    
    if (existingChat) {
      return res.json({ 
        success: true, 
        chatId: existingChat._id.toString(),
        isNew: false 
      });
    }
    
    // Create new chat
    const chatData = {
      type: 'private',
      participants: [userId, contactId],
      createdAt: new Date(),
      updatedAt: new Date(),
      unreadMessages: []
    };
    
    const result = await db.collection(COLLECTIONS.CHATS).insertOne(chatData);
    
    res.json({ 
      success: true, 
      chatId: result.insertedId.toString(),
      isNew: true 
    });
  } catch (error) {
    console.error('Create chat error:', error);
    res.status(500).json({ success: false, error: 'Failed to create chat' });
  }
});

// 9. FILE UPLOAD
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }
    
    const fileData = {
      filename: req.file.filename,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      path: req.file.path,
      url: `/uploads/${req.file.filename}`,
      uploadedAt: new Date(),
      uploadedBy: req.body.userId
    };
    
    res.json({
      success: true,
      file: fileData
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ success: false, error: 'Upload failed' });
  }
});

// 10. GET SETTINGS
app.get('/api/settings/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    let settings = await db.collection(COLLECTIONS.SETTINGS).findOne({ userId });
    
    if (!settings) {
      // Create default settings
      settings = {
        userId,
        theme: 'light',
        wallpaper: 'default',
        fontSize: 'medium',
        chat: {
          enterToSend: true,
          mediaVisibility: true,
          saveToCameraRoll: true
        },
        storage: {
          autoDownload: {
            photos: 'wifi',
            audio: 'wifi',
            video: 'wifi',
            documents: 'wifi'
          }
        },
        privacy: {
          lastSeen: 'everyone',
          profilePhoto: 'everyone',
          status: 'everyone',
          readReceipts: true
        },
        notification: {
          message: true,
          group: true,
          call: true,
          vibration: true,
          sound: 'default'
        },
        createdAt: new Date()
      };
      
      await db.collection(COLLECTIONS.SETTINGS).insertOne(settings);
    }
    
    res.json({ success: true, settings });
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({ success: false, error: 'Failed to get settings' });
  }
});

// 11. UPDATE SETTINGS
app.put('/api/settings/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const settings = req.body;
    
    await db.collection(COLLECTIONS.SETTINGS).updateOne(
      { userId },
      { $set: { ...settings, updatedAt: new Date() } },
      { upsert: true }
    );
    
    res.json({ success: true, message: 'Settings updated' });
  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({ success: false, error: 'Failed to update settings' });
  }
});

// 12. GET STATUS UPDATES
app.get('/api/status/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Get user's status
    const userStatus = await db.collection(COLLECTIONS.STATUS)
      .find({ userId })
      .sort({ createdAt: -1 })
      .limit(1)
      .toArray();
    
    // Get contacts' status (last 24 hours)
    const user = await db.collection(COLLECTIONS.USERS).findOne({ userId });
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    // In a real app, you'd get user's contacts
    const recentStatus = await db.collection(COLLECTIONS.STATUS)
      .aggregate([
        {
          $match: {
            userId: { $ne: userId },
            createdAt: { $gte: twentyFourHoursAgo }
          }
        },
        {
          $lookup: {
            from: COLLECTIONS.USERS,
            localField: 'userId',
            foreignField: 'userId',
            as: 'user'
          }
        },
        {
          $unwind: '$user'
        },
        {
          $group: {
            _id: '$userId',
            statuses: { $push: '$$ROOT' },
            user: { $first: '$user' }
          }
        },
        {
          $sort: { 'user.name': 1 }
        }
      ])
      .toArray();
    
    res.json({
      success: true,
      myStatus: userStatus[0] || null,
      recentStatus: recentStatus.map(s => ({
        userId: s._id,
        name: s.user.name,
        avatar: s.user.avatar,
        statuses: s.statuses
      }))
    });
  } catch (error) {
    console.error('Get status error:', error);
    res.status(500).json({ success: false, error: 'Failed to get status' });
  }
});

// 13. CREATE STATUS
app.post('/api/status', upload.single('media'), async (req, res) => {
  try {
    const { userId, text, type } = req.body;
    
    if (!userId) {
      return res.status(400).json({ success: false, error: 'User ID required' });
    }
    
    const statusData = {
      userId,
      text: text || '',
      type: type || 'text',
      media: req.file ? {
        url: `/uploads/${req.file.filename}`,
        type: req.file.mimetype.split('/')[0]
      } : null,
      viewers: [],
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
    };
    
    await db.collection(COLLECTIONS.STATUS).insertOne(statusData);
    
    res.json({ success: true, message: 'Status created', status: statusData });
  } catch (error) {
    console.error('Create status error:', error);
    res.status(500).json({ success: false, error: 'Failed to create status' });
  }
});

// Serve main page
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== SOCKET.IO ====================
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);
  
  // User goes online
  socket.on('user-online', async (data) => {
    try {
      const { userId } = data;
      onlineUsers.set(userId, socket.id);
      
      // Notify contacts
      const user = await db.collection(COLLECTIONS.USERS).findOne({ userId });
      if (user) {
        // Get user's chats
        const chats = await db.collection(COLLECTIONS.CHATS).find({
          participants: userId,
          type: 'private'
        }).toArray();
        
        // Notify all contacts in private chats
        chats.forEach(chat => {
          const otherUserId = chat.participants.find(p => p !== userId);
          const otherSocketId = onlineUsers.get(otherUserId);
          if (otherSocketId) {
            io.to(otherSocketId).emit('user-status', {
              userId,
              isOnline: true,
              lastSeen: new Date()
            });
          }
        });
      }
    } catch (error) {
      console.error('User online error:', error);
    }
  });
  
  // Join chat room
  socket.on('join-chat', (data) => {
    const { chatId } = data;
    socket.join(`chat-${chatId}`);
  });
  
  // Leave chat room
  socket.on('leave-chat', (data) => {
    const { chatId } = data;
    socket.leave(`chat-${chatId}`);
  });
  
  // Send message
  socket.on('send-message', async (data, callback) => {
    try {
      const { chatId, senderId, text, type = 'text', file, replyTo } = data;
      
      if (!chatId || !senderId || (!text && !file)) {
        if (callback) callback({ error: 'Invalid message data' });
        return;
      }
      
      const messageId = new ObjectId();
      const timestamp = new Date();
      
      const message = {
        _id: messageId,
        chatId: new ObjectId(chatId),
        senderId,
        text: text || '',
        type,
        timestamp,
        status: 'sent',
        ...(file && { file }),
        ...(replyTo && { replyTo })
      };
      
      // Save to database
      await db.collection(COLLECTIONS.MESSAGES).insertOne(message);
      
      // Update chat's last message and timestamp
      await db.collection(COLLECTIONS.CHATS).updateOne(
        { _id: new ObjectId(chatId) },
        { 
          $set: { 
            updatedAt: timestamp,
            lastMessage: messageId
          },
          $push: {
            unreadMessages: {
              userId: { $ne: senderId },
              messageId: messageId,
              timestamp: timestamp
            }
          }
        }
      );
      
      // Format for sending
      const messageToSend = {
        id: messageId.toString(),
        chatId,
        senderId,
        text: message.text,
        type: message.type,
        timestamp: message.timestamp,
        status: message.status,
        file: message.file,
        replyTo: message.replyTo
      };
      
      // Send to sender for confirmation
      socket.emit('message-sent', {
        ...messageToSend,
        tempId: data.tempId
      });
      
      // Send to all other users in chat room
      socket.to(`chat-${chatId}`).emit('new-message', messageToSend);
      
      // Get chat participants
      const chat = await db.collection(COLLECTIONS.CHATS).findOne({
        _id: new ObjectId(chatId)
      });
      
      if (chat) {
        // Notify participants about new message in chat list
        chat.participants.forEach(async participantId => {
          if (participantId !== senderId) {
            const participantSocketId = onlineUsers.get(participantId);
            if (participantSocketId) {
              io.to(participantSocketId).emit('chat-updated', {
                chatId,
                lastMessage: messageToSend
              });
            }
          }
        });
      }
      
      if (callback) callback({ success: true, messageId: messageId.toString() });
      
    } catch (error) {
      console.error('Send message error:', error);
      if (callback) callback({ error: 'Failed to send message' });
    }
  });
  
  // Message delivered
  socket.on('message-delivered', async (data) => {
    try {
      const { messageId, userId } = data;
      
      await db.collection(COLLECTIONS.MESSAGES).updateOne(
        { _id: new ObjectId(messageId) },
        { $set: { status: 'delivered', deliveredAt: new Date() } }
      );
      
      // Notify sender
      const message = await db.collection(COLLECTIONS.MESSAGES).findOne({
        _id: new ObjectId(messageId)
      });
      
      if (message) {
        const senderSocketId = onlineUsers.get(message.senderId);
        if (senderSocketId) {
          io.to(senderSocketId).emit('message-status', {
            messageId,
            status: 'delivered',
            userId
          });
        }
      }
    } catch (error) {
      console.error('Message delivered error:', error);
    }
  });
  
  // Message read
  socket.on('message-read', async (data) => {
    try {
      const { messageId, userId } = data;
      
      await db.collection(COLLECTIONS.MESSAGES).updateOne(
        { _id: new ObjectId(messageId) },
        { $set: { status: 'read', readAt: new Date() } }
      );
      
      // Remove from unread messages in chat
      const message = await db.collection(COLLECTIONS.MESSAGES).findOne({
        _id: new ObjectId(messageId)
      });
      
      if (message) {
        await db.collection(COLLECTIONS.CHATS).updateOne(
          { _id: message.chatId },
          { $pull: { unreadMessages: { messageId: new ObjectId(messageId) } } }
        );
        
        // Notify sender
        const senderSocketId = onlineUsers.get(message.senderId);
        if (senderSocketId) {
          io.to(senderSocketId).emit('message-status', {
            messageId,
            status: 'read',
            userId
          });
        }
      }
    } catch (error) {
      console.error('Message read error:', error);
    }
  });
  
  // Typing indicator
  socket.on('typing', (data) => {
    const { chatId, userId, isTyping } = data;
    
    if (isTyping) {
      if (!typingUsers.has(chatId)) {
        typingUsers.set(chatId, new Set());
      }
      typingUsers.get(chatId).add(userId);
    } else {
      if (typingUsers.has(chatId)) {
        typingUsers.get(chatId).delete(userId);
        if (typingUsers.get(chatId).size === 0) {
          typingUsers.delete(chatId);
        }
      }
    }
    
    // Notify other users in chat
    socket.to(`chat-${chatId}`).emit('user-typing', {
      chatId,
      userId,
      isTyping
    });
  });
  
  // Call signaling
  socket.on('call-offer', (data) => {
    const { to, offer, callType } = data;
    const toSocketId = onlineUsers.get(to);
    
    if (toSocketId) {
      io.to(toSocketId).emit('call-offer', {
        from: socket.id,
        offer,
        callType
      });
    }
  });
  
  socket.on('call-answer', (data) => {
    const { to, answer } = data;
    const toSocketId = onlineUsers.get(to);
    
    if (toSocketId) {
      io.to(toSocketId).emit('call-answer', {
        from: socket.id,
        answer
      });
    }
  });
  
  socket.on('call-ice-candidate', (data) => {
    const { to, candidate } = data;
    const toSocketId = onlineUsers.get(to);
    
    if (toSocketId) {
      io.to(toSocketId).emit('call-ice-candidate', {
        from: socket.id,
        candidate
      });
    }
  });
  
  socket.on('call-end', (data) => {
    const { to } = data;
    const toSocketId = onlineUsers.get(to);
    
    if (toSocketId) {
      io.to(toSocketId).emit('call-end', { from: socket.id });
    }
  });
  
  // User goes offline
  socket.on('disconnect', async () => {
    try {
      // Find user by socket ID
      let disconnectedUserId = null;
      for (const [userId, socketId] of onlineUsers.entries()) {
        if (socketId === socket.id) {
          disconnectedUserId = userId;
          break;
        }
      }
      
      if (disconnectedUserId) {
        onlineUsers.delete(disconnectedUserId);
        
        // Update last seen in database
        await db.collection(COLLECTIONS.USERS).updateOne(
          { userId: disconnectedUserId },
          { $set: { lastSeen: new Date() } }
        );
        
        // Notify contacts
        const user = await db.collection(COLLECTIONS.USERS).findOne({ 
          userId: disconnectedUserId 
        });
        
        if (user) {
          // Get user's chats
          const chats = await db.collection(COLLECTIONS.CHATS).find({
            participants: disconnectedUserId,
            type: 'private'
          }).toArray();
          
          // Notify all contacts
          chats.forEach(chat => {
            const otherUserId = chat.participants.find(p => p !== disconnectedUserId);
            const otherSocketId = onlineUsers.get(otherUserId);
            if (otherSocketId) {
              io.to(otherSocketId).emit('user-status', {
                userId: disconnectedUserId,
                isOnline: false,
                lastSeen: new Date()
              });
            }
          });
        }
      }
      
      console.log('Client disconnected:', socket.id);
    } catch (error) {
      console.error('Disconnect error:', error);
    }
  });
});

// Start Server
const PORT = process.env.PORT || 3000;

connectToDatabase().then(() => {
  // Create uploads directory if it doesn't exist
  if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
  }
  
  server.listen(PORT, () => {
    console.log('='.repeat(60));
    console.log('📱 WHATSAPP CLONE - REAL-TIME MESSENGER');
    console.log('='.repeat(60));
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`✅ MongoDB: Connected to ${DB_NAME}`);
    console.log(`✅ Real-time messaging: Enabled`);
    console.log(`✅ File uploads: Enabled (10MB max)`);
    console.log(`🔗 Open: http://localhost:${PORT}`);
    console.log('='.repeat(60));
    console.log('\n🎯 FEATURES:');
    console.log('• WhatsApp-style UI with tabs (Chats, Status, Calls)');
    console.log('• User Registration & Login with password hashing');
    console.log('• Real-time messaging with delivery/read receipts');
    console.log('• Typing indicators');
    console.log('• Online/offline status');
    console.log('• File sharing (images, audio, video, documents)');
    console.log('• Status updates (24-hour stories)');
    console.log('• Voice/Video call signaling (WebRTC ready)');
    console.log('• Chat search and contacts');
    console.log('• User settings and privacy controls');
    console.log('• MongoDB persistence for all data');
    console.log('='.repeat(60));
  });
});
