#!/usr/bin/env bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
sudo systemctl restart mystic-host-node-agent
sudo systemctl --no-pager --full status mystic-host-node-agent | head -25
curl -fsS http://127.0.0.1:8787/health
printf '\n'
