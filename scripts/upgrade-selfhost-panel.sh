#!/usr/bin/env bash
set -euo pipefail

# Usage: sudo bash scripts/upgrade-selfhost-panel.sh /tmp/mystic-host-panel.tar.gz
ARCHIVE=${1:-/tmp/mystic-host-panel.tar.gz}
PANEL_DIR=${PANEL_DIR:-/opt/mystic-host-panel}
BACKUP_ROOT=${BACKUP_ROOT:-/opt/mystic-host-backups}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
STAGE=$(mktemp -d /tmp/mystic-host-upgrade.XXXXXX)
BACKUP="$BACKUP_ROOT/$STAMP"
cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT

if [[ $EUID -ne 0 ]]; then echo "Run as root" >&2; exit 1; fi
[[ -f "$ARCHIVE" ]] || { echo "Archive not found: $ARCHIVE" >&2; exit 1; }
[[ -d "$PANEL_DIR" ]] || { echo "Panel directory not found: $PANEL_DIR" >&2; exit 1; }

mkdir -p "$BACKUP"
cp -a "$PANEL_DIR/dist" "$BACKUP/dist"
cp -a "$PANEL_DIR/drizzle" "$BACKUP/drizzle" 2>/dev/null || true
cp -a "$PANEL_DIR/package.json" "$BACKUP/package.json"
cp -a "$PANEL_DIR/pnpm-lock.yaml" "$BACKUP/pnpm-lock.yaml" 2>/dev/null || true

tar -xzf "$ARCHIVE" -C "$STAGE"
[[ -f "$STAGE/dist/index.js" ]] || { echo "Archive does not contain dist/index.js" >&2; exit 1; }
cp -a "$STAGE/dist" "$PANEL_DIR/dist.new"
if [[ -d "$STAGE/drizzle" ]]; then cp -a "$STAGE/drizzle/." "$PANEL_DIR/drizzle/"; fi
if [[ -f "$STAGE/package.json" ]]; then cp -a "$STAGE/package.json" "$PANEL_DIR/package.json"; fi
if [[ -f "$STAGE/pnpm-lock.yaml" ]]; then cp -a "$STAGE/pnpm-lock.yaml" "$PANEL_DIR/pnpm-lock.yaml"; fi

if [[ -f "$PANEL_DIR/drizzle/0002_mystic_host_jobs.sql" ]] && ! mysql --batch --skip-column-names mystic_host -e "SHOW TABLES LIKE 'jobs'" | grep -q '^jobs$'; then
  mysql mystic_host < "$PANEL_DIR/drizzle/0002_mystic_host_jobs.sql"
fi
if [[ -f "$PANEL_DIR/drizzle/0003_server_install_metadata.sql" ]] && ! mysql --batch --skip-column-names mystic_host -e "SHOW COLUMNS FROM servers LIKE 'installScript'" | grep -q '^installScript'; then
  mysql mystic_host < "$PANEL_DIR/drizzle/0003_server_install_metadata.sql"
fi
if [[ -f "$PANEL_DIR/drizzle/0004_job_progress.sql" ]] && ! mysql --batch --skip-column-names mystic_host -e "SHOW COLUMNS FROM jobs LIKE 'progress'" | grep -q '^progress'; then
  mysql mystic_host < "$PANEL_DIR/drizzle/0004_job_progress.sql"
fi
if [[ -f "$PANEL_DIR/drizzle/0005_api_keys.sql" ]] && ! mysql --batch --skip-column-names mystic_host -e "SHOW TABLES LIKE 'api_keys'" | grep -q '^api_keys$'; then
  mysql mystic_host < "$PANEL_DIR/drizzle/0005_api_keys.sql"
fi
if [[ -f "$PANEL_DIR/drizzle/0006_schedule_history.sql" ]] && ! mysql --batch --skip-column-names mystic_host -e "SHOW TABLES LIKE 'schedule_runs'" | grep -q '^schedule_runs$'; then
  mysql mystic_host < "$PANEL_DIR/drizzle/0006_schedule_history.sql"
fi

rm -rf "$PANEL_DIR/dist.previous"
if [[ -d "$PANEL_DIR/dist" ]]; then mv "$PANEL_DIR/dist" "$PANEL_DIR/dist.previous"; fi
mv "$PANEL_DIR/dist.new" "$PANEL_DIR/dist"
cd "$PANEL_DIR"
pnpm install --frozen-lockfile --ignore-scripts >/tmp/mystic-host-panel-upgrade-pnpm.log
SERVICE_USER=$(systemctl show mystic-host-panel -p User --value)
SERVICE_GROUP=$(systemctl show mystic-host-panel -p Group --value)
SERVICE_USER=${SERVICE_USER:-root}
SERVICE_GROUP=${SERVICE_GROUP:-$SERVICE_USER}
if id "$SERVICE_USER" >/dev/null 2>&1 && getent group "$SERVICE_GROUP" >/dev/null 2>&1; then
  chown -R "$SERVICE_USER:$SERVICE_GROUP" "$PANEL_DIR"
fi
systemctl restart mystic-host-panel
sleep 2
if ! systemctl is-active --quiet mystic-host-panel || ! curl -fsS http://127.0.0.1:3000/ >/dev/null; then
  echo "Upgrade health check failed; restoring previous build" >&2
  systemctl stop mystic-host-panel || true
  rm -rf "$PANEL_DIR/dist"
  mv "$PANEL_DIR/dist.previous" "$PANEL_DIR/dist"
  cp -a "$BACKUP/package.json" "$PANEL_DIR/package.json"
  [[ -f "$BACKUP/pnpm-lock.yaml" ]] && cp -a "$BACKUP/pnpm-lock.yaml" "$PANEL_DIR/pnpm-lock.yaml"
  systemctl start mystic-host-panel
  exit 1
fi
rm -rf "$PANEL_DIR/dist.previous"
printf 'upgrade_succeeded backup=%s\n' "$BACKUP"
