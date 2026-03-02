# Deployment Guide – BKW Solar Dashboard

## Überblick

Das Deployment läuft vollautomatisch via **GitHub Actions** bei jedem Push auf `main`:

```
Push → main
  │
  ▼
GitHub Actions (ubuntu-latest)
  ├── npm ci --legacy-peer-deps
  ├── vite build  →  build/
  ├── rsync build/ + package*.json + ecosystem.config.cjs → VPS
  ├── ssh: npm ci --omit=dev
  └── ssh: pm2 restart ecosystem.config.cjs
```

---

## 1. VPS einrichten (einmalig)

### Node.js 22 installieren

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v   # muss >= 22.x sein
```

### PM2 global installieren

```bash
sudo npm install -g pm2
```

### Log-Verzeichnis anlegen

```bash
sudo mkdir -p /var/log/bkw
sudo chown $USER:$USER /var/log/bkw
```

### Deploy-Verzeichnis anlegen

```bash
sudo mkdir -p /opt/bkw
sudo chown $USER:$USER /opt/bkw
```

> Wenn du einen anderen Pfad möchtest, `cwd` in `ecosystem.config.cjs` anpassen
> und `DEPLOY_PATH` in den GitHub Secrets entsprechend setzen.

### PM2 beim Systemstart aktivieren

```bash
pm2 startup
# Den ausgegebenen Befehl mit sudo ausführen, z.B.:
# sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u deploy --hp /home/deploy
pm2 save
```

---

## 2. SSH-Key für GitHub Actions anlegen

Auf dem VPS ein dediziertes Schlüsselpaar erstellen:

```bash
ssh-keygen -t ed25519 -C "github-actions-bkw" -f ~/.ssh/github_deploy -N ""
```

**Public Key** auf dem VPS autorisieren:

```bash
cat ~/.ssh/github_deploy.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

**Private Key** anzeigen – dieser kommt als GitHub Secret:

```bash
cat ~/.ssh/github_deploy
```

---

## 3. GitHub Secrets konfigurieren

Unter **GitHub Repo → Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Beispielwert | Beschreibung |
|--------|-------------|-------------|
| `SSH_HOST` | `123.45.67.89` | IP-Adresse oder Hostname des VPS |
| `SSH_USER` | `deploy` | SSH-Benutzername |
| `SSH_PRIVATE_KEY` | `-----BEGIN OPENSSH...` | Kompletter privater SSH-Key (inkl. Header/Footer) |
| `SSH_PORT` | `22` | SSH-Port (weglassen = 22) |
| `DEPLOY_PATH` | `/opt/bkw` | Absoluter Pfad auf dem Server |
| `APP_PORT` | `3000` | Port der App (für Health Check, optional) |

---

## 4. Erstes manuelles Deployment (Bootstrap)

Beim allerersten Deployment muss die App einmal manuell gestartet werden,
da PM2 die App noch nicht kennt:

```bash
# Auf dem VPS:
cd /opt/bkw
pm2 start ecosystem.config.cjs
pm2 save
```

Alle folgenden Deployments laufen dann vollautomatisch via GitHub Actions.

---

## 5. Nginx als Reverse Proxy (empfohlen)

```bash
sudo apt install -y nginx
```

Konfiguration `/etc/nginx/sites-available/bkw`:

```nginx
server {
    listen 80;
    server_name bkw.example.com;   # oder IP-Adresse

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/bkw /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### HTTPS mit Let's Encrypt (optional)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d bkw.example.com
```

---

## 6. Datenbank-Backup

Die SQLite-Datenbank liegt standardmäßig unter `~/.bkw-data/bkw.db`.
Sie wird durch das Deployment **nicht berührt**.

Für automatische Backups (z.B. täglich):

```bash
# Cronjob: täglich 03:00 Uhr
0 3 * * * cp ~/.bkw-data/bkw.db ~/.bkw-data/bkw_$(date +\%Y\%m\%d).db
# Backups älter als 30 Tage löschen
0 3 * * * find ~/.bkw-data -name "bkw_*.db" -mtime +30 -delete
```

---

## 7. Deployment-Status prüfen

```bash
# PM2-Status
pm2 status
pm2 logs bkw --lines 50

# App direkt ansprechen
curl http://localhost:3000

# GitHub Actions Logs
# → github.com/<user>/bkw/actions
```

---

## Workflow-Übersicht

```
.github/workflows/deploy.yml
├── Trigger: push main | workflow_dispatch
├── Runner: ubuntu-latest
│
├── Step 1: Checkout
├── Step 2: Node.js 22 + npm cache
├── Step 3: npm ci --legacy-peer-deps
├── Step 4: vite build  →  build/
├── Step 5: SSH-Key in ~/.ssh/deploy_key
├── Step 6: rsync build/ + package*.json + ecosystem.config.cjs → VPS
├── Step 7: ssh → npm ci --omit=dev && pm2 restart
└── Step 8: Health-Check GET http://<host>:<port>  (non-blocking)
```

### Warum `rsync --delete` nur für `build/`?

Der `--delete`-Flag stellt sicher, dass veraltete Chunks aus vorherigen Builds
entfernt werden. `node_modules/` und die Datenbank liegen außerhalb und werden
nie gelöscht.

### Warum `npm ci` auf dem Server?

`node-cron`, `bcryptjs` und `csv-parser` sind reine JavaScript-Pakete – kein
Kompilieren nötig. `npm ci --omit=dev` installiert in Sekunden und stellt
sicher, dass die Versionen exakt mit `package-lock.json` übereinstimmen.
