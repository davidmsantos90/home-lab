# OneDrive backup automation

This directory contains the host-side backup automation that uploads verified Proxmox guest backups to the encrypted `one-drive-crypt` remote.

## Files

- `proxmox-one-drive-backup.sh` — creates the guest archives, validates them, uploads them, verifies the remote set, and applies retention.
- `proxmox-one-drive-backup.service` — systemd service definition used to run the script.
- `proxmox-one-drive-backup.timer` — weekly scheduler for Sunday 06:00 with `Persistent=true`.
- `proxmox-one-drive-backup.logrotate` — log rotation configuration for the backup logs.

## Install on the Proxmox host

Run these commands on the Proxmox VE host itself:

```bash
sudo -i

REPO=/path/to/home-lab

install -d -m 0711 /var/lib/vz/onedrive-staging
install -d -m 0755 /var/log/proxmox-onedrive-backup

install -m 0755 "${REPO}/proxmox-backup/one-drive/proxmox-one-drive-backup.sh" /usr/local/bin/proxmox-one-drive-backup.sh
install -m 0644 "${REPO}/proxmox-backup/one-drive/proxmox-one-drive-backup.service" /etc/systemd/system/proxmox-one-drive-backup.service
install -m 0644 "${REPO}/proxmox-backup/one-drive/proxmox-one-drive-backup.timer" /etc/systemd/system/proxmox-one-drive-backup.timer
install -m 0644 "${REPO}/proxmox-backup/one-drive/proxmox-one-drive-backup.logrotate" /etc/logrotate.d/proxmox-one-drive-backup

systemctl daemon-reload
systemctl enable --now proxmox-one-drive-backup.timer

systemctl status proxmox-one-drive-backup.timer --no-pager
systemctl list-timers --all | grep proxmox-one-drive-backup
```

## Manual test run

```bash
sudo /usr/local/bin/proxmox-one-drive-backup.sh
```

## Guest selection

This script does not require any hardcoded guest IDs. You can define the scope in a local `.env` file next to the script.

### Option A: backup only the guests you want

```bash
BACKUP_GUESTS="100 101 102 103"
EXCLUDED_GUESTS="120"
```

### Option B: backup everything except the guests you exclude

```bash
BACKUP_GUESTS=""
EXCLUDED_GUESTS="120"
```

With this second option, the script will enumerate the current Proxmox guests and back up every one except the excluded IDs.

## Retention model

The retained backups live in the remote storage itself, not on the Proxmox host. The local staging directory is temporary working space only and is cleaned up after a successful remote upload and verification.

Only the three most recent complete and verified backup sets are kept in the OneDrive remote path.
