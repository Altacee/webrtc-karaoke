# WebRTC Karaoke System

A simple WebRTC-based karaoke system that allows one device to share a browser tab and other devices to join and view the shared content in real-time.

## Features

- **Tab Sharing**: Host can share any browser tab with audio and video
- **Real-time Viewing**: Multiple viewers can join and watch the shared content
- **Simple Interface**: Easy-to-use web interface for both hosts and viewers
- **Room-based System**: Uses room IDs for secure, private sessions

## How It Works

1. **Host**: Starts tab sharing and creates a room with a unique ID
2. **Viewers**: Join using the room ID to watch the shared content
3. **WebRTC**: Direct peer-to-peer connection for low-latency streaming
4. **Signaling Server**: Coordinates connections between host and viewers

## Setup and Installation

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Start the Server**:
   ```bash
   npm start
   ```

3. **Open in Browser**:
   - Navigate to `http://localhost:8080`
   - Choose "Host" to share a tab or "Viewer" to join a session

## Usage

### For Hosts:
1. Click "Host (Share Tab)" on the main page
2. Click "Start Sharing Tab"
3. Select the browser tab you want to share
4. Share the generated Room ID with viewers
5. Viewers will appear in the "Connected Viewers" count

### For Viewers:
1. Click "Viewer (Join Session)" on the main page
2. Enter the Room ID provided by the host
3. Click "Join Session"
4. The shared content will appear automatically

## Technical Details

- **Frontend**: Vanilla JavaScript with WebRTC APIs
- **Backend**: Node.js with Express and WebSocket (ws)
- **WebRTC**: Uses STUN servers for NAT traversal
- **Screen Capture**: Uses `getDisplayMedia()` API for tab sharing

## Browser Requirements

- Modern browsers that support WebRTC and `getDisplayMedia()`
- Chrome, Firefox, Safari, Edge (recent versions)
- HTTPS required for production (works on localhost for development)

## Architecture

```
┌─────────────┐    WebSocket     ┌─────────────────┐    WebSocket     ┌─────────────┐
│    Host     │◄─────────────────┤ Signaling Server │─────────────────►│   Viewer    │
│             │                  │                 │                  │             │
└─────────────┘                  └─────────────────┘                  └─────────────┘
       │                                                                      ▲
       │                           WebRTC P2P Connection                       │
       └──────────────────────────────────────────────────────────────────────┘
```

## Files Structure

- `index.html` - Main landing page
- `host.html` - Host interface for tab sharing
- `viewer.html` - Viewer interface for watching
- `host.js` - Host-side WebRTC and UI logic
- `viewer.js` - Viewer-side WebRTC and UI logic
- `server.js` - WebSocket signaling server
- `package.json` - Node.js dependencies

## Troubleshooting

- **No video/audio**: Ensure browser permissions for screen sharing
- **Connection fails**: Check that port 8080 is available
- **No STUN server**: May not work across different networks without TURN server
- **Tab sharing not available**: Use modern browser with `getDisplayMedia()` support