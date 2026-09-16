#!/usr/bin/env bash
set -euo pipefail
TOKEN="$(cat /tmp/mystic-host-node-token)"
sudo install -d -o ubuntu -g ubuntu /opt/mystic-host-node/bin /opt/mystic-host-node/data
sudo install -o ubuntu -g ubuntu -m 0755 /tmp/mystic-host-node-agent.js /opt/mystic-host-node/bin/agent.js
sudo rm -rf /opt/mystic-host-node/bin/vendor
sudo cp -a /tmp/mystic-host-node-vendor /opt/mystic-host-node/bin/vendor
sudo npm install --prefix /opt/mystic-host-node --no-save --omit=dev ssh2@1.17.0 debug@4.4.3 mout@1.2.4 >/tmp/mystic-host-sftp-npm.log
printf '%s\n' "$TOKEN" | sudo tee /opt/mystic-host-node/agent.token >/dev/null
sudo chmod 600 /opt/mystic-host-node/agent.token
sudo tee /etc/systemd/system/mystic-host-node-agent.service >/dev/null <<'UNIT'
[Unit]
Description=MYSTIC HOST Docker Node Agent
After=docker.service network-online.target
Wants=network-online.target
Requires=docker.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/mystic-host-node
Environment=MYSTIC_HOST_AGENT_PORT=8787
Environment=MYSTIC_HOST_SFTP_PORT=2022
Environment=MYSTIC_HOST_AGENT_TOKEN_FILE=/opt/mystic-host-node/agent.token
Environment=MYSTIC_HOST_DATA_ROOT=/opt/mystic-host-node/data
ExecStart=/usr/bin/node /opt/mystic-host-node/bin/agent.js
Restart=always
RestartSec=3
NoNewPrivileges=false

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now mystic-host-node-agent
sudo systemctl --no-pager --full status mystic-host-node-agent | head -25
curl -fsS http://127.0.0.1:8787/health
printf '\n'
