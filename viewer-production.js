class KaraokeViewer {
    constructor() {
        this.socket = null;
        this.peerConnection = null;
        this.roomId = null;
        this.isFullscreen = false;
        this.connectionRetries = 0;
        this.maxRetries = 3;
        this.reconnectInterval = null;

        this.roomIdInput = document.getElementById('roomIdInput');
        this.joinButton = document.getElementById('joinButton');
        this.leaveButton = document.getElementById('leaveButton');
        this.fullscreenButton = document.getElementById('fullscreenButton');
        this.statusEl = document.getElementById('status');
        this.remoteVideoEl = document.getElementById('remoteVideo');

        this.validateElements();
        this.initializeEventListeners();
        this.setupErrorHandling();
    }

    validateElements() {
        const requiredElements = [
            'roomIdInput', 'joinButton', 'leaveButton', 'fullscreenButton',
            'status', 'remoteVideo'
        ];

        for (const elementId of requiredElements) {
            if (!document.getElementById(elementId)) {
                throw new Error(`Required element #${elementId} not found`);
            }
        }
    }

    setupErrorHandling() {
        window.addEventListener('error', (event) => {
            this.updateStatus('Application error occurred');
            console.error('Global error:', event.error);
        });

        window.addEventListener('unhandledrejection', (event) => {
            this.updateStatus('Unexpected error occurred');
            console.error('Unhandled promise rejection:', event.reason);
        });
    }

    initializeEventListeners() {
        this.joinButton.addEventListener('click', () => this.joinSession());
        this.leaveButton.addEventListener('click', () => this.leaveSession());
        this.fullscreenButton.addEventListener('click', () => this.toggleFullscreen());

        this.roomIdInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.joinSession();
            }
        });

        this.roomIdInput.addEventListener('input', (e) => {
            // Sanitize room ID input
            e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 8);
        });

        // Handle fullscreen change events
        document.addEventListener('fullscreenchange', () => this.handleFullscreenChange());
        document.addEventListener('webkitfullscreenchange', () => this.handleFullscreenChange());
        document.addEventListener('mozfullscreenchange', () => this.handleFullscreenChange());
        document.addEventListener('MSFullscreenChange', () => this.handleFullscreenChange());

        // Exit fullscreen on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isFullscreen) {
                this.exitFullscreen();
            }
        });

        // Cleanup on page unload
        window.addEventListener('beforeunload', () => {
            this.cleanup();
        });

        // Handle visibility change
        document.addEventListener('visibilitychange', () => {
            if (document.hidden && this.socket) {
                console.log('Page hidden, connection may be affected');
            }
        });
    }

    async connectToSignalingServer() {
        return new Promise((resolve, reject) => {
            try {
                const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
                const hostname = window.location.hostname === 'localhost' ?
                    'localhost' : window.location.hostname;
                const port = this.getWebSocketPort();
                const serverUrl = `${protocol}//${hostname}:${port}`;

                console.log('Connecting to:', serverUrl);
                this.socket = new WebSocket(serverUrl);

                // Set connection timeout
                const connectionTimeout = setTimeout(() => {
                    if (this.socket.readyState === WebSocket.CONNECTING) {
                        this.socket.close();
                        reject(new Error('Connection timeout'));
                    }
                }, 10000); // 10 second timeout

                this.socket.onopen = () => {
                    clearTimeout(connectionTimeout);
                    this.connectionRetries = 0;
                    this.updateStatus('Connected to signaling server');
                    resolve();
                };

                this.socket.onmessage = (event) => {
                    try {
                        const message = JSON.parse(event.data);
                        this.handleSignalingMessage(message);
                    } catch (error) {
                        console.error('Error parsing message:', error);
                    }
                };

                this.socket.onclose = (event) => {
                    clearTimeout(connectionTimeout);
                    console.log('WebSocket closed:', event.code, event.reason);

                    if (event.code !== 1000 && this.roomId) {
                        // Unexpected close, attempt reconnection
                        this.attemptReconnection();
                    } else {
                        this.updateStatus('Disconnected from signaling server');
                    }
                };

                this.socket.onerror = (error) => {
                    clearTimeout(connectionTimeout);
                    console.error('WebSocket error:', error);
                    this.updateStatus('Connection error occurred');
                    reject(error);
                };
            } catch (error) {
                console.error('WebSocket connection failed:', error);
                reject(error);
            }
        });
    }

    getWebSocketPort() {
        if (window.location.hostname === 'localhost') {
            return '8080';
        }
        return window.location.port || (window.location.protocol === 'https:' ? '443' : '80');
    }

    attemptReconnection() {
        if (this.connectionRetries >= this.maxRetries) {
            this.updateStatus('Failed to reconnect. Please refresh the page.');
            this.resetUI();
            return;
        }

        this.connectionRetries++;
        this.updateStatus(`Reconnecting... (${this.connectionRetries}/${this.maxRetries})`);

        this.reconnectInterval = setTimeout(async () => {
            try {
                await this.connectToSignalingServer();

                // Re-join room if we had one
                if (this.roomId) {
                    this.sendSignalingMessage({
                        type: 'join-room',
                        roomId: this.roomId
                    });
                }
            } catch (error) {
                console.error('Reconnection failed:', error);
                this.attemptReconnection();
            }
        }, 2000 * this.connectionRetries); // Exponential backoff
    }

    async joinSession() {
        const roomId = this.roomIdInput.value.trim();
        if (!roomId) {
            this.updateStatus('Please enter a Room ID');
            this.roomIdInput.focus();
            return;
        }

        if (!/^[A-Z0-9]{4,8}$/.test(roomId)) {
            this.updateStatus('Room ID must be 4-8 characters (A-Z, 0-9)');
            this.roomIdInput.focus();
            return;
        }

        this.roomId = roomId;
        this.updateStatus('Connecting...');

        try {
            await this.connectToSignalingServer();

            // Join room
            this.sendSignalingMessage({
                type: 'join-room',
                roomId: this.roomId
            });

            this.joinButton.disabled = true;
            this.leaveButton.disabled = false;
            this.roomIdInput.disabled = true;

        } catch (error) {
            this.updateStatus('Failed to join session: ' + error.message);
            console.error('Error joining session:', error);
            this.resetUI();
        }
    }

    leaveSession() {
        this.cleanup();
        this.updateStatus('Left session');
    }

    cleanup() {
        // Close peer connection
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }

        // Close WebSocket
        if (this.socket) {
            this.sendSignalingMessage({
                type: 'leave-room',
                roomId: this.roomId
            });
            this.socket.close(1000, 'Viewer leaving');
            this.socket = null;
        }

        // Clear reconnection timer
        if (this.reconnectInterval) {
            clearTimeout(this.reconnectInterval);
            this.reconnectInterval = null;
        }

        // Reset video
        this.remoteVideoEl.style.display = 'none';
        this.remoteVideoEl.srcObject = null;

        // Exit fullscreen if active
        if (this.isFullscreen) {
            this.exitFullscreen();
        }

        // Reset UI
        this.resetUI();
        this.roomId = null;
        this.connectionRetries = 0;
    }

    async handleSignalingMessage(message) {
        if (!message || !message.type) {
            console.warn('Invalid message received:', message);
            return;
        }

        console.log('Received signaling message:', message.type);

        try {
            switch (message.type) {
                case 'room-joined':
                    this.updateStatus('Joined room successfully - Waiting for host...');
                    break;
                case 'room-not-found':
                    this.updateStatus('Room not found - Check Room ID');
                    this.resetUI();
                    break;
                case 'offer':
                    await this.handleOffer(message.offer);
                    break;
                case 'ice-candidate':
                    await this.handleIceCandidate(message.candidate);
                    break;
                case 'host-disconnected':
                    this.updateStatus('Host disconnected');
                    this.leaveSession();
                    break;
                case 'error':
                    this.updateStatus('Server error: ' + message.message);
                    if (message.message.includes('full') || message.message.includes('overloaded')) {
                        this.resetUI();
                    }
                    break;
                default:
                    console.warn('Unknown message type:', message.type);
            }
        } catch (error) {
            console.error('Error handling signaling message:', error);
            this.updateStatus('Error processing server message');
        }
    }

    async handleOffer(offer) {
        if (!offer) {
            console.error('Invalid offer received');
            return;
        }

        console.log('Received offer');

        try {
            this.peerConnection = new RTCPeerConnection({
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' }
                ],
                iceCandidatePoolSize: 10
            });

            // Handle ICE candidates
            this.peerConnection.onicecandidate = (event) => {
                if (event.candidate) {
                    this.sendSignalingMessage({
                        type: 'ice-candidate',
                        candidate: event.candidate
                    });
                }
            };

            // Handle remote stream
            this.peerConnection.ontrack = (event) => {
                console.log('Received remote stream');
                if (event.streams && event.streams[0]) {
                    this.remoteVideoEl.srcObject = event.streams[0];
                    this.remoteVideoEl.style.display = 'block';
                    this.fullscreenButton.disabled = false;
                    this.updateStatus('Receiving shared content');

                    // Handle stream end
                    event.streams[0].getTracks().forEach(track => {
                        track.onended = () => {
                            console.log('Remote track ended');
                            this.updateStatus('Host stopped sharing');
                        };
                    });
                }
            };

            // Handle connection state changes
            this.peerConnection.onconnectionstatechange = () => {
                const state = this.peerConnection.connectionState;
                console.log('Connection state:', state);

                switch (state) {
                    case 'connected':
                        this.updateStatus('Connected to host');
                        break;
                    case 'disconnected':
                        this.updateStatus('Disconnected from host');
                        break;
                    case 'failed':
                        this.updateStatus('Connection failed');
                        this.leaveSession();
                        break;
                    case 'closed':
                        this.updateStatus('Connection closed');
                        break;
                }
            };

            // Set remote description and create answer
            await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
            const answer = await this.peerConnection.createAnswer();
            await this.peerConnection.setLocalDescription(answer);

            this.sendSignalingMessage({
                type: 'answer',
                answer: answer
            });

        } catch (error) {
            console.error('Error handling offer:', error);
            this.updateStatus('Failed to establish connection');
            this.leaveSession();
        }
    }

    async handleIceCandidate(candidate) {
        if (!candidate) {
            console.warn('Invalid ICE candidate received');
            return;
        }

        if (this.peerConnection && this.peerConnection.remoteDescription) {
            try {
                await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (error) {
                console.error('Error adding ICE candidate:', error);
            }
        }
    }

    sendSignalingMessage(message) {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            console.warn('Cannot send message, WebSocket not connected');
            return false;
        }

        try {
            this.socket.send(JSON.stringify(message));
            return true;
        } catch (error) {
            console.error('Error sending message:', error);
            return false;
        }
    }

    toggleFullscreen() {
        if (!this.isFullscreen) {
            this.enterFullscreen();
        } else {
            this.exitFullscreen();
        }
    }

    enterFullscreen() {
        this.remoteVideoEl.classList.add('fullscreen');
        this.isFullscreen = true;
        this.fullscreenButton.textContent = '🗗 Exit Fullscreen';

        // Request browser fullscreen API
        const element = this.remoteVideoEl;
        const requestFullscreen = element.requestFullscreen ||
            element.webkitRequestFullscreen ||
            element.mozRequestFullScreen ||
            element.msRequestFullscreen;

        if (requestFullscreen) {
            requestFullscreen.call(element).catch(error => {
                console.error('Fullscreen request failed:', error);
            });
        }
    }

    exitFullscreen() {
        this.remoteVideoEl.classList.remove('fullscreen');
        this.isFullscreen = false;
        this.fullscreenButton.textContent = '🔳 Fullscreen';

        // Exit browser fullscreen API
        const exitFullscreen = document.exitFullscreen ||
            document.webkitExitFullscreen ||
            document.mozCancelFullScreen ||
            document.msExitFullscreen;

        if (exitFullscreen) {
            exitFullscreen.call(document).catch(error => {
                console.error('Exit fullscreen failed:', error);
            });
        }
    }

    handleFullscreenChange() {
        // Check if we're still in fullscreen mode
        const isInFullscreen = !!(
            document.fullscreenElement ||
            document.webkitFullscreenElement ||
            document.mozFullScreenElement ||
            document.msFullscreenElement
        );

        if (!isInFullscreen && this.isFullscreen) {
            // User exited fullscreen via browser controls or ESC key
            this.exitFullscreen();
        }
    }

    resetUI() {
        this.joinButton.disabled = false;
        this.leaveButton.disabled = true;
        this.fullscreenButton.disabled = true;
        this.roomIdInput.disabled = false;
    }

    updateStatus(message) {
        if (!message || typeof message !== 'string') return;

        this.statusEl.textContent = message;
        console.log('Status:', message);

        // Add timestamp for debugging
        console.log(`[${new Date().toISOString()}] ${message}`);

        // Auto-clear certain status messages
        if (message.includes('error') || message.includes('failed')) {
            this.statusEl.style.color = '#ff6b6b';
        } else if (message.includes('success') || message.includes('Connected')) {
            this.statusEl.style.color = '#51cf66';
        } else {
            this.statusEl.style.color = '';
        }
    }

    // Utility method to check WebRTC support
    static checkWebRTCSupport() {
        const hasWebRTC = !!(window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection);
        return hasWebRTC;
    }
}

// Initialize when page loads
document.addEventListener('DOMContentLoaded', () => {
    const hasWebRTC = KaraokeViewer.checkWebRTCSupport();

    if (!hasWebRTC) {
        const statusEl = document.getElementById('status');
        if (statusEl) {
            statusEl.textContent = 'WebRTC not supported in this browser';
            statusEl.style.color = '#ff6b6b';
        }

        const joinButton = document.getElementById('joinButton');
        if (joinButton) {
            joinButton.disabled = true;
            joinButton.textContent = 'Not Supported';
        }
        return;
    }

    try {
        new KaraokeViewer();
    } catch (error) {
        console.error('Failed to initialize KaraokeViewer:', error);
        const statusEl = document.getElementById('status');
        if (statusEl) {
            statusEl.textContent = 'Failed to initialize application';
            statusEl.style.color = '#ff6b6b';
        }
    }
});