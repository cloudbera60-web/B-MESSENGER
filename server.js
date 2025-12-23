const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcrypt');
const multer = require('multer');
const fs = require('fs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// Configure Socket.IO for production
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://ellyongiro8:QwXDXE6tyrGpUTNb@cluster0.tyxcmm9.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";
const DB_NAME = 'b_messenger_pro';
const JWT_SECRET = process.env.JWT_SECRET || 'b-messenger-jwt-secret-2024';

const COLLECTIONS = {
    USERS: 'users',
    MESSAGES: 'messages',
    USER_SETTINGS: 'user_settings',
    BLOCKED_USERS: 'blocked_users',
    GROUPS: 'groups',
    FILES: 'files',
    CONVERSATIONS: 'conversations',
    ADMIN_FLAGS: 'admin_flags'
};

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
    const allowedTypes = /jpeg|jpg|png|gif|pdf|txt|mp3|mp4|doc|docx|xls|xlsx/;
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
        await db.collection(COLLECTIONS.USERS).createIndex({ username: 1 }, { unique: true });
        await db.collection(COLLECTIONS.USERS).createIndex({ email: 1 }, { unique: true });
        await db.collection(COLLECTIONS.MESSAGES).createIndex({ conversationId: 1, timestamp: -1 });
        await db.collection(COLLECTIONS.MESSAGES).createIndex({ senderId: 1, receiverId: 1 });
        await db.collection(COLLECTIONS.MESSAGES).createIndex({ content: 'text' });
        await db.collection(COLLECTIONS.USERS).createIndex({ username: 'text', name: 'text', displayName: 'text' });
        await db.collection(COLLECTIONS.CONVERSATIONS).createIndex({ participants: 1 });
        await db.collection(COLLECTIONS.CONVERSATIONS).createIndex({ lastActivity: -1 });
        
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

function generateConversationId(user1, user2) {
    return [user1, user2].sort().join('_');
}

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ success: false, error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

const isAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }
  next();
};

// In-memory storage
const activeUsers = new Map(); // socket.id -> {username, userId, lastActive}
const userSockets = new Map(); // username -> socket.id
const typingUsers = new Map(); // conversationId -> Set of usernames
const onlineUsers = new Set(); // Set of online usernames

// API Routes

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'B MESSENGER',
    timestamp: new Date().toISOString()
  });
});

