// B MESSENGER - WhatsApp/Telegram Clone
class BMessenger {
    constructor() {
        this.socket = null;
        this.currentUser = null;
        this.currentChat = null;
        this.conversations = [];
        this.users = [];
        this.onlineUsers = new Set();
        this.typingTimeout = null;
        this.isAdmin = false;
        
        // Initialize the app
        this.init();
    }

    async init() {
        // Check for existing session
        await this.checkAuth();
        
        // Setup event listeners
        this.setupEventListeners();
        
        // Initialize socket if user is logged in
        if (this.currentUser) {
            await this.initializeSocket();
            await this.loadInitialData();
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
                this.showMainApp();
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
        document.getElementById('register-screen').style.display = 'none';
        document.getElementById('app-container').style.display = 'none';
    }

    showRegisterScreen() {
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('register-screen').style.display = 'flex';
        document.getElementById('app-container').style.display = 'none';
    }

    showMainApp() {
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('register-screen').style.display = 'none';
        document.getElementById('app-container').style.display = 'flex';
        
        // Update user info
        this.updateUserInfo();
        
        // Show admin dashboard button if user is admin
        if (this.isAdmin) {
            document.getElementById('admin-dashboard-btn').style.display = 'block';
        }
    }

    updateUserInfo() {
        if (!this.currentUser) return;
        
        const avatarImg = document.getElementById('user-avatar-img');
        const avatarText = this.currentUser.displayName?.charAt(0) || 'U';
        
        if (this.currentUser.avatar && this.currentUser.avatar.startsWith('http')) {
            avatarImg.src = this.currentUser.avatar;
            avatarImg.alt = this.currentUser.displayName;
            avatarImg.style.display = 'block';
        } else {
            avatarImg.style.display = 'none';
            const avatarDiv = document.querySelector('#user-avatar');
            if (avatarDiv) {
                const textSpan = document.createElement('span');
                textSpan.textContent = avatarText;
                textSpan.style.color = 'white';
                textSpan.style.fontSize = '18px';
                textSpan.style.fontWeight = '500';
                avatarDiv.innerHTML = '';
                avatarDiv.appendChild(textSpan);
            }
        }
        
        document.getElementById('current-user-name').textContent = this.currentUser.displayName || this.currentUser.username;
        document.getElementById('current-user-status').innerHTML = `
            <i class="fas fa-circle online"></i>
            <span>Online</span>
        `;
    }

    setupEventListeners() {
        // Login form
        document.getElementById('login-btn').addEventListener('click', () => this.login());
        document.getElementById('login-password').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.login();
        });
        
