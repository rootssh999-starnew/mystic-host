#!/usr/bin/env bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

if [[ $EUID -ne 0 ]]; then echo 'Run as root: sudo bash install.sh'; exit 1; fi
if ! command -v systemctl >/dev/null 2>&1; then echo 'systemd is required'; exit 1; fi

PANEL_DOMAIN="${MYSTIC_HOST_PANEL_DOMAIN:-host.mystichost.qzz.io}"
NODE_DOMAIN="${MYSTIC_HOST_NODE_DOMAIN:-node.mystichost.qzz.io}"
INSTALL_DIR="${MYSTIC_HOST_INSTALL_DIR:-/opt/mystic-host}"
NODE_DIR="${MYSTIC_HOST_NODE_DIR:-/opt/mystic-host-node}"

cat <<'MENU'
MYSTIC HOST installer
[0] Install the panel
[1] Install the node agent
[2] Install both panel and node on this machine
MENU
read -r -p 'Input 0-2: ' MODE
case "$MODE" in 0|1|2) ;; *) echo 'Invalid selection'; exit 2 ;; esac

apt-get update
apt-get install -y ca-certificates curl nginx mariadb-server unzip certbot python3-certbot-nginx ufw

if [[ "$MODE" == 1 || "$MODE" == 2 ]]; then
  apt-get install -y docker.io
  systemctl enable --now docker
  install -d -m 0750 "$NODE_DIR"/data "$NODE_DIR"/bin /etc/mystic-host
  TOKEN="${MYSTIC_HOST_NODE_TOKEN:-}"
  if [[ -z "$TOKEN" ]]; then TOKEN=$(openssl rand -hex 32); fi
  printf '%s\n' "$TOKEN" > /etc/mystic-host/node.token
  chmod 600 /etc/mystic-host/node.token
  echo "Node agent files must be installed into $NODE_DIR before starting mystic-host-node.service."
fi

if [[ "$MODE" == 0 || "$MODE" == 2 ]]; then
  apt-get install -y nodejs npm
  install -d -m 0755 "$INSTALL_DIR"
  echo "Panel domain: $PANEL_DOMAIN"
  echo "Install the built MYSTIC HOST application into $INSTALL_DIR and configure /etc/mystic-host/panel.env before enabling the service."
fi

ufw allow OpenSSH >/dev/null || true
ufw allow 80/tcp >/dev/null || true
ufw allow 443/tcp >/dev/null || true
ufw --force enable >/dev/null || true
echo 'MYSTIC HOST prerequisites installed.'
