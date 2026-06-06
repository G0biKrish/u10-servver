# 🚀 Oracle Free VM — Nakama Auto-Deploy Guide

Deploy **U10 Nakama** on Oracle Cloud Always-Free VM with:
- Docker + docker-compose (Nakama + Postgres)
- GitHub Actions CI/CD (auto-deploy on every push to `main`)
- Caddy reverse proxy (automatic HTTPS)
- Systemd watchdog (auto-restart on reboot/crash)

---

## 🏗️ Architecture Overview

```
GitHub Push → GitHub Actions → SSH into Oracle VM → git pull → docker-compose up
                                                         ↓
                                                   [Oracle VM]
                                             Caddy (HTTPS :443/:80)
                                                    ↓
                                            Nakama (:7350)
                                                    ↓
                                           Postgres (:5432, internal)
```

---

## PART 1 — First-Time VM Setup (do once via SSH)

### 1.1 Connect to your VM

```bash
ssh ubuntu@<YOUR_ORACLE_VM_PUBLIC_IP>
```
> Oracle uses `ubuntu` user for Ubuntu images, `opc` for Oracle Linux.

---

### 1.2 Install Docker & Docker Compose

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sh

# Add your user to docker group (no sudo needed)
sudo usermod -aG docker $USER
newgrp docker

# Verify
docker --version
docker compose version
```

---

### 1.3 Open Firewall Ports (Oracle Security List)

> **Critical** — Oracle has TWO firewalls. You must open both.

**A) Oracle Cloud Console (Security List):**
1. Go to: Networking → Virtual Cloud Networks → Your VCN → Security Lists
2. Add **Ingress Rules**:

| Protocol | Source CIDR | Port Range | Description |
|----------|------------|------------|-------------|
| TCP | 0.0.0.0/0 | 80 | HTTP (Caddy redirect) |
| TCP | 0.0.0.0/0 | 443 | HTTPS (Caddy) |
| TCP | 0.0.0.0/0 | 7349 | Nakama gRPC |
| TCP | 0.0.0.0/0 | 7350 | Nakama HTTP API |
| TCP | 0.0.0.0/0 | 7351 | Nakama console |
| TCP | 0.0.0.0/0 | 22 | SSH (should already exist) |

**B) VM OS Firewall (iptables):**
```bash
sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 7349 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 7350 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 7351 -j ACCEPT

# Save rules so they persist on reboot
sudo apt install -y iptables-persistent
sudo netfilter-persistent save
```

---

### 1.4 Install Caddy (Automatic HTTPS)

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy -y
```

---

### 1.5 Configure Caddy

> Replace `your-domain.com` with your actual domain (or Oracle's public IP if you don't have one).

**If you have a domain:**
```bash
sudo nano /etc/caddy/Caddyfile
```
```caddyfile
your-domain.com {
    reverse_proxy localhost:7350
}
```

**If you only have an IP (no domain):**
```bash
sudo nano /etc/caddy/Caddyfile
```
```caddyfile
:80 {
    reverse_proxy localhost:7350
}
```
> ⚠️ Without a domain you can't get HTTPS via Caddy. You'd access Nakama on plain HTTP port 80, or keep using port 7350 directly.

```bash
sudo systemctl enable caddy
sudo systemctl restart caddy
```

---

### 1.6 Clone your Nakama repo on the VM

```bash
# Create app directory
mkdir -p ~/u10-server
cd ~/u10-server

# Clone (use HTTPS or SSH)
git clone https://github.com/G0biKrish/u10-servver.git .
```

---

### 1.7 Create the `.env` file (production secrets)

```bash
nano ~/u10-server/.env
```

```env
# Postgres
POSTGRES_DB=nakama
POSTGRES_USER=nakama
POSTGRES_PASSWORD=CHANGE_THIS_STRONG_PASSWORD

# Nakama DB URL (used by docker-compose override)
DATABASE_URL=nakama:CHANGE_THIS_STRONG_PASSWORD@postgres:5432/nakama?sslmode=disable

# Nakama Console & API Keys
CONSOLE_USERNAME=admin
CONSOLE_PASSWORD=CHANGE_THIS_TO_SECURE_CONSOLE_PASSWORD
SERVER_KEY=CHANGE_THIS_TO_SECURE_GAME_SOCKET_KEY
```

> **Never commit `.env` to git.** The `.gitignore` should already exclude it.

---

### 1.8 Create a production docker-compose override

```bash
nano ~/u10-server/docker-compose.prod.yml
```

```yaml
version: '3.8'
services:
  postgres:
    environment:
      - POSTGRES_DB=${POSTGRES_DB}
      - POSTGRES_USER=${POSTGRES_USER}
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
    restart: always

  nakama:
    image: heroiclabs/nakama:3.22.0
    entrypoint:
      - "/bin/sh"
      - "-ec"
      - >
        /nakama/nakama migrate up --database.address "${DATABASE_URL}" &&
        exec /nakama/nakama
        --database.address "${DATABASE_URL}"
        --runtime.js_entrypoint index.js
        --logger.level info
        --session.token_expiry_sec 7200
        --console.username "${CONSOLE_USERNAME:-admin}"
        --console.password "${CONSOLE_PASSWORD:-password}"
        --socket.server_key "${SERVER_KEY:-defaultkey}"
    volumes:
      - ./nakama_modules:/nakama/data/modules
    ports:
      - "7349:7349"
      - "7350:7350"
      - "7351:7351"
    restart: always
    env_file:
      - .env
```

