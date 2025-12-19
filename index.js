// Global Variables
let socket;
let currentUser = null;
let currentChat = null;
let contacts = [];
let chats = [];
let messages = new Map();
let onlineUsers = new Set();

// DOM Elements
const authScreen = document.getElementById('authScreen');
const appContainer = document.getElementById('appContainer');
const phoneScreen = document.getElementById('phoneScreen');
const otpScreen = document.getElementById('otpScreen');
const profileScreen = document.getElementById('profileScreen');
const phoneNumberInput = document.getElementById('phoneNumber');
const otpInputs = document.querySelectorAll('.otp-input');
const messageInput = document.getElementById('messageInput');
const messagesContainer = document.getElementById('messagesContainer');
const chatList = document.getElementById('chatList');
const typingIndicator = document.getElementById('typingIndicator');
const searchInput = document.getElementById('searchInput');

// Initialize App
document.addEventListener('DOMContentLoaded', async () => {
    // Check if user is already authenticated
    const token = localStorage.getItem('authToken');
    const userId = localStorage.getItem('userId');
    
    if (token && userId) {
        // Initialize Socket connection
        initializeSocket(userId);
        // Load user data
        await loadUserData(userId);
        // Show main app
        switchToApp();
    } else {
        // Show auth screen
        switchToAuth();
    }
    
    // Register Service Worker for PWA
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => console.log('Service Worker registered'))
            .catch(err => console.error('Service Worker registration failed:', err));
    }
    
    // Request notification permission
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
    
    // Initialize theme
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
});

// Socket.IO Initialization
function initializeSocket(userId) {
    socket = io();
    
    socket.on('connect', () => {
        console.log('Socket connected');
        socket.emit('authenticate', userId);
    });
    
    socket.on('authenticated', () => {
        console.log('Socket authenticated');
        loadChats();
    });
    
    socket.on('new-message', async (data) => {
        const { message, sender } = data;
        
        // Add message to current chat if active
        if (currentChat && currentChat._id === message.chatId) {
            appendMessage(message, 'received');
            markMessageAsRead(message._id);
            scrollToBottom();
        } else {
            // Update chat list
            updateChatUnreadCount(message.chatId);
            // Show notification
            showNotification(sender.username, message.content);
        }
        
        // Update last message in chat list
        updateChatLastMessage(message);
    });
    
    socket.on('message-sent', (data) => {
        appendMessage(data.message, 'sent');
        scrollToBottom();
    });
    
    socket.on('typing-indicator', ({ userId, isTyping }) => {
        if (currentChat && currentChat.participants.includes(userId)) {
            typingIndicator.classList.toggle('hidden', !isTyping);
        }
    });
    
    socket.on('user-online', (data) => {
        onlineUsers.add(data.userId);
        updateUserStatus(data.userId, true);
    });
    
    socket.on('user-offline', (data) => {
        onlineUsers.delete(data.userId);
        updateUserStatus(data.userId, false);
    });
    
    socket.on('message-read-receipt', (data) => {
        updateMessageStatus(data.messageId, 'read');
    });
    
    socket.on('error', (data) => {
        console.error('Socket error:', data.message);
        showToast(data.message, 'error');
    });
}

// Authentication Functions
async function sendOTP() {
    const phoneNumber = phoneNumberInput.value.trim();
    
    if (!phoneNumber) {
        showToast('Please enter phone number', 'error');
        return;
    }
    
    const btn = document.getElementById('sendOTPBtn');
    btn.disabled = true;
    btn.innerHTML = '<div class="loading"></div>';
    
    try {
        const response = await fetch('/api/otp/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phoneNumber })
        });
        
        const data = await response.json();
        
        if (data.success) {
            phoneScreen.classList.add('hidden');
            otpScreen.classList.remove('hidden');
            otpInputs[0].focus();
            showToast('OTP sent to your WhatsApp', 'success');
        } else {
            showToast(data.error || 'Failed to send OTP', 'error');
        }
    } catch (error) {
        showToast('Network error', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Send OTP via WhatsApp';
    }
}

function moveToNext(input, nextIndex) {
    if (input.value.length === 1) {
        if (nextIndex <= 6) {
            const nextInput = document.querySelector(`.otp-input:nth-child(${nextIndex})`);
            if (nextInput) nextInput.focus();
        }
    } else if (input.value.length === 0 && nextIndex > 1) {
        const prevInput = document.querySelector(`.otp-input:nth-child(${nextIndex - 2})`);
        if (prevInput) prevInput.focus();
    }
    
    // Auto verify if all OTP digits entered
    if (nextIndex === 6 && input.value.length === 1) {
        const allFilled = Array.from(otpInputs).every(input => input.value.length === 1);
        if (allFilled) {
            setTimeout(verifyOTP, 500);
        }
    }
}

