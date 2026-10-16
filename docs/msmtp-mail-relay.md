# Proxmox mail relay with msmtp

This project uses the Proxmox host's local mail stack to send backup notifications. The backup script itself does not deliver mail directly; it calls the system mail tools, and those are expected to be configured through `msmtp` or another local MTA.

## Why this is separate from the backup .env file

The project-local `.env` file is for operational values that are safe to keep near the script, such as the rclone remote, staging path, and guest selection.

The notification recipient is different: it is host-specific, may be private, and should not live in the Git repository. That is why the script loads a root-owned system file by default:

- `/etc/proxmox-onedrive-backup/notifications.env`

This file is not a project file and is not expected to be a dotfile. It is a system-level configuration file.

## Install msmtp

On the Proxmox host:

```bash
apt update
apt install -y msmtp msmtp-mta
```

The `msmtp-mta` package is important because it provides the mail replacement command that the script expects (`mail`/`sendmail` compatibility).

## Configure the relay

Create the system config file:

```bash
sudo install -d -m 700 /etc/proxmox-onedrive-backup
sudo nano /etc/msmtprc
```

Example content:

```conf
defaults
auth on
tls on
tls_trust_file /etc/ssl/certs/ca-certificates.crt
logfile /var/log/msmtp.log

account default
host smtp.example.com
port 587
from proxmox-backup@yourdomain.example
user your-smtp-user
password your-smtp-password
```

Lock down permissions:

```bash
sudo chmod 600 /etc/msmtprc
sudo chown root:root /etc/msmtprc
```

## Configure the notification recipient

Create the backup notification file:

```bash
sudo tee /etc/proxmox-onedrive-backup/notifications.env >/dev/null <<'EOF'
NOTIFY_EMAIL_TO="admin@example.com"
EOF
sudo chmod 0600 /etc/proxmox-onedrive-backup/notifications.env
sudo chown root:root /etc/proxmox-onedrive-backup/notifications.env
```

The script will read this file automatically when it exists, and runtime environment overrides still take precedence.

## Test the relay

From the Proxmox host, send a test mail:

```bash
echo "Subject: Proxmox msmtp test" | sendmail admin@example.com
```

Then check logs:

```bash
tail -n 50 /var/log/msmtp.log
journalctl -f
```

If the message does not arrive, the common issues are:

- wrong SMTP credentials
- wrong port or TLS mode
- blocked outbound SMTP
- invalid or rejected sender address

## Recommended pattern

Use this split:

- project-local `.env` for backup behavior and paths
- `/etc/proxmox-onedrive-backup/notifications.env` for the admin email address
- `/etc/msmtprc` for the SMTP relay configuration and credentials

This keeps the repository clean while still allowing the host to perform reliable email notifications for scheduled backup results.
