// WhatsApp Clone - Complete Frontend Logic
class WhatsAppApp {
    constructor() {
        // App State
        this.socket = null;
        this.currentUser = null;
        this.currentChat = null;
        this.currentChatId = null;
        this.chats = [];
        this.contacts = [];
        this.messages = new Map(); // chatId -> messages array
        this.onlineUsers = new Set();
        this.typingUsers = new Map(); // chatId -> userId
        this.isTyping = false;
        this.typingTimeout = null;
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.isRecording = false;
        
        // DOM Elements
        this.elements = {
            // Screens
            loadingScreen: document.getElementById('loading-screen'),
            authScreen: document.getElementById('auth-screen'),
            mainApp: document.getElementById('main-app'),
            chatScreen: document.getElementById('chat-screen'),
            settingsPanel: document.getElementById('settings-panel'),
            
            // Auth
            loginTab: document.getElementById('login-tab'),
            registerTab: document.getElementById('register-tab'),
            loginForm: document.getElementById('login-form'),
            registerForm: document.getElementById('register-form'),
            loginPhone: document.getElementById('login-phone'),
            loginPassword: document.getElementById('login-password'),
            registerPhone: document.getElementById('register-phone'),
            registerName: document.getElementById('register-name'),
            registerEmail: document.getElementById('register-email'),
            registerPassword: document.getElementById('register-password'),
            loginButton: document.getElementById('login-button'),
            registerButton: document.getElementById('register-button'),
            
            // Main App
            menuBtn: document.getElementById('menu-btn'),
            searchBtn: document.getElementById('search-btn'),
            cameraBtn: document.getElementById('camera-btn'),
            moreBtn: document.getElementById('more-btn'),
            searchContainer: document.getElementById('search-container'),
            searchInput: document.getElementById('search-input'),
            searchClear: document.getElementById('search-clear'),
            
            // Tabs
            tabButtons: document.querySelectorAll('.tab-btn'),
            tabContents: {
                chats: document.getElementById('chats-tab'),
                status: document.getElementById('status-tab'),
                calls: document.getElementById('calls-tab')
            },
            
            // Chats
            chatsList: document.getElementById('chats-list'),
            newChatFab: document.getElementById('new-chat-fab'),
            
            // Status
            myStatus: document.getElementById('my-status'),
            myStatusAvatar: document.getElementById('my-status-avatar'),
            statusList: document.getElementById('status-list'),
            statusCameraFab: document.getElementById('status-camera-fab'),
            statusTextFab: document.getElementById('status-text-fab'),
            
            // Calls
            callsList: document.getElementById('calls-list'),
            createCallLink: document.getElementById('create-call-link'),
            newCallFab: document.getElementById('new-call-fab'),
            
            // Chat Screen
            chatBackBtn: document.getElementById('chat-back-btn'),
            chatAvatar: document.getElementById('chat-avatar'),
            chatUserName: document.getElementById('chat-user-name'),
            chatUserStatus: document.getElementById('chat-user-status'),
            chatStatusText: document.getElementById('chat-status-text'),
            voiceCallBtn: document.getElementById('voice-call-btn'),
            videoCallBtn: document.getElementById('video-call-btn'),
            chatMenuBtn: document.getElementById('chat-menu-btn'),
            
            // Messages
            messagesContainer: document.getElementById('messages-container'),
            typingIndicator: document.getElementById('typing-indicator'),
            
            // Inputs
            messageInput: document.getElementById('message-input'),
            sendButton: document.getElementById('send-button'),
            emojiBtn: document.getElementById('emoji-btn'),
            attachBtn: document.getElementById('attach-btn'),
            chatMessageInput: document.getElementById('chat-message-input'),
            chatSendButton: document.getElementById('chat-send-button'),
            chatEmojiBtn: document.getElementById('chat-emoji-btn'),
            chatAttachBtn: document.getElementById('chat-attach-btn'),
            
            // Settings
            settingsBackBtn: document.getElementById('settings-back-btn'),
            settingsAvatar: document.getElementById('settings-avatar'),
            settingsName: document.getElementById('settings-name'),
            settingsAbout: document.getElementById('settings-about'),
            enterToSend: document.getElementById('enter-to-send'),
            mediaVisibility: document.getElementById('media-visibility'),
            messageNotifications: document.getElementById('message-notifications'),
            soundToggle: document.getElementById('sound-toggle'),
            vibrationToggle: document.getElementById('vibration-toggle'),
            logoutBtn: document.getElementById('logout-btn'),
            themeOptions: document.querySelectorAll('.theme-option'),
            
            // Modals
            newChatModal: document.getElementById('new-chat-modal'),
            closeNewChat: document.getElementById('close-new-chat'),
            contactSearch: document.getElementById('contact-search'),
            contactsList: document.getElementById('contacts-list'),
            
            // Attachment Menu
            attachmentMenu: document.getElementById('attachment-menu'),
            
            // File Input
            fileInput: document.getElementById('file-input'),
            
            // Toast
            toast: document.getElementById('toast'),
            
            // Audio Elements
            messageSound: document.getElementById('message-sound'),
            sendSound: document.getElementById('send-sound')
        };
        
        // Initialize
        this.init();
    }
    
    // ==================== INITIALIZATION ====================
    init() {
        this.setupEventListeners();
        this.checkAuth();
    }
    