// 1. AUTHENTICATION
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, password, displayName, email } = req.body;
        
        if (!username || !password || !displayName) {
            return res.status(400).json({ success: false, error: 'Username, password and display name are required' });
        }
        
        if (password.length < 6) {
            return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
        }
        
        // Check if user exists
        const existingUser = await db.collection(COLLECTIONS.USERS).findOne({ 
            $or: [{ username }, { email: email || `${username}@bmessenger.com` }] 
        });
        
        if (existingUser) {
            return res.status(400).json({ 
                success: false, 
                error: existingUser.username === username ? 
                    'Username taken' : 'Email already registered' 
            });
        }
        
        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);
        const userId = generateUserId();
        
        // Create user
        const userData = {
            userId,
            username,
            displayName: displayName || username,
            email: email || `${username}@bmessenger.com`,
            password: hashedPassword,
            avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName || username)}&background=0088cc&color=fff`,
            isOnline: false,
            lastSeen: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
            status: "Hey there! I'm using B MESSENGER",
            phone: null,
            bio: '',
            role: 'user'
        };
        
        await db.collection(COLLECTIONS.USERS).insertOne(userData);
        
        // Create default settings
        await db.collection(COLLECTIONS.USER_SETTINGS).insertOne({
            userId,
            username,
            theme: 'light',
            notifications: true,
            sound: true,
            wallpaper: 'default',
            privacy: {
                lastSeen: 'everyone',
                profilePhoto: 'everyone',
                status: 'everyone',
                readReceipts: true
            },
            security: {
                twoFactor: false,
                loginAlerts: true
            },
            chat: {
                enterToSend: true,
                mediaVisibility: true,
                fontSize: 'medium'
            },
            createdAt: new Date()
        });
        
        // Generate JWT token
        const token = jwt.sign(
            { userId, username: userData.username, role: userData.role },
            JWT_SECRET,
            { expiresIn: '7d' }
        );
        
        res.status(201).json({ 
            success: true, 
            message: 'Account created successfully',
            token,
            user: {
                userId,
                username: userData.username,
                displayName: userData.displayName,
                avatar: userData.avatar,
                status: userData.status,
                email: userData.email,
                role: userData.role
            }
        });
        
    } catch (error) {
        console.error('Register error:', error);
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
        const user = await db.collection(COLLECTIONS.USERS).findOne({ 
            $or: [{ username }, { email: username }] 
        });
        
        if (!user) {
            return res.status(401).json({ success: false, error: 'Invalid credentials' });
        }
        
        // Check password
        const passwordMatch = await bcrypt.compare(password, user.password);
        if (!passwordMatch) {
            return res.status(401).json({ success: false, error: 'Invalid credentials' });
        }
        
        // Update last seen
        await db.collection(COLLECTIONS.USERS).updateOne(
            { username: user.username },
            { $set: { lastSeen: new Date() } }
        );
        
        // Generate JWT token
        const token = jwt.sign(
            { userId: user.userId, username: user.username, role: user.role },
            JWT_SECRET,
            { expiresIn: '7d' }
        );
        
        res.json({ 
            success: true, 
            message: 'Login successful',
            token,
            user: {
                userId: user.userId,
                username: user.username,
                displayName: user.displayName,
                avatar: user.avatar,
                status: user.status,
                email: user.email,
                role: user.role
            }
        });
        
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, error: 'Login failed' });
    }
});

app.get('/api/auth/verify', authenticateToken, async (req, res) => {
    try {
        const user = await db.collection(COLLECTIONS.USERS).findOne(
            { userId: req.user.userId },
            { projection: { password: 0 } }
        );
        
        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }
        
        res.json({
            success: true,
            user: {
                ...user,
                isOnline: onlineUsers.has(user.username)
            }
        });
    } catch (error) {
        console.error('Verify error:', error);
        res.status(500).json({ success: false, error: 'Verification failed' });
    }
});

// 2. USER MANAGEMENT
app.get('/api/users/all', authenticateToken, async (req, res) => {
    try {
        const users = await db.collection(COLLECTIONS.USERS)
            .find({ username: { $ne: req.user.username } }, { projection: { password: 0 } })
            .sort({ displayName: 1 })
            .toArray();
        
        // Add online status
        const usersWithStatus = users.map(user => ({
            ...user,
            isOnline: onlineUsers.has(user.username)
        }));
        
        res.json({ success: true, users: usersWithStatus });
    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({ success: false, error: 'Failed to get users' });
    }
});

app.get('/api/users/online', authenticateToken, async (req, res) => {
    try {
        const onlineUsernames = Array.from(onlineUsers);
        const users = await db.collection(COLLECTIONS.USERS)
            .find({ 
                username: { $in: onlineUsernames, $ne: req.user.username } 
            }, { projection: { password: 0 } })
            .toArray();
        
        res.json({ success: true, users });
    } catch (error) {
        console.error('Get online users error:', error);
        res.status(500).json({ success: false, error: 'Failed to get online users' });
    }
});

app.get('/api/users/search', authenticateToken, async (req, res) => {
    try {
        const { query } = req.query;
        
        if (!query || query.length < 2) {
            return res.json({ success: true, users: [] });
        }
        
        const users = await db.collection(COLLECTIONS.USERS)
            .find({
                $and: [
                    {
                        $or: [
                            { username: { $regex: query, $options: 'i' } },
                            { displayName: { $regex: query, $options: 'i' } },
                            { email: { $regex: query, $options: 'i' } }
                        ]
                    },
                    { username: { $ne: req.user.username } }
                ]
            }, { projection: { password: 0 } })
            .limit(20)
            .toArray();
        
        // Add online status
        const usersWithStatus = users.map(user => ({
            ...user,
            isOnline: onlineUsers.has(user.username)
        }));
        
        res.json({ success: true, users: usersWithStatus });
    } catch (error) {
        console.error('Search users error:', error);
        res.status(500).json({ success: false, error: 'Search failed' });
    }
});

app.get('/api/users/:username', authenticateToken, async (req, res) => {
    try {
        const { username } = req.params;
        
        const user = await db.collection(COLLECTIONS.USERS).findOne(
            { username },
            { projection: { password: 0 } }
        );
        
        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }
        
        // Add online status
        user.isOnline = onlineUsers.has(username);
        
        res.json({ success: true, user });
    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({ success: false, error: 'Failed to get user' });
    }
});

app.put('/api/users/profile', authenticateToken, async (req, res) => {
    try {
        const { displayName, status, bio, phone, avatar } = req.body;
        
        const updateData = { updatedAt: new Date() };
        if (displayName) updateData.displayName = displayName;
        if (status !== undefined) updateData.status = status;
        if (bio !== undefined) updateData.bio = bio;
        if (phone !== undefined) updateData.phone = phone;
        if (avatar) updateData.avatar = avatar;
        
        await db.collection(COLLECTIONS.USERS).updateOne(
            { username: req.user.username },
            { $set: updateData }
        );
        
        res.json({ success: true, message: 'Profile updated' });
    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({ success: false, error: 'Failed to update profile' });
    }
});

// 3. CONVERSATIONS & MESSAGING
app.get('/api/conversations', authenticateToken, async (req, res) => {
    try {
        const username = req.user.username;
        
        // Get all conversations for this user
        const conversations = await db.collection(COLLECTIONS.MESSAGES)
            .aggregate([
                { 
                    $match: { 
                        $or: [{ sender: username }, { receiver: username }],
                        deleted: { $ne: true }
                    } 
                },
                { 
                    $sort: { timestamp: -1 }
                },
                { 
                    $group: { 
                        _id: "$conversationId",
                        lastMessage: { $first: "$$ROOT" },
                        unreadCount: {
                            $sum: {
                                $cond: [
                                    { 
                                        $and: [
                                            { $eq: ["$receiver", username] },
                                            { $eq: ["$read", false] },
                                            { $ne: ["$sender", username] }
                                        ]
                                    },
                                    1,
                                    0
                                ]
                            }
                        },
                        totalMessages: { $sum: 1 }
                    } 
                },
                { $sort: { "lastMessage.timestamp": -1 } }
            ])
            .toArray();
        
        // Get user details for each conversation
        const formattedConversations = await Promise.all(
            conversations.map(async (conv) => {
                const conversationId = conv._id;
                const users = conversationId.split('_');
                const partner = users.find(user => user !== username);
                
                // Get partner info
                const partnerInfo = await db.collection(COLLECTIONS.USERS).findOne(
                    { username: partner },
                    { projection: { password: 0 } }
                );
                
                return {
                    conversationId,
                    partner,
                    partnerInfo: {
                        username: partnerInfo?.username,
                        displayName: partnerInfo?.displayName || partnerInfo?.name,
                        avatar: partnerInfo?.avatar,
                        status: partnerInfo?.status,
                        isOnline: onlineUsers.has(partner)
                    },
                    lastMessage: conv.lastMessage ? {
                        _id: conv.lastMessage._id,
                        content: conv.lastMessage.text || conv.lastMessage.content,
                        sender: conv.lastMessage.sender,
                        timestamp: conv.lastMessage.timestamp,
                        type: conv.lastMessage.type || 'text',
                        read: conv.lastMessage.read,
                        delivered: conv.lastMessage.delivered
                    } : null,
                    unreadCount: conv.unreadCount,
                    totalMessages: conv.totalMessages,
                    updatedAt: conv.lastMessage?.timestamp
                };
            })
        );
        
        res.json({ success: true, conversations: formattedConversations });
        
    } catch (error) {
        console.error('Get conversations error:', error);
        res.status(500).json({ success: false, error: 'Failed to get conversations' });
    }
});

app.post('/api/conversations/start', authenticateToken, async (req, res) => {
    try {
        const { userId, username } = req.body;
        const currentUsername = req.user.username;
        
        if (!userId && !username) {
            return res.status(400).json({ success: false, error: 'User ID or username required' });
        }
        
        const targetUsername = username || (await db.collection(COLLECTIONS.USERS).findOne({ userId }))?.username;
        
        if (!targetUsername) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }
        
        const conversationId = generateConversationId(currentUsername, targetUsername);
        
        // Check if conversation already exists
        const existingMessages = await db.collection(COLLECTIONS.MESSAGES)
            .find({ conversationId })
            .limit(1)
            .toArray();
        
        if (existingMessages.length > 0) {
            return res.json({ 
                success: true, 
                conversationId,
                isNew: false 
            });
        }
        
        // Create a welcome message
        const welcomeMessage = {
            _id: new ObjectId(),
            conversationId,
            sender: currentUsername,
            receiver: targetUsername,
            text: `You are now connected on B MESSENGER!`,
            type: 'system',
            timestamp: new Date(),
            read: false,
            delivered: false
        };
        
        await db.collection(COLLECTIONS.MESSAGES).insertOne(welcomeMessage);
        
        res.status(201).json({ 
            success: true, 
            conversationId,
            isNew: true,
            message: welcomeMessage
        });
        
    } catch (error) {
        console.error('Start conversation error:', error);
        res.status(500).json({ success: false, error: 'Failed to start conversation' });
    }
});

app.get('/api/messages/:conversationId', authenticateToken, async (req, res) => {
    try {
        const { conversationId } = req.params;
        const { limit = 50, before } = req.query;
        
        // Verify user is part of conversation
        const users = conversationId.split('_');
        if (!users.includes(req.user.username)) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }
        
        let query = { conversationId, deleted: { $ne: true } };
        
        if (before) {
            query.timestamp = { $lt: new Date(before) };
        }
        
        const messages = await db.collection(COLLECTIONS.MESSAGES)
            .find(query)
            .sort({ timestamp: -1 })
            .limit(parseInt(limit))
            .toArray();
        
        // Mark messages as read
        const unreadMessages = messages.filter(msg => 
            msg.receiver === req.user.username && !msg.read
        );
        
        if (unreadMessages.length > 0) {
            const messageIds = unreadMessages.map(m => m._id);
            
            await db.collection(COLLECTIONS.MESSAGES).updateMany(
                { _id: { $in: messageIds } },
                { $set: { read: true, readAt: new Date() } }
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
        
        const messages = await db.collection(COLLECTIONS.MESSAGES)
            .find({
                $text: { $search: query },
                $or: [{ sender: req.user.username }, { receiver: req.user.username }],
                deleted: { $ne: true }
            })
            .sort({ timestamp: -1 })
            .limit(50)
            .toArray();
        
        res.json({ success: true, messages });
    } catch (error) {
        console.error('Search messages error:', error);
        res.status(500).json({ success: false, error: 'Search failed' });
    }
});

// 4. GROUP CHATS
app.post('/api/groups/create', authenticateToken, async (req, res) => {
    try {
        const { name, participants, avatar } = req.body;
        
        if (!name || !participants || participants.length === 0) {
            return res.status(400).json({ success: false, error: 'Group name and participants are required' });
        }
        
        const groupId = generateUserId();
        const allParticipants = [...participants, req.user.username];
        
        const groupData = {
            groupId,
            name,
            avatar: avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=0088cc&color=fff`,
            participants: allParticipants,
            admins: [req.user.username],
            createdBy: req.user.username,
            createdAt: new Date(),
            updatedAt: new Date()
        };
        
        await db.collection(COLLECTIONS.GROUPS).insertOne(groupData);
        
        // Create system message
        const systemMessage = {
            _id: new ObjectId(),
            conversationId: `group_${groupId}`,
            sender: 'system',
            receiver: 'all',
            text: `${req.user.displayName || req.user.username} created group "${name}"`,
            type: 'system',
            timestamp: new Date(),
            read: false,
            delivered: false
        };
        
        await db.collection(COLLECTIONS.MESSAGES).insertOne(systemMessage);
        
        res.status(201).json({
            success: true,
            message: 'Group created successfully',
            group: groupData,
            systemMessage
        });
        
    } catch (error) {
        console.error('Create group error:', error);
        res.status(500).json({ success: false, error: 'Failed to create group' });
    }
});

