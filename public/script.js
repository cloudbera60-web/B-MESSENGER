// ===== B-MESSENGER MOBILE APP =====
// Mobile-first WhatsApp clone with native feel

class MessengerApp {
    constructor() {
        // App State
        this.socket = null;
        this.currentUser = null;
        this.currentChat = null;
        this.conversationId = null;
        this.contacts = [];
        this.chats = [];
        this.onlineUsers = new Set();
        this.isTyping = false;
        this.typingTimeout = null;
        
        // DOM Elements
        this.elements = {
            // Screens
            loadingScreen: document.getElementById('loading-screen'),
            loginScreen: document.getElementById('login-screen'),
            mainApp: document.getElementById('main-app'),
            chatScreen: document.getElementById('chat-screen'),
            
            // Login
            phoneInput: document.getElementById('phone-input'),
            nameInput: document.getElementById('name-input'),
            passwordInput: document.getElementById('password-input'),
            loginBtn: document.getElementById('login-btn'),
            
            // Header
            headerTitle: document.getElementById('header-title'),
            menuBtn: document.getElementById('menu-btn'),
            searchBtn: document.getElementById('search-btn'),
            moreBtn: document.getElementById('more-btn'),
            
            // Navigation
            navTabs: document.querySelectorAll('.nav-tab'),
            tabContents: {
                chats: document.getElementById('chats-tab'),
                status: document.getElementById('status-tab'),
                calls: document.getElementById('calls-tab')
            },
            
            // Search
            searchBar: document.getElementById('search-bar'),
            globalSearch: document.getElementById('global-search'),
            searchClear: document.getElementById('search-clear'),
            
            // Chats
            chatsList: document.getElementById('chats-list'),
            newChatFab: document.getElementById('new-chat-fab'),
            
            // Status
            myStatus: document.getElementById('my-status'),
            statusList: document.getElementById('status-list'),
            
            // Calls
            callsList: document.getElementById('calls-list'),
            createCallLink: document.getElementById('create-call-link'),
            
            // Chat Screen
            chatBackBtn: document.getElementById('chat-back-btn'),
            chatAvatar: document.getElementById('chat-avatar'),
            chatUserName: document.getElementById('chat-user-name'),
            chatUserStatus: document.getElementById('chat-user-status'),
            callBtn: document.getElementById('call-btn'),
            videoCallBtn: document.getElementById('video-call-btn'),
            chatMenuBtn: document.getElementById('chat-menu-btn'),
            
            // Messages
            messagesContainer: document.getElementById('messages-container'),
            typingIndicator: document.getElementById('typing-indicator'),
            
            // Inputs
            messageInput: document.getElementById('message-input'),
            sendButton: document.getElementById('send-button'),
            chatMessageInput: document.getElementById('chat-message-input'),
            chatSendButton: document.getElementById('chat-send-button'),
            attachBtn: document.getElementById('attach-btn'),
            emojiBtn: document.getElementById('emoji-btn'),
            chatAttachBtn: document.getElementById('chat-attach-btn'),
            chatEmojiBtn: document.getElementById('chat-emoji-btn'),
            
            // Modals
            newChatModal: document.getElementById('new-chat-modal'),
            closeNewChat: document.getElementById('close-new-chat'),
            contactSearch: document.getElementById('contact-search'),
            contactsList: document.getElementById('contacts-list'),
            
            // Side Menu
            sideMenu: document.getElementById('side-menu'),
            menuAvatar: document.getElementById('menu-avatar'),
            menuUserName: document.getElementById('menu-user-name'),
            menuUserStatus: document.getElementById('menu-user-status'),
            logoutBtn: document.getElementById('logout-btn'),
            
            // Action Menu
            messageActions: document.getElementById('message-actions'),
            
            // Toast
            toast: document.getElementById('toast')
        };
        
        // Initialize
        this.init();
    }
    
    // ===== INITIALIZATION =====
    init() {
        this.setupEventListeners();
        this.checkSavedSession();
    }
    
