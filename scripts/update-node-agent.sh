#!/usr/bin/env bash
set -euo pipefail
sudo install -o ubuntu -g ubuntu -m 0755 /tmp/mystic-host-node-agent.js /opt/mystic-host-node/bin/agent.js
sudo systemctl restart mystic-host-node-agent
sleep 1
sudo systemctl --no-pager --full status mystic-host-node-agent | head -22
curl -fsS http://127.0.0.1:8787/health
printf '\n'