app.get('/api/groups/:groupId', authenticateToken, async (req, res) => {
    try {
        const { groupId } = req.params;
        
        const group = await db.collection(COLLECTIONS.GROUPS).findOne({ groupId });
        
        if (!group) {
            return res.status(404).json({ success: false, error: 'Group not found' });
        }
        
        // Check if user is a participant
        if (!group.participants.includes(req.user.username)) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }
        
        res.json({ success: true, group });
    } catch (error) {
        console.error('Get group error:', error);
        res.status(500).json({ success: false, error: 'Failed to get group' });
    }
});

// 5. FILE UPLOAD
app.post('/api/upload', authenticateToken, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'No file uploaded' });
        }
        
        const { originalname, mimetype, size, filename } = req.file;
        const fileId = generateUserId();
        
        const fileData = {
            fileId,
            originalName: originalname,
            mimeType: mimetype,
            size,
            path: filename,
            uploadedAt: new Date(),
            uploadedBy: req.user.username
        };
        
        await db.collection(COLLECTIONS.FILES).insertOne(fileData);
        
        res.json({
            success: true,
            file: {
                fileId,
                url: `/uploads/${filename}`,
                originalName: originalname,
                mimeType: mimetype,
                size
            }
        });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ success: false, error: 'Upload failed' });
    }
});

