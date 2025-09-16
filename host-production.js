class KaraokeHost {
    constructor() {
        this.socket = null;
        this.peerConnections = new Map();
        this.localStream = null;
        this.roomId = null;
        this.connectionRetries = 0;
        this.maxRetries = 3;
        this.reconnectInterval = null;

        this.startButton = document.getElementById('startButton');
        this.stopButton = document.getElementById('stopButton');
        this.statusEl = document.getElementById('status');
        this.roomIdEl = document.getElementById('roomId');
        this.roomInfoEl = document.getElementById('roomInfo');
        this.previewEl = document.getElementById('preview');
        this.viewerCountEl = document.getElementById('viewerCount');

        this.validateElements();
        this.initializeEventListeners();
        this.setupErrorHandling();
    }

    validateElements() {
        const requiredElements = [
            'startButton', 'stopButton', 'status', 'roomId',
            'roomInfo', 'preview', 'viewerCount'
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
        this.startButton.addEventListener('click', () => this.startSharing());
        this.stopButton.addEventListener('click', () => this.stopSharing());

        // Cleanup on page unload
        window.addEventListener('beforeunload', () => {
            this.cleanup();
        });

        // Handle visibility change
        document.addEventListener('visibilitychange', () => {
            if (document.hidden && this.socket) {
                // Page is hidden, prepare for potential disconnect
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
            return;
        }

        this.connectionRetries++;
        this.updateStatus(`Reconnecting... (${this.connectionRetries}/${this.maxRetries})`);

        this.reconnectInterval = setTimeout(async () => {
            try {
                await this.connectToSignalingServer();

                // Re-create room if we had one
                if (this.roomId) {
                    this.sendSignalingMessage({
                        type: 'create-room',
                        roomId: this.roomId
                    });
                }
            } catch (error) {
                console.error('Reconnection failed:', error);
                this.attemptReconnection();
            }
        }, 2000 * this.connectionRetries); // Exponential backoff
    }

    async startSharing() {
        try {
            this.updateStatus('Starting tab capture...');

            // Check browser support
            if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
                throw new Error('Screen sharing not supported in this browser');
            }

            // Request tab sharing with error handling
            this.localStream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    mediaSource: 'screen',
                    width: { ideal: 1920, max: 1920 },
                    height: { ideal: 1080, max: 1080 },
                    frameRate: { ideal: 30, max: 60 }
                },
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });

            // Validate stream
            if (!this.localStream || this.localStream.getTracks().length === 0) {
                throw new Error('No media tracks received');
            }

            // Show preview
            this.previewEl.srcObject = this.localStream;
            this.previewEl.style.display = 'block';

            // Connect to signaling server
            await this.connectToSignalingServer();

            // Create room
            this.roomId = this.generateRoomId();
            this.roomIdEl.textContent = this.roomId;
            this.roomInfoEl.style.display = 'block';

            // Register as host
            this.sendSignalingMessage({
                type: 'create-room',
                roomId: this.roomId
            });

            this.startButton.disabled = true;
            this.stopButton.disabled = false;
            this.updateStatus('Sharing started - Room created');

            // Handle stream end
            this.localStream.getVideoTracks()[0].addEventListener('ended', () => {
                this.updateStatus('Screen sharing ended by user');
                this.stopSharing();
            });

        } catch (error) {
            this.updateStatus('Failed to start sharing: ' + error.message);
            console.error('Error starting share:', error);
            this.cleanup();
        }
    }

    stopSharing() {
        this.cleanup();
        this.updateStatus('Sharing stopped');
    }

    cleanup() {
        // Stop local stream
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                track.stop();
                console.log('Stopped track:', track.kind);
            });
            this.localStream = null;
        }

        // Close all peer connections
        this.peerConnections.forEach((pc, viewerId) => {
            pc.close();
            console.log('Closed peer connection for viewer:', viewerId);
        });
        this.peerConnections.clear();

        // Close WebSocket
        if (this.socket) {
            this.socket.close(1000, 'Host stopping');
            this.socket = null;
        }

        // Clear reconnection timer
        if (this.reconnectInterval) {
            clearTimeout(this.reconnectInterval);
            this.reconnectInterval = null;
        }

        // Reset UI
        this.previewEl.style.display = 'none';
        this.previewEl.srcObject = null;
        this.roomInfoEl.style.display = 'none';
        this.startButton.disabled = false;
        this.stopButton.disabled = true;
        this.viewerCountEl.textContent = '0';
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
                case 'room-created':
                    this.updateStatus('Room created successfully');
                    break;
                case 'viewer-joined':
                    await this.handleViewerJoined(message.viewerId);
                    break;
                case 'viewer-left':
                    this.handleViewerLeft(message.viewerId);
                    break;
                case 'ice-candidate':
                    await this.handleIceCandidate(message);
                    break;
                case 'answer':
                    await this.handleAnswer(message);
                    break;
                case 'error':
                    this.updateStatus('Server error: ' + message.message);
                    break;
                default:
                    console.warn('Unknown message type:', message.type);
            }
        } catch (error) {
            console.error('Error handling signaling message:', error);
            this.updateStatus('Error processing server message');
        }
    }

    async handleViewerJoined(viewerId) {
        if (!viewerId || typeof viewerId !== 'string') {
            console.error('Invalid viewer ID:', viewerId);
            return;
        }

        console.log('Viewer joined:', viewerId);

        try {
            const pc = new RTCPeerConnection({
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' }
                ],
                iceCandidatePoolSize: 10
            });

            this.peerConnections.set(viewerId, pc);

            // Add local stream to peer connection
            if (this.localStream) {
                this.localStream.getTracks().forEach(track => {
                    pc.addTrack(track, this.localStream);
                });
            } else {
                throw new Error('No local stream available');
            }

            // Handle ICE candidates
            pc.onicecandidate = (event) => {
                if (event.candidate) {
                    this.sendSignalingMessage({
                        type: 'ice-candidate',
                        candidate: event.candidate,
                        viewerId: viewerId
                    });
                }
            };

            // Handle connection state changes
            pc.onconnectionstatechange = () => {
                console.log(`Peer connection state for ${viewerId}:`, pc.connectionState);
                if (pc.connectionState === 'failed') {
                    console.log('Peer connection failed, removing viewer:', viewerId);
                    this.handleViewerLeft(viewerId);
                }
            };

            // Create and send offer
            const offer = await pc.createOffer({
                offerToReceiveAudio: false,
                offerToReceiveVideo: false
            });
            await pc.setLocalDescription(offer);

            this.sendSignalingMessage({
                type: 'offer',
                offer: offer,
                viewerId: viewerId
            });

            this.updateViewerCount();
        } catch (error) {
            console.error('Error handling viewer join:', error);
            this.handleViewerLeft(viewerId);
        }
    }

    handleViewerLeft(viewerId) {
        if (!viewerId) return;

        const pc = this.peerConnections.get(viewerId);
        if (pc) {
            pc.close();
            this.peerConnections.delete(viewerId);
            console.log('Viewer left:', viewerId);
        }
        this.updateViewerCount();
    }

    async handleIceCandidate(message) {
        if (!message.viewerId || !message.candidate) {
            console.warn('Invalid ICE candidate message:', message);
            return;
        }

        const pc = this.peerConnections.get(message.viewerId);
        if (pc && pc.remoteDescription) {
            try {
                await pc.addIceCandidate(new RTCIceCandidate(message.candidate));
            } catch (error) {
                console.error('Error adding ICE candidate:', error);
            }
        }
    }

    async handleAnswer(message) {
        if (!message.viewerId || !message.answer) {
            console.warn('Invalid answer message:', message);
            return;
        }

        const pc = this.peerConnections.get(message.viewerId);
        if (pc) {
            try {
                await pc.setRemoteDescription(new RTCSessionDescription(message.answer));
            } catch (error) {
                console.error('Error setting remote description:', error);
                this.handleViewerLeft(message.viewerId);
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

    updateViewerCount() {
        const count = this.peerConnections.size;
        this.viewerCountEl.textContent = count.toString();

        if (count === 0) {
            this.updateStatus('Room created - Waiting for viewers');
        } else {
            this.updateStatus(`Streaming to ${count} viewer${count === 1 ? '' : 's'}`);
        }
    }

    updateStatus(message) {
        if (!message || typeof message !== 'string') return;

        this.statusEl.textContent = message;
        console.log('Status:', message);

        // Add timestamp for debugging
        console.log(`[${new Date().toISOString()}] ${message}`);
    }

    generateRoomId() {
        // Generate a more secure room ID
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let result = '';
        for (let i = 0; i < 8; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    // Utility method to check WebRTC support
    static checkWebRTCSupport() {
        const hasWebRTC = !!(window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection);
        const hasMediaDevices = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);

        return {
            webrtc: hasWebRTC,
            screenShare: hasMediaDevices,
            supported: hasWebRTC && hasMediaDevices
        };
    }
}

// Initialize when page loads
document.addEventListener('DOMContentLoaded', () => {
    const support = KaraokeHost.checkWebRTCSupport();

    if (!support.supported) {
        const statusEl = document.getElementById('status');
        if (statusEl) {
            statusEl.textContent = 'WebRTC or screen sharing not supported in this browser';
            statusEl.style.color = '#ff6b6b';
        }

        const startButton = document.getElementById('startButton');
        if (startButton) {
            startButton.disabled = true;
            startButton.textContent = 'Not Supported';
        }
        return;
    }

    try {
        new KaraokeHost();
    } catch (error) {
        console.error('Failed to initialize KaraokeHost:', error);
        const statusEl = document.getElementById('status');
        if (statusEl) {
            statusEl.textContent = 'Failed to initialize application';
            statusEl.style.color = '#ff6b6b';
        }
    }
});