# MYSTIC HOST Control Plane

MYSTIC HOST is an independent, self-hosted Docker control plane inspired by common game and application hosting workflows. It is not a fork or replacement for Pterodactyl and does not copy Pterodactyl source code. It provides a web panel, an authenticated node agent, Docker-backed server lifecycle operations, file upload and ZIP extraction, logs, statistics, and a repeatable Ubuntu installer.

## Current scope

The current implementation supports administrator and user authentication, node health, Docker server creation, start/stop/restart, logs, statistics, file uploads, ZIP extraction, storage metadata, runtime templates, and a self-hosted panel/node installation path. It is intentionally smaller than Pterodactyl and should be extended with persistent server metadata, allocations, schedules, backups, databases, permissions, and a full console protocol before production use.

## Installer

Run the installer as root on Ubuntu 22.04 or 24.04:

```bash
curl -fsSL https://raw.githubusercontent.com/REPLACE_OWNER/mystic-host/main/install.sh | sudo bash
```

The installer supports panel-only, node-only, and combined installation modes. Review the script before executing it in production.

## Security

Use a strong database password and node token. Keep `/etc/mystic-host` and `/etc/mystic-host/node.env` private. Do not expose node tokens, database credentials, JWT secrets, or generated environment files in GitHub.