// 6. SETTINGS
app.get('/api/settings', authenticateToken, async (req, res) => {
    try {
        const user = await db.collection(COLLECTIONS.USERS).findOne(
            { username: req.user.username },
            { projection: { password: 0 } }
        );
        
        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }
        
        let settings = await db.collection(COLLECTIONS.USER_SETTINGS).findOne({ username: req.user.username });
        
        if (!settings) {
            settings = {
                username: req.user.username,
                theme: 'light',
                notifications: true,
                sound: true,
                wallpaper: 'default',
                privacy: {
                    lastSeen: 'everyone',
                    profilePhoto: 'everyone',
                    status: 'everyone',
                    readReceipts: true
                },
                security: {
                    twoFactor: false,
                    loginAlerts: true
                },
                chat: {
                    enterToSend: true,
                    mediaVisibility: true,
                    fontSize: 'medium'
                },
                createdAt: new Date()
            };
            
            await db.collection(COLLECTIONS.USER_SETTINGS).insertOne(settings);
        }
        
        res.json({ success: true, user, settings });
    } catch (error) {
        console.error('Get settings error:', error);
        res.status(500).json({ success: false, error: 'Failed to get settings' });
    }
});

app.put('/api/settings', authenticateToken, async (req, res) => {
    try {
        const { settings } = req.body;
        
        await db.collection(COLLECTIONS.USER_SETTINGS).updateOne(
            { username: req.user.username },
            { 
                $set: { 
                    ...settings,
                    updatedAt: new Date()
                } 
            },
            { upsert: true }
        );
        
        res.json({ success: true, message: 'Settings updated' });
    } catch (error) {
        console.error('Update settings error:', error);
        res.status(500).json({ success: false, error: 'Failed to update settings' });
    }
});

