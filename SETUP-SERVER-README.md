# Geode Dapp Search – Server Setup & Deployment Documentation

## Overview
This document provides the technical setup and deployment guide for the **Geode CrossChain Dapp Search backend** on a **Contabo VPS**. It explains how to configure **Nginx reverse proxy**, secure the service with **SSL**, manage processes with **PM2**, and automate deployments using a **GitHub webhook listener**.

- **Backend:** Express.js application running on **port 3001**
- **Domain:** [https://geode-dappsearch.com](https://geode-dappsearch.com)
- **Process Manager:** PM2 (manages backend + webhook listener)
- **Automation:** GitHub webhook pulls latest changes from the `crosschainDappsearch-api` branch
<!-- 
This documentation is for **internal employees** to understand, maintain, and troubleshoot the system. -->

---

## 1. Server Environment
- Provider: **Contabo VPS**
- OS: **Ubuntu 20.04 LTS**
- Backend: **Express.js app (server.js)** on port `3001`
- Process Manager: **PM2**
- Reverse Proxy & SSL: **Nginx + Zero SSL**
- Deployment Automation: **GitHub Webhook + Node.js listener**

---

## 2. Initial Setup

### Install Required Packages
```bash
sudo apt update
sudo apt install nginx git curl -y
```

### Install Node.js & PM2
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
```

### Clone Repository
```bash
cd /root
git clone https://github.com/geodechain/Geode-CrossChainDappSearch-Api.git
cd Geode-CrossChainDappSearch-Api
git checkout prod
npm install
```

---

## 3. Nginx Reverse Proxy

### Configuration File
`/etc/nginx/sites-available/geode-dappsearch`
```nginx
  GNU nano 7.2                                   geode-dappsearch.com
server {
    listen 80;
    server_name geode-dappsearch.com;

    return 301 https://$host$request_uri;
}

# HTTPS server
server {
    listen 443 ssl;
    server_name geode-dappsearch.com;

    ssl_certificate /etc/nginx/ssl/certificate.crt;
    ssl_certificate_key /etc/nginx/ssl/private.key;
    ssl_trusted_certificate /etc/nginx/ssl/ca_bundle.crt;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_cache_bypass $http_upgrade;
    }

location /webhook {
    proxy_pass http://localhost:3002/webhook;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
}

```

### Enable & Reload
```bash
sudo ln -sf /etc/nginx/sites-available/geode-dappsearch /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## 4. Backend Express Application

The backend API is an **Express.js app** running on port `3001`.

### Start with PM2
```bash
cd /root/Geode-ccdapp-api
pm2 start --name crosschain-api
pm2 save
```

### Check status and logs
```bash
pm2 status
pm2 logs crosschain-api
```

---

## 5. Webhook Listener for Auto-Deploy

A **Node.js Express app** listens for GitHub push events and triggers deployment.

### Listener Code
`/root/webhook-listener/app.js`
```javascript
const express = require('express');
const crypto = require('crypto');
const { exec } = require('child_process');
const app = express();
const secret = 'geodesecretccdapp0725';

app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

app.post('/webhook', (req, res) => {
  const sig = req.headers['x-hub-signature-256'];
  const hmac = crypto.createHmac('sha256', secret);
  const digest = 'sha256=' + hmac.update(req.rawBody).digest('hex');

  if (sig !== digest) {
    console.log('Invalid signature');
    return res.sendStatus(403);
  }

  const branch = req.body.ref;
  if (branch !== 'refs/heads/prod') {
    console.log(`ℹ️ Ignoring push to ${branch}`);
    return res.sendStatus(200);
  }

  console.log('✅ Webhook verified. Deploying...');

  exec(`
    cd /root/Geode-ccdapp-api && \
    git fetch origin prod && \
    git reset --hard origin/prod && \
    npm install && \
    pm2 restart geode-ccdapp-api
  `, (err, stdout, stderr) => {
    if (err) {
      console.error('Deployment failed:', stderr);
      return res.sendStatus(500);
    }
    console.log('✅ Deployment success:\n', stdout);
    res.sendStatus(200);
  });
});

app.listen(3002, () => {
  console.log('Listening for webhook on port 3002');
});

```

### Run with PM2
```bash
cd /root/webhook
pm2 start webhook.js --name webhook-listener
pm2 save
```

---

## 7. PM2 Process Management

### Common Commands
```bash
# List processes
pm2 status

# Restart services
pm2 restart crosschain-api
pm2 restart webhook-listener

# Stop or delete
pm2 stop crosschain-api
pm2 delete webhook-listener

# View logs
pm2 logs crosschain-api
pm2 logs webhook-listener

# Save config & startup
pm2 save
pm2 startup systemd
```

---

## 8. Troubleshooting

### Nginx
```bash
sudo nginx -t
sudo systemctl reload nginx
sudo systemctl status nginx
tail -f /var/log/nginx/error.log
```

### Backend / Webhook
```bash
pm2 logs crosschain-api
pm2 logs webhook-listener
```

### Manual Git Reset
```bash
cd /root/Geode-ccdapp-api
git fetch origin prod
git reset --hard origin/prod
```

---

## 9. Maintenance Notes
- SSL certificates via ZeroSSL .  
- Always run `pm2 save` after modifying processes.  
- Monitor webhook + backend logs after deployments.  
---