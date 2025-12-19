/**
 * WhatsApp OTP Sender using Baileys
 * Production-grade implementation following WhatsApp patterns
 */

const { default: makeWASocket, useSingleFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

// Developer numbers for OTP delivery
const DEVELOPER_NUMBERS = ['254743982206', '254116763755'];
const ACTIVE_NUMBER = DEVELOPER_NUMBERS[0]; // Use first number as primary

class WhatsAppOTPSender {
    constructor() {
        this.socket = null;
        this.authState = null;
        this.isConnected = false;
        this.connectionPromise = null;
        this.reconnectAttempts = 0;
        this.MAX_RECONNECT_ATTEMPTS = 5;
        
        // Auth state file for persistent connection
        this.authStateFile = path.join(__dirname, 'baileys_auth.json');
    }

    /**
     * Initialize WhatsApp connection with persistent auth state
     */
    async initialize() {
        if (this.connectionPromise) {
            return this.connectionPromise;
        }

        this.connectionPromise = (async () => {
            try {
                const { state, saveState } = await useSingleFileAuthState(this.authStateFile);
                this.authState = { state, saveState };

                this.socket = makeWASocket({
                    auth: state,
                    logger: pino({ level: 'silent' }), // Minimal logging in production
                    printQRInTerminal: false, // We don't need QR for bot accounts
                    browser: ['B-Messenger OTP', 'Chrome', '1.0.0'],
                });

                // Set up event handlers
                this.setupEventHandlers(saveState);

                // Wait for connection
                await new Promise((resolve) => {
                    const checkConnection = () => {
                        if (this.isConnected) {
                            resolve();
                        } else {
                            setTimeout(checkConnection, 100);
                        }
                    };
                    checkConnection();
                });

                console.log('✅ Baileys WhatsApp connection established');
                return true;
            } catch (error) {
                console.error('❌ Failed to initialize WhatsApp connection:', error);
                this.connectionPromise = null;
                throw error;
            }
        })();

        return this.connectionPromise;
    }

    /**
     * Set up socket event handlers
     */
    setupEventHandlers(saveState) {
        this.socket.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect } = update;
            
            if (connection === 'close') {
                this.isConnected = false;
                const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
                
                if (shouldReconnect && this.reconnectAttempts < this.MAX_RECONNECT_ATTEMPTS) {
                    this.reconnectAttempts++;
                    console.log(`🔄 Reconnecting WhatsApp (attempt ${this.reconnectAttempts})...`);
                    setTimeout(() => this.initialize(), 2000);
                } else {
                    console.error('❌ WhatsApp connection closed permanently');
                    this.cleanup();
                }
            } else if (connection === 'open') {
                this.isConnected = true;
                this.reconnectAttempts = 0;
                console.log('✅ WhatsApp connection opened');
            }
        });

        this.socket.ev.on('creds.update', saveState);
    }

    /**
     * Send OTP via WhatsApp message (WhatsApp-style delivery)
     * @param {string} phone - Recipient phone in E.164 format
     * @param {string} otp - 6-digit OTP code
     * @returns {Promise<boolean>} Success status
     */
    async sendOTP(phone, otp) {
        try {
            // Ensure connection
            if (!this.isConnected) {
                await this.initialize();
            }

            // Validate phone format
            if (!this.isValidE164(phone)) {
                throw new Error(`Invalid phone format: ${phone}. Must be E.164.`);
            }

            // WhatsApp message format matching system tone
            const message = `Your B-Messenger verification code is: *${otp}*\n\nThis code will expire in 2 minutes.\n\nDo not share this code with anyone.`;

            // Send message
            const recipient = phone.replace('+', '') + '@s.whatsapp.net';
            await this.socket.sendMessage(recipient, { 
                text: message 
            });

            console.log(`📱 OTP sent to ${phone} via WhatsApp`);
            return true;
        } catch (error) {
            console.error(`❌ Failed to send OTP to ${phone}:`, error.message);
            
            // Handle specific Baileys errors
            if (error.message.includes('not authorized') || error.message.includes('blocked')) {
                throw new Error('Cannot send OTP: Recipient may have blocked this number');
            }
            
            throw error;
        }
    }

    /**
     * Validate E.164 phone format
     */
    isValidE164(phone) {
        return /^\+[1-9]\d{1,14}$/.test(phone);
    }

    /**
     * Cleanup resources
     */
    cleanup() {
        if (this.socket) {
            this.socket.end();
            this.socket = null;
        }
        this.authState = null;
        this.isConnected = false;
        this.connectionPromise = null;
    }

    /**
     * Get connection status
     */
    getStatus() {
        return {
            isConnected: this.isConnected,
            activeNumber: ACTIVE_NUMBER,
            reconnectAttempts: this.reconnectAttempts
        };
    }
}

// Singleton instance
let whatsappInstance = null;

function getWhatsAppInstance() {
    if (!whatsappInstance) {
        whatsappInstance = new WhatsAppOTPSender();
    }
    return whatsappInstance;
}

module.exports = { getWhatsAppInstance };
