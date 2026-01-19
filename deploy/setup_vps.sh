#!/bin/bash

# NovaStream Radio - VPS Setup Script
# This script installs all dependencies for the backend server on Ubuntu 22.04/24.04

set -e

echo ">>> Updating system packages..."
sudo apt-get update && sudo apt-get upgrade -y

echo ">>> Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

echo ">>> Installing Icecast2..."
# Pre-seed answers for Icecast installation to avoid interactive prompts
echo "icecast2 icecast2/adminpassword password admin" | sudo debconf-set-selections
echo "icecast2 icecast2/hackme password hackme" | sudo debconf-set-selections
echo "icecast2 icecast2/hostname string localhost" | sudo debconf-set-selections
sudo apt-get install -y icecast2

echo ">>> Installing Liquidsoap and FFmpeg..."
sudo apt-get install -y liquidsoap ffmpeg

echo ">>> Installing PM2 (Process Manager)..."
sudo npm install -g pm2

echo ">>> Creating project directory..."
mkdir -p ~/novastream-backend
cd ~/novastream-backend

echo ">>> Setup Complete!"
echo "Next steps:"
echo "1. Upload your 'server' folder to ~/novastream-backend"
echo "2. Run 'npm install' inside that folder"
echo "3. Start the server with 'pm2 start index.ts --interpreter node --name novastream-api'"
echo "4. Configure Icecast at /etc/icecast2/icecast.xml if needed"
