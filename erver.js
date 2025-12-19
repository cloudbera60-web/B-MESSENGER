const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ['websocket', 'polling']
});

// Middleware
app.use(helmet({
  contentSecurityPolicy: false
}));
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/bmessenger', {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

// MongoDB Schemas
const userSchema = new mongoose.Schema({
  phoneNumber: { type: String, unique: true, required: true },
  username: { type: String, unique: true, sparse: true },
  email: { type: String },
  profilePhoto: { type: String },
  bio: { type: String, default: '' },
  isVerified: { type: Boolean, default: false },
  isOnline: { type: Boolean, default: false },
  lastSeen: { type: Date, default: Date.now },
  fcmToken: { type: String },
  contacts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  blockedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  status: {
    text: String,
    image: String,
    expiresAt: Date
  },
  createdAt: { type: Date, default: Date.now }
});

const messageSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  receiver: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  chatId: { type: String, required: true },
  content: { type: String },
  media: {
    url: String,
    type: String, // 'image', 'video', 'audio', 'file'
    name: String,
    size: Number
  },
  messageType: { 
    type: String, 
    enum: ['text', 'image', 'video', 'audio', 'file', 'broadcast'],
    default: 'text'
  },
  isBroadcast: { type: Boolean, default: false },
  broadcastReceivers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  reactions: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    emoji: String
  }],
  status: {
    sent: { type: Boolean, default: false },
    delivered: { type: Boolean, default: false },
    read: { type: Boolean, default: false }
  },
  deletedFor: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  deletedForEveryone: { type: Boolean, default: false },
  timestamp: { type: Date, default: Date.now },
  encrypted: { type: Boolean, default: false },
  encryptionKey: String
});

const chatSchema = new mongoose.Schema({
  participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  isGroup: { type: Boolean, default: false },
  groupName: String,
  groupPhoto: String,
  admin: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  lastMessage: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
  unreadCount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const otpSchema = new mongoose.Schema({
  phoneNumber: { type: String, required: true },
  otp: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  verified: { type: Boolean, default: false }
});

const adminSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  role: { type: String, default: 'admin' }
});

const User = mongoose.model('User', userSchema);
const Message = mongoose.model('Message', messageSchema);
const Chat = mongoose.model('Chat', chatSchema);
const OTP = mongoose.model('OTP', otpSchema);
const Admin = mongoose.model('Admin', adminSchema);

// Socket.IO Connection Handling
const onlineUsers = new Map();

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // User authentication via socket
  socket.on('authenticate', async (userId) => {
    try {
      const user = await User.findById(userId);
      if (user) {
        onlineUsers.set(userId, socket.id);
        socket.userId = userId;
        
        // Update user online status
        await User.findByIdAndUpdate(userId, {
          isOnline: true,
          lastSeen: new Date()
        });

        // Notify contacts
        const contacts = await User.find({ _id: { $in: user.contacts } });
        contacts.forEach(contact => {
          const contactSocketId = onlineUsers.get(contact._id.toString());
          if (contactSocketId) {
            io.to(contactSocketId).emit('user-online', { userId });
          }
        });
      }
    } catch (error) {
      console.error('Authentication error:', error);
    }
  });

  // Send message
  socket.on('send-message', async (data) => {
    try {
      const { senderId, receiverId, content, media, messageType } = data;
      
      // Create chat ID (sorted to ensure consistency)
      const chatId = [senderId, receiverId].sort().join('_');
      
      // Create message
      const message = new Message({
        sender: senderId,
        receiver: receiverId,
        chatId,
        content,
        media,
        messageType,
        status: { sent: true }
      });

      await message.save();

      // Update chat
      await Chat.findOneAndUpdate(
        { participants: { $all: [senderId, receiverId] } },
        {
          $setOnInsert: { participants: [senderId, receiverId] },
          lastMessage: message._id,
          updatedAt: new Date()
        },
        { upsert: true, new: true }
      );

      // Emit to sender
      socket.emit('message-sent', { message });

      // Emit to receiver if online
      const receiverSocketId = onlineUsers.get(receiverId);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit('new-message', { 
          message,
          sender: await User.findById(senderId).select('username profilePhoto')
        });
        message.status.delivered = true;
        await message.save();
      }

      // TODO: Send FCM notification if receiver is offline

    } catch (error) {
      console.error('Send message error:', error);
      socket.emit('error', { message: 'Failed to send message' });
    }
  });

  // Typing indicator
  socket.on('typing', async ({ userId, chatId, isTyping }) => {
    const chat = await Chat.findById(chatId);
    if (chat) {
      const otherParticipant = chat.participants.find(p => p.toString() !== userId);
      const otherSocketId = onlineUsers.get(otherParticipant);
      if (otherSocketId) {
        io.to(otherSocketId).emit('typing-indicator', { userId, isTyping });
      }
    }
  });

  // Message read receipt
  socket.on('message-read', async ({ messageId, userId }) => {
    try {
      const message = await Message.findById(messageId);
      if (message && message.receiver.toString() === userId) {
        message.status.read = true;
        await message.save();
        
        // Notify sender
        const senderSocketId = onlineUsers.get(message.sender.toString());
        if (senderSocketId) {
          io.to(senderSocketId).emit('message-read-receipt', { messageId });
        }
      }
    } catch (error) {
      console.error('Message read error:', error);
    }
  });

  // Disconnect
  socket.on('disconnect', async () => {
    if (socket.userId) {
      onlineUsers.delete(socket.userId);
      
      // Update user offline status
      await User.findByIdAndUpdate(socket.userId, {
        isOnline: false,
        lastSeen: new Date()
      });

      // Notify contacts
      const user = await User.findById(socket.userId);
      if (user) {
        const contacts = await User.find({ _id: { $in: user.contacts } });
        contacts.forEach(contact => {
          const contactSocketId = onlineUsers.get(contact._id.toString());
          if (contactSocketId) {
            io.to(contactSocketId).emit('user-offline', { userId: socket.userId });
          }
        });
      }
    }
    console.log('Client disconnected:', socket.id);
  });
});