// 7. BLOCK USERS
app.post('/api/block', authenticateToken, async (req, res) => {
    try {
        const { blocked } = req.body;
        
        await db.collection(COLLECTIONS.BLOCKED_USERS).updateOne(
            { blocker: req.user.username, blocked },
            { $set: { blockedAt: new Date() } },
            { upsert: true }
        );
        
        res.json({ success: true, message: 'User blocked' });
    } catch (error) {
        console.error('Block user error:', error);
        res.status(500).json({ success: false, error: 'Failed to block user' });
    }
});

app.post('/api/unblock', authenticateToken, async (req, res) => {
    try {
        const { blocked } = req.body;
        
        await db.collection(COLLECTIONS.BLOCKED_USERS).deleteOne({ blocker: req.user.username, blocked });
        
        res.json({ success: true, message: 'User unblocked' });
    } catch (error) {
        console.error('Unblock user error:', error);
        res.status(500).json({ success: false, error: 'Failed to unblock user' });
    }
});

app.get('/api/blocked', authenticateToken, async (req, res) => {
    try {
        const blocked = await db.collection(COLLECTIONS.BLOCKED_USERS)
            .find({ blocker: req.user.username })
            .toArray();
        
        res.json({ success: true, blocked: blocked.map(b => b.blocked) });
    } catch (error) {
        console.error('Get blocked users error:', error);
        res.status(500).json({ success: false, error: 'Failed to get blocked users' });
    }
});

// 8. ADMIN ROUTES
app.get('/api/admin/users', authenticateToken, isAdmin, async (req, res) => {
    try {
        const users = await db.collection(COLLECTIONS.USERS)
            .find({}, { projection: { password: 0 } })
            .sort({ createdAt: -1 })
            .toArray();
        
        res.json({ success: true, users });
    } catch (error) {
        console.error('Admin get users error:', error);
        res.status(500).json({ success: false, error: 'Failed to get users' });
    }
});

app.get('/api/admin/conversations', authenticateToken, isAdmin, async (req, res) => {
    try {
        const conversations = await db.collection(COLLECTIONS.MESSAGES)
            .aggregate([
                { 
                    $match: { deleted: { $ne: true } }
                },
                { 
                    $sort: { timestamp: -1 }
                },
                { 
                    $group: { 
                        _id: "$conversationId",
                        lastMessage: { $first: "$$ROOT" },
                        messageCount: { $sum: 1 }
                    } 
                },
                { $sort: { "lastMessage.timestamp": -1 } },
                { $limit: 100 }
            ])
            .toArray();
        
        res.json({ success: true, conversations });
    } catch (error) {
        console.error('Admin get conversations error:', error);
        res.status(500).json({ success: false, error: 'Failed to get conversations' });
    }
});