---

### 1.9 First manual launch (verify everything works)

```bash
cd ~/u10-server
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# Watch logs
docker compose logs -f nakama
```

Check it's alive:
```bash
curl http://localhost:7350/
# Should return: {"status":"ok"} or similar
```

---

### 1.10 Create systemd service (auto-start on reboot)

```bash
sudo nano /etc/systemd/system/u10-nakama.service
```

```ini
[Unit]
Description=U10 Nakama Game Server
Requires=docker.service
After=docker.service network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/home/ubuntu/u10-server
ExecStart=/usr/bin/docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
ExecStop=/usr/bin/docker compose -f docker-compose.yml -f docker-compose.prod.yml down
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable u10-nakama
sudo systemctl start u10-nakama
```

---

## PART 2 — GitHub Actions Auto-Deploy

### 2.1 Create a deploy SSH key pair (on your local Windows machine)

```powershell
# Run in PowerShell
ssh-keygen -t ed25519 -C "github-deploy-u10" -f "$env:USERPROFILE\.ssh\u10_deploy_key" -N ""
```

This creates:
- `u10_deploy_key` — private key (goes into GitHub)  
- `u10_deploy_key.pub` — public key (goes onto the VM)

---

### 2.2 Add public key to the Oracle VM

```bash
# On the VM
echo "PASTE_PUBLIC_KEY_HERE" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

---

### 2.3 Add GitHub Secrets

In your repo: **Settings → Secrets and variables → Actions → New repository secret**

| Secret Name | Value |
|-------------|-------|
| `ORACLE_HOST` | Your VM's public IP address |
| `ORACLE_USER` | `ubuntu` (or `opc` for Oracle Linux) |
| `ORACLE_SSH_KEY` | Contents of `u10_deploy_key` (private key) |
| `ORACLE_PORT` | `22` |

---

### 2.4 Create the GitHub Actions workflow

Create this file in your repo:

**`.github/workflows/deploy.yml`**

```yaml
name: Deploy Nakama to Oracle VM

on:
  push:
    branches: [ main ]

jobs:
  deploy:
    name: SSH Deploy
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Deploy to Oracle VM via SSH
        uses: appleboy/ssh-action@v1.0.3
        with:
          host: ${{ secrets.ORACLE_HOST }}
          username: ${{ secrets.ORACLE_USER }}
          key: ${{ secrets.ORACLE_SSH_KEY }}
          port: ${{ secrets.ORACLE_PORT }}
          script: |
            set -e
            cd ~/u10-server

            echo "--- Pulling latest code ---"
            git pull origin main

            echo "--- Rebuilding and restarting Nakama ---"
            docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build --remove-orphans

            echo "--- Cleaning old images ---"
            docker image prune -f

            echo "--- Deploy complete ---"
            docker compose ps
```

---

### 2.5 Commit and push the workflow

```powershell
# On your local machine (in u10-server directory)
git add .github/workflows/deploy.yml
git commit -m "ci: add Oracle VM auto-deploy workflow"
git push
```

GitHub Actions will now trigger automatically on every push to `main`. ✅

---

## PART 3 — Verify the Pipeline

### Check a deployment run
1. Go to your GitHub repo → **Actions** tab
2. Click the latest workflow run
3. Watch the **SSH Deploy** step logs in real-time

### Check Nakama is running on the VM
```bash
# SSH into the VM
docker compose -f ~/u10-server/docker-compose.yml ps
docker logs u10-nakama --tail 50
```

### Test the public endpoint
```bash
curl https://your-domain.com/
# or
curl http://<ORACLE_IP>:7350/
```

---

## PART 4 — Update Config Server to use Oracle VM

Once Nakama is running on Oracle, update your **config portal** to point to the Oracle IP/domain.

In `d:\GodotGames\config-server\index.html`, change the default host in the login form:
```html
<input type="text" id="login-host" value="your-domain.com" ...>
```

---

## 🔒 Security Checklist

- [ ] `.env` is in `.gitignore` — secrets never committed
- [ ] Oracle Security List only opens required ports
- [ ] SSH key is `ed25519` (modern, secure)
- [ ] Postgres only accessible internally (not exposed publicly)
- [ ] Caddy handles HTTPS termination — Nakama never sees raw TLS
- [ ] `restart: always` on both services

---

## 🛠️ Useful Commands

```bash
# View running containers
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps

# View Nakama logs (live)
docker compose logs -f nakama

# Restart Nakama only
docker compose restart nakama

# Full redeploy manually
cd ~/u10-server && git pull && docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

# Check systemd service
sudo systemctl status u10-nakama
```
