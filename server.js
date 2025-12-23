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
const io = socketIo(server);

// Middleware
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://ellyongiro8:QwXDXE6tyrGpUTNb@cluster0.tyxcmm9.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";
const DB_NAME = 'b_messenger_mobile';
const COLLECTIONS = {
    USERS: 'users',
    MESSAGES: 'messages',
    USER_SETTINGS: 'user_settings',
    STATUS_UPDATES: 'status_updates',
    CALLS: 'calls'
};

// File upload setup
const upload = multer({
    dest: 'uploads/',
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|pdf|txt|mp3|mp4|mpeg/;
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
        
        // Create indexes for mobile-first approach
        await db.collection(COLLECTIONS.USERS).createIndex({ username: 1 }, { unique: true });
        await db.collection(COLLECTIONS.MESSAGES).createIndex({ conversationId: 1, timestamp: -1 });
        await db.collection(COLLECTIONS.MESSAGES).createIndex({ sender: 1, receiver: 1 });
        await db.collection(COLLECTIONS.STATUS_UPDATES).createIndex({ userId: 1, createdAt: -1 });
        await db.collection(COLLECTIONS.CALLS).createIndex({ participants: 1, timestamp: -1 });
        
        return client;
    } catch (error) {
        console.error('❌ MongoDB connection failed:', error);
        process.exit(1);
    }
}

// Utility Functions
function getConversationId(user1, user2) {
    return [user1, user2].sort().join('_');
}

function generateId() {
    return crypto.randomBytes(16).toString('hex');
}

// In-memory storage for mobile sessions
const activeUsers = new Map(); // socket.id -> {username, userId, lastActive}
const userSockets = new Map(); // username -> socket.id
const onlineUsers = new Set(); // Set of online usernames

// API Routes optimized for mobile
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.json({ success: false, error: 'Username and password required' });
        }
        
        // Find user
        const user = await db.collection(COLLECTIONS.USERS).findOne({ 
            $or: [{ username }, { phone: username }] 
        });
        
        if (!user) {
            return res.json({ success: false, error: 'User not found' });
        }
        
        // Check password
        const passwordMatch = await bcrypt.compare(password, user.password);
        if (!passwordMatch) {
            return res.json({ success: false, error: 'Invalid password' });
        }
        
        // Update last seen
        await db.collection(COLLECTIONS.USERS).updateOne(
            { username: user.username },
            { $set: { lastSeen: new Date(), isOnline: true } }
        );
        
        res.json({ 
            success: true,
            user: {
                userId: user.userId,
                username: user.username,
                name: user.name,
                phone: user.phone,
                avatar: user.avatar,
                status: user.status,
                isOnline: true
            }
        });
        
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, error: 'Login failed' });
    }
});

