#!/bin/sh

# Install OpenSSL
apk add --no-cache openssl

# Create SSL directory
mkdir -p /etc/nginx/ssl

# Generate a browser-compatible SSL certificate
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /etc/nginx/ssl/server.key \
  -out /etc/nginx/ssl/server.crt \
  -subj "/C=US/ST=State/L=City/O=WebRTC-Karaoke/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,DNS:*.localhost,IP:127.0.0.1,IP:0.0.0.0,IP:192.168.0.1,IP:192.168.1.1,IP:192.168.29.115,IP:10.0.0.1,IP:172.17.0.1" \
  -addext "keyUsage=digitalSignature,keyEncipherment" \
  -addext "extendedKeyUsage=serverAuth"

# Set permissions
chmod 600 /etc/nginx/ssl/server.key
chmod 644 /etc/nginx/ssl/server.crt

echo "SSL certificate generated successfully"

# Start nginx
exec nginx -g 'daemon off;'
