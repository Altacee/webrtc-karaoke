class KaraokeHost {
    constructor() {
        this.socket = null;
        this.peerConnections = new Map();
        this.localStream = null;
        this.roomId = null;

        this.startButton = document.getElementById('startButton');
        this.stopButton = document.getElementById('stopButton');
        this.statusEl = document.getElementById('status');
        this.roomIdEl = document.getElementById('roomId');
        this.roomInfoEl = document.getElementById('roomInfo');
        this.previewEl = document.getElementById('preview');
        this.viewerCountEl = document.getElementById('viewerCount');

        this.initializeEventListeners();
    }

    initializeEventListeners() {
        this.startButton.addEventListener('click', () => this.startSharing());
        this.stopButton.addEventListener('click', () => this.stopSharing());
    }

    async connectToSignalingServer() {
        return new Promise((resolve, reject) => {
            try {
                const serverUrl = window.location.hostname === 'localhost' ?
                'ws://localhost:8080' :
                `ws://${window.location.hostname}:8080`;
            this.socket = new WebSocket(serverUrl);

                this.socket.onopen = () => {
                    this.updateStatus('Connected to signaling server');
                    resolve();
                };

                this.socket.onmessage = (event) => {
                    this.handleSignalingMessage(JSON.parse(event.data));
                };

                this.socket.onclose = () => {
                    this.updateStatus('Disconnected from signaling server');
                };

                this.socket.onerror = (error) => {
                    this.updateStatus('Connection error: ' + error.message);
                    reject(error);
                };
            } catch (error) {
                this.updateStatus('Failed to connect to signaling server');
                console.error('WebSocket connection failed:', error);
                reject(error);
            }
        });
    }

    async startSharing() {
        try {
            this.updateStatus('Starting tab capture...');

            // Check if getDisplayMedia is available
            if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
                throw new Error('Screen sharing requires HTTPS. Please access via https:// or use localhost');
            }

            // Request tab sharing
            this.localStream = await navigator.mediaDevices.getDisplayMedia({
                video: { mediaSource: 'screen' },
                audio: true
            });

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
            this.localStream.getVideoTracks()[0].onended = () => {
                this.stopSharing();
            };

        } catch (error) {
            this.updateStatus('Failed to start sharing: ' + error.message);
            console.error('Error starting share:', error);
        }
    }

    stopSharing() {
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }

        // Close all peer connections
        this.peerConnections.forEach(pc => pc.close());
        this.peerConnections.clear();

        // Close WebSocket
        if (this.socket) {
            this.socket.close();
            this.socket = null;
        }

        this.previewEl.style.display = 'none';
        this.roomInfoEl.style.display = 'none';
        this.startButton.disabled = false;
        this.stopButton.disabled = true;
        this.viewerCountEl.textContent = '0';
        this.updateStatus('Sharing stopped');
    }

    async handleSignalingMessage(message) {
        console.log('Received signaling message:', message);

        switch (message.type) {
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
        }
    }

    async handleViewerJoined(viewerId) {
        console.log('Viewer joined:', viewerId);

        const pc = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });

        this.peerConnections.set(viewerId, pc);

        // Add local stream to peer connection
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                pc.addTrack(track, this.localStream);
            });
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

        // Create and send offer
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        this.sendSignalingMessage({
            type: 'offer',
            offer: offer,
            viewerId: viewerId
        });

        this.updateViewerCount();
    }

    handleViewerLeft(viewerId) {
        const pc = this.peerConnections.get(viewerId);
        if (pc) {
            pc.close();
            this.peerConnections.delete(viewerId);
        }
        this.updateViewerCount();
    }

    async handleIceCandidate(message) {
        const pc = this.peerConnections.get(message.viewerId);
        if (pc) {
            await pc.addIceCandidate(new RTCIceCandidate(message.candidate));
        }
    }

    async handleAnswer(message) {
        const pc = this.peerConnections.get(message.viewerId);
        if (pc) {
            await pc.setRemoteDescription(new RTCSessionDescription(message.answer));
        }
    }

    sendSignalingMessage(message) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify(message));
        }
    }

    updateViewerCount() {
        this.viewerCountEl.textContent = this.peerConnections.size.toString();
    }

    updateStatus(message) {
        this.statusEl.textContent = message;
        console.log('Status:', message);
    }

    generateRoomId() {
        return Math.random().toString(36).substr(2, 8).toUpperCase();
    }
}

// Initialize when page loads
document.addEventListener('DOMContentLoaded', () => {
    new KaraokeHost();
});