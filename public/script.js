class BMessenger {
    constructor() {
        this.socket = null;
        this.currentUser = null;
        this.currentChat = null;
        this.conversations = [];
        this.users = [];
        this.onlineUsers = new Set();
        this.typingUsers = new Map();
        this.isAdmin = false;
        
        this.initialize();
    }

    async initialize() {
        this.checkAuth();
        this.setupEventListeners();
        
        if (this.currentUser) {
            await this.initializeSocket();
            await this.loadConversations();
            await this.loadAllUsers();
            this.updateUI();
        }
    }

    async checkAuth() {
        const token = localStorage.getItem('bm_token');
        if (!token) {
            this.showLoginScreen();
            return;
        }

        try {
            const response = await fetch('/api/auth/verify', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            const data = await response.json();
            
            if (data.success) {
                this.currentUser = data.user;
                this.isAdmin = data.user.role === 'admin';
                
                if (this.isAdmin && window.location.hash === '#admin') {
                    this.showAdminDashboard();
                } else {
                    this.showMainApp();
                }
            } else {
                localStorage.removeItem('bm_token');
                this.showLoginScreen();
            }
        } catch (error) {
            console.error('Auth check failed:', error);
            localStorage.removeItem('bm_token');
            this.showLoginScreen();
        }
    }

    showLoginScreen() {
        document.getElementById('login-screen').style.display = 'flex';
        document.getElementById('app-container').style.display = 'none';
        document.getElementById('admin-dashboard').style.display = 'none';
    }

    showMainApp() {
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('app-container').style.display = 'flex';
        document.getElementById('admin-dashboard').style.display = 'none';
        
        // Update user info
        document.getElementById('current-user-name').textContent = this.currentUser.displayName;
        document.getElementById('user-avatar').textContent = this.currentUser.displayName.charAt(0);
        document.getElementById('user-avatar').style.backgroundImage = this.currentUser.avatar ? `url('${this.currentUser.avatar}')` : '';
    }

    showAdminDashboard() {
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('app-container').style.display = 'none';
        document.getElementById('admin-dashboard').style.display = 'flex';
        
        this.loadAdminData();
    }

    setupEventListeners() {
        // Login/Register
        document.getElementById('login-btn').addEventListener('click', () => this.login());
        document.getElementById('register-btn').addEventListener('click', () => this.register());
        
        // Tabs
        document.querySelectorAll('.login-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                document.querySelectorAll('.login-tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.login-form').forEach(f => f.classList.remove('active'));
                
                e.target.classList.add('active');
                const tabName = e.target.textContent.toLowerCase();
                document.getElementById(`${tabName}-form`).classList.add('active');
            });
        });

        // Message input
        const messageInput = document.getElementById('message-input');
        messageInput.addEventListener('input', () => this.handleMessageInput());
        messageInput.addEventListener('keydown', (e) => this.handleKeyPress(e));

        // Send button
        document.getElementById('send-button').addEventListener('click', () => this.sendMessage());

        // Search
        document.getElementById('search-input').addEventListener('input', (e) => this.handleSearch(e.target.value));

        // Modals
        document.getElementById('new-chat-btn').addEventListener('click', () => this.showNewChatModal());
        document.getElementById('settings-btn').addEventListener('click', () => this.showSettingsModal());
        document.getElementById('logout-btn').addEventListener('click', () => this.logout());

        // Back button
        document.getElementById('back-button').addEventListener('click', () => this.closeChat());

        // Admin menu
        document.querySelectorAll('.admin-menu-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const section = e.target.getAttribute('data-section');
                this.showAdminSection(section);
            });
        });
    }

    async login() {
        const username = document.getElementById('login-username').value.trim();
        const password = document.getElementById('login-password').value;

        if (!username || !password) {
            this.showError('Please enter username and password');
            return;
        }

        this.setLoading('login-btn', true);

        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();

            if (data.success) {
                localStorage.setItem('bm_token', data.token);
                this.currentUser = data.user;
                this.showSuccess('Login successful!');
                
                setTimeout(() => {
                    this.showMainApp();
                    this.initializeSocket();
                    this.loadConversations();
                    this.loadAllUsers();
                }, 1000);
            } else {
                this.showError(data.error);
            }
        } catch (error) {
            this.showError('Network error. Please try again.');
        } finally {
            this.setLoading('login-btn', false);
        }
    }

    async register() {
        const username = document.getElementById('register-username').value.trim();
        const displayName = document.getElementById('register-displayname').value.trim();
        const password = document.getElementById('register-password').value;

        if (!username || !displayName || !password) {
            this.showError('All fields are required');
            return;
        }

        if (password.length < 6) {
            this.showError('Password must be at least 6 characters');
            return;
        }

        this.setLoading('register-btn', true);

        try {
            const response = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, displayName, password })
            });

            const data = await response.json();

            if (data.success) {
                this.showSuccess('Account created successfully! Please login.', false);
                setTimeout(() => {
                    document.querySelector('.login-tab:nth-child(1)').click();
                    document.getElementById('login-username').value = username;
                    document.getElementById('login-password').value = '';
                }, 1000);
            } else {
                this.showError(data.error);
            }
        } catch (error) {
            this.showError('Network error. Please try again.');
        } finally {
            this.setLoading('register-btn', false);
        }
    }

    logout() {
        localStorage.removeItem('bm_token');
        if (this.socket) {
            this.socket.disconnect();
        }
        this.showLoginScreen();
    }

    async initializeSocket() {
        const token = localStorage.getItem('bm_token');
        
        this.socket = io();
        
        this.socket.on('connect', () => {
            console.log('Connected to server');
            this.socket.emit('authenticate', token);
        });

        this.socket.on('auth-error', (error) => {
            console.error('Auth error:', error);
            this.logout();
        });

        this.socket.on('user-online', (data) => {
            this.onlineUsers.add(data.userId);
            this.updateUserStatus(data.userId, true);
        });

        this.socket.on('user-offline', (data) => {
            this.onlineUsers.delete(data.userId);
            this.updateUserStatus(data.userId, false);
        });

        this.socket.on('new-message', (message) => {
            this.handleNewMessage(message);
        });

        this.socket.on('message-delivered', (data) => {
            this.updateMessageStatus(data.messageId, 'delivered');
        });

        this.socket.on('message-read', (data) => {
            this.updateMessageStatus(data.messageId, 'read');
        });

        this.socket.on('user-typing', (data) => {
            this.handleTypingIndicator(data);
        });

        this.socket.on('messages-read', (data) => {
            // Update UI for read messages
            if (this.currentChat && this.currentChat._id === data.conversationId) {
                this.markMessagesAsRead();
            }
        });
    }

    async loadConversations() {
        try {
            const token = localStorage.getItem('bm_token');
            const response = await fetch('/api/conversations', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            const data = await response.json();

            if (data.success) {
                this.conversations = data.conversations;
                this.renderConversations();
            }
        } catch (error) {
            console.error('Load conversations error:', error);
        }
    }

    async loadAllUsers() {
        try {
            const token = localStorage.getItem('bm_token');
            const response = await fetch('/api/users/all', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            const data = await response.json();

            if (data.success) {
                this.users = data.users;
            }
        } catch (error) {
            console.error('Load users error:', error);
        }
    }

    renderConversations() {
        const container = document.getElementById('conversations-list');
        container.innerHTML = '';

        if (this.conversations.length === 0) {
            container.innerHTML = `
                <div class="empty-chats">
                    <div class="empty-icon">💬</div>
                    <p>No conversations yet</p>
                    <p>Start chatting with users!</p>
                </div>
            `;
            return;
        }

        this.conversations.forEach(conv => {
            const item = this.createConversationElement(conv);
            container.appendChild(item);
        });
    }

    createConversationElement(conv) {
        const div = document.createElement('div');
        div.className = `chat-item ${this.currentChat?._id === conv._id ? 'active' : ''}`;
        div.dataset.id = conv._id;

        const lastMessage = conv.lastMessage;
        const time = lastMessage ? this.formatTime(new Date(lastMessage.createdAt)) : '';
        const preview = lastMessage ? this.getPreviewText(lastMessage) : 'No messages yet';
        
        const unreadBadge = conv.unreadCount > 0 ? 
            `<div class="chat-badge">${conv.unreadCount}</div>` : '';

        const statusDot = this.getParticipantStatus(conv);

        div.innerHTML = `
            <div class="chat-avatar">
                <div class="chat-avatar-img" style="${conv.avatar ? `background-image: url('${conv.avatar}')` : ''}">
                    ${!conv.avatar ? conv.name.charAt(0).toUpperCase() : ''}
                </div>
                ${statusDot}
            </div>
            <div class="chat-info">
                <div class="chat-header">
                    <div class="chat-name">${conv.name}</div>
                    <div class="chat-time">${time}</div>
                </div>
                <div class="chat-preview">
                    <div class="chat-message">${preview}</div>
                    ${unreadBadge}
                </div>
            </div>
        `;

        div.addEventListener('click', () => this.openChat(conv));
        return div;
    }

    getParticipantStatus(conv) {
        if (conv.type === 'private') {
            const otherUser = conv.participants.find(p => p._id !== this.currentUser._id);
            if (otherUser) {
                const isOnline = this.onlineUsers.has(otherUser._id.toString());
                return `<div class="chat-status ${isOnline ? 'online' : 'offline'}"></div>`;
            }
        }
        return '';
    }

    getPreviewText(message) {
        const prefix = message.senderId === this.currentUser._id ? 'You: ' : '';
        return prefix + message.content.substring(0, 50) + (message.content.length > 50 ? '...' : '');
    }

    formatTime(date) {
        const now = new Date();
        const diff = now - date;
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        
        if (days === 0) {
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else if (days === 1) {
            return 'Yesterday';
        } else if (days < 7) {
            return date.toLocaleDateString([], { weekday: 'short' });
        } else {
            return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
        }
    }

    async openChat(conversation) {
        this.currentChat = conversation;
        
        // Update UI
        document.getElementById('chat-panel').classList.add('active');
        document.getElementById('chat-user-name').textContent = conversation.name;
        document.getElementById('chat-user-avatar').textContent = conversation.name.charAt(0).toUpperCase();
        document.getElementById('chat-user-avatar').style.backgroundImage = conversation.avatar ? `url('${conversation.avatar}')` : '';
        
        // Update status
        if (conversation.type === 'private') {
            const otherUser = conversation.participants.find(p => p._id !== this.currentUser._id);
            if (otherUser) {
                const status = this.onlineUsers.has(otherUser._id.toString()) ? 'online' : 'last seen ' + this.formatTime(new Date(otherUser.lastSeen));
                document.getElementById('chat-user-status').textContent = status;
            }
        } else {
            document.getElementById('chat-user-status').textContent = `${conversation.participants.length} participants`;
        }

        // Join conversation room
        if (this.socket) {
            this.socket.emit('join-conversation', conversation._id);
        }

        // Load messages
        await this.loadMessages(conversation._id);

        // Update active state in list
        document.querySelectorAll('.chat-item').forEach(item => {
            item.classList.remove('active');
        });
        document.querySelector(`.chat-item[data-id="${conversation._id}"]`)?.classList.add('active');

        // Mark as read
        this.markMessagesAsRead();
    }

    async loadMessages(conversationId) {
        try {
            const token = localStorage.getItem('bm_token');
            const response = await fetch(`/api/messages/${conversationId}`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            const data = await response.json();

            if (data.success) {
                this.renderMessages(data.messages);
            }
        } catch (error) {
            console.error('Load messages error:', error);
        }
    }

    renderMessages(messages) {
        const container = document.getElementById('messages-container');
        container.innerHTML = '';

        if (messages.length === 0) {
            container.innerHTML = `
                <div class="empty-chats">
                    <div class="empty-icon">💬</div>
                    <p>No messages yet</p>
                    <p>Send a message to start the conversation!</p>
                </div>
            `;
            return;
        }

        let lastDate = null;
        
        messages.forEach(msg => {
            const msgDate = new Date(msg.createdAt).toDateString();
            
            if (msgDate !== lastDate) {
                lastDate = msgDate;
                const dateDiv = document.createElement('div');
                dateDiv.className = 'message-date';
                dateDiv.innerHTML = `<div class="date-label">${this.formatDate(new Date(msg.createdAt))}</div>`;
                container.appendChild(dateDiv);
            }

            const messageEl = this.createMessageElement(msg);
            container.appendChild(messageEl);
        });

        // Add typing indicator
        const typingEl = document.createElement('div');
        typingEl.className = 'typing-indicator';
        typingEl.id = 'typing-indicator';
        typingEl.innerHTML = `
            <div class="typing-dots">
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
            </div>
        `;
        container.appendChild(typingEl);

        // Scroll to bottom
        container.scrollTop = container.scrollHeight;
    }

    createMessageElement(message) {
        const div = document.createElement('div');
        const isSent = message.senderId._id === this.currentUser._id;
        const isSystem = message.messageType === 'system';
        
        div.className = `message ${isSystem ? 'system' : isSent ? 'sent' : 'received'}`;
        div.dataset.id = message._id;

        const time = new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        let statusIcon = '✓';
        if (isSent) {
            if (message.status === 'read') {
                statusIcon = '✓✓<span style="color:#4fc3f7">✓✓</span>';
            } else if (message.status === 'delivered') {
                statusIcon = '✓✓';
            }
        }

        if (isSystem) {
            div.innerHTML = `
                <div class="message-text">${message.content}</div>
            `;
        } else if (this.currentChat.type === 'group' && !isSent) {
            div.innerHTML = `
                <div class="sender-name">${message.senderId.displayName}</div>
                <div class="message-text">${message.content}</div>
                <div class="message-time">
                    ${time}
                    ${isSent ? `<span class="message-status">${statusIcon}</span>` : ''}
                </div>
            `;
        } else {
            div.innerHTML = `
                <div class="message-text">${message.content}</div>
                <div class="message-time">
                    ${time}
                    ${isSent ? `<span class="message-status">${statusIcon}</span>` : ''}
                </div>
            `;
        }

        return div;
    }

    formatDate(date) {
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        
        if (date.toDateString() === today.toDateString()) {
            return 'Today';
        } else if (date.toDateString() === yesterday.toDateString()) {
            return 'Yesterday';
        } else {
            return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
        }
    }

    handleMessageInput() {
        const input = document.getElementById('message-input');
        const sendBtn = document.getElementById('send-button');
        const micBtn = document.getElementById('mic-button');
        
        const hasText = input.value.trim().length > 0;
        
        sendBtn.style.display = hasText ? 'flex' : 'none';
        micBtn.style.display = hasText ? 'none' : 'flex';
        
        // Auto-resize
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 100) + 'px';
        
        // Typing indicator
        if (hasText && this.currentChat && this.socket) {
            this.socket.emit('typing-start', {
                conversationId: this.currentChat._id
            });
            
            clearTimeout(this.typingTimeout);
            this.typingTimeout = setTimeout(() => {
                this.socket.emit('typing-stop', {
                    conversationId: this.currentChat._id
                });
            }, 2000);
        }
    }

    handleKeyPress(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            this.sendMessage();
        }
    }

    async sendMessage() {
        const input = document.getElementById('message-input');
        const content = input.value.trim();
        
        if (!content || !this.currentChat || !this.socket) return;

        // Create temporary message
        const tempMessage = {
            _id: 'temp-' + Date.now(),
            content,
            senderId: { 
                _id: this.currentUser._id,
                displayName: this.currentUser.displayName,
                avatar: this.currentUser.avatar
            },
            status: 'sending',
            createdAt: new Date(),
            messageType: 'text'
        };

        this.addMessageToChat(tempMessage);
        
        // Send via socket
        this.socket.emit('send-message', {
            conversationId: this.currentChat._id,
            content,
            messageType: 'text'
        }, (response) => {
            if (response.success) {
                // Replace temp message with real one
                const tempEl = document.querySelector(`[data-id="${tempMessage._id}"]`);
                if (tempEl) {
                    tempEl.dataset.id = response.message._id;
                    this.updateMessageStatus(response.message._id, 'sent');
                }
                
                // Update conversation list
                this.updateConversationList(response.message);
            } else {
                // Remove temp message on error
                const tempEl = document.querySelector(`[data-id="${tempMessage._id}"]`);
                if (tempEl) {
                    tempEl.remove();
                }
                this.showError('Failed to send message');
            }
        });

        // Clear input
        input.value = '';
        input.style.height = 'auto';
        this.handleMessageInput();
        
        // Stop typing
        if (this.socket) {
            this.socket.emit('typing-stop', {
                conversationId: this.currentChat._id
            });
        }
    }

    addMessageToChat(message) {
        const container = document.getElementById('messages-container');
        const messageEl = this.createMessageElement(message);
        
        // Add before typing indicator
        const typingIndicator = document.getElementById('typing-indicator');
        container.insertBefore(messageEl, typingIndicator);
        
        // Scroll to bottom
        container.scrollTop = container.scrollHeight;
    }

    handleNewMessage(message) {
        if (this.currentChat && this.currentChat._id === message.conversationId) {
            this.addMessageToChat(message);
            this.markMessagesAsRead();
        }
        
        // Update conversation list
        this.updateConversationList(message);
    }

    updateConversationList(message) {
        const convIndex = this.conversations.findIndex(c => c._id === message.conversationId);
        
        if (convIndex !== -1) {
            // Update existing conversation
            this.conversations[convIndex].lastMessage = message;
            this.conversations[convIndex].lastActivity = new Date();
            
            if (message.senderId !== this.currentUser._id) {
                this.conversations[convIndex].unreadCount = (this.conversations[convIndex].unreadCount || 0) + 1;
            }
            
            // Move to top
            const conv = this.conversations.splice(convIndex, 1)[0];
            this.conversations.unshift(conv);
        } else {
            // Create new conversation (for search results)
            this.loadConversations();
        }
        
        this.renderConversations();
    }

    updateMessageStatus(messageId, status) {
        const messageEl = document.querySelector(`[data-id="${messageId}"]`);
        if (!messageEl) return;
        
        const statusEl = messageEl.querySelector('.message-status');
        if (!statusEl) return;
        
        if (status === 'delivered') {
            statusEl.innerHTML = '✓✓';
        } else if (status === 'read') {
            statusEl.innerHTML = '✓✓<span style="color:#4fc3f7">✓✓</span>';
        }
    }

    markMessagesAsRead() {
        if (!this.currentChat || !this.socket) return;
        
        // Get unread messages in current chat
        const unreadMessages = Array.from(document.querySelectorAll('.message.received'))
            .map(el => el.dataset.id)
            .filter(id => id && !id.startsWith('temp-'));
        
        if (unreadMessages.length > 0) {
            unreadMessages.forEach(messageId => {
                this.socket.emit('message-read', { messageId });
            });
            
            // Update conversation unread count
            const conv = this.conversations.find(c => c._id === this.currentChat._id);
            if (conv) {
                conv.unreadCount = 0;
                this.renderConversations();
            }
        }
    }

    handleTypingIndicator(data) {
        const indicator = document.getElementById('typing-indicator');
        
        if (data.isTyping) {
            indicator.style.display = 'block';
            
            clearTimeout(this.typingHideTimeout);
            this.typingHideTimeout = setTimeout(() => {
                indicator.style.display = 'none';
            }, 3000);
        } else {
            indicator.style.display = 'none';
        }
    }

    async handleSearch(query) {
        if (query.length < 2) {
            this.renderConversations();
            return;
        }

        try {
            const token = localStorage.getItem('bm_token');
            const response = await fetch(`/api/users/search?query=${encodeURIComponent(query)}`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            const data = await response.json();

            if (data.success) {
                this.renderSearchResults(data.users);
            }
        } catch (error) {
            console.error('Search error:', error);
        }
    }

    renderSearchResults(users) {
        const container = document.getElementById('conversations-list');
        container.innerHTML = '';

        if (users.length === 0) {
            container.innerHTML = `
                <div class="empty-chats">
                    <div class="empty-icon">🔍</div>
                    <p>No users found</p>
                </div>
            `;
            return;
        }

        users.forEach(user => {
            const div = document.createElement('div');
            div.className = 'chat-item';
            
            div.innerHTML = `
                <div class="chat-avatar">
                    <div class="chat-avatar-img" style="${user.avatar ? `background-image: url('${user.avatar}')` : ''}">
                        ${!user.avatar ? user.displayName.charAt(0).toUpperCase() : ''}
                    </div>
                    <div class="chat-status ${user.isOnline ? 'online' : 'offline'}"></div>
                </div>
                <div class="chat-info">
                    <div class="chat-header">
                        <div class="chat-name">${user.displayName}</div>
                        <div class="chat-time">${user.isOnline ? 'Online' : 'Offline'}</div>
                    </div>
                    <div class="chat-preview">
                        <div class="chat-message">@${user.username}</div>
                    </div>
                </div>
            `;

            div.addEventListener('click', () => this.startChatWithUser(user));
            container.appendChild(div);
        });
    }

    async startChatWithUser(user) {
        try {
            const token = localStorage.getItem('bm_token');
            const response = await fetch('/api/conversations/private', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ userId: user._id })
            });

            const data = await response.json();

            if (data.success) {
                const conversation = {
                    _id: data.conversation._id,
                    type: 'private',
                    name: user.displayName,
                    avatar: user.avatar,
                    participants: [this.currentUser, user],
                    unreadCount: 0,
                    lastActivity: new Date()
                };

                this.conversations.unshift(conversation);
                this.renderConversations();
                this.openChat(conversation);
            }
        } catch (error) {
            console.error('Start chat error:', error);
            this.showError('Failed to start chat');
        }
    }

    closeChat() {
        this.currentChat = null;
        document.getElementById('chat-panel').classList.remove('active');
        document.getElementById('messages-container').innerHTML = '';
        
        // Update active state
        document.querySelectorAll('.chat-item').forEach(item => {
            item.classList.remove('active');
        });
    }

    showNewChatModal() {
        const modal = document.getElementById('new-chat-modal');
        modal.classList.add('active');
        
        this.renderUsersForNewChat();
    }

    renderUsersForNewChat() {
        const container = document.getElementById('new-chat-users');
        container.innerHTML = '';

        this.users.forEach(user => {
            const div = document.createElement('div');
            div.className = 'user-list-item';
            
            div.innerHTML = `
                <div class="user-list-avatar" style="${user.avatar ? `background-image: url('${user.avatar}')` : ''}">
                    ${!user.avatar ? user.displayName.charAt(0).toUpperCase() : ''}
                </div>
                <div class="user-list-info">
                    <div class="user-list-name">${user.displayName}</div>
                    <div class="user-list-username">@${user.username}</div>
                    <div class="user-list-status ${user.isOnline ? 'online' : ''}">
                        ${user.isOnline ? '● Online' : '○ Offline'}
                    </div>
                </div>
            `;

            div.addEventListener('click', () => {
                this.startChatWithUser(user);
                modal.classList.remove('active');
            });
            
            container.appendChild(div);
        });
    }

    showSettingsModal() {
        const modal = document.getElementById('settings-modal');
        modal.classList.add('active');
        
        this.loadSettings();
    }

    async loadSettings() {
        // Load current settings
        document.getElementById('settings-name').value = this.currentUser.displayName;
        document.getElementById('settings-about').value = this.currentUser.about || '';
        
        // Load theme
        const theme = localStorage.getItem('bm_theme') || 'light';
        document.getElementById('theme-select').value = theme;
    }

    async updateProfile() {
        const name = document.getElementById('settings-name').value.trim();
        const about = document.getElementById('settings-about').value.trim();
        
        if (!name) return;
        
        try {
            const token = localStorage.getItem('bm_token');
            const response = await fetch('/api/users/profile', {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ displayName: name, about })
            });

            const data = await response.json();

            if (data.success) {
                this.currentUser = data.user;
                this.updateUI();
                this.showSuccess('Profile updated');
            }
        } catch (error) {
            console.error('Update profile error:', error);
            this.showError('Failed to update profile');
        }
    }

    changeTheme() {
        const theme = document.getElementById('theme-select').value;
        localStorage.setItem('bm_theme', theme);
        
        if (theme === 'dark') {
            document.body.classList.add('dark-theme');
        } else {
            document.body.classList.remove('dark-theme');
        }
    }

    updateUI() {
        // Update user info
        document.getElementById('current-user-name').textContent = this.currentUser.displayName;
        document.getElementById('user-avatar').textContent = this.currentUser.displayName.charAt(0);
        document.getElementById('user-avatar').style.backgroundImage = this.currentUser.avatar ? `url('${this.currentUser.avatar}')` : '';
        
        // Apply theme
        const theme = localStorage.getItem('bm_theme') || 'light';
        if (theme === 'dark') {
            document.body.classList.add('dark-theme');
        }
    }

    updateUserStatus(userId, isOnline) {
        // Update in chat list
        document.querySelectorAll('.chat-item').forEach(item => {
            const conv = this.conversations.find(c => c._id === item.dataset.id);
            if (conv && conv.type === 'private') {
                const otherUser = conv.participants.find(p => p._id !== this.currentUser._id);
                if (otherUser && otherUser._id === userId) {
                    const statusDot = item.querySelector('.chat-status');
                    if (statusDot) {
                        statusDot.className = `chat-status ${isOnline ? 'online' : 'offline'}`;
                    }
                }
            }
        });
        
        // Update in current chat
        if (this.currentChat && this.currentChat.type === 'private') {
            const otherUser = this.currentChat.participants.find(p => p._id !== this.currentUser._id);
            if (otherUser && otherUser._id === userId) {
                const statusText = isOnline ? 'online' : `last seen ${this.formatTime(new Date())}`;
                document.getElementById('chat-user-status').textContent = statusText;
            }
        }
    }

    // Admin Functions
    showAdminSection(section) {
        // Update menu
        document.querySelectorAll('.admin-menu-item').forEach(item => {
            item.classList.remove('active');
        });
        document.querySelector(`[data-section="${section}"]`).classList.add('active');
        
        // Show section
        document.querySelectorAll('.admin-section').forEach(sec => {
            sec.classList.remove('active');
        });
        document.getElementById(`admin-${section}`).classList.add('active');
        
        // Load section data
        this.loadAdminSectionData(section);
    }

    async loadAdminData() {
        this.showAdminSection('dashboard');
    }

    async loadAdminSectionData(section) {
        const token = localStorage.getItem('bm_token');
        
        try {
            switch (section) {
                case 'users':
                    await this.loadAdminUsers();
                    break;
                case 'conversations':
                    await this.loadAdminConversations();
                    break;
                case 'messages':
                    await this.loadAdminMessages();
                    break;
                case 'flags':
                    await this.loadAdminFlags();
                    break;
            }
        } catch (error) {
            console.error(`Load admin ${section} error:`, error);
        }
    }

    async loadAdminUsers() {
        const token = localStorage.getItem('bm_token');
        const response = await fetch('/api/admin/users', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const data = await response.json();
        
        if (data.success) {
            this.renderAdminUsers(data.users);
        }
    }

    renderAdminUsers(users) {
        const tbody = document.querySelector('#admin-users tbody');
        tbody.innerHTML = '';
        
        users.forEach(user => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${user.username}</td>
                <td>${user.displayName}</td>
                <td>${user.role}</td>
                <td>${new Date(user.createdAt).toLocaleDateString()}</td>
                <td>${user.onlineStatus ? 'Online' : 'Offline'}</td>
                <td>
                    <div class="admin-actions">
                        <button class="admin-btn view" onclick="app.viewUser('${user._id}')">View</button>
                        <button class="admin-btn delete" onclick="app.deleteUser('${user._id}')">Delete</button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    // Utility Functions
    showError(message) {
        const errorEl = document.getElementById('error-message');
        errorEl.textContent = message;
        errorEl.style.display = 'block';
        
        setTimeout(() => {
            errorEl.style.display = 'none';
        }, 3000);
    }

    showSuccess(message, autoHide = true) {
        const successEl = document.getElementById('success-message');
        successEl.textContent = message;
        successEl.style.display = 'block';
        
        if (autoHide) {
            setTimeout(() => {
                successEl.style.display = 'none';
            }, 3000);
        }
    }

    setLoading(buttonId, isLoading) {
        const button = document.getElementById(buttonId);
        if (!button) return;
        
        if (isLoading) {
            button.disabled = true;
            const originalText = button.querySelector('span').textContent;
            button.setAttribute('data-original-text', originalText);
            button.querySelector('span').innerHTML = '<div class="loading-spinner"></div>';
        } else {
            button.disabled = false;
            const originalText = button.getAttribute('data-original-text');
            if (originalText) {
                button.querySelector('span').textContent = originalText;
            }
        }
    }
}

// Initialize app
window.app = new BMessenger();

// Global functions for HTML event handlers
function showLoginTab(tab) {
    document.querySelectorAll('.login-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.login-form').forEach(f => f.classList.remove('active'));
    
    if (tab === 'login') {
        document.querySelector('.login-tab:nth-child(1)').classList.add('active');
        document.getElementById('login-form').classList.add('active');
    } else {
        document.querySelector('.login-tab:nth-child(2)').classList.add('active');
        document.getElementById('register-form').classList.add('active');
    }
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

function toggleUserInfo() {
    const sidebar = document.getElementById('info-sidebar');
    sidebar.classList.toggle('active');
          }
