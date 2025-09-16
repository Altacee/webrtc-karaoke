const WebSocket = require('ws');
const https = require('https');
const fs = require('fs');
const express = require('express');
const path = require('path');

class SignalingServer {
    constructor() {
        this.app = express();
        this.server = null;
        this.wss = null;

        this.rooms = new Map();
        this.connections = new Map();
        this.connectionCount = 0;
        this.maxConnections = parseInt(process.env.MAX_CONNECTIONS) || 1000;
        this.maxRooms = parseInt(process.env.MAX_ROOMS) || 100;

        this.validateEnvironment();
        this.setupHTTPServer();
        this.createHTTPSServer();
        this.setupWebSocketServer();
        this.setupCleanupInterval();
    }

    validateEnvironment() {
        this.isProduction = process.env.NODE_ENV === 'production';
        this.port = parseInt(process.env.PORT) || 8443;
        this.logLevel = process.env.LOG_LEVEL || 'info';
    }

    createHTTPSServer() {
        // Create self-signed certificates if they don't exist
        const certPath = path.join(__dirname, 'cert.pem');
        const keyPath = path.join(__dirname, 'key.pem');

        if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
            this.log('info', 'Creating self-signed certificates...');
            this.createSelfSignedCerts();
        }

        const options = {
            key: fs.readFileSync(keyPath),
            cert: fs.readFileSync(certPath)
        };

