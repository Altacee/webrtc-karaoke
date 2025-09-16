class KaraokeViewer {
    constructor() {
        this.socket = null;
        this.peerConnection = null;
        this.roomId = null;

        this.roomIdInput = document.getElementById('roomIdInput');
        this.joinButton = document.getElementById('joinButton');
        this.leaveButton = document.getElementById('leaveButton');
        this.fullscreenButton = document.getElementById('fullscreenButton');
        this.statusEl = document.getElementById('status');
        this.remoteVideoEl = document.getElementById('remoteVideo');
        this.isFullscreen = false;

        this.initializeEventListeners();
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
    }

    async connectToSignalingServer() {
        return new Promise((resolve, reject) => {
            try {
                // Auto-detect protocol: use wss:// for HTTPS pages, ws:// for HTTP pages
                const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
                const hostname = window.location.hostname;
                const port = window.location.port ? `:${window.location.port}` : '';
                const serverUrl = `${protocol}//${hostname}${port}`;

                console.log('Connecting to WebSocket:', serverUrl);
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

    async joinSession() {
        const roomId = this.roomIdInput.value.trim();
        if (!roomId) {
            this.updateStatus('Please enter a Room ID');
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
        }
    }

    leaveSession() {
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }

        if (this.socket) {
            this.sendSignalingMessage({
                type: 'leave-room',
                roomId: this.roomId
            });
            this.socket.close();
            this.socket = null;
        }

        this.remoteVideoEl.style.display = 'none';
        this.remoteVideoEl.srcObject = null;
        this.joinButton.disabled = false;
        this.leaveButton.disabled = true;
        this.fullscreenButton.disabled = true;
        this.roomIdInput.disabled = false;
        if (this.isFullscreen) {
            this.exitFullscreen();
        }
        this.updateStatus('Left session');
    }

    async handleSignalingMessage(message) {
        console.log('Received signaling message:', message);

        switch (message.type) {
            case 'room-joined':
                this.updateStatus('Joined room successfully');
                break;
            case 'room-not-found':
                this.updateStatus('Room not found');
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
        }
    }

    async handleOffer(offer) {
        console.log('Received offer');

        this.peerConnection = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
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
            this.remoteVideoEl.srcObject = event.streams[0];
            this.remoteVideoEl.style.display = 'block';
            this.fullscreenButton.disabled = false;
            this.updateStatus('Receiving shared content');
        };

        // Handle connection state changes
        this.peerConnection.onconnectionstatechange = () => {
            console.log('Connection state:', this.peerConnection.connectionState);
            if (this.peerConnection.connectionState === 'connected') {
                this.updateStatus('Connected to host');
            } else if (this.peerConnection.connectionState === 'disconnected') {
                this.updateStatus('Disconnected from host');
            } else if (this.peerConnection.connectionState === 'failed') {
                this.updateStatus('Connection failed');
                this.leaveSession();
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
    }

    async handleIceCandidate(candidate) {
        if (this.peerConnection) {
            await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        }
    }

    sendSignalingMessage(message) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify(message));
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
        if (this.remoteVideoEl.requestFullscreen) {
            this.remoteVideoEl.requestFullscreen();
        } else if (this.remoteVideoEl.webkitRequestFullscreen) {
            this.remoteVideoEl.webkitRequestFullscreen();
        } else if (this.remoteVideoEl.mozRequestFullScreen) {
            this.remoteVideoEl.mozRequestFullScreen();
        } else if (this.remoteVideoEl.msRequestFullscreen) {
            this.remoteVideoEl.msRequestFullscreen();
        }
    }

    exitFullscreen() {
        this.remoteVideoEl.classList.remove('fullscreen');
        this.isFullscreen = false;
        this.fullscreenButton.textContent = '🔳 Fullscreen';

        // Exit browser fullscreen API
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        } else if (document.mozCancelFullScreen) {
            document.mozCancelFullScreen();
        } else if (document.msExitFullscreen) {
            document.msExitFullscreen();
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
        this.statusEl.textContent = message;
        console.log('Status:', message);
    }
}

// Initialize when page loads
document.addEventListener('DOMContentLoaded', () => {
    new KaraokeViewer();
});