app.get('/api/admin/messages', authenticateToken, isAdmin, async (req, res) => {
    try {
        const { conversationId, username, keyword, startDate, endDate, page = 1, limit = 50 } = req.query;
        
        let query = { deleted: { $ne: true } };
        
        if (conversationId) query.conversationId = conversationId;
        if (username) query.$or = [{ sender: username }, { receiver: username }];
        if (keyword) query.$text = { $search: keyword };
        
        if (startDate || endDate) {
            query.timestamp = {};
            if (startDate) query.timestamp.$gte = new Date(startDate);
            if (endDate) query.timestamp.$lte = new Date(endDate);
        }

        const messages = await db.collection(COLLECTIONS.MESSAGES)
            .find(query)
            .sort({ timestamp: -1 })
            .skip((page - 1) * limit)
            .limit(parseInt(limit))
            .toArray();

        const total = await db.collection(COLLECTIONS.MESSAGES).countDocuments(query);

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
        const flags = await db.collection(COLLECTIONS.ADMIN_FLAGS)
            .find({})
            .sort({ createdAt: -1 })
            .toArray();
        
        res.json({ success: true, flags });
    } catch (error) {
        console.error('Admin get flags error:', error);
        res.status(500).json({ success: false, error: 'Failed to get flags' });
    }
});

app.post('/api/admin/flags/:flagId/review', authenticateToken, isAdmin, async (req, res) => {
    try {
        const { flagId } = req.params;
        const { action } = req.body;
        
        const flag = await db.collection(COLLECTIONS.ADMIN_FLAGS).findOne({ 
            _id: new ObjectId(flagId) 
        });
        
        if (!flag) {
            return res.status(404).json({ success: false, error: 'Flag not found' });
        }
        
        flag.reviewed = true;
        flag.reviewedBy = req.user.username;
        flag.reviewedAt = new Date();
        
        if (action === 'delete') {
            await db.collection(COLLECTIONS.MESSAGES).updateOne(
                { _id: flag.messageId },
                { $set: { deleted: true, deletedAt: new Date() } }
            );
        }
        
        await db.collection(COLLECTIONS.ADMIN_FLAGS).updateOne(
            { _id: new ObjectId(flagId) },
            { $set: flag }
        );
        
        res.json({ success: true, message: 'Flag reviewed successfully' });
        
    } catch (error) {
        console.error('Review flag error:', error);
        res.status(500).json({ success: false, error: 'Failed to review flag' });
    }
});

