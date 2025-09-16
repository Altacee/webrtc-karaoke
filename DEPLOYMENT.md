# WebRTC Karaoke - Production Deployment Guide

## Overview

This guide covers deploying the WebRTC Karaoke system in production using Docker, with proper security, monitoring, and scalability considerations.

## Prerequisites

- Docker and Docker Compose installed
- SSL certificates for HTTPS (required for WebRTC in production)
- Domain name pointing to your server
- Minimum 2GB RAM, 2 CPU cores

## Quick Start with Docker

### 1. Clone and Setup

```bash
git clone <your-repo-url>
cd webrtc-karaoke

# Copy environment configuration
cp .env.example .env

# Edit configuration
nano .env
```

### 2. SSL Setup

Create SSL certificates directory:
```bash
mkdir -p ssl
```

Option A - Self-signed (development/testing):
```bash
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout ssl/key.pem \
  -out ssl/cert.pem \
  -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost"
```

Option B - Let's Encrypt (production):
```bash
# Install certbot
sudo apt-get install certbot

# Generate certificate
sudo certbot certonly --standalone -d your-domain.com

# Copy certificates
sudo cp /etc/letsencrypt/live/your-domain.com/fullchain.pem ssl/cert.pem
sudo cp /etc/letsencrypt/live/your-domain.com/privkey.pem ssl/key.pem
sudo chown $USER:$USER ssl/*.pem
```

### 3. Deploy

```bash
# Build and start services
docker-compose up -d

# Check status
docker-compose ps

# View logs
docker-compose logs -f
```

### 4. Access

- HTTPS: https://your-domain.com
- HTTP: http://your-domain.com (redirects to HTTPS)
- Health Check: https://your-domain.com/health
- Metrics: https://your-domain.com/metrics

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | production | Environment mode |
| `PORT` | 8080 | Application port |
| `LOG_LEVEL` | info | Logging level (error, warn, info, debug) |
| `MAX_CONNECTIONS` | 1000 | Maximum WebSocket connections |
| `MAX_ROOMS` | 100 | Maximum concurrent rooms |

### Docker Compose Services

#### webrtc-karaoke
- Main application container
- Handles HTTP and WebSocket connections
- Auto-restarts on failure
- Health checks every 30 seconds

#### nginx
- Reverse proxy and SSL termination
- Rate limiting and security headers
- Static file serving with caching
- WebSocket proxy support

## Security Features

### Network Security
- HTTPS/WSS encryption
- Rate limiting (100 req/15min per IP)
- Security headers (HSTS, CSP, etc.)
- Input validation and sanitization

### Application Security
- Connection limits per room
- Message size limits (16KB)
- Automatic cleanup of stale connections
- Error handling without information leakage

### Container Security
- Non-root user execution
- Minimal base images (Alpine Linux)
- No unnecessary packages
- Resource limits

## Monitoring and Logging

### Health Checks

The application provides several monitoring endpoints:

```bash
# Application health
curl https://your-domain.com/health

# Detailed metrics
curl https://your-domain.com/metrics
```

### Log Management

View application logs:
```bash
# All services
docker-compose logs -f

# Application only
docker-compose logs -f webrtc-karaoke

# Nginx only
docker-compose logs -f nginx
```

### Metrics Collection

The application exposes metrics for monitoring tools:

- Active rooms count
- Active connections count
- Memory usage
- Uptime

## Scaling and Performance

### Horizontal Scaling

For multiple server instances, you'll need:

1. **Load Balancer**: Distribute HTTP traffic
2. **Session Affinity**: WebSocket connections must stick to same server
3. **Shared State**: Redis for room/connection state (future enhancement)

Example nginx load balancer config:
```nginx
upstream webrtc_backend {
    ip_hash; # Session affinity
    server server1:8080;
    server server2:8080;
    server server3:8080;
}
```

### Resource Optimization

#### Memory
- Each WebSocket connection: ~1-2MB
- Each room: ~100-500KB
- Video streams: Handled peer-to-peer (no server load)