app.post('/api/auth/register', async (req, res) => {
    try {
        const { name, phone, password } = req.body;
        
        if (!name || !phone || !password) {
            return res.json({ success: false, error: 'Name, phone and password required' });
        }
        
        if (password.length < 6) {
            return res.json({ success: false, error: 'Password must be at least 6 characters' });
        }
        
        // Check if phone exists
        const existingUser = await db.collection(COLLECTIONS.USERS).findOne({ phone });
        
        if (existingUser) {
            return res.json({ success: false, error: 'Phone number already registered' });
        }
        
        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);
        const userId = generateId();
        const username = phone.replace(/\D/g, '');
        
        // Create user
        const userData = {
            userId,
            username,
            name,
            phone,
            password: hashedPassword,
            avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=25D366&color=fff`,
            isOnline: true,
            lastSeen: new Date(),
            createdAt: new Date(),
            status: "Hey there! I'm using B-Messenger",
            about: ''
        };
        
        await db.collection(COLLECTIONS.USERS).insertOne(userData);
        
        res.json({ 
            success: true,
            user: {
                userId,
                username,
                name,
                phone,
                avatar: userData.avatar,
                status: userData.status
            }
        });
        
    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({ success: false, error: 'Registration failed' });
    }
});

// Get chat list for mobile
app.get('/api/chats/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        
        const user = await db.collection(COLLECTIONS.USERS).findOne({ userId });
        if (!user) return res.json({ success: false, error: 'User not found' });
        
        // Get all conversations
        const conversations = await db.collection(COLLECTIONS.MESSAGES)
            .aggregate([
                { 
                    $match: { 
                        $or: [{ sender: user.username }, { receiver: user.username }],
                        deleted: { $ne: true }
                    } 
                },
                { $sort: { timestamp: -1 } },
                { 
                    $group: { 
                        _id: "$conversationId",
                        lastMessage: { $first: "$$ROOT" },
                        unreadCount: {
                            $sum: {
                                $cond: [
                                    { 
                                        $and: [
                                            { $eq: ["$receiver", user.username] },
                                            { $eq: ["$read", false] },
                                            { $ne: ["$sender", user.username] }
                                        ]
                                    },
                                    1,
                                    0
                                ]
                            }
                        }
                    } 
                },
                { $sort: { "lastMessage.timestamp": -1 } }
            ])
            .toArray();
        
        // Format for mobile
        const formattedChats = await Promise.all(
            conversations.map(async (conv) => {
                const conversationId = conv._id;
                const users = conversationId.split('_');
                const partnerUsername = users.find(u => u !== user.username);
                
                const partner = await db.collection(COLLECTIONS.USERS).findOne(
                    { username: partnerUsername },
                    { projection: { password: 0 } }
                );
                
                return {
                    id: conversationId,
                    userId: partner?.userId,
                    name: partner?.name,
                    avatar: partner?.avatar,
                    lastMessage: {
                        text: conv.lastMessage?.text || '',
                        sender: conv.lastMessage?.sender === user.username ? 'You' : partner?.name,
                        time: conv.lastMessage?.timestamp,
                        isSent: conv.lastMessage?.sender === user.username,
                        isRead: conv.lastMessage?.read,
                        isDelivered: conv.lastMessage?.delivered
                    },
                    unreadCount: conv.unreadCount,
                    timestamp: conv.lastMessage?.timestamp,
                    isOnline: onlineUsers.has(partner?.username)
                };
            })
        );
        
        res.json({ success: true, chats: formattedChats });
        
    } catch (error) {
        console.error('Get chats error:', error);
        res.status(500).json({ success: false, error: 'Failed to get chats' });
    }
});

// Get messages for conversation
app.get('/api/messages/:conversationId', async (req, res) => {
    try {
        const { conversationId } = req.params;
        const { userId } = req.query;
        
        const user = await db.collection(COLLECTIONS.USERS).findOne({ userId });
        if (!user) return res.json({ success: false, error: 'User not found' });
        
        const messages = await db.collection(COLLECTIONS.MESSAGES)
            .find({ 
                conversationId,
                deleted: { $ne: true }
            })
            .sort({ timestamp: 1 })
            .limit(100)
            .toArray();
        
        // Format for mobile UI
        const formattedMessages = messages.map(msg => ({
            id: msg._id,
            text: msg.text,
            isSent: msg.sender === user.username,
            time: msg.timestamp,
            isRead: msg.read,
            isDelivered: msg.delivered,
            type: msg.type || 'text',
            file: msg.file
        }));
        
        // Mark as read
        const unreadMessages = messages.filter(m => 
            m.receiver === user.username && !m.read
        );
        
        if (unreadMessages.length > 0) {
            const messageIds = unreadMessages.map(m => m._id);
            await db.collection(COLLECTIONS.MESSAGES).updateMany(
                { _id: { $in: messageIds } },
                { $set: { read: true, readAt: new Date() } }
            );
        }
        
        res.json({ success: true, messages: formattedMessages });
        
    } catch (error) {
        console.error('Get messages error:', error);
        res.status(500).json({ success: false, error: 'Failed to get messages' });
    }
});

// Search users
app.get('/api/users/search', async (req, res) => {
    try {
        const { query } = req.query;
        
        if (!query || query.length < 2) {
            return res.json({ success: true, users: [] });
        }
        
        const users = await db.collection(COLLECTIONS.USERS)
            .find({
                $or: [
                    { name: { $regex: query, $options: 'i' } },
                    { phone: { $regex: query, $options: 'i' } }
                ]
            }, { projection: { password: 0 } })
            .limit(20)
            .toArray();
        
        const usersWithStatus = users.map(user => ({
            ...user,
            isOnline: onlineUsers.has(user.username)
        }));
        
        res.json({ success: true, users: usersWithStatus });
        
    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({ success: false, error: 'Search failed' });
    }
});

// Get status updates
app.get('/api/status/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        
        // Get user's contacts status
        const user = await db.collection(COLLECTIONS.USERS).findOne({ userId });
        if (!user) return res.json({ success: false, error: 'User not found' });
        
        // In a real app, you'd get contacts from user's phonebook
        // For demo, get recent users with status
        const statusUpdates = await db.collection(COLLECTIONS.STATUS_UPDATES)
            .find({ 
                createdAt: { $gt: new Date(Date.now() - 24 * 60 * 60 * 1000) } // Last 24h
            })
            .sort({ createdAt: -1 })
            .toArray();
        
        // Group by user
        const groupedStatus = {};
        statusUpdates.forEach(status => {
            if (!groupedStatus[status.userId]) {
                groupedStatus[status.userId] = {
                    user: status.userInfo,
                    updates: []
                };
            }
            groupedStatus[status.userId].updates.push(status);
        });
        
        res.json({ 
            success: true, 
            status: Object.values(groupedStatus),
            myStatus: {
                userId: user.userId,
                name: user.name,
                avatar: user.avatar,
                lastUpdated: user.lastSeen
            }
        });
        
    } catch (error) {
        console.error('Get status error:', error);
        res.status(500).json({ success: false, error: 'Failed to get status' });
    }
});

// Get call history
app.get('/api/calls/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        
        const user = await db.collection(COLLECTIONS.USERS).findOne({ userId });
        if (!user) return res.json({ success: false, error: 'User not found' });
        
        const calls = await db.collection(COLLECTIONS.CALLS)
            .find({ participants: user.username })
            .sort({ timestamp: -1 })
            .limit(50)
            .toArray();
        
        // Get caller/receiver info
        const formattedCalls = await Promise.all(
            calls.map(async (call) => {
                const otherParticipant = call.participants.find(p => p !== user.username);
                const otherUser = await db.collection(COLLECTIONS.USERS).findOne(
                    { username: otherParticipant },
                    { projection: { name: 1, avatar: 1 } }
                );
                
                return {
                    id: call._id,
                    type: call.type, // 'audio' or 'video'
                    direction: call.caller === user.username ? 'outgoing' : 'incoming',
                    status: call.status, // 'missed', 'answered', 'rejected'
                    duration: call.duration,
                    timestamp: call.timestamp,
                    contact: {
                        name: otherUser?.name || 'Unknown',
                        avatar: otherUser?.avatar
                    }
                };
            })
        );
        
        res.json({ success: true, calls: formattedCalls });
        
    } catch (error) {
        console.error('Get calls error:', error);
        res.status(500).json({ success: false, error: 'Failed to get calls' });
    }
});

// File upload
app.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'No file uploaded' });
        }
        
        const { originalname, mimetype, size, path: filepath } = req.file;
        const fileId = generateId();
        
        // Move file to permanent location
        const newPath = `uploads/${fileId}_${originalname}`;
        fs.renameSync(filepath, newPath);
        
        const fileData = {
            fileId,
            originalName: originalname,
            mimeType: mimetype,
            size,
            path: newPath,
            url: `/uploads/${fileId}_${originalname}`,
            uploadedAt: new Date()
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

// Serve main page
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Socket.IO Handling for mobile
io.on('connection', (socket) => {
    console.log('Mobile user connected:', socket.id);

    socket.on('user-online', async (userData) => {
        try {
            const { userId, username } = userData;
            
            // Store user connection
            activeUsers.set(socket.id, { userId, username, lastActive: new Date() });
            userSockets.set(username, socket.id);
            onlineUsers.add(username);
            
            // Update user status
            await db.collection(COLLECTIONS.USERS).updateOne(
                { username },
                { $set: { isOnline: true, lastSeen: new Date() } }
            );
            
            // Notify contacts
            io.emit('user-status-changed', { 
                username, 
                isOnline: true 
            });
            
            // Send online users list
            socket.emit('online-users', Array.from(onlineUsers));
            
        } catch (error) {
            console.error('User online error:', error);
        }
    });

    socket.on('join-chat', async (data) => {
        try {
            const { conversationId, userId } = data;
            
            // Join room for this conversation
            socket.join(conversationId);
            
            // Get user info
            const user = await db.collection(COLLECTIONS.USERS).findOne({ userId });
            if (!user) return;
            
            // Mark messages as read
            await db.collection(COLLECTIONS.MESSAGES).updateMany(
                { 
                    conversationId,
                    receiver: user.username,
                    read: false 
                },
                { $set: { read: true, readAt: new Date() } }
            );
            
        } catch (error) {
            console.error('Join chat error:', error);
        }
    });

    socket.on('send-message', async (data, callback) => {
        try {
            const { senderId, receiverId, text, type = 'text', file } = data;
            
            // Get users
            const [sender, receiver] = await Promise.all([
                db.collection(COLLECTIONS.USERS).findOne({ userId: senderId }),
                db.collection(COLLECTIONS.USERS).findOne({ userId: receiverId })
            ]);
            
            if (!sender || !receiver) {
                if (callback) callback({ error: 'User not found' });
                return;
            }
            
            const conversationId = getConversationId(sender.username, receiver.username);
            const messageId = new ObjectId();
            
            const message = {
                _id: messageId,
                text: text || '',
                sender: sender.username,
                receiver: receiver.username,
                timestamp: new Date(),
                conversationId,
                type,
                read: false,
                delivered: false,
                ...(file && { file })
            };
            
            // Save to database
            await db.collection(COLLECTIONS.MESSAGES).insertOne(message);
            
            // Format for mobile
            const mobileMessage = {
                id: messageId.toString(),
                text: message.text,
                isSent: true,
                time: message.timestamp,
                isRead: false,
                isDelivered: false,
                type: message.type,
                file: message.file
            };
            
            // Send to sender immediately
            socket.emit('message-sent', mobileMessage);
            
            // Send to receiver if online
            const receiverSocketId = userSockets.get(receiver.username);
            if (receiverSocketId) {
                // Mark as delivered
                await db.collection(COLLECTIONS.MESSAGES).updateOne(
                    { _id: messageId },
                    { $set: { delivered: true, deliveredAt: new Date() } }
                );
                
                const receiverMessage = {
                    ...mobileMessage,
                    isSent: false,
                    isDelivered: true
                };
                
                io.to(receiverSocketId).emit('new-message', receiverMessage);
                
                // Notify sender about delivery
                socket.emit('message-delivered', { messageId: messageId.toString() });
            }
            
            // Notify both users about chat list update
            [sender.username, receiver.username].forEach(async (username) => {
                const userSocketId = userSockets.get(username);
                if (userSocketId) {
                    io.to(userSocketId).emit('chat-updated', { conversationId });
                }
            });
            
            if (callback) callback({ 
                success: true, 
                messageId: messageId.toString() 
            });
            
        } catch (error) {
            console.error('Send message error:', error);
            if (callback) callback({ error: 'Failed to send message' });
        }
    });

    socket.on('typing', (data) => {
        try {
            const { conversationId, userId, isTyping } = data;
            
            // Notify other user in conversation
            socket.to(conversationId).emit('user-typing', {
                conversationId,
                userId,
                isTyping
            });
            
        } catch (error) {
            console.error('Typing error:', error);
        }
    });

    socket.on('message-read', async (data) => {
        try {
            const { messageId, userId } = data;
            
            const user = await db.collection(COLLECTIONS.USERS).findOne({ userId });
            if (!user) return;
            
            // Update message as read
            const result = await db.collection(COLLECTIONS.MESSAGES).updateOne(
                { _id: new ObjectId(messageId), receiver: user.username },
                { $set: { read: true, readAt: new Date() } }
            );
            
            if (result.modifiedCount > 0) {
                // Notify sender
                const message = await db.collection(COLLECTIONS.MESSAGES).findOne({ 
                    _id: new ObjectId(messageId) 
                });
                
                if (message) {
                    const sender = await db.collection(COLLECTIONS.USERS).findOne({ username: message.sender });
                    const senderSocketId = userSockets.get(message.sender);
                    
                    if (senderSocketId) {
                        io.to(senderSocketId).emit('message-read', { 
                            messageId,
                            userId: sender.userId
                        });
                    }
                }
            }
            
        } catch (error) {
            console.error('Message read error:', error);
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
                
                // Notify contacts
                io.emit('user-status-changed', { 
                    username, 
                    isOnline: false 
                });
            }
        } catch (error) {
            console.error('Disconnect error:', error);
        }
    });
});

// Start Server
const PORT = process.env.PORT || 3000;

connectToDatabase().then(() => {
    // Create uploads directory
    if (!fs.existsSync('uploads')) {
        fs.mkdirSync('uploads');
    }
    
    server.listen(PORT, () => {
        console.log('='.repeat(50));
        console.log('📱 B-MESSENGER MOBILE');
        console.log('='.repeat(50));
        console.log(`✅ Server running on port ${PORT}`);
        console.log(`✅ MongoDB: Connected to ${DB_NAME}`);
        console.log(`✅ Mode: Mobile-first WhatsApp clone`);
        console.log(`🔗 Open: http://localhost:${PORT}`);
        console.log('='.repeat(50));
        console.log('\n📱 MOBILE-FEATURES:');
        console.log('• WhatsApp-like mobile interface');
        console.log('• Chats, Status, Calls tabs');
        console.log('• One-handed operation optimized');
        console.log('• Native mobile gestures');
        console.log('• Touch-optimized UI elements');
        console.log('• Instant message delivery');
        console.log('• Typing indicators');
        console.log('• Read receipts');
        console.log('• Media sharing');
        console.log('• Status updates');
        console.log('• Call history');
        console.log('='.repeat(50));
    });
});
