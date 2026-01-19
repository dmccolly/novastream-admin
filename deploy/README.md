# NovaStream Deployment Guide

This project uses a **Hybrid Deployment** strategy:
1.  **Frontend**: Hosted on **Netlify** (Free, Fast, CDN).
2.  **Backend**: Hosted on a **VPS** (DigitalOcean/Hetzner) for 24/7 streaming.

---

## Part 1: Frontend (Netlify)

1.  Push this repository to your GitHub.
2.  Log in to [Netlify](https://app.netlify.com/).
3.  Click **"Add new site"** -> **"Import from Git"**.
4.  Select this repository (`novastream-admin`).
5.  Netlify will detect the `netlify.toml` file and configure everything automatically.
6.  **Important**: Go to **Site Settings > Environment Variables** and add:
    *   `VITE_API_URL`: `http://<YOUR_VPS_IP>:3001` (You will get this IP in Part 2).

---

## Part 2: Backend (VPS)

### 1. Get a Server
*   Sign up for **DigitalOcean** or **Hetzner**.
*   Create a new server (Droplet/Cloud Server) with **Ubuntu 22.04** or **24.04**.
*   **Specs**: 1 vCPU / 2GB RAM is enough to start.

### 2. Run the Setup Script
SSH into your new server and run these commands:

```bash
# Copy the setup script from this repo to your server
scp deploy/setup_vps.sh root@<YOUR_SERVER_IP>:~/

# SSH into the server
ssh root@<YOUR_SERVER_IP>

# Run the script
chmod +x setup_vps.sh
./setup_vps.sh
```

### 3. Deploy the Code
Back on your local machine (or wherever you have the code):

```bash
# Copy the server code to the VPS
scp -r server root@<YOUR_SERVER_IP>:~/novastream-backend/
scp package.json root@<YOUR_SERVER_IP>:~/novastream-backend/
```

### 4. Start the Server
SSH back into the server:

```bash
cd ~/novastream-backend
npm install
npm run build # If using TypeScript
pm2 start dist/index.js --name novastream-api
pm2 save
pm2 startup
```

### 5. Configure Icecast & Liquidsoap
*   Edit `/etc/icecast2/icecast.xml` to change passwords if needed.
*   Ensure Liquidsoap is running (it might need a separate systemd service or PM2 process).

---

## Troubleshooting
*   **CORS Errors**: Ensure your VPS firewall allows traffic on port 3001.
*   **Audio Issues**: Check `liquidsoap` logs.