// REST API Routes

// OTP Generation (Simulated - replace with actual WhatsApp API)
app.post('/api/otp/send', async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    
    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    
    // Save OTP
    await OTP.findOneAndUpdate(
      { phoneNumber },
      { phoneNumber, otp, expiresAt, verified: false },
      { upsert: true }
    );

    // TODO: Integrate with WhatsApp Business API
    console.log(`OTP for ${phoneNumber}: ${otp}`);
    
    // Using these WhatsApp numbers (from requirements):
    // 254743982206
    // 254116763755
    
    res.json({ success: true, message: 'OTP sent via WhatsApp' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// OTP Verification
app.post('/api/otp/verify', async (req, res) => {
  try {
    const { phoneNumber, otp } = req.body;
    
    const otpRecord = await OTP.findOne({ 
      phoneNumber, 
      otp,
      expiresAt: { $gt: new Date() }
    });
    
    if (!otpRecord) {
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }
    
    otpRecord.verified = true;
    await otpRecord.save();
    
    // Create or update user
    let user = await User.findOne({ phoneNumber });
    if (!user) {
      user = new User({ phoneNumber });
      await user.save();
    }
    
    res.json({ 
      success: true, 
      userId: user._id,
      isNewUser: !user.username
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get user chats
app.get('/api/chats/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    const chats = await Chat.find({ participants: userId })
      .populate('participants', 'username profilePhoto phoneNumber isOnline lastSeen')
      .populate('lastMessage')
      .sort({ updatedAt: -1 });
    
    res.json(chats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get messages for chat
app.get('/api/messages/:chatId', async (req, res) => {
  try {
    const { chatId } = req.params;
    const { limit = 50, before } = req.query;
    
    const query = { chatId };
    if (before) {
      query._id = { $lt: before };
    }
    
    const messages = await Message.find(query)
      .populate('sender', 'username profilePhoto')
      .sort({ timestamp: -1 })
      .limit(parseInt(limit));
    
    res.json(messages.reverse());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update user profile
app.put('/api/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const updates = req.body;
    
    const user = await User.findByIdAndUpdate(
      userId,
      updates,
      { new: true, runValidators: true }
    ).select('-contacts -blockedUsers');
    
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin routes
app.post('/api/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // In production, use environment variables for admin credentials
    if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
      // Create admin user if not exists
      let admin = await Admin.findOne({ username });
      if (!admin) {
        admin = new Admin({ username, password: require('bcryptjs').hashSync(password, 10) });
        await admin.save();
      }
      
      res.json({ success: true, role: 'admin' });
    } else {
      res.status(401).json({ error: 'Invalid credentials' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/verify-user', async (req, res) => {
  try {
    const { userId, verified } = req.body;
    
    const user = await User.findByIdAndUpdate(
      userId,
      { isVerified: verified },
      { new: true }
    );
    
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Serve PWA files
app.get('/sw.js', (req, res) => {
  res.sendFile(__dirname + '/sw.js');
});

app.get('/manifest.json', (req, res) => {
  res.sendFile(__dirname + '/manifest.json');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
