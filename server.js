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

// Connect to MongoDB with safe index creation
async function connectToDatabase() {
    try {
        const client = new MongoClient(MONGODB_URI);
        await client.connect();
        console.log('✅ Connected to MongoDB');
        
        db = client.db(DB_NAME);
        mongoClient = client;
        
        // Check and create indexes safely
        await createIndexesSafely();
        
        return client;
    } catch (error) {
        console.error('❌ MongoDB connection failed:', error);
        process.exit(1);
    }
}

// Safe index creation that handles existing indexes
async function createIndexesSafely() {
    try {
        console.log('🔧 Setting up database indexes...');
        
        // Get existing indexes to avoid conflicts
        const existingIndexes = {
            users: await db.collection(COLLECTIONS.USERS).indexes(),
            messages: await db.collection(COLLECTIONS.MESSAGES).indexes(),
            conversations: await db.collection(COLLECTIONS.CONVERSATIONS).indexes()
        };
        
        // Create indexes only if they don't exist
        await createIndexIfNotExists(COLLECTIONS.USERS, { username: 1 }, { unique: true, name: 'username_unique' });
        await createIndexIfNotExists(COLLECTIONS.USERS, { email: 1 }, { unique: true, name: 'email_unique' });
        await createIndexIfNotExists(COLLECTIONS.USERS, { username: 'text', displayName: 'text', name: 'text' }, { name: 'user_search_text' });
        
        await createIndexIfNotExists(COLLECTIONS.MESSAGES, { conversationId: 1, timestamp: -1 }, { name: 'conversation_timestamp' });
        await createIndexIfNotExists(COLLECTIONS.MESSAGES, { sender: 1, receiver: 1 }, { name: 'sender_receiver' });
        await createIndexIfNotExists(COLLECTIONS.MESSAGES, { content: 'text' }, { name: 'message_content_text' });
        
        if (!existingIndexes.conversations) {
            await db.collection(COLLECTIONS.CONVERSATIONS).createIndex({ participants: 1 }, { name: 'participants_index' });
            await db.collection(COLLECTIONS.CONVERSATIONS).createIndex({ lastActivity: -1 }, { name: 'last_activity_desc' });
        }
        
        console.log('✅ Database indexes setup completed');
        
    } catch (error) {
        console.error('❌ Index creation error:', error.message);
        // Don't fail the entire app if index creation fails
    }
}

// Helper function to create index only if it doesn't exist
async function createIndexIfNotExists(collectionName, keys, options = {}) {
    const collection = db.collection(collectionName);
    const indexes = await collection.indexes();
    
    // Check if similar index already exists
    const indexExists = indexes.some(index => {
        // Compare keys
        const existingKeys = JSON.stringify(index.key);
        const newKeys = JSON.stringify(keys);
        
        // Check if keys match
        if (existingKeys === newKeys) {
            console.log(`⚠️  Index already exists for ${collectionName}:`, index.name);
            return true;
        }
        
        // Check if it's a unique index on the same field
        if (options.unique) {
            const existingKeyNames = Object.keys(index.key);
            const newKeyNames = Object.keys(keys);
            
            if (existingKeyNames.length === 1 && newKeyNames.length === 1) {
                if (existingKeyNames[0] === newKeyNames[0]) {
                    console.log(`⚠️  Unique index already exists on ${existingKeyNames[0]} for ${collectionName}`);
                    return true;
                }
            }
        }
        
        return false;
    });
    
    if (!indexExists) {
        try {
            await collection.createIndex(keys, options);
            console.log(`✅ Created index for ${collectionName}:`, options.name || 'unnamed');
        } catch (error) {
            // If it's an index conflict error, just log it
            if (error.code === 85 || error.codeName === 'IndexOptionsConflict') {
                console.log(`⚠️  Index conflict for ${collectionName}, using existing index`);
            } else {
                throw error;
            }
        }
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
    timestamp: new Date().toISOString(),
    version: '1.0.0'
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
        const { username: targetUsername } = req.body;
        const currentUsername = req.user.username;
        
        if (!targetUsername) {
            return res.status(400).json({ success: false, error: 'Username required' });
        }
        
        if (targetUsername === currentUsername) {
            return res.status(400).json({ success: false, error: 'Cannot start conversation with yourself' });
        }
        
        const conversationId = generateConversationId(currentUsername, targetUsername);
        
        // Check if conversation already exists
        const existingMessage = await db.collection(COLLECTIONS.MESSAGES)
            .findOne({ conversationId });
        
        if (existingMessage) {
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

// 7. ADMIN ROUTES
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

app.get('/api/admin/messages', authenticateToken, isAdmin, async (req, res) => {
    try {
        const { conversationId, username, keyword, page = 1, limit = 50 } = req.query;
        
        let query = { deleted: { $ne: true } };
        
        if (conversationId) query.conversationId = conversationId;
        if (username) query.$or = [{ sender: username }, { receiver: username }];
        if (keyword) query.$or = [
            { text: { $regex: keyword, $options: 'i' } },
            { content: { $regex: keyword, $options: 'i' } }
        ];

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
                timestamp: new Date(),
                conversationId,
                type: type,
                read: false,
                delivered: false,
                tempId,
                ...(file && { file })
            };
            
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
        console.log(`✅ Environment: ${process.env.NODE_ENV || 'development'}`);
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
        console.log('='.repeat(60));
    });
});