#### CPU
- Primarily I/O bound
- WebSocket message routing
- JSON parsing/serialization

#### Network
- Signaling only (low bandwidth)
- Media streams are peer-to-peer
- ~1KB/sec per active connection

### Performance Tuning

```yaml
# docker-compose.yml adjustments
services:
  webrtc-karaoke:
    deploy:
      resources:
        limits:
          memory: 512M
          cpus: '0.5'
        reservations:
          memory: 256M
          cpus: '0.25'
```

## Backup and Recovery

### Data to Backup
- SSL certificates (`ssl/` directory)
- Configuration files (`.env`, `nginx.conf`)
- Application logs (if persisted)

### Backup Script
```bash
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/backups/webrtc-karaoke"

mkdir -p $BACKUP_DIR

# Backup configuration
tar -czf "$BACKUP_DIR/config_$DATE.tar.gz" \
  .env docker-compose.yml nginx.conf ssl/

# Backup logs
docker-compose logs webrtc-karaoke > "$BACKUP_DIR/app_$DATE.log"
docker-compose logs nginx > "$BACKUP_DIR/nginx_$DATE.log"
```

## Troubleshooting

### Common Issues

#### WebSocket Connection Fails
```bash
# Check firewall
sudo ufw status

# Check if port is listening
netstat -tlnp | grep 8080

# Check container logs
docker-compose logs webrtc-karaoke
```

#### SSL Certificate Issues
```bash
# Test certificate
openssl s_client -connect your-domain.com:443

# Check certificate expiry
openssl x509 -in ssl/cert.pem -text -noout | grep "Not After"
```

#### High Memory Usage
```bash
# Check container stats
docker stats

# Restart services
docker-compose restart
```

### Log Analysis

Important log patterns to monitor:

```bash
# Connection issues
grep -i "connection\|disconnect" logs/

# Error patterns
grep -i "error\|failed\|exception" logs/

# Performance issues
grep -i "timeout\|slow\|overload" logs/
```

## Maintenance

### Regular Tasks

#### Daily
- Monitor resource usage
- Check error logs
- Verify health endpoints

#### Weekly
- Update SSL certificates (if needed)
- Review connection metrics
- Clean old log files

#### Monthly
- Update Docker images
- Security patch review
- Performance analysis

### Update Process

```bash
# 1. Backup current setup
./backup.sh

# 2. Pull latest code
git pull origin main

# 3. Rebuild and deploy
docker-compose down
docker-compose build --no-cache
docker-compose up -d

# 4. Verify deployment
curl https://your-domain.com/health
```

## Security Checklist

- [ ] SSL certificates installed and valid
- [ ] Firewall configured (only 80, 443, 22 open)
- [ ] Rate limiting enabled
- [ ] Security headers configured
- [ ] Regular updates scheduled
- [ ] Monitoring alerts configured
- [ ] Backup system in place
- [ ] Access logs reviewed regularly

## Support

For issues or questions:

1. Check application logs: `docker-compose logs -f`
2. Verify health endpoint: `curl https://your-domain.com/health`
3. Review this documentation
4. Open GitHub issue with logs and configuration (sanitized)

## Advanced Configuration

### Custom STUN/TURN Servers

For better connectivity across firewalls/NAT:

```javascript
// In production client code
const iceServers = [
    { urls: 'stun:your-stun-server.com:3478' },
    {
        urls: 'turn:your-turn-server.com:3478',
        username: 'username',
        credential: 'password'
    }
];
```

### Integration with CDN

For global deployment:

1. Use CloudFlare or similar CDN
2. Configure WebSocket proxy
3. Enable geographic routing
4. Set up multiple origin servers

### Monitoring Integration

Example Prometheus configuration:

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'webrtc-karaoke'
    static_configs:
      - targets: ['localhost:8080']
    metrics_path: '/metrics'
```

This completes your production-ready WebRTC Karaoke deployment!