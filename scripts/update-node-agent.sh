#!/usr/bin/env bash
set -euo pipefail
sudo install -o ubuntu -g ubuntu -m 0755 /tmp/mystic-host-node-agent.js /opt/mystic-host-node/bin/agent.js
sudo rm -rf /opt/mystic-host-node/bin/vendor
sudo cp -a /tmp/mystic-host-node-vendor /opt/mystic-host-node/bin/vendor
sudo npm install --prefix /opt/mystic-host-node --no-save --omit=dev ssh2@1.17.0 debug@4.4.3 mout@1.2.4 >/tmp/mystic-host-sftp-npm.log
sudo systemctl restart mystic-host-node-agent
sleep 1
sudo systemctl --no-pager --full status mystic-host-node-agent | head -22
curl -fsS http://127.0.0.1:8787/health
printf '\n'