        this.server = https.createServer(options, this.app);
        this.log('info', 'HTTPS server created with self-signed certificates');
    }

    createSelfSignedCerts() {
        const { execSync } = require('child_process');

        try {
            // Create self-signed certificate
            execSync(`openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost"`, {
                cwd: __dirname,
                stdio: 'pipe'
            });
            this.log('info', 'Self-signed certificates created successfully');
        } catch (error) {
            this.log('error', 'Failed to create certificates. Please install OpenSSL or create certificates manually');
            process.exit(1);
        }
    }

    setupHTTPServer() {
        // Parse JSON with size limit
        this.app.use(express.json({ limit: '10mb' }));

        // CORS for local development
        this.app.use((req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
            res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
            next();
        });

        // Health check endpoint
        this.app.get('/health', (req, res) => {
            const health = {
                status: 'ok',
                timestamp: new Date().toISOString(),
                uptime: process.uptime(),
                rooms: this.rooms.size,
                connections: this.connectionCount,
                memory: process.memoryUsage(),
                protocol: 'https'
            };
            res.status(200).json(health);
        });

        // Metrics endpoint
        this.app.get('/metrics', (req, res) => {
            const metrics = {
                rooms_active: this.rooms.size,
                connections_active: this.connectionCount,
                memory_used: process.memoryUsage().heapUsed,
                uptime_seconds: process.uptime()
            };
            res.status(200).json(metrics);
        });

        // Serve static files
        this.app.use(express.static(path.join(__dirname), {
            maxAge: this.isProduction ? '1h' : '0',
            etag: true,
            lastModified: true
        }));

        // Root route
        this.app.get('/', (req, res) => {
            res.sendFile(path.join(__dirname, 'index.html'));
        });

        // 404 handler
        this.app.use((req, res) => {
            res.status(404).json({ error: 'Not found' });
        });

        // Error handler
        this.app.use((err, req, res, next) => {
            this.log('error', 'HTTP Error:', err);
            res.status(500).json({ error: 'Internal server error' });
        });

        this.log('info', 'HTTP server configured');
    }

    setupWebSocketServer() {
        this.wss = new WebSocket.Server({
            server: this.server,
            maxPayload: 16 * 1024,
        });

        this.wss.on('connection', (ws, req) => {
            if (this.connectionCount >= this.maxConnections) {
                this.log('warn', 'Max connections reached, rejecting new connection');
                ws.close(1013, 'Server overloaded');
                return;
            }

            this.connectionCount++;
            ws.isAlive = true;
            ws.joinTime = Date.now();
            ws.ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;

            this.log('info', `New WebSocket connection from ${ws.ip}. Total: ${this.connectionCount}`);

            ws.on('pong', () => {
                ws.isAlive = true;
            });

            ws.on('message', (data) => {
                try {
                    if (data.length > 16384) {
                        ws.close(1009, 'Message too large');
                        return;
                    }

                    const message = JSON.parse(data);
                    this.handleMessage(ws, message);
                } catch (error) {
                    this.log('error', 'Error parsing message:', error);
                    ws.close(1003, 'Invalid message format');
                }
            });

            ws.on('close', () => {
                this.handleDisconnection(ws);
                this.connectionCount--;
                this.log('info', `WebSocket disconnected. Total: ${this.connectionCount}`);
            });

            ws.on('error', (error) => {
                this.log('error', 'WebSocket error:', error);
                this.handleDisconnection(ws);
            });
        });

        this.log('info', 'WebSocket server configured');
    }

    setupCleanupInterval() {
        setInterval(() => {
            this.wss.clients.forEach((ws) => {
                if (!ws.isAlive) {
                    this.log('info', 'Terminating dead connection');
                    return ws.terminate();
                }
                ws.isAlive = false;
                ws.ping();
            });
        }, 30000);

        setInterval(() => {
            this.cleanupStaleRooms();
        }, 5 * 60 * 1000);
    }

    cleanupStaleRooms() {
        const now = Date.now();
        const staleThreshold = 30 * 60 * 1000;

        for (const [roomId, room] of this.rooms.entries()) {
            if (room.host && room.host.readyState !== WebSocket.OPEN) {
                this.log('info', `Cleaning up stale room: ${roomId}`);
                this.rooms.delete(roomId);
                continue;
            }

            if (room.createdAt && (now - room.createdAt) > staleThreshold) {
                this.log('info', `Cleaning up old room: ${roomId}`);
                if (room.host && room.host.readyState === WebSocket.OPEN) {
                    room.host.close(1000, 'Room expired');
                }
                this.rooms.delete(roomId);
            }
        }
    }

    handleMessage(ws, message) {
        if (!message.type) {
            this.log('warn', 'Message missing type field');
            return;
        }

        this.log('debug', 'Received message:', message.type);

        try {
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
                    this.log('warn', 'Unknown message type:', message.type);
            }
        } catch (error) {
            this.log('error', 'Error handling message:', error);
            ws.close(1011, 'Message processing error');
        }
    }

    handleCreateRoom(ws, message) {
        const { roomId } = message;

        if (!roomId || typeof roomId !== 'string' || roomId.length > 20) {
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid room ID' }));
            return;
        }

        if (this.rooms.size >= this.maxRooms) {
            ws.send(JSON.stringify({ type: 'error', message: 'Maximum rooms reached' }));
            return;
        }

        if (this.rooms.has(roomId)) {
            ws.send(JSON.stringify({ type: 'error', message: 'Room already exists' }));
            return;
        }

        this.rooms.set(roomId, {
            host: ws,
            viewers: new Set(),
            createdAt: Date.now()
        });

        this.connections.set(ws, {
            type: 'host',
            roomId: roomId
        });

        this.log('info', `Room created: ${roomId}`);

        ws.send(JSON.stringify({
            type: 'room-created',
            roomId: roomId
        }));
    }

    handleJoinRoom(ws, message) {
        const { roomId } = message;

        if (!roomId || typeof roomId !== 'string') {
            ws.send(JSON.stringify({ type: 'room-not-found' }));
            return;
        }

        if (!this.rooms.has(roomId)) {
            ws.send(JSON.stringify({ type: 'room-not-found' }));
            return;
        }

        const room = this.rooms.get(roomId);

        if (room.viewers.size >= 50) {
            ws.send(JSON.stringify({ type: 'error', message: 'Room is full' }));
            return;
        }

        const viewerId = this.generateViewerId();

        room.viewers.add(ws);
        this.connections.set(ws, {
            type: 'viewer',
            roomId: roomId,
            viewerId: viewerId
        });

        this.log('info', `Viewer ${viewerId} joined room: ${roomId}`);

        ws.send(JSON.stringify({
            type: 'room-joined',
            roomId: roomId,
            viewerId: viewerId
        }));

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

            if (room.host && room.host.readyState === WebSocket.OPEN) {
                room.host.send(JSON.stringify({
                    type: 'viewer-left',
                    viewerId: connection.viewerId
                }));
            }
        }

        this.connections.delete(ws);
        this.log('info', `${connection.type} left room: ${connection.roomId}`);
    }

    handleOffer(ws, message) {
        const { offer, viewerId } = message;
        const connection = this.connections.get(ws);

        if (!connection || connection.type !== 'host') return;

        const room = this.rooms.get(connection.roomId);
        if (!room) return;

        for (const viewer of room.viewers) {
            const viewerConnection = this.connections.get(viewer);
            if (viewerConnection && viewerConnection.viewerId === viewerId) {
                if (viewer.readyState === WebSocket.OPEN) {
                    viewer.send(JSON.stringify({
                        type: 'offer',
                        offer: offer
                    }));
                }
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

        if (room.host.readyState === WebSocket.OPEN) {
            room.host.send(JSON.stringify({
                type: 'answer',
                answer: answer,
                viewerId: connection.viewerId
            }));
        }
    }

    handleIceCandidate(ws, message) {
        const { candidate, viewerId } = message;
        const connection = this.connections.get(ws);

        if (!connection) return;

        const room = this.rooms.get(connection.roomId);
        if (!room) return;

        if (connection.type === 'host') {
            for (const viewer of room.viewers) {
                const viewerConnection = this.connections.get(viewer);
                if (viewerConnection && viewerConnection.viewerId === viewerId) {
                    if (viewer.readyState === WebSocket.OPEN) {
                        viewer.send(JSON.stringify({
                            type: 'ice-candidate',
                            candidate: candidate
                        }));
                    }
                    break;
                }
            }
        } else if (connection.type === 'viewer') {
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
            room.viewers.forEach(viewer => {
                if (viewer.readyState === WebSocket.OPEN) {
                    viewer.send(JSON.stringify({
                        type: 'host-disconnected'
                    }));
                }
            });

            this.rooms.delete(connection.roomId);
            this.log('info', `Host disconnected, room ${connection.roomId} closed`);
        } else if (connection.type === 'viewer') {
            room.viewers.delete(ws);

            if (room.host && room.host.readyState === WebSocket.OPEN) {
                room.host.send(JSON.stringify({
                    type: 'viewer-left',
                    viewerId: connection.viewerId
                }));
            }
            this.log('info', `Viewer ${connection.viewerId} disconnected from room ${connection.roomId}`);
        }

        this.connections.delete(ws);
    }

    generateViewerId() {
        return 'viewer_' + Math.random().toString(36).substr(2, 8);
    }

    log(level, ...args) {
        const levels = { error: 0, warn: 1, info: 2, debug: 3 };
        const currentLevel = levels[this.logLevel] || 2;

        if (levels[level] <= currentLevel) {
            const timestamp = new Date().toISOString();
            console.log(`[${timestamp}] [${level.toUpperCase()}]`, ...args);
        }
    }

    start() {
        this.server.listen(this.port, '0.0.0.0', () => {
            this.log('info', `🎤 Karaoke signaling server (HTTPS) running on port ${this.port}`);
            this.log('info', `Access at: https://localhost:${this.port} (accept certificate warning)`);
            this.log('info', `For mobile: https://192.168.29.222:${this.port} (accept certificate warning)`);
            this.log('info', `Environment: ${process.env.NODE_ENV || 'development'}`);
            this.log('info', `Max connections: ${this.maxConnections}`);
        });

        process.on('SIGTERM', () => {
            this.log('info', 'Received SIGTERM, shutting down gracefully');
            this.server.close(() => {
                this.log('info', 'Server closed');
                process.exit(0);
            });
        });
    }
}

const server = new SignalingServer();
server.start();