// Serve main page
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Socket.IO Handling
io.on('connection', (socket) => {
    console.log('🔌 User connected:', socket.id);

    socket.on('authenticate', async (token) => {
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            const user = await db.collection(COLLECTIONS.USERS).findOne({ 
                username: decoded.username 
            });
            
            if (!user) {
                socket.emit('auth-error', 'User not found');
                return;
            }

            // Store user connection
            activeUsers.set(socket.id, { 
                username: user.username, 
                userId: user.userId, 
                lastActive: new Date() 
            });
            userSockets.set(user.username, socket.id);
            onlineUsers.add(user.username);
            
            // Update user status
            await db.collection(COLLECTIONS.USERS).updateOne(
                { username: user.username },
                { $set: { isOnline: true, lastSeen: new Date() } }
            );
            
            // Notify all users
            io.emit('user-status-changed', { 
                username: user.username, 
                isOnline: true,
                lastSeen: new Date()
            });
            
            // Send online users list
            const onlineUsersList = Array.from(onlineUsers);
            socket.emit('online-users-list', onlineUsersList);
            
            socket.userId = user.userId;
            socket.username = user.username;
            socket.role = user.role;
            
            console.log(`✅ ${user.username} is now online`);
            
        } catch (error) {
            console.error('User authentication error:', error);
            socket.emit('auth-error', 'Invalid token');
        }
    });

    socket.on('join-conversation', async (data) => {
        try {
            const { conversationId, username } = data;
            
            // Join room for this conversation
            socket.join(conversationId);
            
            // Get conversation messages
            const messages = await db.collection(COLLECTIONS.MESSAGES)
                .find({ conversationId, deleted: { $ne: true } })
                .sort({ timestamp: -1 })
                .limit(100)
                .toArray();
            
            messages.reverse();
            
            // Mark messages as read
            const unreadMessages = messages.filter(m => 
                m.receiver === username && !m.read
            );
            
            if (unreadMessages.length > 0) {
                const messageIds = unreadMessages.map(m => m._id);
                
                await db.collection(COLLECTIONS.MESSAGES).updateMany(
                    { _id: { $in: messageIds } },
                    { $set: { read: true, readAt: new Date() } }
                );
                
                // Notify sender about read messages
                const otherUser = conversationId.split('_').find(u => u !== username);
                const otherSocket = userSockets.get(otherUser);
                
                if (otherSocket) {
                    io.to(otherSocket).emit('messages-read', {
                        conversationId,
                        messageIds,
                        reader: username
                    });
                }
            }
            
            socket.emit('conversation-loaded', {
                conversationId,
                messages
            });
            
        } catch (error) {
            console.error('Join conversation error:', error);
            socket.emit('conversation-error', { error: 'Failed to load conversation' });
        }
    });

    socket.on('send-message', async (data, callback) => {
        try {
            const { sender, receiver, text, type = 'text', file, tempId, conversationId: providedConversationId } = data;
            
            if (!sender || !receiver || (!text && !file)) {
                if (callback) callback({ error: 'Invalid message data' });
                return;
            }
            
            // Check if blocked
            const isBlocked = await db.collection(COLLECTIONS.BLOCKED_USERS).findOne({
                blocker: receiver,
                blocked: sender
            });
            
            if (isBlocked) {
                if (callback) callback({ error: 'You are blocked by this user' });
                return;
            }
            
            const conversationId = providedConversationId || generateConversationId(sender, receiver);
            const messageId = new ObjectId();
            
            const message = {
                _id: messageId,
                text: text || '',
                content: text || '',
                sender,
                receiver,
                senderId: sender,
                receiverId: receiver,
                timestamp: new Date(),
                conversationId,
                type: type,
                read: false,
                delivered: false,
                tempId,
                ...(file && { file })
            };
            
            // Auto-flag sensitive content
            const sensitiveKeywords = ['badword', 'spam', 'scam', 'hack', 'cheat'];
            const hasSensitiveContent = sensitiveKeywords.some(keyword => 
                text.toLowerCase().includes(keyword.toLowerCase())
            );
            
            if (hasSensitiveContent) {
                const flag = {
                    messageId: messageId,
                    conversationId,
                    reason: 'Sensitive content detected',
                    severity: 'medium',
                    reviewed: false,
                    createdAt: new Date()
                };
                await db.collection(COLLECTIONS.ADMIN_FLAGS).insertOne(flag);
            }
            
            // Save to database
            await db.collection(COLLECTIONS.MESSAGES).insertOne(message);
            
            // Prepare message for sending
            const messageToSend = { ...message };
            delete messageToSend.tempId;
            
            // Send to sender immediately
            socket.emit('new-message', messageToSend);
            
            // Send to receiver if online
            const receiverSocketId = userSockets.get(receiver);
            if (receiverSocketId) {
                // Mark as delivered
                await db.collection(COLLECTIONS.MESSAGES).updateOne(
                    { _id: messageId },
                    { $set: { delivered: true, deliveredAt: new Date() } }
                );
                
                messageToSend.delivered = true;
                io.to(receiverSocketId).emit('new-message', messageToSend);
                
                // Notify sender about delivery
                socket.emit('message-delivered', {
                    messageId: messageId.toString(),
                    tempId
                });
            }
            
            // Update both users' conversation lists
            [sender, receiver].forEach(async (username) => {
                const userSocketId = userSockets.get(username);
                if (userSocketId) {
                    // Send updated conversation info
                    const conversations = await db.collection(COLLECTIONS.MESSAGES)
                        .aggregate([
                            { 
                                $match: { 
                                    $or: [{ sender: username }, { receiver: username }],
                                    deleted: { $ne: true }
                                } 
                            },
                            { $sort: { timestamp: -1 } },
                            { 
                                $group: { 
                                    _id: "$conversationId",
                                    lastMessage: { $first: "$$ROOT" }
                                } 
                            }
                        ])
                        .toArray();
                    
                    io.to(userSocketId).emit('conversations-updated', conversations);
                }
            });
            
            if (callback) callback({ 
                success: true, 
                messageId: messageId.toString(),
                conversationId 
            });
            
        } catch (error) {
            console.error('Send message error:', error);
            if (callback) callback({ error: 'Failed to send message' });
        }
    });

    socket.on('typing-start', (data) => {
        try {
            const { conversationId, username } = data;
            
            // Notify other users in conversation
            socket.to(conversationId).emit('user-typing', {
                conversationId,
                username,
                isTyping: true
            });
            
        } catch (error) {
            console.error('Typing start error:', error);
        }
    });

    socket.on('typing-stop', (data) => {
        try {
            const { conversationId, username } = data;
            
            // Notify other users
            socket.to(conversationId).emit('user-typing', {
                conversationId,
                username,
                isTyping: false
            });
            
        } catch (error) {
            console.error('Typing stop error:', error);
        }
    });

    socket.on('message-read', async (data) => {
        try {
            const { messageId, reader } = data;
            
            // Update message as read
            const result = await db.collection(COLLECTIONS.MESSAGES).updateOne(
                { _id: new ObjectId(messageId), receiver: reader },
                { $set: { read: true, readAt: new Date() } }
            );
            
            if (result.modifiedCount > 0) {
                // Notify sender
                const message = await db.collection(COLLECTIONS.MESSAGES).findOne({ 
                    _id: new ObjectId(messageId) 
                });
                
                if (message) {
                    const senderSocketId = userSockets.get(message.sender);
                    if (senderSocketId) {
                        io.to(senderSocketId).emit('message-read', { 
                            messageId,
                            reader 
                        });
                    }
                }
            }
            
        } catch (error) {
            console.error('Message read error:', error);
        }
    });

    socket.on('delete-message', async (data) => {
        try {
            const { messageId, username } = data;
            
            // Check if user owns the message
            const message = await db.collection(COLLECTIONS.MESSAGES).findOne({ 
                _id: new ObjectId(messageId) 
            });
            
            if (message && message.sender === username) {
                // Soft delete
                await db.collection(COLLECTIONS.MESSAGES).updateOne(
                    { _id: new ObjectId(messageId) },
                    { $set: { deleted: true, deletedAt: new Date() } }
                );
                
                // Notify both users
                const conversationId = message.conversationId;
                io.to(conversationId).emit('message-deleted', { messageId });
            }
            
        } catch (error) {
            console.error('Delete message error:', error);
        }
    });

    socket.on('disconnect', async () => {
        try {
            const userData = activeUsers.get(socket.id);
            if (userData) {
                const { username } = userData;
                
                // Remove from online lists
                activeUsers.delete(socket.id);
                userSockets.delete(username);
                onlineUsers.delete(username);
                
                // Update user status
                await db.collection(COLLECTIONS.USERS).updateOne(
                    { username },
                    { $set: { isOnline: false, lastSeen: new Date() } }
                );
                
                // Notify all users
                io.emit('user-status-changed', { 
                    username, 
                    isOnline: false,
                    lastSeen: new Date()
                });
                
                console.log(`❌ ${username} disconnected`);
            }
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
        fs.mkdirSync('uploads', { recursive: true });
    }
    
    server.listen(PORT, () => {
        console.log('='.repeat(60));
        console.log('🚀 B MESSENGER - WhatsApp/Telegram Clone');
        console.log('='.repeat(60));
        console.log(`✅ Server running on port ${PORT}`);
        console.log(`✅ MongoDB: Connected to ${DB_NAME}`);
        console.log(`✅ File uploads: Enabled (10MB max)`);
        console.log(`✅ Features: Real-time chat, Search, File sharing`);
        console.log(`✅ Admin Dashboard: Enabled`);
        console.log(`🔗 Open: http://localhost:${PORT}`);
        console.log('='.repeat(60));
        console.log('\n🎯 FEATURES INCLUDED:');
        console.log('• WhatsApp-like UI with dark/light themes');
        console.log('• Telegram-style global user search');
        console.log('• Real-time messaging with read receipts');
        console.log('• Typing indicators');
        console.log('• File sharing (images, docs, audio)');
        console.log('• User blocking system');
        console.log('• Group chats with admin controls');
        console.log('• Profile customization');
        console.log('• Message search');
        console.log('• Online/offline status');
        console.log('• Admin moderation dashboard');
        console.log('• Content auto-flagging');
        console.log('='.repeat(60));
    });
});
