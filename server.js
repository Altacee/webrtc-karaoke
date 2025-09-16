const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const path = require('path');

class SignalingServer {
    constructor() {
        this.app = express();
        this.server = http.createServer(this.app);
        this.wss = new WebSocket.Server({ server: this.server });

        this.rooms = new Map(); // roomId -> { host: WebSocket, viewers: Set<WebSocket> }
        this.connections = new Map(); // WebSocket -> { type: 'host'|'viewer', roomId: string, viewerId?: string }

        this.setupHTTPServer();
        this.setupWebSocketServer();
    }

    setupHTTPServer() {
        // Serve static files
        this.app.use(express.static(path.join(__dirname)));

        // Root route
        this.app.get('/', (req, res) => {
            res.sendFile(path.join(__dirname, 'index.html'));
        });

        console.log('HTTP server configured to serve static files');
    }

    setupWebSocketServer() {
        this.wss.on('connection', (ws) => {
            console.log('New WebSocket connection');

            ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data);
                    this.handleMessage(ws, message);
                } catch (error) {
                    console.error('Error parsing message:', error);
                }
            });

            ws.on('close', () => {
                this.handleDisconnection(ws);
            });

            ws.on('error', (error) => {
                console.error('WebSocket error:', error);
                this.handleDisconnection(ws);
            });
        });

        console.log('WebSocket server configured');
    }

    handleMessage(ws, message) {
        console.log('Received message:', message.type, message);

        switch (message.type) {
            case 'create-room':
                this.handleCreateRoom(ws, message);
                break;
            case 'join-room':
                this.handleJoinRoom(ws, message);
                break;
            case 'leave-room':
                this.handleLeaveRoom(ws, message);
                break;
            case 'offer':
                this.handleOffer(ws, message);
                break;
            case 'answer':
                this.handleAnswer(ws, message);
                break;
            case 'ice-candidate':
                this.handleIceCandidate(ws, message);
                break;
            default:
                console.log('Unknown message type:', message.type);
        }
    }

    handleCreateRoom(ws, message) {
        const { roomId } = message;

        if (this.rooms.has(roomId)) {
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Room already exists'
            }));
            return;
        }

        // Create room
        this.rooms.set(roomId, {
            host: ws,
            viewers: new Set()
        });

        this.connections.set(ws, {
            type: 'host',
            roomId: roomId
        });

        console.log(`Room created: ${roomId}`);

        ws.send(JSON.stringify({
            type: 'room-created',
            roomId: roomId
        }));
    }

    handleJoinRoom(ws, message) {
        const { roomId } = message;

        if (!this.rooms.has(roomId)) {
            ws.send(JSON.stringify({
                type: 'room-not-found'
            }));
            return;
        }

        const room = this.rooms.get(roomId);
        const viewerId = this.generateViewerId();

        // Add viewer to room
        room.viewers.add(ws);
        this.connections.set(ws, {
            type: 'viewer',
            roomId: roomId,
            viewerId: viewerId
        });

        console.log(`Viewer ${viewerId} joined room: ${roomId}`);

        // Notify viewer that they joined
        ws.send(JSON.stringify({
            type: 'room-joined',
            roomId: roomId,
            viewerId: viewerId
        }));

        // Notify host about new viewer
        if (room.host && room.host.readyState === WebSocket.OPEN) {
            room.host.send(JSON.stringify({
                type: 'viewer-joined',
                viewerId: viewerId
            }));
        }
    }

    handleLeaveRoom(ws, message) {
        const connection = this.connections.get(ws);
        if (!connection) return;

        const room = this.rooms.get(connection.roomId);
        if (!room) return;

        if (connection.type === 'viewer') {
            room.viewers.delete(ws);

            // Notify host
            if (room.host && room.host.readyState === WebSocket.OPEN) {
                room.host.send(JSON.stringify({
                    type: 'viewer-left',
                    viewerId: connection.viewerId
                }));
            }
        }

        this.connections.delete(ws);
        console.log(`${connection.type} left room: ${connection.roomId}`);
    }

    handleOffer(ws, message) {
        const { offer, viewerId } = message;
        const connection = this.connections.get(ws);

        if (!connection || connection.type !== 'host') return;

        const room = this.rooms.get(connection.roomId);
        if (!room) return;

        // Find the viewer and send offer
        for (const viewer of room.viewers) {
            const viewerConnection = this.connections.get(viewer);
            if (viewerConnection && viewerConnection.viewerId === viewerId) {
                viewer.send(JSON.stringify({
                    type: 'offer',
                    offer: offer
                }));
                break;
            }
        }
    }

    handleAnswer(ws, message) {
        const { answer } = message;
        const connection = this.connections.get(ws);

        if (!connection || connection.type !== 'viewer') return;

        const room = this.rooms.get(connection.roomId);
        if (!room || !room.host) return;

        // Send answer to host
        room.host.send(JSON.stringify({
            type: 'answer',
            answer: answer,
            viewerId: connection.viewerId
        }));
    }

    handleIceCandidate(ws, message) {
        const { candidate, viewerId } = message;
        const connection = this.connections.get(ws);

        if (!connection) return;

        const room = this.rooms.get(connection.roomId);
        if (!room) return;

        if (connection.type === 'host') {
            // Forward to specific viewer
            for (const viewer of room.viewers) {
                const viewerConnection = this.connections.get(viewer);
                if (viewerConnection && viewerConnection.viewerId === viewerId) {
                    viewer.send(JSON.stringify({
                        type: 'ice-candidate',
                        candidate: candidate
                    }));
                    break;
                }
            }
        } else if (connection.type === 'viewer') {
            // Forward to host
            if (room.host && room.host.readyState === WebSocket.OPEN) {
                room.host.send(JSON.stringify({
                    type: 'ice-candidate',
                    candidate: candidate,
                    viewerId: connection.viewerId
                }));
            }
        }
    }

    handleDisconnection(ws) {
        const connection = this.connections.get(ws);
        if (!connection) return;

        const room = this.rooms.get(connection.roomId);
        if (!room) return;

        if (connection.type === 'host') {
            // Notify all viewers that host disconnected
            room.viewers.forEach(viewer => {
                if (viewer.readyState === WebSocket.OPEN) {
                    viewer.send(JSON.stringify({
                        type: 'host-disconnected'
                    }));
                }
            });

            // Clean up room
            this.rooms.delete(connection.roomId);
            console.log(`Host disconnected, room ${connection.roomId} closed`);
        } else if (connection.type === 'viewer') {
            room.viewers.delete(ws);

            // Notify host
            if (room.host && room.host.readyState === WebSocket.OPEN) {
                room.host.send(JSON.stringify({
                    type: 'viewer-left',
                    viewerId: connection.viewerId
                }));
            }
            console.log(`Viewer ${connection.viewerId} disconnected from room ${connection.roomId}`);
        }

        this.connections.delete(ws);
    }

    generateViewerId() {
        return 'viewer_' + Math.random().toString(36).substr(2, 8);
    }

    start(port = 8080) {
        this.server.listen(port, '0.0.0.0', () => {
            console.log(`🎤 Karaoke signaling server running on http://localhost:${port}`);
            console.log(`🎤 For mobile devices, use: http://192.168.29.222:${port}`);
            console.log(`WebSocket server running on ws://localhost:${port}`);
            console.log(`For mobile WebSocket: ws://192.168.29.222:${port}`);
        });
    }
}

// Start server
const server = new SignalingServer();
server.start();