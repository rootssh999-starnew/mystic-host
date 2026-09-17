#!/usr/bin/env bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
source /tmp/mystic-host-deploy-config.txt
NODE_TOKEN=$(cat /tmp/mystic-host-node-token)

sudo apt-get update
sudo apt-get install -y mariadb-server nginx certbot python3-certbot-nginx
sudo systemctl enable --now mariadb
sudo mysql <<SQL
    CREATE DATABASE IF NOT EXISTS mystic_host CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
    CREATE USER IF NOT EXISTS 'mystic_host'@'127.0.0.1' IDENTIFIED BY '${DB_PASSWORD}';
    ALTER USER 'mystic_host'@'127.0.0.1' IDENTIFIED BY '${DB_PASSWORD}';
    GRANT ALL PRIVILEGES ON mystic_host.* TO 'mystic_host'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL
sudo mysql mystic_host <<'SQL'
CREATE TABLE IF NOT EXISTS users (id int AUTO_INCREMENT NOT NULL, openId varchar(64) NOT NULL, name text, email varchar(320), loginMethod varchar(64), role enum('user','admin') NOT NULL DEFAULT 'user', createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP, updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, lastSignedIn timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (id), UNIQUE KEY users_openId_unique (openId));
CREATE TABLE IF NOT EXISTS stored_files (id int AUTO_INCREMENT NOT NULL, userId int NOT NULL, serverName varchar(100) NOT NULL, originalName varchar(255) NOT NULL, storageKey varchar(512) NOT NULL, storageUrl varchar(768) NOT NULL, mimeType varchar(150) NOT NULL, size int NOT NULL, createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP, updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, PRIMARY KEY (id), UNIQUE KEY stored_files_storageKey_unique (storageKey));
SQL

sudo install -d -o ubuntu -g ubuntu /opt/mystic-host-panel
sudo rm -rf /opt/mystic-host-panel/dist /opt/mystic-host-panel/package.json /opt/mystic-host-panel/node_modules
sudo tar -xzf /tmp/mystic-host-panel.tar.gz -C /opt/mystic-host-panel
if [[ -f /opt/mystic-host-panel/drizzle/0001_mystic_host_control_plane.sql ]]; then
  sudo mysql mystic_host < /opt/mystic-host-panel/drizzle/0001_mystic_host_control_plane.sql
fi
if [[ -f /opt/mystic-host-panel/drizzle/0002_mystic_host_jobs.sql ]] && ! sudo mysql --batch --skip-column-names mystic_host -e "SHOW TABLES LIKE 'jobs'" | grep -q '^jobs$'; then
  sudo mysql mystic_host < /opt/mystic-host-panel/drizzle/0002_mystic_host_jobs.sql
fi
cd /opt/mystic-host-panel
sudo npm install --legacy-peer-deps --ignore-scripts --no-audit --no-fund
sudo chown -R ubuntu:ubuntu /opt/mystic-host-panel
sudo install -d -m 0750 /etc/mystic-host
sudo tee /etc/mystic-host/panel.env >/dev/null <<ENV
NODE_ENV=production
PORT=3000
DATABASE_URL=mysql://mystic_host:${DB_PASSWORD}@127.0.0.1:3306/mystic_host
JWT_SECRET=${JWT_SECRET}
VITE_APP_ID=${VITE_APP_ID}
OAUTH_SERVER_URL=${OAUTH_SERVER_URL}
VITE_OAUTH_PORTAL_URL=${VITE_OAUTH_PORTAL_URL}
OWNER_NAME=MYSTIC HOST
BUILT_IN_FORGE_API_URL=
BUILT_IN_FORGE_API_KEY=
MYSTIC_HOST_NODE_AGENT_URL=https://node.mystichost.qzz.io
MYSTIC_HOST_NODE_AGENT_TOKEN=${NODE_TOKEN}
ENV
sudo chmod 600 /etc/mystic-host/panel.env
sudo tee /etc/systemd/system/mystic-host-panel.service >/dev/null <<'UNIT'
[Unit]
Description=MYSTIC HOST Self-Hosted Panel
After=network-online.target mariadb.service
Wants=network-online.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/mystic-host-panel
EnvironmentFile=/etc/mystic-host/panel.env
ExecStart=/usr/bin/node /opt/mystic-host-panel/dist/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
sudo tee /etc/nginx/sites-available/mystic-host-panel >/dev/null <<'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name host.mystichost.qzz.io;
    client_max_body_size 50m;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 120s;
    }
}
NGINX
sudo ln -sf /etc/nginx/sites-available/mystic-host-panel /etc/nginx/sites-enabled/mystic-host-panel
sudo nginx -t
sudo systemctl daemon-reload
sudo systemctl enable --now mystic-host-panel
sudo systemctl reload nginx
sudo certbot --nginx --non-interactive --agree-tos --register-unsafely-without-email --redirect -d host.mystichost.qzz.io
sudo systemctl reload nginx
curl -fsS https://host.mystichost.qzz.io/ | grep -q 'MYSTIC HOST' || true
printf 'panel_installed\n'
