# MARKETING OS v3 GLOBAL — Deployment Guide

## Option A: Railway (Recommended — Easiest)

Railway auto-detects Node.js projects and handles HTTPS, env vars, and domains.

```bash
# 1. Install Railway CLI
npm install -g @railway/cli

# 2. Login
railway login

# 3. From your project folder
railway init
railway up

# 4. Set environment variables in Railway dashboard
# Go to your project → Variables → Add all from .env.example

# 5. Get your public URL from Railway dashboard
# Update ALLOWED_ORIGINS with your Railway URL
```

---

## Option B: Render

```bash
# 1. Push code to GitHub first
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/yourusername/marketing-os-v3.git
git push -u origin main

# 2. Go to render.com → New → Web Service
# Connect your GitHub repo
# Build command: npm install
# Start command: npm start
# Add all environment variables from .env.example
```

---

## Option C: VPS with PM2 (Full Control)

```bash
# On your server (Ubuntu 20.04+)

# 1. Install the pinned Node runtime via nvm (version comes from .nvmrc)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install    # reads .nvmrc → 24.20.0
nvm use

# 2. Install PM2
npm install -g pm2

# 3. Clone your project
git clone https://github.com/yourusername/marketing-os-v3.git
cd marketing-os-v3

# 4. Install dependencies
npm install

# 5. Create .env from template
cp .env.example .env
nano .env  # Fill in all values

# 6. Verify Airtable connection
npm run setup

# 7. Start with PM2
pm2 start src/server.js --name marketing-os-v3

# 8. Auto-restart on server reboot
pm2 save
pm2 startup

# 9. Configure nginx reverse proxy
sudo apt install nginx
sudo nano /etc/nginx/sites-available/marketing-os
```

Nginx config:
```nginx
server {
    server_name yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 120s;
    }
}
```

```bash
# Enable site and get SSL via Certbot
sudo ln -s /etc/nginx/sites-available/marketing-os /etc/nginx/sites-enabled/
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com
sudo nginx -t && sudo systemctl reload nginx
```

---

## Post-Deployment Checklist

```
□ Health check returns 200: curl https://yourdomain.com/health
□ Frontend loads at https://yourdomain.com (Clerk sign-in appears)
□ Set WEBHOOK_SECRET in .env (server-side only — never expose to frontend)
□ Set CLERK_PUBLISHABLE_KEY in .env (injected into index.html server-side)
□ Set NODE_ENV=production in .env
□ Update ALLOWED_ORIGINS with your production domain
□ Test full onboarding flow end-to-end
□ Verify Airtable records are being created
□ Verify Gmail notifications are sending
□ Set up uptime monitoring (UptimeRobot free plan)
□ Set up Airtable automations for backup if needed
```

---

## Gmail App Password Setup

Gmail requires an App Password (not your regular password) for SMTP:

1. Go to myaccount.google.com/security
2. Enable 2-Step Verification (required)
3. Go to myaccount.google.com/apppasswords
4. Select app: Mail, device: Other (custom name)
5. Enter "MARKETING OS" as the name
6. Copy the 16-character password
7. Add to `.env` as `GMAIL_APP_PASSWORD`

**Important**: Never use your regular Gmail password. Only App Passwords work for SMTP.

---

## Scaling Considerations

### Airtable Limits
- Free plan: 1,000 records, 5 API requests/second
- Pro plan: 50,000 records, unlimited API requests
- For high volume: consider migrating to PostgreSQL + Prisma

### Claude API Rate Limits
- Default: 50 requests/minute for claude-sonnet-4-5
- Increase via console.anthropic.com → rate limit increase request

### Response Time Optimization
- Claude API typically responds in 2-8 seconds
- For faster UX, implement streaming responses using `stream: true` in Claude API calls
- See Anthropic streaming docs: docs.anthropic.com/en/api/streaming
