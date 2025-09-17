#!/bin/bash

# Get the server's IP address
IP=$(hostname -I | awk '{print $1}')

# Create SSL directory if it doesn't exist
mkdir -p ssl

# Generate self-signed certificate with IP SAN
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout ssl/server.key \
  -out ssl/server.crt \
  -subj "/C=US/ST=State/L=City/O=WebRTC-Karaoke/CN=${IP}" \
  -addext "subjectAltName=IP:${IP},IP:127.0.0.1,DNS:localhost"

echo "SSL certificate generated for IP: ${IP}"
echo "Certificate: ssl/server.crt"
echo "Private key: ssl/server.key"

# Set appropriate permissions
chmod 600 ssl/server.key
chmod 644 ssl/server.crt

echo "SSL certificate setup complete!"