    setupEventListeners() {
        // Auth
        this.elements.loginForm.addEventListener('submit', (e) => this.handleLogin(e));
        this.elements.registerForm.addEventListener('submit', (e) => this.handleRegister(e));
        
        // Navigation
        this.elements.menuBtn.addEventListener('click', () => this.showSettings());
        this.elements.searchBtn.addEventListener('click', () => this.toggleSearch());
        this.elements.cameraBtn.addEventListener('click', () => this.openCamera());
        this.elements.moreBtn.addEventListener('click', () => this.showMoreOptions());
        
        // Tabs
        this.elements.tabButtons.forEach(btn => {
            btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
        });
        
        // Search
        this.elements.searchInput.addEventListener('input', (e) => this.handleSearch(e.target.value));
        this.elements.searchClear.addEventListener('click', () => this.clearSearch());
        
        // Chats
        this.elements.newChatFab.addEventListener('click', () => this.showNewChatModal());
        this.elements.closeNewChat.addEventListener('click', () => this.hideNewChatModal());
        this.elements.contactSearch.addEventListener('input', (e) => this.searchContacts(e.target.value));
        
        // Status
        this.elements.myStatus.addEventListener('click', () => this.addStatus());
        this.elements.statusCameraFab.addEventListener('click', () => this.addStatus('camera'));
        this.elements.statusTextFab.addEventListener('click', () => this.addStatus('text'));
        
        // Calls
        this.elements.createCallLink.addEventListener('click', () => this.createCallLink());
        this.elements.newCallFab.addEventListener('click', () => this.startNewCall());
        
        // Chat Screen
        this.elements.chatBackBtn.addEventListener('click', () => this.closeChat());
        this.elements.voiceCallBtn.addEventListener('click', () => this.startVoiceCall());
        this.elements.videoCallBtn.addEventListener('click', () => this.startVideoCall());
        this.elements.chatMenuBtn.addEventListener('click', () => this.showChatMenu());
        
        // Message Inputs
        this.elements.messageInput.addEventListener('input', (e) => this.handleMessageInput(e, 'main'));
        this.elements.chatMessageInput.addEventListener('input', (e) => this.handleMessageInput(e, 'chat'));
        
        this.elements.messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage('main');
            }
        });
        
        this.elements.chatMessageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage('chat');
            }
        });
        
        this.elements.sendButton.addEventListener('click', () => this.sendMessage('main'));
        this.elements.chatSendButton.addEventListener('click', () => this.sendMessage('chat'));
        
        // Attachment
        this.elements.attachBtn.addEventListener('click', () => this.showAttachmentMenu('main'));
        this.elements.chatAttachBtn.addEventListener('click', () => this.showAttachmentMenu('chat'));
        
        // Settings
        this.elements.settingsBackBtn.addEventListener('click', () => this.hideSettings());
        this.elements.logoutBtn.addEventListener('click', () => this.logout());
        
        // Theme
        this.elements.themeOptions.forEach(option => {
            option.addEventListener('click', () => this.changeTheme(option.dataset.theme));
        });
        
        // File Upload
        this.elements.fileInput.addEventListener('change', (e) => this.handleFileUpload(e.target.files));
        
        // Attachment Menu Items
        document.querySelectorAll('.attachment-item').forEach(item => {
            item.addEventListener('click', () => this.handleAttachment(item.dataset.type));
        });
        
        // Modal Overlay
        this.elements.newChatModal.addEventListener('click', (e) => {
            if (e.target === this.elements.newChatModal) {
                this.hideNewChatModal();
            }
        });
        
        // Prevent body scroll when modal is open
        document.addEventListener('touchmove', (e) => {
            if (this.elements.newChatModal.classList.contains('active') || 
                this.elements.attachmentMenu.classList.contains('active')) {
                e.preventDefault();
            }
        }, { passive: false });
        
        // Click outside to close menus
        document.addEventListener('click', (e) => {
            if (this.elements.attachmentMenu.classList.contains('active') && 
                !e.target.closest('.attachment-menu') && 
                !e.target.closest('.input-btn') && 
                !e.target.closest('.chat-input-btn')) {
                this.hideAttachmentMenu();
            }
        });
    }
    
    // ==================== AUTHENTICATION ====================
    async checkAuth() {
        const token = localStorage.getItem('whatsapp_token');
        const userData = localStorage.getItem('whatsapp_user');
        
        if (token && userData) {
            try {
                this.currentUser = JSON.parse(userData);
                this.showMainApp();
                await this.loadUserData();
                this.connectSocket();
            } catch (error) {
                console.error('Auth check error:', error);
                localStorage.removeItem('whatsapp_token');
                localStorage.removeItem('whatsapp_user');
                this.showAuth();
            }
        } else {
            this.showAuth();
        }
    }
    
    showAuth() {
        this.elements.loadingScreen.style.display = 'none';
        this.elements.authScreen.style.display = 'flex';
        this.elements.mainApp.style.display = 'none';
    }
    
    showAuthTab(tab) {
        if (tab === 'login') {
            this.elements.loginTab.classList.add('active');
            this.elements.registerTab.classList.remove('active');
            this.elements.loginForm.classList.add('active');
            this.elements.registerForm.classList.remove('active');
        } else {
            this.elements.loginTab.classList.remove('active');
            this.elements.registerTab.classList.add('active');
            this.elements.loginForm.classList.remove('active');
            this.elements.registerForm.classList.add('active');
        }
    }
    
    async handleLogin(e) {
        e.preventDefault();
        
        const phone = this.elements.loginPhone.value.trim();
        const password = this.elements.loginPassword.value;
        
        if (!phone || !password) {
            this.showToast('Phone and password are required');
            return;
        }
        
        this.showLoading(this.elements.loginButton);
        
        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone, password })
            });
            
            const result = await response.json();
            
            if (result.success) {
                // Save user data
                this.currentUser = result.user;
                localStorage.setItem('whatsapp_token', 'jwt_token_placeholder');
                localStorage.setItem('whatsapp_user', JSON.stringify(result.user));
                
                // Show main app
                this.showMainApp();
                await this.loadUserData();
                this.connectSocket();
                
                this.showToast('Login successful!');
            } else {
                this.showToast(result.error || 'Login failed');
            }
        } catch (error) {
            console.error('Login error:', error);
            this.showToast('Network error. Please try again.');
        } finally {
            this.hideLoading(this.elements.loginButton, 'CONTINUE');
        }
    }
    
    async handleRegister(e) {
        e.preventDefault();
        
        const phone = this.elements.registerPhone.value.trim();
        const name = this.elements.registerName.value.trim();
        const email = this.elements.registerEmail.value.trim();
        const password = this.elements.registerPassword.value;
        
        if (!phone || !name || !password) {
            this.showToast('Phone, name and password are required');
            return;
        }
        
        if (password.length < 6) {
            this.showToast('Password must be at least 6 characters');
            return;
        }
        
        this.showLoading(this.elements.registerButton);
        
        try {
            const response = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone, name, email, password })
            });
            
            const result = await response.json();
            
            if (result.success) {
                // Save user data
                this.currentUser = result.user;
                localStorage.setItem('whatsapp_token', 'jwt_token_placeholder');
                localStorage.setItem('whatsapp_user', JSON.stringify(result.user));
                
                // Show main app
                this.showMainApp();
                await this.loadUserData();
                this.connectSocket();
                
                this.showToast('Account created successfully!');
            } else {
                this.showToast(result.error || 'Registration failed');
            }
        } catch (error) {
            console.error('Register error:', error);
            this.showToast('Network error. Please try again.');
        } finally {
            this.hideLoading(this.elements.registerButton, 'CREATE ACCOUNT');
        }
    }
    
    logout() {
        if (this.socket) {
            this.socket.disconnect();
        }
        
        localStorage.removeItem('whatsapp_token');
        localStorage.removeItem('whatsapp_user');
        
        this.currentUser = null;
        this.chats = [];
        this.contacts = [];
        this.messages.clear();
        
        this.hideSettings();
        this.elements.mainApp.style.display = 'none';
        this.elements.authScreen.style.display = 'flex';
        
        // Reset forms
        this.elements.loginPhone.value = '';
        this.elements.loginPassword.value = '';
        this.elements.registerPhone.value = '';
        this.elements.registerName.value = '';
        this.elements.registerEmail.value = '';
        this.elements.registerPassword.value = '';
        
        this.showAuthTab('login');
    }
    
    // ==================== SOCKET.IO ====================
    connectSocket() {
        this.socket = io();
        
        this.socket.on('connect', () => {
            console.log('Connected to server');
            
            // Notify server user is online
            this.socket.emit('user-online', {
                userId: this.currentUser.userId
            });
        });
        
        this.socket.on('user-status', (data) => {
            this.handleUserStatus(data);
        });
        
        this.socket.on('new-message', (message) => {
            this.handleNewMessage(message);
        });
        
        this.socket.on('message-sent', (message) => {
            this.handleMessageSent(message);
        });
        
        this.socket.on('message-status', (data) => {
            this.updateMessageStatus(data);
        });
        
        this.socket.on('user-typing', (data) => {
            this.handleTypingIndicator(data);
        });
        
        this.socket.on('chat-updated', (data) => {
            this.updateChatList(data);
        });
        
        this.socket.on('call-offer', (data) => {
            this.handleCallOffer(data);
        });
        
        this.socket.on('call-answer', (data) => {
            this.handleCallAnswer(data);
        });
        
        this.socket.on('call-ice-candidate', (data) => {
            this.handleIceCandidate(data);
        });
        
        this.socket.on('call-end', (data) => {
            this.handleCallEnd(data);
        });
        
        this.socket.on('disconnect', () => {
            console.log('Disconnected from server');
        });
    }
    
    // ==================== UI MANAGEMENT ====================
    showMainApp() {
        this.elements.loadingScreen.style.display = 'none';
        this.elements.authScreen.style.display = 'none';
        this.elements.mainApp.style.display = 'flex';
        this.elements.chatScreen.style.display = 'none';
        this.elements.settingsPanel.style.display = 'none';
        
        // Update user info
        this.updateUserInfo();
        
        // Load initial data
        this.loadChats();
        this.loadContacts();
        this.loadStatus();
        this.loadCalls();
    }
    
    switchTab(tabName) {
        // Update active tab
        this.elements.tabButtons.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabName);
        });
        
        // Show active content
        Object.keys(this.elements.tabContents).forEach(key => {
            this.elements.tabContents[key].classList.toggle('active', key === tabName);
        });
        
        // Hide search if open
        this.hideSearch();
        
        // Load data for tab
        switch(tabName) {
            case 'status':
                this.loadStatus();
                break;
            case 'calls':
                this.loadCalls();
                break;
        }
    }
    
    toggleSearch() {
        this.elements.searchContainer.style.display = 
            this.elements.searchContainer.style.display === 'none' ? 'block' : 'none';
        
        if (this.elements.searchContainer.style.display === 'block') {
            this.elements.searchInput.focus();
        }
    }
    
    hideSearch() {
        this.elements.searchContainer.style.display = 'none';
        this.elements.searchInput.value = '';
        this.elements.searchClear.classList.remove('active');
    }
    
    handleSearch(query) {
        this.elements.searchClear.classList.toggle('active', query.length > 0);
        
        if (!query) {
            this.renderChats(this.chats);
            return;
        }
        
        const filteredChats = this.chats.filter(chat => 
            chat.name.toLowerCase().includes(query.toLowerCase()) ||
            (chat.lastMessage?.text || '').toLowerCase().includes(query.toLowerCase())
        );
        
        this.renderChats(filteredChats);
    }
    
    clearSearch() {
        this.elements.searchInput.value = '';
        this.elements.searchClear.classList.remove('active');
        this.handleSearch('');
        this.elements.searchInput.focus();
    }
    
    // ==================== CHAT MANAGEMENT ====================
    async loadChats() {
        try {
            const response = await fetch(`/api/chats/${this.currentUser.userId}`);
            const result = await response.json();
            
            if (result.success) {
                this.chats = result.chats;
                this.renderChats(this.chats);
            }
        } catch (error) {
            console.error('Load chats error:', error);
            this.showToast('Failed to load chats');
        }
    }
    
    renderChats(chats) {
        if (chats.length === 0) {
            this.elements.chatsList.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-comments"></i>
                    <p>No chats yet</p>
                    <p class="subtext">Start a new chat to begin messaging</p>
                </div>
            `;
            return;
        }
        
        this.elements.chatsList.innerHTML = chats.map(chat => `
            <div class="chat-item ${chat.unreadCount > 0 ? 'unread' : ''}" 
                 data-chat-id="${chat.id}" 
                 data-user-id="${chat.participants.find(p => p !== this.currentUser.userId)}">
                <div class="avatar-img">
                    ${chat.avatar ? `<img src="${chat.avatar}" alt="${chat.name}">` : chat.name.charAt(0)}
                </div>
                <div class="chat-info">
                    <div class="chat-header">
                        <div class="chat-name">${chat.name}</div>
                        <div class="chat-time">${this.formatTime(chat.timestamp)}</div>
                    </div>
                    <div class="chat-preview">
                        <div class="chat-message">
                            ${chat.lastMessage ? chat.lastMessage.text : 'No messages yet'}
                        </div>
                        ${chat.unreadCount > 0 ? `<div class="chat-unread">${chat.unreadCount}</div>` : ''}
                    </div>
                </div>
            </div>
        `).join('');
        
        // Add click listeners
        document.querySelectorAll('.chat-item').forEach(item => {
            item.addEventListener('click', () => {
                const chatId = item.dataset.chatId;
                const userId = item.dataset.userId;
                const chat = chats.find(c => c.id === chatId);
                this.openChat(chatId, userId, chat);
            });
        });
    }
    
    async openChat(chatId, userId, chatInfo) {
        this.currentChatId = chatId;
        this.currentChat = {
            id: chatId,
            userId: userId,
            name: chatInfo?.name || 'Unknown',
            avatar: chatInfo?.avatar,
            isOnline: chatInfo?.isOnline || false
        };
        
        // Update chat header
        this.elements.chatUserName.textContent = this.currentChat.name;
        this.elements.chatAvatar.innerHTML = `
            <div class="avatar-img">
                ${this.currentChat.avatar ? `<img src="${this.currentChat.avatar}" alt="${this.currentChat.name}">` : this.currentChat.name.charAt(0)}
            </div>
        `;
        this.elements.chatStatusText.textContent = this.currentChat.isOnline ? 'online' : 'offline';
        
        // Show chat screen
        this.elements.chatScreen.style.display = 'flex';
        this.elements.mainApp.style.display = 'none';
        
        // Join chat room
        if (this.socket) {
            this.socket.emit('join-chat', { chatId });
        }
        
        // Load messages
        await this.loadMessages(chatId);
        
        // Mark as read
        if (this.socket) {
            const chat = this.chats.find(c => c.id === chatId);
            if (chat && chat.unreadCount > 0) {
                // Mark all messages as read
                const messages = this.messages.get(chatId) || [];
                messages.forEach(msg => {
                    if (!msg.isSent && !msg.read) {
                        this.socket.emit('message-read', {
                            messageId: msg.id,
                            userId: this.currentUser.userId
                        });
                    }
                });
            }
        }
    }
    
    closeChat() {
        this.elements.chatScreen.style.display = 'none';
        this.elements.mainApp.style.display = 'flex';
        this.currentChat = null;
        this.currentChatId = null;
        this.elements.messagesContainer.innerHTML = '';
        this.elements.chatMessageInput.value = '';
        this.handleMessageInput({ target: this.elements.chatMessageInput }, 'chat');
        
        // Leave chat room
        if (this.socket && this.currentChatId) {
            this.socket.emit('leave-chat', { chatId: this.currentChatId });
        }
        
        // Reload chats to update unread counts
        this.loadChats();
    }
    
    async loadMessages(chatId) {
        try {
            const response = await fetch(`/api/messages/${chatId}?limit=50`);
            const result = await response.json();
            
            if (result.success) {
                this.messages.set(chatId, result.messages);
                this.renderMessages(chatId, result.messages);
            }
        } catch (error) {
            console.error('Load messages error:', error);
            this.showToast('Failed to load messages');
        }
    }
    
    renderMessages(chatId, messages) {
        this.elements.messagesContainer.innerHTML = '';
        
        if (messages.length === 0) {
            this.elements.messagesContainer.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-comment"></i>
                    <p>No messages yet</p>
                    <p class="subtext">Send a message to start the conversation</p>
                </div>
            `;
            return;
        }
        
        // Group messages by date
        let currentDate = null;
        let html = '';
        
        messages.forEach(message => {
            const messageDate = this.formatDate(message.timestamp);
            
            if (messageDate !== currentDate) {
                currentDate = messageDate;
                html += `
                    <div class="message-date">
                        <span>${currentDate}</span>
                    </div>
                `;
            }
            
            const isSent = message.senderId === this.currentUser.userId;
            const statusIcon = isSent ? 
                (message.status === 'read' ? '✓✓' : 
                 message.status === 'delivered' ? '✓✓' : '✓') : '';
            
            html += `
                <div class="message ${isSent ? 'sent' : 'received'}" data-message-id="${message.id}">
                    <div class="message-text">${message.text}</div>
                    <div class="message-time">
                        ${this.formatTime(message.timestamp)}
                        ${isSent ? `
                            <span class="message-status">
                                <span class="${message.status}">${statusIcon}</span>
                            </span>
                        ` : ''}
                    </div>
                </div>
            `;
        });
        
        this.elements.messagesContainer.innerHTML = html;
        this.scrollToBottom();
        
        // Add typing indicator
        const typingIndicator = document.createElement('div');
        typingIndicator.className = 'typing-indicator';
        typingIndicator.id = 'typing-indicator';
        typingIndicator.style.display = 'none';
        typingIndicator.innerHTML = `
            <div class="typing-dots">
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
            </div>
        `;
        this.elements.messagesContainer.appendChild(typingIndicator);
    }
    
    handleMessageInput(e, source) {
        const input = e.target;
        const hasText = input.value.trim().length > 0;
        const button = source === 'main' ? this.elements.sendButton : this.elements.chatSendButton;
        
        // Update button icon
        if (hasText) {
            button.innerHTML = '<i class="fas fa-paper-plane"></i>';
        } else {
            button.innerHTML = '<i class="fas fa-microphone"></i>';
        }
        
        // Handle typing indicator
        if (source === 'chat' && this.currentChatId && this.socket) {
            if (hasText && !this.isTyping) {
                this.socket.emit('typing', {
                    chatId: this.currentChatId,
                    userId: this.currentUser.userId,
                    isTyping: true
                });
                this.isTyping = true;
            } else if (!hasText && this.isTyping) {
                this.socket.emit('typing', {
                    chatId: this.currentChatId,
                    userId: this.currentUser.userId,
                    isTyping: false
                });
                this.isTyping = false;
            }
            
            // Clear previous timeout
            clearTimeout(this.typingTimeout);
            
            // Set timeout to stop typing indicator
            if (hasText) {
                this.typingTimeout = setTimeout(() => {
                    if (this.isTyping) {
                        this.socket.emit('typing', {
                            chatId: this.currentChatId,
                            userId: this.currentUser.userId,
                            isTyping: false
                        });
                        this.isTyping = false;
                    }
                }, 2000);
            }
        }
    }
    
    async sendMessage(source) {
        let input, button;
        
        if (source === 'main') {
            input = this.elements.messageInput;
            button = this.elements.sendButton;
        } else {
            input = this.elements.chatMessageInput;
            button = this.elements.chatSendButton;
        }
        
        const text = input.value.trim();
        
        if (!text) {
            // Start voice recording
            if (!this.isRecording) {
                this.startRecording();
            } else {
                this.stopRecording();
            }
            return;
        }
        
        if (!this.currentChatId || !this.currentChat) {
            this.showToast('Select a chat first');
            return;
        }
        
        // Create temporary message
        const tempId = 'temp_' + Date.now();
        const tempMessage = {
            id: tempId,
            text,
            senderId: this.currentUser.userId,
            timestamp: new Date(),
            status: 'sent',
            isSent: true
        };
        
        // Add to UI immediately
        this.addMessageToUI(tempMessage);
        
        // Send via socket
        if (this.socket) {
            this.socket.emit('send-message', {
                chatId: this.currentChatId,
                senderId: this.currentUser.userId,
                text: text,
                tempId: tempId
            }, (response) => {
                if (response && response.error) {
                    console.error('Send failed:', response.error);
                    this.showToast('Failed to send message');
                    
                    // Remove temp message
                    const tempMsg = document.querySelector(`[data-message-id="${tempId}"]`);
                    if (tempMsg) tempMsg.remove();
                }
            });
        }
        
        // Clear input
        input.value = '';
        this.handleMessageInput({ target: input }, source);
        
        // Play send sound
        this.elements.sendSound.currentTime = 0;
        this.elements.sendSound.play().catch(console.error);
    }
    
    addMessageToUI(message) {
        const isSent = message.senderId === this.currentUser.userId;
        const statusIcon = isSent ? 
            (message.status === 'read' ? '✓✓' : 
             message.status === 'delivered' ? '✓✓' : '✓') : '';
        
        const messageEl = document.createElement('div');
        messageEl.className = `message ${isSent ? 'sent' : 'received'}`;
        messageEl.dataset.messageId = message.id;
        messageEl.innerHTML = `
            <div class="message-text">${message.text}</div>
            <div class="message-time">
                ${this.formatTime(message.timestamp)}
                ${isSent ? `
                    <span class="message-status">
                        <span class="${message.status}">${statusIcon}</span>
                    </span>
                ` : ''}
            </div>
        `;
        
        // Insert before typing indicator
        const typingIndicator = document.getElementById('typing-indicator');
        if (typingIndicator) {
            this.elements.messagesContainer.insertBefore(messageEl, typingIndicator);
        } else {
            this.elements.messagesContainer.appendChild(messageEl);
        }
        
        this.scrollToBottom();
        
        // Add to messages array
        if (this.currentChatId) {
            const messages = this.messages.get(this.currentChatId) || [];
            messages.push(message);
            this.messages.set(this.currentChatId, messages);
        }
    }
    
    handleNewMessage(message) {
        if (message.chatId === this.currentChatId) {
            // Add to UI
            this.addMessageToUI({
                ...message,
                isSent: false
            });
            
            // Play notification sound
            if (this.elements.messageNotifications?.checked !== false) {
                this.elements.messageSound.currentTime = 0;
                this.elements.messageSound.play().catch(console.error);
            }
        }
        
        // Update chat list
        this.updateChatInList(message.chatId, {
            lastMessage: message,
            timestamp: message.timestamp
        });
    }
    
    handleMessageSent(message) {
        // Update temp message with real ID
        const tempMsg = document.querySelector(`[data-message-id="${message.tempId}"]`);
        if (tempMsg) {
            tempMsg.dataset.messageId = message.id;
            
            // Update status
            const statusEl = tempMsg.querySelector('.message-status span');
            if (statusEl) {
                statusEl.className = 'delivered';
                statusEl.textContent = '✓✓';
            }
        }
    }
    
    updateMessageStatus(data) {
        const messageEl = document.querySelector(`[data-message-id="${data.messageId}"]`);
        if (messageEl) {
            const statusEl = messageEl.querySelector('.message-status span');
            if (statusEl) {
                statusEl.className = data.status;
                statusEl.textContent = '✓✓';
            }
        }
    }
    
    handleTypingIndicator(data) {
        if (data.chatId === this.currentChatId && data.userId !== this.currentUser.userId) {
            const typingIndicator = document.getElementById('typing-indicator');
            if (typingIndicator) {
                typingIndicator.style.display = data.isTyping ? 'block' : 'none';
                
                if (data.isTyping) {
                    // Auto-hide after 3 seconds
                    setTimeout(() => {
                        typingIndicator.style.display = 'none';
                    }, 3000);
                }
            }
        }
    }
    
    updateChatInList(chatId, updateData) {
        const chatIndex = this.chats.findIndex(c => c.id === chatId);
        if (chatIndex !== -1) {
            this.chats[chatIndex] = {
                ...this.chats[chatIndex],
                ...updateData,
                unreadCount: chatId === this.currentChatId ? 0 : (this.chats[chatIndex].unreadCount || 0) + 1
            };
            
            // Move to top
            const chat = this.chats.splice(chatIndex, 1)[0];
            this.chats.unshift(chat);
            
            // Re-render if on chats tab
            if (this.elements.tabContents.chats.classList.contains('active')) {
                this.renderChats(this.chats);
            }
        }
    }
    
    // ==================== CONTACTS ====================
    async loadContacts() {
        try {
            const response = await fetch(`/api/users/search/?userId=${this.currentUser.userId}`);
            const result = await response.json();
            
            if (result.success) {
                this.contacts = result.users;
            }
        } catch (error) {
            console.error('Load contacts error:', error);
        }
    }
    
    renderContacts(contacts) {
        if (contacts.length === 0) {
            this.elements.contactsList.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-users"></i>
                    <p>No contacts found</p>
                </div>
            `;
            return;
        }
        
        this.elements.contactsList.innerHTML = contacts.map(contact => `
            <div class="chat-item" data-user-id="${contact.userId}">
                <div class="avatar-img">
                    ${contact.avatar ? `<img src="${contact.avatar}" alt="${contact.name}">` : contact.name.charAt(0)}
                </div>
                <div class="chat-info">
                    <div class="chat-header">
                        <div class="chat-name">${contact.name}</div>
                    </div>
                    <div class="chat-preview">
                        <div class="chat-message">${contact.about || 'Hey there! I\'m using WhatsApp'}</div>
                    </div>
                </div>
            </div>
        `).join('');
        
        // Add click listeners
        document.querySelectorAll('.chat-item[data-user-id]').forEach(item => {
            item.addEventListener('click', async () => {
                const userId = item.dataset.userId;
                const contact = contacts.find(c => c.userId === userId);
                
                // Create or get chat
                try {
                    const response = await fetch('/api/chats/create', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            userId: this.currentUser.userId,
                            contactId: userId
                        })
                    });
                    
                    const result = await response.json();
                    
                    if (result.success) {
                        this.hideNewChatModal();
                        
                        // Open chat
                        this.openChat(result.chatId, userId, {
                            name: contact.name,
                            avatar: contact.avatar,
                            isOnline: this.onlineUsers.has(userId)
                        });
                        
                        // Add to chats list if new
                        if (result.isNew) {
                            this.chats.unshift({
                                id: result.chatId,
                                name: contact.name,
                                avatar: contact.avatar,
                                participants: [this.currentUser.userId, userId],
                                lastMessage: null,
                                unreadCount: 0,
                                timestamp: new Date(),
                                isOnline: this.onlineUsers.has(userId)
                            });
                            this.renderChats(this.chats);
                        }
                    }
                } catch (error) {
                    console.error('Create chat error:', error);
                    this.showToast('Failed to create chat');
                }
            });
        });
    }
    
    searchContacts(query) {
        if (!query) {
            this.renderContacts(this.contacts);
            return;
        }
        
        const filteredContacts = this.contacts.filter(contact => 
            contact.name.toLowerCase().includes(query.toLowerCase()) ||
            contact.phone.includes(query)
        );
        
        this.renderContacts(filteredContacts);
    }
    
    showNewChatModal() {
        this.elements.newChatModal.classList.add('active');
        this.renderContacts(this.contacts);
    }
    
    hideNewChatModal() {
        this.elements.newChatModal.classList.remove('active');
        this.elements.contactSearch.value = '';
        this.searchContacts('');
    }
    
    // ==================== STATUS ====================
    async loadStatus() {
        try {
            const response = await fetch(`/api/status/${this.currentUser.userId}`);
            const result = await response.json();
            
            if (result.success) {
                this.renderStatus(result);
            }
        } catch (error) {
            console.error('Load status error:', error);
        }
    }
    
    renderStatus(statusData) {
        // Update my status
        this.elements.myStatusAvatar.innerHTML = this.currentUser.avatar ? 
            `<img src="${this.currentUser.avatar}" alt="${this.currentUser.name}">` : 
            this.currentUser.name.charAt(0);
        
        // Render recent updates
        if (!statusData.recentStatus || statusData.recentStatus.length === 0) {
            this.elements.statusList.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-circle"></i>
                    <p>No status updates</p>
                </div>
            `;
            return;
        }
        
        this.elements.statusList.innerHTML = statusData.recentStatus.map(status => `
            <div class="status-item">
                <div class="avatar-img" style="border: 3px solid var(--status-ring);">
                    ${status.avatar ? `<img src="${status.avatar}" alt="${status.name}">` : status.name.charAt(0)}
                </div>
                <div class="status-item-info">
                    <div class="status-item-name">${status.name}</div>
                    <div class="status-item-time">${this.formatTimeAgo(status.statuses[0]?.createdAt)}</div>
                </div>
            </div>
        `).join('');
    }
    
    async addStatus(type = 'text') {
        if (type === 'camera') {
            this.openCamera();
        } else if (type === 'text') {
            const text = prompt('Enter your status text:');
            if (text) {
                await this.createStatus(text, 'text');
            }
        }
    }
    
    async createStatus(text, type, mediaFile = null) {
        const formData = new FormData();
        formData.append('userId', this.currentUser.userId);
        formData.append('text', text);
        formData.append('type', type);
        
        if (mediaFile) {
            formData.append('media', mediaFile);
        }
        
        try {
            const response = await fetch('/api/status', {
                method: 'POST',
                body: formData
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.showToast('Status updated');
                this.loadStatus();
            }
        } catch (error) {
            console.error('Create status error:', error);
            this.showToast('Failed to update status');
        }
    }
    
    // ==================== CALLS ====================
    async loadCalls() {
        try {
            const response = await fetch(`/api/calls/${this.currentUser.userId}`);
            const result = await response.json();
            
            if (result.success) {
                this.renderCalls(result.calls);
            }
        } catch (error) {
            console.error('Load calls error:', error);
        }
    }
    
    renderCalls(calls) {
        if (!calls || calls.length === 0) {
            this.elements.callsList.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-phone"></i>
                    <p>No call history</p>
                </div>
            `;
            return;
        }
        
        this.elements.callsList.innerHTML = calls.map(call => `
            <div class="call-item">
                <div class="avatar-img">
                    ${call.contact.avatar ? `<img src="${call.contact.avatar}" alt="${call.contact.name}">` : call.contact.name.charAt(0)}
                </div>
                <div class="call-info">
                    <div class="call-header">
                        <div class="call-name">${call.contact.name}</div>
                        <div class="call-time">${this.formatTime(call.timestamp)}</div>
                    </div>
                    <div class="call-details">
                        <span class="call-direction ${call.status}">
                            <i class="fas fa-${call.direction === 'incoming' ? 'arrow-down' : 'arrow-up'}"></i>
                            ${call.direction}
                        </span>
                        <span class="call-type">
                            <i class="fas fa-${call.type === 'audio' ? 'phone' : 'video'}"></i>
                            ${call.type}
                        </span>
                        ${call.duration ? `<span class="call-duration">${this.formatDuration(call.duration)}</span>` : ''}
                    </div>
                </div>
            </div>
        `).join('');
    }
    
    createCallLink() {
        const callLink = `https://whatsapp.com/call/${crypto.randomUUID()}`;
        navigator.clipboard.writeText(callLink).then(() => {
            this.showToast('Call link copied to clipboard');
        }).catch(() => {
            prompt('Copy this call link:', callLink);
        });
    }
    
    startNewCall() {
        this.showToast('Call feature coming soon');
    }
    
    startVoiceCall() {
        if (!this.currentChat) {
            this.showToast('Select a chat first');
            return;
        }
        
        if (this.socket) {
            // In a real app, you'd use WebRTC here
            this.showToast(`Calling ${this.currentChat.name}...`);
        }
    }
    
    startVideoCall() {
        if (!this.currentChat) {
            this.showToast('Select a chat first');
            return;
        }
        
        if (this.socket) {
            // In a real app, you'd use WebRTC here
            this.showToast(`Video calling ${this.currentChat.name}...`);
        }
    }
    
    // ==================== SETTINGS ====================
    showSettings() {
        this.elements.settingsPanel.style.display = 'flex';
        this.elements.mainApp.style.display = 'none';
        this.updateSettingsUI();
    }
    
    hideSettings() {
        this.elements.settingsPanel.style.display = 'none';
        this.elements.mainApp.style.display = 'flex';
    }
    
    updateSettingsUI() {
        // Update profile info
        this.elements.settingsName.textContent = this.currentUser.name;
        this.elements.settingsAbout.textContent = this.currentUser.about || "Hey there! I'm using WhatsApp";
        this.elements.settingsAvatar.innerHTML = this.currentUser.avatar ? 
            `<img src="${this.currentUser.avatar}" alt="${this.currentUser.name}">` : 
            this.currentUser.name.charAt(0);
        
        // Load settings from server
        this.loadUserSettings();
    }
    
    async loadUserSettings() {
        try {
            const response = await fetch(`/api/settings/${this.currentUser.userId}`);
            const result = await response.json();
            
            if (result.success) {
                const settings = result.settings;
                
                // Update toggle switches
                if (this.elements.enterToSend) {
                    this.elements.enterToSend.checked = settings.chat?.enterToSend !== false;
                }
                if (this.elements.mediaVisibility) {
                    this.elements.mediaVisibility.checked = settings.chat?.mediaVisibility !== false;
                }
                if (this.elements.messageNotifications) {
                    this.elements.messageNotifications.checked = settings.notification?.message !== false;
                }
                if (this.elements.soundToggle) {
                    this.elements.soundToggle.checked = settings.notification?.sound !== false;
                }
                if (this.elements.vibrationToggle) {
                    this.elements.vibrationToggle.checked = settings.notification?.vibration !== false;
                }
                
                // Update theme
                const theme = settings.theme || 'light';
                this.changeTheme(theme, false);
                
                // Update theme buttons
                this.elements.themeOptions.forEach(option => {
                    option.classList.toggle('active', option.dataset.theme === theme);
                });
            }
        } catch (error) {
            console.error('Load settings error:', error);
        }
    }
    
    async saveSettings() {
        const settings = {
            theme: document.querySelector('.theme-option.active')?.dataset.theme || 'light',
            chat: {
                enterToSend: this.elements.enterToSend?.checked || true,
                mediaVisibility: this.elements.mediaVisibility?.checked || true
            },
            notification: {
                message: this.elements.messageNotifications?.checked || true,
                sound: this.elements.soundToggle?.checked || true,
                vibration: this.elements.vibrationToggle?.checked || true
            }
        };
        
        try {
            const response = await fetch(`/api/settings/${this.currentUser.userId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ settings })
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.showToast('Settings saved');
            }
        } catch (error) {
            console.error('Save settings error:', error);
            this.showToast('Failed to save settings');
        }
    }
    
    changeTheme(theme, save = true) {
        document.documentElement.setAttribute('data-theme', theme);
        
        if (save) {
            this.saveSettings();
        }
    }
    
    // ==================== MEDIA & ATTACHMENTS ====================
    showAttachmentMenu(source) {
        this.elements.attachmentMenu.classList.add('active');
        this.attachmentSource = source;
    }
    
    hideAttachmentMenu() {
        this.elements.attachmentMenu.classList.remove('active');
    }
    
    handleAttachment(type) {
        this.hideAttachmentMenu();
        
        switch(type) {
            case 'camera':
                this.openCamera();
                break;
            case 'gallery':
                this.openGallery();
                break;
            case 'document':
                this.openDocumentPicker();
                break;
            case 'audio':
                this.startAudioRecording();
                break;
            case 'location':
                this.shareLocation();
                break;
            case 'contact':
                this.shareContact();
                break;
        }
    }
    
    openCamera() {
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            navigator.mediaDevices.getUserMedia({ video: true })
                .then(stream => {
                    this.showToast('Camera opened - implement photo capture');
                    // In a real app, you'd show camera preview and capture photo
                })
                .catch(error => {
                    console.error('Camera error:', error);
                    this.showToast('Camera access denied');
                });
        } else {
            this.showToast('Camera not available');
        }
    }
    
    openGallery() {
        this.elements.fileInput.accept = 'image/*,video/*';
        this.elements.fileInput.click();
    }
    
    openDocumentPicker() {
        this.elements.fileInput.accept = '.pdf,.doc,.docx,.txt,.zip';
        this.elements.fileInput.click();
    }
    
    async handleFileUpload(files) {
        if (!files.length || !this.currentChatId) return;
        
        const file = files[0];
        const formData = new FormData();
        formData.append('file', file);
        formData.append('userId', this.currentUser.userId);
        
        try {
            const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });
            
            const result = await response.json();
            
            if (result.success) {
                // Send as message
                const fileType = file.type.split('/')[0];
                const messageText = `Sent a ${fileType === 'image' ? 'photo' : 
                                    fileType === 'video' ? 'video' : 
                                    fileType === 'audio' ? 'audio' : 'document'}`;
                
                if (this.socket) {
                    this.socket.emit('send-message', {
                        chatId: this.currentChatId,
                        senderId: this.currentUser.userId,
                        text: messageText,
                        type: fileType,
                        file: result.file
                    });
                }
            }
        } catch (error) {
            console.error('Upload error:', error);
            this.showToast('Upload failed');
        }
    }
    
    startAudioRecording() {
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            navigator.mediaDevices.getUserMedia({ audio: true })
                .then(stream => {
                    this.mediaRecorder = new MediaRecorder(stream);
                    this.audioChunks = [];
                    
                    this.mediaRecorder.ondataavailable = (event) => {
                        this.audioChunks.push(event.data);
                    };
                    
                    this.mediaRecorder.onstop = () => {
                        const audioBlob = new Blob(this.audioChunks, { type: 'audio/wav' });
                        this.sendAudioMessage(audioBlob);
                        
                        // Stop all tracks
                        stream.getTracks().forEach(track => track.stop());
                    };
                    
                    this.mediaRecorder.start();
                    this.isRecording = true;
                    this.showToast('Recording... Click to stop');
                    
                    // Update button
                    const button = this.attachmentSource === 'main' ? 
                        this.elements.sendButton : this.elements.chatSendButton;
                    button.innerHTML = '<i class="fas fa-stop"></i>';
                    
                })
                .catch(error => {
                    console.error('Microphone error:', error);
                    this.showToast('Microphone access denied');
                });
        } else {
            this.showToast('Audio recording not available');
        }
    }
    
    stopRecording() {
        if (this.mediaRecorder && this.isRecording) {
            this.mediaRecorder.stop();
            this.isRecording = false;
            
            // Update button
            const button = this.attachmentSource === 'main' ? 
                this.elements.sendButton : this.elements.chatSendButton;
            button.innerHTML = '<i class="fas fa-microphone"></i>';
        }
    }
    
    async sendAudioMessage(audioBlob) {
        const audioFile = new File([audioBlob], 'voice-message.wav', { type: 'audio/wav' });
        await this.handleFileUpload([audioFile]);
    }
    
    shareLocation() {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    const { latitude, longitude } = position.coords;
                    
                    if (this.socket && this.currentChatId) {
                        this.socket.emit('send-message', {
                            chatId: this.currentChatId,
                            senderId: this.currentUser.userId,
                            text: 'Shared location',
                            type: 'location',
                            location: { latitude, longitude }
                        });
                    }
                },
                (error) => {
                    console.error('Geolocation error:', error);
                    this.showToast('Location access denied');
                }
            );
        } else {
            this.showToast('Geolocation not available');
        }
    }
    
    shareContact() {
        this.showToast('Contact sharing coming soon');
    }
    
    // ==================== UTILITIES ====================
    async loadUserData() {
        await Promise.all([
            this.loadChats(),
            this.loadContacts(),
            this.loadStatus(),
            this.loadCalls()
        ]);
    }
    
    handleUserStatus(data) {
        if (data.isOnline) {
            this.onlineUsers.add(data.userId);
        } else {
            this.onlineUsers.delete(data.userId);
        }
        
        // Update chat list
        this.chats = this.chats.map(chat => {
            const otherUserId = chat.participants?.find(p => p !== this.currentUser.userId);
            if (otherUserId === data.userId) {
                return { ...chat, isOnline: data.isOnline };
            }
            return chat;
        });
        
        // Update current chat status
        if (this.currentChat && this.currentChat.userId === data.userId) {
            this.currentChat.isOnline = data.isOnline;
            this.elements.chatStatusText.textContent = data.isOnline ? 'online' : 'offline';
        }
        
        // Re-render chats if needed
        if (this.elements.tabContents.chats.classList.contains('active')) {
            this.renderChats(this.chats);
        }
    }
    
    scrollToBottom() {
        setTimeout(() => {
            this.elements.messagesContainer.scrollTop = this.elements.messagesContainer.scrollHeight;
        }, 100);
    }
    
    showLoading(button) {
        button.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        button.disabled = true;
    }
    
    hideLoading(button, text) {
        button.innerHTML = text;
        button.disabled = false;
    }
    
    showToast(message, duration = 3000) {
        this.elements.toast.textContent = message;
        this.elements.toast.classList.add('active');
        
        setTimeout(() => {
            this.elements.toast.classList.remove('active');
        }, duration);
    }
    
    formatTime(date) {
        if (!date) return '';
        const d = new Date(date);
        const now = new Date();
        const diff = now - d;
        const dayDiff = Math.floor(diff / (1000 * 60 * 60 * 24));
        
        if (dayDiff === 0) {
            return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else if (dayDiff === 1) {
            return 'Yesterday';
        } else if (dayDiff < 7) {
            return d.toLocaleDateString([], { weekday: 'short' });
        } else {
            return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
        }
    }
    
    formatDate(date) {
        if (!date) return '';
        const d = new Date(date);
        const now = new Date();
        
        if (d.toDateString() === now.toDateString()) {
            return 'Today';
        }
        
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        
        if (d.toDateString() === yesterday.toDateString()) {
            return 'Yesterday';
        }
        
        return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
    }
    
    formatTimeAgo(date) {
        if (!date) return '';
        const d = new Date(date);
        const now = new Date();
        const diff = now - d;
        const minutes = Math.floor(diff / (1000 * 60));
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        
        if (minutes < 1) return 'Just now';
        if (minutes < 60) return `${minutes}m ago`;
        if (hours < 24) return `${hours}h ago`;
        if (days < 7) return `${days}d ago`;
        return this.formatDate(date);
    }
    
    formatDuration(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
    
    updateUserInfo() {
        // Update my status avatar
        this.elements.myStatusAvatar.innerHTML = this.currentUser.avatar ? 
            `<img src="${this.currentUser.avatar}" alt="${this.currentUser.name}">` : 
            this.currentUser.name.charAt(0);
    }
    
    // ==================== UNIMPLEMENTED FEATURES ====================
    showMoreOptions() {
        this.showToast('More options coming soon');
    }
    
    showChatMenu() {
        this.showToast('Chat options coming soon');
    }
    
    handleCallOffer(data) {
        // WebRTC call handling - implement in real app
        console.log('Call offer received:', data);
    }
    
    handleCallAnswer(data) {
        console.log('Call answer received:', data);
    }
    
    handleIceCandidate(data) {
        console.log('ICE candidate received:', data);
    }
    
    handleCallEnd(data) {
        console.log('Call ended:', data);
    }
}

// Initialize app when DOM is loaded
let app;
document.addEventListener('DOMContentLoaded', () => {
    app = new WhatsAppApp();
});

// Make app available globally
window.app = app;
