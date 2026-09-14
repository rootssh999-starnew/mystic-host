#!/usr/bin/env bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
sudo apt-get update
sudo apt-get install -y nginx certbot python3-certbot-nginx
sudo tee /etc/nginx/sites-available/mystic-host-node >/dev/null <<'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name node.mystichost.qzz.io;
    client_max_body_size 12m;
    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
NGINX
sudo ln -sf /etc/nginx/sites-available/mystic-host-node /etc/nginx/sites-enabled/mystic-host-node
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl enable --now nginx
sudo certbot --nginx --non-interactive --agree-tos --register-unsafely-without-email --redirect -d node.mystichost.qzz.io
sudo systemctl reload nginx
curl -fsS https://node.mystichost.qzz.io/health
printf '\n'