        // Register form
        document.getElementById('register-btn').addEventListener('click', () => this.register());
        document.getElementById('register-confirm-password').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.register();
        });
        
        // Navigation between login/register
        document.getElementById('go-to-register').addEventListener('click', () => this.showRegisterScreen());
        document.getElementById('go-to-login').addEventListener('click', () => this.showLoginScreen());
        document.getElementById('back-to-login').addEventListener('click', () => this.showLoginScreen());
        
        // Password visibility toggles
        this.setupPasswordToggles();
        
        // Search functionality
        document.getElementById('search-input').addEventListener('input', (e) => this.handleSearch(e.target.value));
        document.getElementById('search-clear').addEventListener('click', () => this.clearSearch());
        
        // New chat and group buttons
        document.getElementById('new-chat-btn').addEventListener('click', () => this.showNewChatModal());
        document.getElementById('new-group-btn').addEventListener('click', () => this.showNewGroupModal());
        
        // Admin dashboard
        document.getElementById('admin-dashboard-btn')?.addEventListener('click', () => this.showAdminModal());
        
        // Message input
        const messageInput = document.getElementById('message-input');
        messageInput.addEventListener('input', () => this.handleMessageInput());
        messageInput.addEventListener('keydown', (e) => this.handleKeyPress(e));
        
        // Back buttons
        document.getElementById('back-to-chats').addEventListener('click', () => this.closeChat());
        
        // Modal close buttons
        document.querySelectorAll('.modal-close').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const modal = e.target.closest('.modal');
                this.hideModal(modal.id);
            });
        });
    }

    setupPasswordToggles() {
        const toggles = [
            { button: 'show-login-password', input: 'login-password' },
            { button: 'show-register-password', input: 'register-password' },
            { button: 'show-confirm-password', input: 'register-confirm-password' }
        ];
        
        toggles.forEach(({ button, input }) => {
            const toggleBtn = document.getElementById(button);
            const inputField = document.getElementById(input);
            
            if (toggleBtn && inputField) {
                toggleBtn.addEventListener('click', () => {
                    const type = inputField.type === 'password' ? 'text' : 'password';
                    inputField.type = type;
                    toggleBtn.innerHTML = type === 'password' ? '<i class="fas fa-eye"></i>' : '<i class="fas fa-eye-slash"></i>';
                });
            }
        });
    }

    async login() {
        const username = document.getElementById('login-username').value.trim();
        const password = document.getElementById('login-password').value;
        const rememberMe = document.getElementById('remember-me').checked;

        if (!username || !password) {
            this.showToast('Please enter username and password', 'error');
            return;
        }

        this.showLoading(true);

        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();

            if (data.success) {
                // Store token
                localStorage.setItem('bm_token', data.token);
                if (rememberMe) {
                    localStorage.setItem('bm_remember', 'true');
                }
                
                this.currentUser = data.user;
                this.isAdmin = data.user.role === 'admin';
                
                this.showToast('Login successful!', 'success');
                
                // Show main app
                this.showMainApp();
                
                // Initialize socket and load data
                await this.initializeSocket();
                await this.loadInitialData();
                
            } else {
                this.showToast(data.error || 'Login failed', 'error');
            }
        } catch (error) {
            console.error('Login error:', error);
            this.showToast('Network error. Please try again.', 'error');
        } finally {
            this.showLoading(false);
        }
    }

    async register() {
        const username = document.getElementById('register-username').value.trim();
        const displayName = document.getElementById('register-displayname').value.trim();
        const email = document.getElementById('register-email').value.trim();
        const password = document.getElementById('register-password').value;
        const confirmPassword = document.getElementById('register-confirm-password').value;
        const termsAgreed = document.getElementById('terms-agreement').checked;

        // Validation
        if (!username || !displayName || !password || !confirmPassword) {
            this.showToast('Please fill in all required fields', 'error');
            return;
        }

        if (password.length < 6) {
            this.showToast('Password must be at least 6 characters', 'error');
            return;
        }

        if (password !== confirmPassword) {
            this.showToast('Passwords do not match', 'error');
            return;
        }

        if (!termsAgreed) {
            this.showToast('Please agree to the terms and conditions', 'error');
            return;
        }

        this.showLoading(true);

        try {
            const response = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, displayName, email, password })
            });

            const data = await response.json();

            if (data.success) {
                this.showToast('Account created successfully!', 'success');
                
                // Auto-login after registration
                localStorage.setItem('bm_token', data.token);
                this.currentUser = data.user;
                this.isAdmin = data.user.role === 'admin';
                
                // Switch to main app
                setTimeout(() => {
                    this.showMainApp();
                    this.initializeSocket();
                    this.loadInitialData();
                }, 1500);
                
            } else {
                this.showToast(data.error || 'Registration failed', 'error');
            }
        } catch (error) {
            console.error('Registration error:', error);
            this.showToast('Network error. Please try again.', 'error');
        } finally {
            this.showLoading(false);
        }
    }

    logout() {
        if (this.socket) {
            this.socket.disconnect();
        }
        
        localStorage.removeItem('bm_token');
        this.currentUser = null;
        this.currentChat = null;
        this.conversations = [];
        this.users = [];
        
        this.showLoginScreen();
        this.showToast('Logged out successfully', 'success');
    }

    async initializeSocket() {
        const token = localStorage.getItem('bm_token');
        if (!token) return;

        this.socket = io();

        this.socket.on('connect', () => {
            console.log('Connected to server');
            this.socket.emit('authenticate', token);
        });

        this.socket.on('auth-error', (error) => {
            console.error('Socket auth error:', error);
            this.logout();
        });

        this.socket.on('user-status-changed', (data) => {
            this.handleUserStatusChange(data);
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

        this.socket.on('conversations-updated', () => {
            this.loadConversations();
        });

        this.socket.on('conversation-loaded', (data) => {
            this.renderMessages(data.messages);
        });
    }

    async loadInitialData() {
        await this.loadConversations();
        await this.loadAllUsers();
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
        const chatCount = document.getElementById('chat-count');
        
        if (!container) return;

        container.innerHTML = '';
        chatCount.textContent = this.conversations.length;

        if (this.conversations.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-comments"></i>
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
        div.className = `chat-item ${this.currentChat?.conversationId === conv.conversationId ? 'active' : ''}`;
        div.dataset.id = conv.conversationId;

        const lastMessage = conv.lastMessage;
        const time = lastMessage ? this.formatTime(new Date(lastMessage.timestamp)) : '';
        const preview = lastMessage ? this.getPreviewText(lastMessage) : 'No messages yet';
        const unreadBadge = conv.unreadCount > 0 ? 
            `<div class="chat-unread">${conv.unreadCount}</div>` : '';

        div.innerHTML = `
            <div class="chat-avatar">
                <div class="chat-avatar-img">
                    ${conv.partnerInfo?.avatar ? 
                        `<img src="${conv.partnerInfo.avatar}" alt="${conv.partnerInfo.displayName}">` :
                        `<span>${conv.partnerInfo?.displayName?.charAt(0) || 'U'}</span>`
                    }
                </div>
                <div class="chat-status ${conv.partnerInfo?.isOnline ? 'online' : 'offline'}"></div>
            </div>
            <div class="chat-info">
                <div class="chat-header">
                    <div class="chat-name">${conv.partnerInfo?.displayName || conv.partner}</div>
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

    getPreviewText(message) {
        const prefix = message.sender === this.currentUser.username ? 'You: ' : '';
        return prefix + (message.content || message.text || '').substring(0, 50) + 
               ((message.content || message.text || '').length > 50 ? '...' : '');
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
        document.getElementById('welcome-screen').style.display = 'none';
        document.getElementById('message-input-container').style.display = 'flex';
        
        // Update chat header
        document.getElementById('chat-user-name').textContent = 
            conversation.partnerInfo?.displayName || conversation.partner;
        
        const chatAvatar = document.getElementById('chat-avatar-img');
        if (conversation.partnerInfo?.avatar) {
            chatAvatar.src = conversation.partnerInfo.avatar;
            chatAvatar.alt = conversation.partnerInfo.displayName;
            chatAvatar.style.display = 'block';
        } else {
            chatAvatar.style.display = 'none';
            const avatarDiv = document.querySelector('#chat-user-avatar');
            if (avatarDiv) {
                const textSpan = document.createElement('span');
                textSpan.textContent = conversation.partnerInfo?.displayName?.charAt(0) || 'U';
                textSpan.style.color = 'white';
                textSpan.style.fontSize = '18px';
                textSpan.style.fontWeight = '500';
                avatarDiv.innerHTML = '';
                avatarDiv.appendChild(textSpan);
            }
        }
        
        document.getElementById('chat-user-status').textContent = 
            conversation.partnerInfo?.isOnline ? 'online' : 'last seen recently';
        
        // Load messages
        await this.loadMessages(conversation.conversationId);
        
        // Join conversation room
        if (this.socket) {
            this.socket.emit('join-conversation', {
                conversationId: conversation.conversationId,
                username: this.currentUser.username
            });
        }
        
        // Update active state in list
        document.querySelectorAll('.chat-item').forEach(item => {
            item.classList.remove('active');
        });
        document.querySelector(`.chat-item[data-id="${conversation.conversationId}"]`)?.classList.add('active');
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

        // Keep welcome screen hidden if we have messages
        document.getElementById('welcome-screen').style.display = 'none';

        if (messages.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-comment"></i>
                    <p>No messages yet</p>
                    <p>Send a message to start the conversation!</p>
                </div>
            `;
            return;
        }

        let lastDate = null;
        
        messages.forEach(msg => {
            const msgDate = new Date(msg.timestamp).toDateString();
            
            if (msgDate !== lastDate) {
                lastDate = msgDate;
                const dateDiv = document.createElement('div');
                dateDiv.className = 'message-date';
                dateDiv.innerHTML = `<div class="date-label">${this.formatDate(new Date(msg.timestamp))}</div>`;
                container.appendChild(dateDiv);
            }

            const messageEl = this.createMessageElement(msg);
            container.appendChild(messageEl);
        });

        // Add typing indicator at the end
        const typingEl = document.createElement('div');
        typingEl.className = 'typing-indicator';
        typingEl.id = 'typing-indicator';
        typingEl.style.display = 'none';
        typingEl.innerHTML = `
            <div class="typing-dots">
                <div class="dot"></div>
                <div class="dot"></div>
                <div class="dot"></div>
            </div>
            <span id="typing-user">is typing...</span>
        `;
        container.appendChild(typingEl);

        // Scroll to bottom
        container.scrollTop = container.scrollHeight;
    }

    createMessageElement(message) {
        const div = document.createElement('div');
        const isSent = message.sender === this.currentUser.username;
        const isSystem = message.type === 'system';
        
        div.className = `message ${isSystem ? 'system' : isSent ? 'sent' : 'received'}`;
        div.dataset.id = message._id;

        const time = new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        let statusIcon = '<i class="fas fa-check"></i>';
        if (isSent) {
            if (message.read) {
                statusIcon = '<i class="fas fa-check-double read"></i>';
            } else if (message.delivered) {
                statusIcon = '<i class="fas fa-check-double"></i>';
            }
        }

        div.innerHTML = `
            <div class="message-text">${message.text || message.content || ''}</div>
            <div class="message-time">
                ${time}
                ${isSent ? `<span class="message-status">${statusIcon}</span>` : ''}
            </div>
        `;

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
        const voiceBtn = document.getElementById('voice-button');
        
        const hasText = input.value.trim().length > 0;
        
        sendBtn.style.display = hasText ? 'flex' : 'none';
        voiceBtn.style.display = hasText ? 'none' : 'flex';
        
        // Auto-resize
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 100) + 'px';
        
        // Typing indicator
        if (hasText && this.currentChat && this.socket) {
            this.socket.emit('typing-start', {
                conversationId: this.currentChat.conversationId,
                username: this.currentUser.username
            });
            
            clearTimeout(this.typingTimeout);
            this.typingTimeout = setTimeout(() => {
                this.socket.emit('typing-stop', {
                    conversationId: this.currentChat.conversationId,
                    username: this.currentUser.username
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
            text: content,
            sender: this.currentUser.username,
            timestamp: new Date(),
            read: false,
            delivered: false
        };

        this.addMessageToChat(tempMessage);
        
        // Send via socket
        this.socket.emit('send-message', {
            sender: this.currentUser.username,
            receiver: this.currentChat.partner,
            text: content,
            conversationId: this.currentChat.conversationId
        }, (response) => {
            if (response && response.success) {
                // Replace temp message with real one
                const tempEl = document.querySelector(`[data-id="${tempMessage._id}"]`);
                if (tempEl && response.messageId) {
                    tempEl.dataset.id = response.messageId;
                    this.updateMessageStatus(response.messageId, 'sent');
                }
            } else if (response && response.error) {
                // Remove temp message on error
                const tempEl = document.querySelector(`[data-id="${tempMessage._id}"]`);
                if (tempEl) {
                    tempEl.remove();
                }
                this.showToast('Failed to send message: ' + response.error, 'error');
            }
        });

        // Clear input
        input.value = '';
        input.style.height = 'auto';
        this.handleMessageInput();
        
        // Stop typing
        if (this.socket) {
            this.socket.emit('typing-stop', {
                conversationId: this.currentChat.conversationId,
                username: this.currentUser.username
            });
        }
    }

    addMessageToChat(message) {
        const container = document.getElementById('messages-container');
        const messageEl = this.createMessageElement(message);
        
        // Add before typing indicator
        const typingIndicator = document.getElementById('typing-indicator');
        if (typingIndicator) {
            container.insertBefore(messageEl, typingIndicator);
        } else {
            container.appendChild(messageEl);
        }
        
        // Scroll to bottom
        container.scrollTop = container.scrollHeight;
    }

    handleNewMessage(message) {
        if (this.currentChat && this.currentChat.conversationId === message.conversationId) {
            this.addMessageToChat(message);
        }
        
        // Update conversation list
        this.loadConversations();
    }

    updateMessageStatus(messageId, status) {
        const messageEl = document.querySelector(`[data-id="${messageId}"]`);
        if (!messageEl) return;
        
        const statusEl = messageEl.querySelector('.message-status');
        if (!statusEl) return;
        
        if (status === 'delivered') {
            statusEl.innerHTML = '<i class="fas fa-check-double"></i>';
        } else if (status === 'read') {
            statusEl.innerHTML = '<i class="fas fa-check-double read"></i>';
        }
    }

    handleTypingIndicator(data) {
        const indicator = document.getElementById('typing-indicator');
        
        if (data.isTyping && data.username !== this.currentUser.username) {
            indicator.style.display = 'flex';
            document.getElementById('typing-user').textContent = `${data.username} is typing...`;
            
            clearTimeout(this.typingHideTimeout);
            this.typingHideTimeout = setTimeout(() => {
                indicator.style.display = 'none';
            }, 3000);
        } else {
            indicator.style.display = 'none';
        }
    }

    handleUserStatusChange(data) {
        if (data.username === this.currentUser.username) return;
        
        if (data.isOnline) {
            this.onlineUsers.add(data.username);
        } else {
            this.onlineUsers.delete(data.username);
        }
        
        // Update UI
        this.updateOnlineStatus(data.username, data.isOnline);
    }

    updateOnlineStatus(username, isOnline) {
        // Update in chat list
        document.querySelectorAll('.chat-item').forEach(item => {
            const conv = this.conversations.find(c => c.conversationId === item.dataset.id);
            if (conv && conv.partner === username) {
                const statusDot = item.querySelector('.chat-status');
                if (statusDot) {
                    statusDot.className = `chat-status ${isOnline ? 'online' : 'offline'}`;
                }
            }
        });
        
        // Update in current chat
        if (this.currentChat && this.currentChat.partner === username) {
            const statusText = isOnline ? 'online' : 'last seen recently';
            document.getElementById('chat-user-status').textContent = statusText;
        }
    }

    async handleSearch(query) {
        const searchClear = document.getElementById('search-clear');
        
        if (!query) {
            searchClear.style.display = 'none';
            this.renderConversations();
            return;
        }
        
        searchClear.style.display = 'block';

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

    clearSearch() {
        document.getElementById('search-input').value = '';
        document.getElementById('search-clear').style.display = 'none';
        this.renderConversations();
    }

    renderSearchResults(users) {
        const container = document.getElementById('conversations-list');
        container.innerHTML = '';

        if (users.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-search"></i>
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
                    <div class="chat-avatar-img">
                        ${user.avatar ? 
                            `<img src="${user.avatar}" alt="${user.displayName}">` :
                            `<span>${user.displayName?.charAt(0) || 'U'}</span>`
                        }
                    </div>
                    <div class="chat-status ${user.isOnline ? 'online' : 'offline'}"></div>
                </div>
                <div class="chat-info">
                    <div class="chat-header">
                        <div class="chat-name">${user.displayName || user.username}</div>
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
            const response = await fetch('/api/conversations/start', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username: user.username })
            });

            const data = await response.json();

            if (data.success) {
                const conversation = {
                    conversationId: data.conversationId,
                    partner: user.username,
                    partnerInfo: {
                        username: user.username,
                        displayName: user.displayName,
                        avatar: user.avatar,
                        isOnline: user.isOnline
                    },
                    unreadCount: 0,
                    lastMessage: data.message
                };

                this.conversations.unshift(conversation);
                this.renderConversations();
                this.openChat(conversation);
                
                // Hide new chat modal if open
                this.hideModal('new-chat-modal');
            }
        } catch (error) {
            console.error('Start chat error:', error);
            this.showToast('Failed to start chat', 'error');
        }
    }

    closeChat() {
        this.currentChat = null;
        document.getElementById('welcome-screen').style.display = 'flex';
        document.getElementById('message-input-container').style.display = 'none';
        document.getElementById('messages-container').innerHTML = `
            <div class="welcome-screen" id="welcome-screen">
                <div class="welcome-icon">
                    <i class="fas fa-comments"></i>
                </div>
                <h2>Welcome to B MESSENGER</h2>
                <p>Select a chat to start messaging or search for users to begin new conversations.</p>
                <div class="welcome-features">
                    <div class="feature">
                        <i class="fas fa-bolt"></i>
                        <span>Real-time messaging</span>
                    </div>
                    <div class="feature">
                        <i class="fas fa-search"></i>
                        <span>Global user search</span>
                    </div>
                    <div class="feature">
                        <i class="fas fa-shield-alt"></i>
                        <span>End-to-end encryption</span>
                    </div>
                    <div class="feature">
                        <i class="fas fa-users"></i>
                        <span>Group chats</span>
                    </div>
                </div>
            </div>
        `;
        
        // Update active state
        document.querySelectorAll('.chat-item').forEach(item => {
            item.classList.remove('active');
        });
    }

    // Modal Functions
    showModal(modalId) {
        document.getElementById(modalId).classList.add('active');
    }

    hideModal(modalId) {
        document.getElementById(modalId).classList.remove('active');
    }

    showNewChatModal() {
        this.showModal('new-chat-modal');
        this.renderUsersForNewChat();
    }

    renderUsersForNewChat() {
        const container = document.getElementById('new-chat-users');
        container.innerHTML = '';

        this.users.forEach(user => {
            const div = document.createElement('div');
            div.className = 'user-list-item';
            
            div.innerHTML = `
                <div class="user-list-avatar">
                    ${user.avatar ? 
                        `<img src="${user.avatar}" alt="${user.displayName}">` :
                        `<span>${user.displayName?.charAt(0) || 'U'}</span>`
                    }
                </div>
                <div class="user-list-info">
                    <div class="user-list-name">${user.displayName || user.username}</div>
                    <div class="user-list-username">@${user.username}</div>
                    <div class="user-list-status ${user.isOnline ? 'online' : ''}">
                        ${user.isOnline ? '● Online' : '○ Offline'}
                    </div>
                </div>
            `;

            div.addEventListener('click', () => {
                this.startChatWithUser(user);
            });
            
            container.appendChild(div);
        });
    }

    showNewGroupModal() {
        this.showModal('new-group-modal');
        this.renderUsersForGroup();
    }

    renderUsersForGroup() {
        const container = document.getElementById('group-users-list');
        container.innerHTML = '';

        this.users.forEach(user => {
            const div = document.createElement('div');
            div.className = 'user-list-item';
            div.dataset.username = user.username;
            
            div.innerHTML = `
                <div class="user-list-avatar">
                    ${user.avatar ? 
                        `<img src="${user.avatar}" alt="${user.displayName}">` :
                        `<span>${user.displayName?.charAt(0) || 'U'}</span>`
                    }
                </div>
                <div class="user-list-info">
                    <div class="user-list-name">${user.displayName || user.username}</div>
                    <div class="user-list-username">@${user.username}</div>
                    <div class="user-list-status ${user.isOnline ? 'online' : ''}">
                        ${user.isOnline ? '● Online' : '○ Offline'}
                    </div>
                </div>
                <input type="checkbox" class="user-checkbox" onchange="app.toggleUserSelection('${user.username}', this.checked)">
            `;
            
            container.appendChild(div);
        });
    }

    toggleUserSelection(username, selected) {
        const selectedUsers = document.getElementById('selected-users');
        
        if (selected) {
            const user = this.users.find(u => u.username === username);
            if (user) {
                const userDiv = document.createElement('div');
                userDiv.className = 'selected-user';
                userDiv.dataset.username = username;
                userDiv.innerHTML = `
                    ${user.displayName || user.username}
                    <button class="remove-user" onclick="app.removeSelectedUser('${username}')">
                        <i class="fas fa-times"></i>
                    </button>
                `;
                selectedUsers.appendChild(userDiv);
            }
        } else {
            const userDiv = selectedUsers.querySelector(`[data-username="${username}"]`);
            if (userDiv) {
                userDiv.remove();
            }
        }
    }

    removeSelectedUser(username) {
        this.toggleUserSelection(username, false);
        const checkbox = document.querySelector(`.user-checkbox[onchange*="${username}"]`);
        if (checkbox) {
            checkbox.checked = false;
        }
    }

    async createGroup() {
        const groupName = document.getElementById('group-name').value.trim();
        const selectedUsers = Array.from(document.querySelectorAll('.selected-user'))
            .map(div => div.dataset.username);

        if (!groupName) {
            this.showToast('Please enter a group name', 'error');
            return;
        }

        if (selectedUsers.length === 0) {
            this.showToast('Please select at least one participant', 'error');
            return;
        }

        try {
            const token = localStorage.getItem('bm_token');
            const response = await fetch('/api/groups/create', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                    name: groupName, 
                    participants: selectedUsers 
                })
            });

            const data = await response.json();

            if (data.success) {
                this.showToast('Group created successfully!', 'success');
                this.hideModal('new-group-modal');
                
                // Clear form
                document.getElementById('group-name').value = '';
                document.getElementById('selected-users').innerHTML = '';
                
                // Reload conversations
                this.loadConversations();
            } else {
                this.showToast(data.error || 'Failed to create group', 'error');
            }
        } catch (error) {
            console.error('Create group error:', error);
            this.showToast('Failed to create group', 'error');
        }
    }

    showProfileModal() {
        this.showModal('profile-modal');
        this.loadProfileData();
    }

    async loadProfileData() {
        try {
            const token = localStorage.getItem('bm_token');
            const response = await fetch('/api/settings', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            const data = await response.json();

            if (data.success) {
                const user = data.user;
                
                document.getElementById('profile-display-name').textContent = user.displayName || user.username;
                document.getElementById('profile-status').textContent = user.status || "Hey there! I'm using B MESSENGER";
                document.getElementById('profile-username').textContent = user.username;
                document.getElementById('profile-email').textContent = user.email || 'Not provided';
                document.getElementById('profile-bio').textContent = user.bio || 'No bio yet';
                document.getElementById('profile-joined').textContent = new Date(user.createdAt).toLocaleDateString();
                
                const avatarImg = document.getElementById('profile-avatar-img');
                if (user.avatar && user.avatar.startsWith('http')) {
                    avatarImg.src = user.avatar;
                    avatarImg.alt = user.displayName;
                    avatarImg.style.display = 'block';
                } else {
                    avatarImg.style.display = 'none';
                    const avatarDiv = document.querySelector('.profile-avatar');
                    if (avatarDiv) {
                        const textSpan = document.createElement('span');
                        textSpan.textContent = (user.displayName || user.username).charAt(0);
                        textSpan.style.color = 'white';
                        textSpan.style.fontSize = '32px';
                        textSpan.style.fontWeight = '500';
                        avatarDiv.innerHTML = '';
                        avatarDiv.appendChild(textSpan);
                        avatarDiv.appendChild(document.querySelector('.avatar-upload'));
                    }
                }
            }
        } catch (error) {
            console.error('Load profile error:', error);
        }
    }

    showSettingsModal() {
        this.showModal('settings-modal');
        this.loadSettings();
    }

    async loadSettings() {
        try {
            const token = localStorage.getItem('bm_token');
            const response = await fetch('/api/settings', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            const data = await response.json();

            if (data.success) {
                const settings = data.settings;
                
                // Load theme
                const theme = localStorage.getItem('bm_theme') || settings.theme || 'light';
                document.getElementById('theme-select').value = theme;
                
                // Load notification settings
                document.getElementById('notifications-toggle').checked = settings.notifications !== false;
                document.getElementById('sound-toggle').checked = settings.sound !== false;
                
                // Load privacy settings
                document.getElementById('last-seen-select').value = settings.privacy?.lastSeen || 'everyone';
                document.getElementById('read-receipts-toggle').checked = settings.privacy?.readReceipts !== false;
                
                // Apply theme
                if (theme === 'dark') {
                    document.body.classList.add('dark-theme');
                } else if (theme === 'light') {
                    document.body.classList.remove('dark-theme');
                }
            }
        } catch (error) {
            console.error('Load settings error:', error);
        }
    }

    showAdminModal() {
        this.showModal('admin-modal');
        this.loadAdminUsers();
    }

    async loadAdminUsers() {
        try {
            const token = localStorage.getItem('bm_token');
            const response = await fetch('/api/admin/users', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            const data = await response.json();

            if (data.success) {
                this.renderAdminUsers(data.users);
            }
        } catch (error) {
            console.error('Load admin users error:', error);
        }
    }

    renderAdminUsers(users) {
        const container = document.getElementById('admin-users-list');
        container.innerHTML = '';

        users.forEach(user => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${user.username}</td>
                <td>${user.displayName || user.name || ''}</td>
                <td>${user.email || ''}</td>
                <td>
                    <span class="badge ${user.role === 'admin' ? 'badge-primary' : 'badge-secondary'}">
                        ${user.role}
                    </span>
                </td>
                <td>${new Date(user.createdAt).toLocaleDateString()}</td>
                <td>
                    <button class="action-btn small" onclick="app.viewUser('${user._id}')" title="View">
                        <i class="fas fa-eye"></i>
                    </button>
                    <button class="action-btn small danger" onclick="app.deleteUser('${user._id}')" title="Delete">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            `;
            container.appendChild(tr);
        });
    }

    // Utility Functions
    showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        
        const icons = {
            success: 'fas fa-check-circle',
            error: 'fas fa-exclamation-circle',
            warning: 'fas fa-exclamation-triangle',
            info: 'fas fa-info-circle'
        };
        
        toast.innerHTML = `
            <div class="toast-icon">
                <i class="${icons[type] || icons.info}"></i>
            </div>
            <div class="toast-content">
                <div class="toast-title">${type.charAt(0).toUpperCase() + type.slice(1)}</div>
                <div class="toast-message">${message}</div>
            </div>
            <button class="toast-close" onclick="this.parentElement.remove()">
                <i class="fas fa-times"></i>
            </button>
        `;
        
        container.appendChild(toast);
        
        // Auto remove after 5 seconds
        setTimeout(() => {
            if (toast.parentNode) {
                toast.remove();
            }
        }, 5000);
    }

    showLoading(show) {
        const overlay = document.getElementById('loading-overlay');
        overlay.style.display = show ? 'flex' : 'none';
    }

    toggleChatInfo() {
        const sidebar = document.getElementById('chat-info-sidebar');
        sidebar.classList.toggle('active');
    }

    showChatInfo() {
        this.toggleChatInfo();
        // Load chat info here
    }

    editProfile() {
        // Implement profile editing
        this.showToast('Profile editing coming soon!', 'info');
    }

    changePassword() {
        // Implement password change
        this.showToast('Password change coming soon!', 'info');
    }

    deleteAccount() {
        if (confirm('Are you sure you want to delete your account? This action cannot be undone.')) {
            this.showToast('Account deletion coming soon!', 'info');
        }
    }

    clearChat() {
        if (this.currentChat && confirm('Are you sure you want to clear this chat?')) {
            this.showToast('Chat cleared', 'success');
            // Implement chat clearing
        }
    }

    blockUser() {
        if (this.currentChat && confirm(`Are you sure you want to block ${this.currentChat.partner}?`)) {
            this.showToast('User blocked', 'success');
            // Implement user blocking
        }
    }

    uploadAvatar() {
        // Implement avatar upload
        this.showToast('Avatar upload coming soon!', 'info');
    }

    toggleEmojiPicker() {
        // Implement emoji picker
        this.showToast('Emoji picker coming soon!', 'info');
    }

    showFilePicker() {
        document.getElementById('file-input').click();
    }

    handleFileUpload(files) {
        if (!files.length) return;
        
        this.showToast(`Selected ${files.length} file(s)`, 'info');
        // Implement file upload
    }

    toggleVoiceMessage() {
        // Implement voice message
        this.showToast('Voice messages coming soon!', 'info');
    }

    toggleFormatting() {
        // Implement text formatting
        this.showToast('Text formatting coming soon!', 'info');
    }

    startVoiceRecording() {
        // Implement voice recording
        this.showToast('Voice recording coming soon!', 'info');
    }

    viewUser(userId) {
        // Implement user view
        this.showToast('User view coming soon!', 'info');
    }

    deleteUser(userId) {
        if (confirm('Are you sure you want to delete this user?')) {
            this.showToast('User deletion coming soon!', 'info');
        }
    }

    showAttachmentMenu() {
        // Implement attachment menu
        this.showToast('Attachment menu coming soon!', 'info');
    }
}

// Initialize the app when page loads
window.addEventListener('DOMContentLoaded', () => {
    window.app = new BMessenger();
});

// Global helper functions
function formatTime(date) {
    return window.app ? window.app.formatTime(date) : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function showToast(message, type) {
    if (window.app) {
        window.app.showToast(message, type);
    }
        }