    setupEventListeners() {
        // Login
        this.elements.loginBtn.addEventListener('click', () => this.handleLogin());
        this.elements.passwordInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.handleLogin();
        });
        
        // Navigation
        this.elements.navTabs.forEach(tab => {
            tab.addEventListener('click', (e) => this.switchTab(e.currentTarget.dataset.tab));
        });
        
        // Header Actions
        this.elements.menuBtn.addEventListener('click', () => this.toggleSideMenu());
        this.elements.searchBtn.addEventListener('click', () => this.toggleSearch());
        this.elements.moreBtn.addEventListener('click', () => this.showMoreOptions());
        
        // Search
        this.elements.globalSearch.addEventListener('input', (e) => this.handleSearch(e.target.value));
        this.elements.searchClear.addEventListener('click', () => this.clearSearch());
        
        // Chat Actions
        this.elements.newChatFab.addEventListener('click', () => this.showNewChatModal());
        this.elements.closeNewChat.addEventListener('click', () => this.hideNewChatModal());
        this.elements.contactSearch.addEventListener('input', (e) => this.searchContacts(e.target.value));
        
        // Message Inputs
        this.elements.messageInput.addEventListener('input', (e) => this.handleInputChange(e.target, 'main'));
        this.elements.chatMessageInput.addEventListener('input', (e) => this.handleInputChange(e.target, 'chat'));
        
        this.elements.messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage('main');
        });
        
        this.elements.chatMessageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage('chat');
        });
        
        this.elements.sendButton.addEventListener('click', () => this.sendMessage('main'));
        this.elements.chatSendButton.addEventListener('click', () => this.sendMessage('chat'));
        
        this.elements.attachBtn.addEventListener('click', () => this.showAttachmentOptions('main'));
        this.elements.chatAttachBtn.addEventListener('click', () => this.showAttachmentOptions('chat'));
        
        // Chat Screen
        this.elements.chatBackBtn.addEventListener('click', () => this.closeChat());
        this.elements.callBtn.addEventListener('click', () => this.startCall('audio'));
        this.elements.videoCallBtn.addEventListener('click', () => this.startCall('video'));
        this.elements.chatMenuBtn.addEventListener('click', () => this.showChatOptions());
        
        // Side Menu
        this.elements.logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            this.logout();
        });
        
        // Modal Overlay
        this.elements.newChatModal.addEventListener('click', (e) => {
            if (e.target === this.elements.newChatModal) {
                this.hideNewChatModal();
            }
        });
        
        // Prevent body scroll when modal is open
        document.addEventListener('touchmove', (e) => {
            if (this.elements.newChatModal.classList.contains('active')) {
                e.preventDefault();
            }
        }, { passive: false });
    }
    
    // ===== AUTHENTICATION =====
    async handleLogin() {
        const phone = this.elements.phoneInput.value.trim();
        const name = this.elements.nameInput.value.trim();
        const password = this.elements.passwordInput.value;
        
        if (!phone || !password) {
            this.showToast('Phone and password are required');
            return;
        }
        
        if (password.length < 6) {
            this.showToast('Password must be at least 6 characters');
            return;
        }
        
        // Show loading on button
        const originalText = this.elements.loginBtn.innerHTML;
        this.elements.loginBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        this.elements.loginBtn.disabled = true;
        
        try {
            // Check if user exists (simplified for demo)
            // In real app, you'd check against your database
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: phone,
                    password: password
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                // Login successful
                this.currentUser = result.user;
                this.saveSession();
                this.showMainApp();
                this.initializeSocket();
                this.loadInitialData();
            } else {
                // Try registration
                await this.handleRegister(phone, name, password);
            }
            
        } catch (error) {
            console.error('Login error:', error);
            // For demo, create a user locally
            await this.createDemoUser(phone, name);
        } finally {
            this.elements.loginBtn.innerHTML = originalText;
            this.elements.loginBtn.disabled = false;
        }
    }
    
    async handleRegister(phone, name, password) {
        try {
            const response = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    phone,
                    name,
                    password
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.currentUser = result.user;
                this.saveSession();
                this.showMainApp();
                this.initializeSocket();
                this.loadInitialData();
            } else {
                this.showToast(result.error || 'Registration failed');
            }
        } catch (error) {
            console.error('Register error:', error);
            this.showToast('Network error. Please try again.');
        }
    }
    
    async createDemoUser(phone, name) {
        // Create demo user for testing
        this.currentUser = {
            userId: 'user_' + Date.now(),
            username: phone.replace(/\D/g, ''),
            name: name || 'User',
            phone: phone,
            avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(name || 'User')}&background=25D366&color=fff`,
            status: "Hey there! I'm using B-Messenger",
            isOnline: true
        };
        
        this.saveSession();
        this.showMainApp();
        this.initializeSocket();
        this.loadInitialData();
        
        // Create demo contacts
        this.createDemoContacts();
    }
    
    saveSession() {
        localStorage.setItem('bm_user', JSON.stringify(this.currentUser));
    }
    
    checkSavedSession() {
        const savedUser = localStorage.getItem('bm_user');
        if (savedUser) {
            try {
                this.currentUser = JSON.parse(savedUser);
                this.showMainApp();
                this.initializeSocket();
                this.loadInitialData();
                this.createDemoContacts(); // For demo
            } catch (e) {
                localStorage.removeItem('bm_user');
            }
        }
    }
    
    logout() {
        if (this.socket) {
            this.socket.disconnect();
        }
        
        this.currentUser = null;
        localStorage.removeItem('bm_user');
        
        this.hideSideMenu();
        this.elements.mainApp.style.display = 'none';
        this.elements.loginScreen.style.display = 'flex';
        
        // Reset form
        this.elements.phoneInput.value = '';
        this.elements.nameInput.value = '';
        this.elements.passwordInput.value = '';
    }
    
    // ===== UI MANAGEMENT =====
    showMainApp() {
        this.elements.loadingScreen.style.animation = 'fadeOut 0.5s ease forwards';
        setTimeout(() => {
            this.elements.loadingScreen.style.display = 'none';
            this.elements.loginScreen.style.display = 'none';
            this.elements.mainApp.style.display = 'flex';
            
            // Update user info in menu
            this.updateUserInfo();
            
            // Load chats
            this.loadChats();
        }, 500);
    }
    
    switchTab(tabName) {
        // Update active tab
        this.elements.navTabs.forEach(tab => {
            tab.classList.toggle('active', tab.dataset.tab === tabName);
        });
        
        // Update header title
        this.elements.headerTitle.textContent = tabName.charAt(0).toUpperCase() + tabName.slice(1);
        
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
        this.elements.searchBar.classList.toggle('active');
        if (this.elements.searchBar.classList.contains('active')) {
            this.elements.globalSearch.focus();
        }
    }
    
    hideSearch() {
        this.elements.searchBar.classList.remove('active');
        this.elements.globalSearch.value = '';
        this.elements.searchClear.classList.remove('active');
        this.handleSearch(''); // Reset chat list
    }
    
    handleSearch(query) {
        this.elements.searchClear.classList.toggle('active', query.length > 0);
        
        if (!query) {
            this.loadChats();
            return;
        }
        
        // Filter chats
        const filteredChats = this.chats.filter(chat => 
            chat.name.toLowerCase().includes(query.toLowerCase()) ||
            chat.lastMessage.text.toLowerCase().includes(query.toLowerCase())
        );
        
        this.renderChats(filteredChats);
    }
    
    clearSearch() {
        this.elements.globalSearch.value = '';
        this.elements.searchClear.classList.remove('active');
        this.handleSearch('');
        this.elements.globalSearch.focus();
    }
    
    toggleSideMenu() {
        this.elements.sideMenu.classList.toggle('active');
        document.body.style.overflow = this.elements.sideMenu.classList.contains('active') ? 'hidden' : '';
    }
    
    hideSideMenu() {
        this.elements.sideMenu.classList.remove('active');
        document.body.style.overflow = '';
    }
    
    showNewChatModal() {
        this.elements.newChatModal.classList.add('active');
        this.loadContacts();
    }
    
    hideNewChatModal() {
        this.elements.newChatModal.classList.remove('active');
        this.elements.contactSearch.value = '';
        this.searchContacts('');
    }
    
    searchContacts(query) {
        if (!query) {
            this.loadContacts();
            return;
        }
        
        const filteredContacts = this.contacts.filter(contact => 
            contact.name.toLowerCase().includes(query.toLowerCase()) ||
            contact.phone.includes(query)
        );
        
        this.renderContacts(filteredContacts);
    }
    
    // ===== CHAT MANAGEMENT =====
    async loadChats() {
        if (!this.currentUser) return;
        
        // Show loading shimmer
        this.elements.chatsList.innerHTML = `
            ${Array(5).fill().map(() => `
                <div class="chat-item loading-shimmer">
                    <div class="chat-avatar">
                        <div class="avatar-img" style="background: transparent;"></div>
                    </div>
                    <div class="chat-info">
                        <div class="chat-header">
                            <div class="chat-name" style="background: var(--border-color); height: 16px; width: 60%; border-radius: 8px;"></div>
                            <div class="chat-time" style="background: var(--border-color); height: 12px; width: 40px; border-radius: 6px;"></div>
                        </div>
                        <div class="chat-preview">
                            <div class="chat-message" style="background: var(--border-color); height: 14px; width: 80%; border-radius: 7px;"></div>
                        </div>
                    </div>
                </div>
            `).join('')}
        `;
        
        try {
            if (this.socket) {
                // Load from server
                const response = await fetch(`/api/chats/${this.currentUser.userId}`);
                const result = await response.json();
                
                if (result.success) {
                    this.chats = result.chats;
                }
            }
            
            // If no chats from server or for demo, use local chats
            if (!this.chats || this.chats.length === 0) {
                this.createDemoChats();
            }
            
            this.renderChats(this.chats);
            
        } catch (error) {
            console.error('Load chats error:', error);
            this.createDemoChats();
            this.renderChats(this.chats);
        }
    }
    
    renderChats(chats) {
        if (chats.length === 0) {
            this.elements.chatsList.innerHTML = `
                <div style="text-align: center; padding: 40px 20px; color: var(--text-secondary);">
                    <i class="fas fa-comments" style="font-size: 48px; margin-bottom: 16px; opacity: 0.5;"></i>
                    <p>No conversations yet</p>
                    <p style="font-size: 14px; margin-top: 8px;">Start a new chat to begin messaging!</p>
                </div>
            `;
            return;
        }
        
        this.elements.chatsList.innerHTML = chats.map(chat => `
            <div class="chat-item" data-chat-id="${chat.id}" data-user-id="${chat.userId}">
                <div class="chat-avatar" onclick="event.stopPropagation(); app.viewUserProfile('${chat.userId}')">
                    <div class="avatar-img">
                        ${chat.avatar ? `<img src="${chat.avatar}" alt="${chat.name}">` : chat.name.charAt(0)}
                    </div>
                    ${chat.isOnline ? '<div class="online-dot"></div>' : ''}
                </div>
                <div class="chat-info" onclick="app.openChat('${chat.userId}', '${chat.name}', '${chat.avatar}')">
                    <div class="chat-header">
                        <div class="chat-name">${chat.name}</div>
                        <div class="chat-time">${this.formatTime(chat.timestamp)}</div>
                    </div>
                    <div class="chat-preview">
                        <div class="chat-message">
                            ${chat.lastMessage.sender === 'You' ? '<span style="color: var(--text-muted);">You: </span>' : ''}
                            ${chat.lastMessage.text}
                        </div>
                        ${chat.unreadCount > 0 ? `<div class="chat-badge">${chat.unreadCount}</div>` : ''}
                    </div>
                </div>
            </div>
        `).join('');
    }
    
    openChat(userId, userName, userAvatar) {
        this.currentChat = { userId, userName, userAvatar };
        this.conversationId = [this.currentUser.userId, userId].sort().join('_');
        
        // Update chat header
        this.elements.chatUserName.textContent = userName;
        this.elements.chatAvatar.innerHTML = `
            <div class="avatar-img">
                ${userAvatar ? `<img src="${userAvatar}" alt="${userName}">` : userName.charAt(0)}
            </div>
        `;
        
        // Show chat screen
        this.elements.chatScreen.classList.add('active');
        
        // Load messages
        this.loadMessages();
        
        // Join socket room
        if (this.socket) {
            this.socket.emit('join-chat', {
                conversationId: this.conversationId,
                userId: this.currentUser.userId
            });
        }
    }
    
    closeChat() {
        this.elements.chatScreen.classList.remove('active');
        this.currentChat = null;
        this.conversationId = null;
        this.elements.messagesContainer.innerHTML = '';
        this.elements.chatMessageInput.value = '';
        this.handleInputChange(this.elements.chatMessageInput, 'chat');
    }
    
    async loadMessages() {
        if (!this.currentChat || !this.conversationId) return;
        
        this.elements.messagesContainer.innerHTML = `
            <div class="typing-indicator" id="typing-indicator">
                <div class="typing-dots">
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                </div>
            </div>
        `;
        
        try {
            let messages = [];
            
            if (this.socket) {
                // Load from server
                const response = await fetch(`/api/messages/${this.conversationId}?userId=${this.currentUser.userId}`);
                const result = await response.json();
                
                if (result.success) {
                    messages = result.messages;
                }
            }
            
            // If no messages from server, create demo messages
            if (messages.length === 0) {
                messages = this.createDemoMessages();
            }
            
            this.renderMessages(messages);
            
        } catch (error) {
            console.error('Load messages error:', error);
            const demoMessages = this.createDemoMessages();
            this.renderMessages(demoMessages);
        }
    }
    
    renderMessages(messages) {
        if (messages.length === 0) {
            this.elements.messagesContainer.innerHTML = `
                <div style="text-align: center; padding: 40px 20px; color: var(--text-secondary);">
                    <i class="fas fa-comment" style="font-size: 48px; margin-bottom: 16px; opacity: 0.5;"></i>
                    <p>No messages yet</p>
                    <p style="font-size: 14px; margin-top: 8px;">Send a message to start the conversation!</p>
                </div>
                <div class="typing-indicator" id="typing-indicator">
                    <div class="typing-dots">
                        <div class="typing-dot"></div>
                        <div class="typing-dot"></div>
                        <div class="typing-dot"></div>
                    </div>
                </div>
            `;
            return;
        }
        
        // Group messages by date
        let currentDate = null;
        let html = '';
        
        messages.forEach(message => {
            const messageDate = this.formatDate(message.time);
            
            if (messageDate !== currentDate) {
                currentDate = messageDate;
                html += `
                    <div class="message-date" style="text-align: center; margin: 16px 0;">
                        <span style="background: rgba(0,0,0,0.1); color: var(--text-secondary); font-size: 12px; padding: 4px 12px; border-radius: 12px;">
                            ${currentDate}
                        </span>
                    </div>
                `;
            }
            
            html += `
                <div class="message ${message.isSent ? 'sent' : 'received'}" data-message-id="${message.id}">
                    <div class="message-text">${message.text}</div>
                    <div class="message-time">
                        ${this.formatTime(message.time)}
                        ${message.isSent ? `
                            <span class="message-status">
                                <span class="${message.isRead ? 'read' : message.isDelivered ? 'delivered' : 'sent'}">
                                    ${message.isRead ? '✓✓' : message.isDelivered ? '✓✓' : '✓'}
                                </span>
                            </span>
                        ` : ''}
                    </div>
                </div>
            `;
        });
        
        // Add typing indicator at the end
        html += `
            <div class="typing-indicator" id="typing-indicator">
                <div class="typing-dots">
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                </div>
            </div>
        `;
        
        this.elements.messagesContainer.innerHTML = html;
        this.scrollToBottom();
    }
    
    addMessage(text, isSent = true, isRead = false, isDelivered = false) {
        const message = {
            id: 'msg_' + Date.now(),
            text,
            isSent,
            time: new Date(),
            isRead,
            isDelivered
        };
        
        // Create message element
        const messageEl = document.createElement('div');
        messageEl.className = `message ${isSent ? 'sent' : 'received'}`;
        messageEl.dataset.messageId = message.id;
        messageEl.innerHTML = `
            <div class="message-text">${text}</div>
            <div class="message-time">
                ${this.formatTime(message.time)}
                ${isSent ? `
                    <span class="message-status">
                        <span class="${isRead ? 'read' : isDelivered ? 'delivered' : 'sent'}">
                            ${isRead ? '✓✓' : isDelivered ? '✓✓' : '✓'}
                        </span>
                    </span>
                ` : ''}
            </div>
        `;
        
        // Insert before typing indicator
        const typingIndicator = this.elements.typingIndicator;
        this.elements.messagesContainer.insertBefore(messageEl, typingIndicator);
        
        // Scroll to bottom
        this.scrollToBottom();
        
        return message;
    }
    
    sendMessage(source) {
        let input, button;
        
        if (source === 'main') {
            input = this.elements.messageInput;
            button = this.elements.sendButton;
        } else {
            input = this.elements.chatMessageInput;
            button = this.elements.chatSendButton;
        }
        
        const text = input.value.trim();
        if (!text || !this.currentChat) return;
        
        // Add message locally
        const message = this.addMessage(text, true, false, false);
        
        // Send via socket
        if (this.socket) {
            this.socket.emit('send-message', {
                senderId: this.currentUser.userId,
                receiverId: this.currentChat.userId,
                text: text
            }, (response) => {
                if (response && response.error) {
                    console.error('Send failed:', response.error);
                    // Show error
                    this.showToast('Failed to send message');
                } else {
                    // Update message status
                    const messageEl = document.querySelector(`[data-message-id="${message.id}"]`);
                    if (messageEl) {
                        const statusEl = messageEl.querySelector('.message-status span');
                        if (statusEl) {
                            statusEl.className = 'delivered';
                            statusEl.textContent = '✓✓';
                        }
                    }
                    
                    // Update chat list
                    this.updateChatList(this.currentChat.userId, text);
                }
            });
        } else {
            // For demo without socket
            setTimeout(() => {
                const messageEl = document.querySelector(`[data-message-id="${message.id}"]`);
                if (messageEl) {
                    const statusEl = messageEl.querySelector('.message-status span');
                    if (statusEl) {
                        statusEl.className = 'delivered';
                        statusEl.textContent = '✓✓';
                    }
                }
                
                // Simulate reply after 1 second
                setTimeout(() => {
                    this.addMessage("Thanks for your message!", false, false, true);
                }, 1000);
                
                // Update chat list
                this.updateChatList(this.currentChat.userId, text);
            }, 500);
        }
        
        // Clear input
        input.value = '';
        this.handleInputChange(input, source);
        
        // Stop typing indicator
        if (this.isTyping) {
            this.sendTyping(false);
        }
    }
    
    updateChatList(userId, lastMessage) {
        // Update the chat in our local list
        const chatIndex = this.chats.findIndex(chat => chat.userId === userId);
        if (chatIndex !== -1) {
            this.chats[chatIndex].lastMessage = {
                text: lastMessage,
                sender: 'You',
                time: new Date()
            };
            this.chats[chatIndex].timestamp = new Date();
            this.chats[chatIndex].unreadCount = 0;
            
            // Move to top
            const chat = this.chats.splice(chatIndex, 1)[0];
            this.chats.unshift(chat);
            
            // Re-render if on chats tab
            if (this.elements.tabContents.chats.classList.contains('active')) {
                this.renderChats(this.chats);
            }
        }
    }
    
    handleInputChange(input, source) {
        const hasText = input.value.trim().length > 0;
        let button;
        
        if (source === 'main') {
            button = this.elements.sendButton;
        } else {
            button = this.elements.chatSendButton;
        }
        
        // Update button icon
        if (hasText) {
            button.innerHTML = '<i class="fas fa-paper-plane"></i>';
            button.style.background = 'var(--whatsapp-green)';
        } else {
            button.innerHTML = '<i class="fas fa-microphone"></i>';
            button.style.background = 'var(--whatsapp-green)';
        }
        
        // Handle typing indicators
        if (source === 'chat' && this.currentChat && this.socket) {
            if (hasText && !this.isTyping) {
                this.sendTyping(true);
                this.isTyping = true;
            } else if (!hasText && this.isTyping) {
                this.sendTyping(false);
                this.isTyping = false;
            }
            
            // Clear previous timeout
            clearTimeout(this.typingTimeout);
            
            // Set timeout to stop typing indicator
            if (hasText) {
                this.typingTimeout = setTimeout(() => {
                    if (this.isTyping) {
                        this.sendTyping(false);
                        this.isTyping = false;
                    }
                }, 2000);
            }
        }
    }
    
    sendTyping(isTyping) {
        if (!this.socket || !this.currentChat || !this.conversationId) return;
        
        this.socket.emit('typing', {
            conversationId: this.conversationId,
            userId: this.currentUser.userId,
            isTyping: isTyping
        });
    }
    
    // ===== CONTACTS =====
    async loadContacts() {
        // For demo, create contacts if none exist
        if (this.contacts.length === 0) {
            this.createDemoContacts();
        }
        
        this.renderContacts(this.contacts);
    }
    
    renderContacts(contacts) {
        if (contacts.length === 0) {
            this.elements.contactsList.innerHTML = `
                <div style="text-align: center; padding: 40px 20px; color: var(--text-secondary);">
                    <i class="fas fa-users" style="font-size: 48px; margin-bottom: 16px; opacity: 0.5;"></i>
                    <p>No contacts found</p>
                </div>
            `;
            return;
        }
        
        this.elements.contactsList.innerHTML = contacts.map(contact => `
            <div class="chat-item" onclick="app.startChatWithContact('${contact.userId}', '${contact.name}', '${contact.avatar}')">
                <div class="chat-avatar">
                    <div class="avatar-img">
                        ${contact.avatar ? `<img src="${contact.avatar}" alt="${contact.name}">` : contact.name.charAt(0)}
                    </div>
                    ${contact.isOnline ? '<div class="online-dot"></div>' : ''}
                </div>
                <div class="chat-info">
                    <div class="chat-header">
                        <div class="chat-name">${contact.name}</div>
                    </div>
                    <div class="chat-preview">
                        <div class="chat-message">${contact.status || 'Hey there! I\'m using B-Messenger'}</div>
                    </div>
                </div>
            </div>
        `).join('');
    }
    
    startChatWithContact(userId, userName, userAvatar) {
        this.hideNewChatModal();
        
        // Check if chat already exists
        const existingChat = this.chats.find(chat => chat.userId === userId);
        if (existingChat) {
            this.openChat(userId, userName, userAvatar);
        } else {
            // Create new chat
            const newChat = {
                id: [this.currentUser.userId, userId].sort().join('_'),
                userId,
                name: userName,
                avatar: userAvatar,
                lastMessage: {
                    text: '',
                    sender: '',
                    time: new Date()
                },
                unreadCount: 0,
                timestamp: new Date(),
                isOnline: true
            };
            
            this.chats.unshift(newChat);
            this.renderChats(this.chats);
            this.openChat(userId, userName, userAvatar);
        }
    }
    
    // ===== STATUS =====
    async loadStatus() {
        // For demo, create status updates
        this.renderStatus(this.createDemoStatus());
    }
    
    renderStatus(statusData) {
        const { myStatus, recentUpdates } = statusData;
        
        // Update my status
        this.elements.myStatus.querySelector('.avatar-img').innerHTML = 
            myStatus.avatar ? `<img src="${myStatus.avatar}" alt="${myStatus.name}">` : myStatus.name.charAt(0);
        this.elements.myStatus.querySelector('.status-name').textContent = myStatus.name;
        this.elements.myStatus.querySelector('.status-time').textContent = 
            myStatus.lastUpdated ? `Last updated ${this.formatTimeAgo(myStatus.lastUpdated)}` : 'Tap to add status update';
        
        // Render recent updates
        if (recentUpdates.length === 0) {
            this.elements.statusList.innerHTML = `
                <div style="text-align: center; padding: 40px 20px; color: var(--text-secondary);">
                    <i class="fas fa-circle" style="font-size: 48px; margin-bottom: 16px; opacity: 0.5;"></i>
                    <p>No status updates</p>
                </div>
            `;
            return;
        }
        
        this.elements.statusList.innerHTML = recentUpdates.map(status => `
            <div class="status-item" onclick="app.viewStatus('${status.userId}')">
                <div class="chat-avatar">
                    <div class="avatar-img" style="border: 3px solid var(--whatsapp-green);">
                        ${status.avatar ? `<img src="${status.avatar}" alt="${status.name}">` : status.name.charAt(0)}
                    </div>
                </div>
                <div class="status-info">
                    <div class="status-name">${status.name}</div>
                    <div class="status-time">${this.formatTimeAgo(status.timestamp)}</div>
                </div>
            </div>
        `).join('');
    }
    
    // ===== CALLS =====
    async loadCalls() {
        // For demo, create call history
        this.renderCalls(this.createDemoCalls());
    }
    
    renderCalls(calls) {
        if (calls.length === 0) {
            this.elements.callsList.innerHTML = `
                <div style="text-align: center; padding: 40px 20px; color: var(--text-secondary);">
                    <i class="fas fa-phone" style="font-size: 48px; margin-bottom: 16px; opacity: 0.5;"></i>
                    <p>No call history</p>
                </div>
            `;
            return;
        }
        
        this.elements.callsList.innerHTML = calls.map(call => `
            <div class="call-item" onclick="app.startCall('${call.type}', '${call.contact.userId}')">
                <div class="chat-avatar">
                    <div class="avatar-img">
                        ${call.contact.avatar ? `<img src="${call.contact.avatar}" alt="${call.contact.name}">` : call.contact.name.charAt(0)}
                    </div>
                </div>
                <div class="call-info">
                    <div class="call-header">
                        <div class="call-name">${call.contact.name}</div>
                        <div class="call-time">${this.formatTime(call.timestamp)}</div>
                    </div>
                    <div class="call-details">
                        <span class="call-direction ${call.status}">
                            <i class="fas fa-${call.direction === 'incoming' ? 'arrow-down' : 'arrow-up'}"></i>
                            ${call.direction === 'incoming' ? 'Incoming' : 'Outgoing'}
                        </span>
                        <span class="call-type">
                            <i class="fas fa-${call.type === 'audio' ? 'phone' : 'video'}"></i>
                            ${call.type === 'audio' ? 'Audio' : 'Video'}
                        </span>
                        ${call.duration ? `<span>• ${this.formatCallDuration(call.duration)}</span>` : ''}
                    </div>
                </div>
            </div>
        `).join('');
    }
    
    // ===== SOCKET.IO =====
    initializeSocket() {
        if (!this.currentUser) return;
        
        this.socket = io();
        
        this.socket.on('connect', () => {
            console.log('Connected to server');
            
            // Notify server user is online
            this.socket.emit('user-online', {
                userId: this.currentUser.userId,
                username: this.currentUser.username
            });
        });
        
        this.socket.on('online-users', (users) => {
            this.onlineUsers = new Set(users);
            this.updateOnlineStatus();
        });
        
        this.socket.on('user-status-changed', (data) => {
            if (data.isOnline) {
                this.onlineUsers.add(data.username);
            } else {
                this.onlineUsers.delete(data.username);
            }
            this.updateOnlineStatus();
        });
        
        this.socket.on('new-message', (message) => {
            if (this.currentChat && message.senderId === this.currentChat.userId) {
                // Add message to current chat
                this.addMessage(message.text, false, true, true);
                
                // Update typing indicator
                if (message.isTyping) {
                    this.showTypingIndicator();
                }
            }
            
            // Update chat list
            this.updateChatList(message.senderId, message.text);
        });
        
        this.socket.on('message-delivered', (data) => {
            // Update message status
            const messageEl = document.querySelector(`[data-message-id="${data.messageId}"]`);
            if (messageEl) {
                const statusEl = messageEl.querySelector('.message-status span');
                if (statusEl) {
                    statusEl.className = 'delivered';
                    statusEl.textContent = '✓✓';
                }
            }
        });
        
        this.socket.on('message-read', (data) => {
            // Update message status
            const messageEl = document.querySelector(`[data-message-id="${data.messageId}"]`);
            if (messageEl) {
                const statusEl = messageEl.querySelector('.message-status span');
                if (statusEl) {
                    statusEl.className = 'read';
                    statusEl.textContent = '✓✓';
                }
            }
        });
        
        this.socket.on('user-typing', (data) => {
            if (this.currentChat && data.userId === this.currentChat.userId) {
                if (data.isTyping) {
                    this.showTypingIndicator();
                } else {
                    this.hideTypingIndicator();
                }
            }
        });
        
        this.socket.on('chat-updated', (data) => {
            // Refresh chat list
            this.loadChats();
        });
        
        this.socket.on('disconnect', () => {
            console.log('Disconnected from server');
        });
    }
    
    // ===== UTILITIES =====
    updateUserInfo() {
        if (!this.currentUser) return;
        
        this.elements.menuAvatar.innerHTML = `
            <div class="avatar-img">
                ${this.currentUser.avatar ? `<img src="${this.currentUser.avatar}" alt="${this.currentUser.name}">` : this.currentUser.name.charAt(0)}
            </div>
        `;
        
        this.elements.menuUserName.textContent = this.currentUser.name;
        this.elements.menuUserStatus.textContent = this.currentUser.status || 'Online';
    }
    
    updateOnlineStatus() {
        // Update online status in chat list
        document.querySelectorAll('.chat-item').forEach(item => {
            const userId = item.dataset.userId;
            if (userId) {
                const onlineDot = item.querySelector('.online-dot');
                if (onlineDot) {
                    // For demo, we'll check if user is in our onlineUsers set
                    // In real app, you'd check against actual online status
                    onlineDot.style.display = this.onlineUsers.has(userId) ? 'block' : 'none';
                }
            }
        });
    }
    
    showTypingIndicator() {
        this.elements.typingIndicator.classList.add('active');
        
        // Auto-hide after 3 seconds
        setTimeout(() => {
            this.hideTypingIndicator();
        }, 3000);
    }
    
    hideTypingIndicator() {
        this.elements.typingIndicator.classList.remove('active');
    }
    
    scrollToBottom() {
        setTimeout(() => {
            this.elements.messagesContainer.scrollTop = this.elements.messagesContainer.scrollHeight;
        }, 100);
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
    
    formatCallDuration(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
    
    // ===== DEMO DATA (For testing without backend) =====
    createDemoContacts() {
        this.contacts = [
            {
                userId: 'contact_1',
                name: 'John Doe',
                phone: '+1234567890',
                avatar: 'https://ui-avatars.com/api/?name=John+Doe&background=0088cc&color=fff',
                status: 'Available',
                isOnline: true
            },
            {
                userId: 'contact_2',
                name: 'Jane Smith',
                phone: '+0987654321',
                avatar: 'https://ui-avatars.com/api/?name=Jane+Smith&background=25D366&color=fff',
                status: 'At work',
                isOnline: false
            },
            {
                userId: 'contact_3',
                name: 'Mike Johnson',
                phone: '+1122334455',
                avatar: 'https://ui-avatars.com/api/?name=Mike+Johnson&background=34B7F1&color=fff',
                status: 'Hey there! I\'m using B-Messenger',
                isOnline: true
            },
            {
                userId: 'contact_4',
                name: 'Sarah Williams',
                phone: '+5566778899',
                avatar: 'https://ui-avatars.com/api/?name=Sarah+Williams&background=FF9500&color=fff',
                status: 'Busy',
                isOnline: true
            },
            {
                userId: 'contact_5',
                name: 'Alex Brown',
                phone: '+6677889900',
                avatar: 'https://ui-avatars.com/api/?name=Alex+Brown&background=5856D6&color=fff',
                status: 'Available for chat',
                isOnline: false
            }
        ];
    }
    
    createDemoChats() {
        this.chats = [
            {
                id: 'chat_1',
                userId: 'contact_1',
                name: 'John Doe',
                avatar: 'https://ui-avatars.com/api/?name=John+Doe&background=0088cc&color=fff',
                lastMessage: {
                    text: 'See you tomorrow!',
                    sender: 'John Doe',
                    time: new Date(Date.now() - 2 * 60 * 60 * 1000) // 2 hours ago
                },
                unreadCount: 2,
                timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000),
                isOnline: true
            },
            {
                id: 'chat_2',
                userId: 'contact_2',
                name: 'Jane Smith',
                avatar: 'https://ui-avatars.com/api/?name=Jane+Smith&background=25D366&color=fff',
                lastMessage: {
                    text: 'Thanks for the help!',
                    sender: 'You',
                    time: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000) // 1 day ago
                },
                unreadCount: 0,
                timestamp: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
                isOnline: false
            },
            {
                id: 'chat_3',
                userId: 'contact_3',
                name: 'Mike Johnson',
                avatar: 'https://ui-avatars.com/api/?name=Mike+Johnson&background=34B7F1&color=fff',
                lastMessage: {
                    text: 'Meeting at 3 PM',
                    sender: 'Mike Johnson',
                    time: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) // 3 days ago
                },
                unreadCount: 0,
                timestamp: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
                isOnline: true
            }
        ];
    }
    
    createDemoMessages() {
        return [
            {
                id: 'msg_1',
                text: 'Hey there! How are you doing?',
                isSent: false,
                time: new Date(Date.now() - 2 * 60 * 60 * 1000),
                isRead: true,
                isDelivered: true
            },
            {
                id: 'msg_2',
                text: 'I\'m doing great! Just finished work.',
                isSent: true,
                time: new Date(Date.now() - 1.5 * 60 * 60 * 1000),
                isRead: true,
                isDelivered: true
            },
            {
                id: 'msg_3',
                text: 'That\'s awesome! Want to grab coffee tomorrow?',
                isSent: false,
                time: new Date(Date.now() - 1 * 60 * 60 * 1000),
                isRead: true,
                isDelivered: true
            },
            {
                id: 'msg_4',
                text: 'Sure, that sounds perfect! What time works for you?',
                isSent: true,
                time: new Date(Date.now() - 0.5 * 60 * 60 * 1000),
                isRead: true,
                isDelivered: true
            }
        ];
    }
    
    createDemoStatus() {
        return {
            myStatus: {
                userId: this.currentUser?.userId || 'user_1',
                name: this.currentUser?.name || 'You',
                avatar: this.currentUser?.avatar,
                lastUpdated: new Date(Date.now() - 6 * 60 * 60 * 1000)
            },
            recentUpdates: [
                {
                    userId: 'contact_1',
                    name: 'John Doe',
                    avatar: 'https://ui-avatars.com/api/?name=John+Doe&background=0088cc&color=fff',
                    timestamp: new Date(Date.now() - 1 * 60 * 60 * 1000)
                },
                {
                    userId: 'contact_3',
                    name: 'Mike Johnson',
                    avatar: 'https://ui-avatars.com/api/?name=Mike+Johnson&background=34B7F1&color=fff',
                    timestamp: new Date(Date.now() - 3 * 60 * 60 * 1000)
                },
                {
                    userId: 'contact_4',
                    name: 'Sarah Williams',
                    avatar: 'https://ui-avatars.com/api/?name=Sarah+Williams&background=FF9500&color=fff',
                    timestamp: new Date(Date.now() - 8 * 60 * 60 * 1000)
                }
            ]
        };
    }
    
    createDemoCalls() {
        return [
            {
                id: 'call_1',
                type: 'audio',
                direction: 'incoming',
                status: 'answered',
                duration: 125,
                timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000),
                contact: {
                    userId: 'contact_1',
                    name: 'John Doe',
                    avatar: 'https://ui-avatars.com/api/?name=John+Doe&background=0088cc&color=fff'
                }
            },
            {
                id: 'call_2',
                type: 'video',
                direction: 'outgoing',
                status: 'answered',
                duration: 305,
                timestamp: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
                contact: {
                    userId: 'contact_2',
                    name: 'Jane Smith',
                    avatar: 'https://ui-avatars.com/api/?name=Jane+Smith&background=25D366&color=fff'
                }
            },
            {
                id: 'call_3',
                type: 'audio',
                direction: 'incoming',
                status: 'missed',
                duration: 0,
                timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
                contact: {
                    userId: 'contact_3',
                    name: 'Mike Johnson',
                    avatar: 'https://ui-avatars.com/api/?name=Mike+Johnson&background=34B7F1&color=fff'
                }
            }
        ];
    }
    
    // ===== UNIMPLEMENTED FEATURES (Placeholders) =====
    viewUserProfile(userId) {
        this.showToast('User profile feature coming soon');
    }
    
    showMoreOptions() {
        this.showToast('More options feature coming soon');
    }
    
    showAttachmentOptions(source) {
        this.showToast('Attachment feature coming soon');
    }
    
    startCall(type, userId = null) {
        if (type === 'audio' || type === 'video') {
            this.showToast(`${type === 'audio' ? 'Audio' : 'Video'} call feature coming soon`);
        }
    }
    
    showChatOptions() {
        this.showToast('Chat options feature coming soon');
    }
    
    viewStatus(userId) {
        this.showToast('Status viewer feature coming soon');
    }
    
    loadInitialData() {
        this.loadChats();
        this.loadContacts();
    }
}

// Initialize the app when DOM is loaded
let app;
document.addEventListener('DOMContentLoaded', () => {
    app = new MessengerApp();
});

// Make app available globally for inline onclick handlers
window.app = app;