async function verifyOTP() {
    const otp = Array.from(otpInputs).map(input => input.value).join('');
    const phoneNumber = phoneNumberInput.value.trim();
    
    if (otp.length !== 6) {
        document.getElementById('otpError').textContent = 'Please enter 6-digit OTP';
        return;
    }
    
    const btn = document.getElementById('verifyOTPBtn');
    btn.disabled = true;
    btn.innerHTML = '<div class="loading"></div>';
    
    try {
        const response = await fetch('/api/otp/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phoneNumber, otp })
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Store auth token
            localStorage.setItem('authToken', 'Bearer ' + data.userId);
            localStorage.setItem('userId', data.userId);
            
            if (data.isNewUser) {
                // Show profile setup
                otpScreen.classList.add('hidden');
                profileScreen.classList.remove('hidden');
            } else {
                // Direct login
                await completeLogin(data.userId);
            }
        } else {
            document.getElementById('otpError').textContent = data.error;
        }
    } catch (error) {
        showToast('Network error', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Verify OTP';
    }
}

function resendOTP() {
    phoneScreen.classList.remove('hidden');
    otpScreen.classList.add('hidden');
    phoneNumberInput.focus();
}

async function completeProfile() {
    const username = document.getElementById('username').value.trim();
    
    if (!username) {
        showToast('Username is required', 'error');
        return;
    }
    
    const userId = localStorage.getItem('userId');
    const bio = document.getElementById('bio').value.trim();
    
    const btn = document.getElementById('completeProfileBtn');
    btn.disabled = true;
    btn.innerHTML = '<div class="loading"></div>';
    
    try {
        const response = await fetch(`/api/user/${userId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, bio })
        });
        
        if (response.ok) {
            await completeLogin(userId);
        } else {
            const data = await response.json();
            showToast(data.error || 'Profile update failed', 'error');
        }
    } catch (error) {
        showToast('Network error', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Complete Setup';
    }
}

async function completeLogin(userId) {
    await loadUserData(userId);
    initializeSocket(userId);
    switchToApp();
    loadChats();
}

// User Data Functions
async function loadUserData(userId) {
    try {
        const response = await fetch(`/api/user/${userId}`);
        if (response.ok) {
            currentUser = await response.json();
            updateUserUI();
        }
    } catch (error) {
        console.error('Failed to load user data:', error);
    }
}

function updateUserUI() {
    if (currentUser) {
        document.getElementById('userInitial').textContent = 
            currentUser.username?.[0]?.toUpperCase() || 'U';
        document.getElementById('userName').textContent = 
            currentUser.username || 'User';
        document.getElementById('userStatus').textContent = 
            currentUser.isOnline ? 'Online' : 'Offline';
    }
}

// Chat Functions
async function loadChats() {
    try {
        const response = await fetch(`/api/chats/${currentUser._id}`);
        if (response.ok) {
            chats = await response.json();
            renderChatList();
        }
    } catch (error) {
        console.error('Failed to load chats:', error);
    }
}

function renderChatList() {
    chatList.innerHTML = '';
    
    chats.forEach(chat => {
        const otherUser = chat.participants.find(p => p._id !== currentUser._id);
        const lastMessage = chat.lastMessage;
        const isOnline = onlineUsers.has(otherUser?._id);
        
        const chatElement = document.createElement('div');
        chatElement.className = `chat-item ${currentChat?._id === chat._id ? 'active' : ''}`;
        chatElement.innerHTML = `
            <div class="chat-avatar">
                <div class="avatar" style="width: 48px; height: 48px;">
                    ${otherUser?.username?.[0]?.toUpperCase() || 'U'}
                    ${isOnline ? '<div class="online-indicator"></div>' : ''}
                </div>
            </div>
            <div class="chat-info">
                <div class="chat-header">
                    <div class="chat-name">${otherUser?.username || 'Unknown'}</div>
                    <div class="chat-time">${formatTime(lastMessage?.timestamp)}</div>
                </div>
                <div class="last-message">
                    ${lastMessage?.content || 'No messages yet'}
                    ${chat.unreadCount > 0 ? 
                        `<span class="unread-badge">${chat.unreadCount}</span>` : ''}
                </div>
            </div>
        `;
        
        chatElement.addEventListener('click', () => selectChat(chat, otherUser));
        chatList.appendChild(chatElement);
    });
}

async function selectChat(chat, otherUser) {
    currentChat = chat;
    
    // Update UI
    document.querySelectorAll('.chat-item').forEach(item => {
        item.classList.remove('active');
    });
    event.currentTarget.classList.add('active');
    
    // Update chat header
    document.getElementById('chatAvatar').textContent = 
        otherUser?.username?.[0]?.toUpperCase() || 'U';
    document.getElementById('chatUserName').textContent = 
        otherUser?.username || 'Unknown';
    document.getElementById('chatStatus').textContent = 
        onlineUsers.has(otherUser?._id) ? 'Online' : 'Offline';
    document.getElementById('chatOnlineIndicator').style.display = 
        onlineUsers.has(otherUser?._id) ? 'block' : 'none';
    
    // Load messages
    await loadMessages(chat._id);
    scrollToBottom();
}

async function loadMessages(chatId) {
    try {
        const response = await fetch(`/api/messages/${chatId}`);
        if (response.ok) {
            const loadedMessages = await response.json();
            messages.set(chatId, loadedMessages);
            renderMessages(loadedMessages);
        }
    } catch (error) {
        console.error('Failed to load messages:', error);
    }
}

function renderMessages(messages) {
    messagesContainer.innerHTML = '';
    
    messages.forEach(message => {
        const isSent = message.sender._id === currentUser._id;
        appendMessage(message, isSent ? 'sent' : 'received');
    });
}

function appendMessage(message, type) {
    const messageElement = document.createElement('div');
    messageElement.className = `message-wrapper ${type}`;
    
    const statusIcon = type === 'sent' ? getStatusIcon(message) : '';
    
    messageElement.innerHTML = `
        <div class="message-bubble ${type}">
            ${message.media ? renderMedia(message.media) : ''}
            <div class="message-content">${encryptDecrypt(message.content, false)}</div>
            <div class="message-info">
                <span class="message-time">${formatTime(message.timestamp)}</span>
                ${statusIcon}
            </div>
        </div>
    `;
    
    messagesContainer.appendChild(messageElement);
}

function renderMedia(media) {
    if (media.type === 'image') {
        return `<img src="${media.url}" alt="Image" class="message-media">`;
    } else if (media.type === 'video') {
        return `<video src="${media.url}" controls class="message-media"></video>`;
    } else {
        return `<div class="file-attachment">📎 ${media.name}</div>`;
    }
}

function getStatusIcon(message) {
    if (message.status.read) return '✓✓';
    if (message.status.delivered) return '✓✓';
    if (message.status.sent) return '✓';
    return '';
}

// Message Functions
function sendMessage() {
    const content = messageInput.value.trim();
    
    if (!content || !currentChat) return;
    
    const messageData = {
        senderId: currentUser._id,
        receiverId: currentChat.participants.find(p => p._id !== currentUser._id)?._id,
        content: encryptDecrypt(content, true),
        messageType: 'text',
        chatId: currentChat._id
    };
    
    socket.emit('send-message', messageData);
    
    // Clear input
    messageInput.value = '';
    adjustTextareaHeight(messageInput);
}

function handleMessageKeypress(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
    }
    
    // Send typing indicator
    if (currentChat) {
        socket.emit('typing', {
            userId: currentUser._id,
            chatId: currentChat._id,
            isTyping: true
        });
        
        clearTimeout(window.typingTimeout);
        window.typingTimeout = setTimeout(() => {
            socket.emit('typing', {
                userId: currentUser._id,
                chatId: currentChat._id,
                isTyping: false
            });
        }, 1000);
    }
}

function adjustTextareaHeight(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 100) + 'px';
}

function markMessageAsRead(messageId) {
    socket.emit('message-read', {
        messageId,
        userId: currentUser._id
    });
}

function updateMessageStatus(messageId, status) {
    const messageElements = messagesContainer.querySelectorAll('.message-bubble.sent');
    messageElements.forEach(bubble => {
        const statusElement = bubble.querySelector('.message-status');
        if (statusElement) {
            if (status === 'delivered') {
                statusElement.textContent = '✓✓';
            } else if (status === 'read') {
                statusElement.textContent = '✓✓';
                statusElement.style.color = '#4FC3F7';
            }
        }
    });
}

// Encryption (Basic simulation)
function encryptDecrypt(text, encrypt) {
    // This is a basic simulation - replace with real encryption in production
    if (encrypt) {
        return btoa(text);
    } else {
        try {
            return atob(text);
        } catch {
            return text;
        }
    }
}

// UI Functions
function switchToApp() {
    authScreen.classList.add('hidden');
    appContainer.classList.remove('hidden');
}

function switchToAuth() {
    authScreen.classList.remove('hidden');
    appContainer.classList.add('hidden');
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
}

function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function formatTime(timestamp) {
    if (!timestamp) return '';
    
    const date = new Date(timestamp);
    const now = new Date();
    
    if (date.toDateString() === now.toDateString()) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else {
        return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
}

function showToast(message, type = 'info') {
    // Create toast element
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 12px 20px;
        background: ${type === 'error' ? '#ff4444' : type === 'success' ? '#00C851' : '#33b5e5'};
        color: white;
        border-radius: 5px;
        z-index: 10000;
        animation: slideIn 0.3s ease;
    `;
    
    document.body.appendChild(toast);
    
    // Remove after 3 seconds
    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function showNotification(title, body) {
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, { body, icon: '/icon.png' });
    }
}

// Placeholder functions for future implementation
function openNewChat() {
    showToast('New chat feature coming soon', 'info');
}

function openProfileModal() {
    showToast('Profile modal coming soon', 'info');
}

function voiceCall() {
    showToast('Voice call feature coming soon', 'info');
}

function videoCall() {
    showToast('Video call feature coming soon', 'info');
}

function openChatInfo() {
    showToast('Chat info coming soon', 'info');
}

function toggleEmojiPicker() {
    showToast('Emoji picker coming soon', 'info');
}

function openAttachmentMenu() {
    showToast('Attachment menu coming soon', 'info');
}

function updateChatUnreadCount(chatId) {
    // Implementation for updating unread count
}

function updateChatLastMessage(message) {
    // Implementation for updating last message in chat list
}

function updateUserStatus(userId, isOnline) {
    // Implementation for updating user status in UI
}
