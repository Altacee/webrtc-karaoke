#!/bin/sh

# This script runs inside the Docker container to generate SSL certs for any IP

# Create SSL directory
mkdir -p /etc/nginx/ssl

# Generate a wildcard certificate that accepts any IP/hostname
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /etc/nginx/ssl/server.key \
  -out /etc/nginx/ssl/server.crt \
  -subj "/C=US/ST=State/L=City/O=WebRTC-Karaoke/CN=*" \
  -addext "subjectAltName=DNS:*,DNS:localhost,IP:127.0.0.1,IP:0.0.0.0,IP:192.168.0.0/16,IP:10.0.0.0/8,IP:172.16.0.0/12" \
  -config <(
    echo '[req]'
    echo 'distinguished_name = req'
    echo '[v3_req]'
    echo 'subjectAltName = @alt_names'
    echo '[alt_names]'
    echo 'DNS.1 = *'
    echo 'DNS.2 = localhost'
    echo 'IP.1 = 127.0.0.1'
    echo 'IP.2 = 0.0.0.0'
  ) 2>/dev/null || {
    # Fallback simpler version if the above doesn't work
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
      -keyout /etc/nginx/ssl/server.key \
      -out /etc/nginx/ssl/server.crt \
      -subj "/C=US/ST=State/L=City/O=WebRTC-Karaoke/CN=localhost"
  }

# Set permissions
chmod 600 /etc/nginx/ssl/server.key
chmod 644 /etc/nginx/ssl/server.crt

echo "SSL certificate generated for container"
