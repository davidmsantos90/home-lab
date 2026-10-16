# Proxmox OneDrive Backup Automation

## 1. Objective

Implement an automated backup process on the Proxmox VE host that creates independent backups of selected virtual machines and LXC containers and uploads them to OneDrive using `rclone` client-side encryption.

These backups must be independent of Proxmox Backup Server (PBS), providing an additional recovery option if the primary backup infrastructure becomes unavailable.

The implementation must be reliable, auditable, secure, and recoverable. It must preserve the existing backup infrastructure and avoid unnecessary changes to the host.

## 2. Existing Environment

The implementation must account for the following existing configuration:

- Proxmox VE 9.2.
- Debian 13 host named `pve`.
- `rclone` 1.75.2 is installed.
- Existing rclone remotes:
  - `one-drive:`
  - `one-drive-crypt:`
- Rclone configuration: `/root/.config/rclone/rclone.conf`
- Local staging directory: `/var/lib/vz/onedrive-staging`
- Root filesystem: `/var/lib/vz`, approximately 221 GiB total with 142 GiB free at the time of the initial assessment.
- The staging directory currently has restrictive permissions (`0711`). Preserve its existing permissions unless a demonstrated technical requirement justifies a change.

Do not expose credentials, encryption passwords, tokens, or other secrets in logs, documentation, command output, or generated files.

Do not hardcode LAN IP addresses in repository configuration or documentation when a configurable value or hostname is appropriate.

## 3. Backup Schedule

Use the `Europe/Lisbon` timezone.

| Backup system | Schedule | Purpose |
|---|---|---|
| Proxmox Backup Server | Saturday at 06:00 | Existing primary backup process |
| OneDrive | Sunday at 06:00 | Independent off-site backups |

The OneDrive process must not modify the existing PBS schedule or Proxmox backup configuration.

Implement the OneDrive schedule using a systemd service and timer, following existing repository conventions where applicable.

The timer should use `Persistent=true` so a missed scheduled execution can be handled after the host becomes available again.

The implementation must prevent overlapping executions and must not interfere with another active `vzdump` task.

## 4. Backup Scope

Create independent backups for the following guests:

| VMID | Guest | Type |
|---:|---|---|
| 100 | `retro-gaming` | Virtual machine |
| 101 | Jellyfin | LXC |
| 102 | Immich | LXC |
| 103 | Deluge | LXC |
| 104 | Mealie | LXC |
| 105 | Pi-hole | LXC |
| 106 | Nginx Proxy Manager | LXC |
| 107 | WireGuard | LXC |

Explicitly exclude VMID `120` (`pentaho-server-ubuntu`).

Keep the guest list configurable and easy to audit. Avoid duplicating configuration unnecessarily across scripts and service files.

Before implementation, verify that the guest IDs and their current configuration are still correct.

## 5. Backup Creation

Use Proxmox's native `vzdump` mechanism to create independent backup archives.

Requirements:

- Store temporary archives in `/var/lib/vz/onedrive-staging`.
- Use Zstandard compression (`zstd`).
- Create a separate archive for each guest.
- Preserve the standard Proxmox backup format so archives remain compatible with the normal Proxmox restore workflow.
- Capture the exit status and relevant output for each backup.
- Abort the overall backup run if any required guest backup fails.
- Do not upload a backup set as complete if even one required guest backup is missing or invalid.

Some LXC storage volumes do not support snapshot backups. Proxmox may therefore fall back to suspend mode. Preserve this existing behaviour and do not change storage configuration as part of this feature.

### External bind mounts

Standard LXC `vzdump` backups do not automatically include external bind-mount data.

The following paths are known examples that require separate backup consideration:

| VMID | Host path | Container path |
|---:|---|---|
| 101 | `/mnt/intenso/Media` | `/media` |
| 102 | `/mnt/intenso/Galeria` | `/galeria` |
| 103 | `/mnt/intenso/Downloads` | `/downloads` |

This feature protects the guest data actually included in the generated `vzdump` archives. It must not claim to back up the contents of these external paths unless a separate, explicitly designed mechanism is implemented.

Document this limitation clearly.

## 6. Concurrency and Safety

The backup script must:

1. Acquire an exclusive lock before starting.
2. Exit safely if another instance is already running.
3. Check for an existing Proxmox backup task or active `vzdump` process before starting.
4. Abort rather than compete with another active backup operation.
5. Release its lock automatically when the process exits.
6. Handle interruptions and failures without marking an incomplete backup set as successful.

Use a reliable mechanism such as `flock` for script-level locking.

Do not rely exclusively on the systemd timer to prevent concurrent executions.

## 7. OneDrive Upload

Use the existing encrypted rclone remote:

`one-drive-crypt:`

Store each backup set under:

`Backups-Proxmox/weekly/YYYY-MM-DD/`

Each execution must use its own dated directory. Do not overwrite a previous backup set.

The upload process must:

1. Confirm that all required guest archives exist and are valid.
2. Generate a manifest containing, at minimum:
   - Backup date.
   - Guest VMIDs.
   - Archive filenames.
   - Archive sizes.
   - SHA-256 checksums.
3. Upload all required archives and the manifest.
4. Verify the uploaded archives using `rclone cryptcheck`.
5. Publish a completion marker only after every required archive and the manifest have been uploaded and successfully verified.

A backup directory without a valid completion marker must be considered incomplete.

The implementation must account for the fact that a failed upload can leave partial files or an incomplete remote directory.

Do not treat the existence of a remote directory or individual files as proof that a complete backup set exists.

## 8. Verification

Use `rclone cryptcheck` to verify the uploaded archives against the local source files.

Verification must cover every required archive, not just one representative file.

The verification process must detect missing or mismatched files and return a failure status when verification fails.

Do not publish the completion marker, prune previous versions, or perform success-only local cleanup after a verification failure.

Where practical, include a separate validation command or script mode that can verify an existing backup set without creating new backups or deleting files.

## 9. Retention Policy

Retain the three most recent **complete and successfully verified** backup sets.

The retention mechanism must:

- Identify complete versions using the completion marker and appropriate validation.
- Never count incomplete or failed backup sets as valid retained versions.
- Never prune previous versions when the current run fails.
- Delete only backup directories explicitly managed by this feature, inside the dedicated `Backups-Proxmox/weekly/` path.
- Never delete arbitrary OneDrive content.
- Avoid deleting the only known-good backup set before a newer set has been fully verified.
- Log every deletion and the reason for it.

If the retention process cannot confidently identify valid backup sets, it must stop without deleting anything.

## 10. Local Storage Management

Local staging storage is limited and is shared with the existing host filesystem.

Before starting a backup run:

- Check available disk space.
- Check for stale archives and incomplete previous runs.
- Confirm that sufficient space is available for the planned operation, using a conservative estimate based on the selected guests and recent archive sizes.
- Abort safely if available space is insufficient.

Local archives must not be removed until the entire remote backup set has been uploaded and successfully verified.

After successful verification and completion-marker publication, remove only temporary files explicitly created and tracked by the current execution, plus any other files that the implementation can safely identify as belonging to a completed run.

Do not remove unknown files, manually created test files, or unrelated logs.

Do not change the staging directory permissions without first establishing why a change is necessary.

## 11. Notifications

The backup workflow remains unchanged: the script still performs guest backup creation, upload, verification and retention exactly as before. The notification layer is added at the end of the run and attempts to report a single final result without altering the backup status itself.

### Email notifications

Use the host's existing mail delivery mechanism when available, preferring the configured system mail stack over introducing a new SMTP service. The script checks for `mail` or `sendmail` and logs a clear warning instead of failing the backup if neither is installed or configured.

Required settings:

- `NOTIFY_EMAIL_TO` — recipient address, configured outside the Git repository when possible.
- Mail is not a required prerequisite for the backup itself. If no mail agent is available, the backup still runs normally and only the notification is skipped.

The notification summary includes only:

- status
- hostname
- date/time
- run identifier
- guest count
- destination path
- log file path
- phase or concise error summary

It does not include credentials, full logs, or other sensitive configuration.

### Notification behavior

- Success notifications are sent only after the backup set has completed upload, verification and retention.
- Failure notifications are sent when the script exits non-zero at any point, including early validation errors and trap-based exits.
- Email delivery is attempted independently and a delivery failure is logged without altering the backup exit result.
- The script sends exactly one final result per run and does not send a success notification after a failure.

### Mail relay and secure notification file

The notification config is intentionally a root-owned system file, not a Git-tracked project dotfile. The script reads a file named `notifications.env` from `/etc/proxmox-onedrive-backup` by default, because it is loaded explicitly via `NOTIFY_CONFIG_FILE` and not discovered by filename convention.

This is the recommended layout:

```bash
sudo install -d -m 0755 /etc/proxmox-onedrive-backup
sudo tee /etc/proxmox-onedrive-backup/notifications.env >/dev/null <<'EOF'
NOTIFY_EMAIL_TO="admin@example.com"
EOF
sudo chmod 0600 /etc/proxmox-onedrive-backup/notifications.env
```

This file is not expected to start with a dot because it is not a repo-local `.env` file; it is a host-level configuration artifact. For a copyable template in the repository, use the example file at [proxmox-backup/one-drive/notifications.env.example](../proxmox-backup/one-drive/notifications.env.example).

The mail transport itself should be provided by the Proxmox host's local mail stack, typically `msmtp` configured to send via an SMTP relay. The backup script itself only needs a valid `NOTIFY_EMAIL_TO` value; mail delivery is handled by the host mail agent, not by the backup script.

The script will read this file automatically when it exists, and runtime environment overrides still take precedence.

## 12. Logging and Error Handling

Write local logs to:

`/var/log/proxmox-onedrive-backup/`

Logs must include:

- Start and end timestamps.
- Backup date and execution identifier.
- Guest IDs being processed.
- Backup creation results.
- Upload results.
- Verification results.
- Retention actions.
- Local cleanup actions.
- Failure reasons and relevant exit codes.

Do not send email notifications. Local logs are the required notification and troubleshooting mechanism.

Implement log rotation using the existing host conventions or a dedicated logrotate configuration.

Avoid logging secrets or dumping the full rclone configuration.

The systemd service must return a non-zero exit status if any required backup, upload, verification, or other mandatory operation fails.

## 12. Systemd Integration

Create a dedicated systemd service and timer, using names consistent with the repository conventions.

The service should:

- Run with the privileges required by `vzdump` and the existing root-owned rclone configuration.
- Use a predictable environment and explicit paths.
- Run the backup script.
- Produce useful output in the local log and systemd journal.
- Fail visibly when a mandatory step fails.

The timer should:

- Run every Sunday at 06:00.
- Use the `Europe/Lisbon` timezone behaviour supported by the installed systemd version.
- Set `Persistent=true`.
- Avoid starting a second execution while the service is already active.

Verify the installed systemd version and timer capabilities before selecting any version-specific syntax.

Do not enable the timer automatically during implementation.

## 13. Repository Integration

Before modifying files, inspect the repository structure and existing conventions.

The implementation should add only the necessary files, expected to include:

- The backup script.
- The systemd service unit.
- The systemd timer unit.
- Documentation under the existing documentation structure.
- Tests or validation tooling appropriate to the repository.

All repository documentation must be written in English, including README files, feature documentation, installation instructions, configuration examples, comments intended for maintainers, and troubleshooting guides.

Follow the repository's existing Markdown style and naming conventions.

Keep configurable values in one appropriate location where practical. Do not hardcode concrete LAN IP addresses or secrets.

Do not introduce unnecessary dependencies or redesign existing infrastructure.

## 14. Testing Requirements

Provide tests or safe validation procedures for at least the following scenarios:

1. Successful backup creation for all configured guests.
2. A guest backup fails.
3. An archive is missing or invalid.
4. An upload fails.
5. Remote verification detects a missing or mismatched file.
6. A completion marker is not published for an incomplete set.
7. A concurrent script execution is rejected.
8. An existing `vzdump` task prevents the new run from starting.
9. Insufficient local disk space prevents the run from starting.
10. Retention keeps the three most recent complete backup sets.
11. Incomplete backup sets are not counted as valid retained versions.
12. Retention does not run after a failed backup or verification.
13. Local cleanup does not remove files belonging to an unsuccessful run.
14. Logs contain useful diagnostic information without exposing secrets.

Tests must not require deleting real backup data or modifying the live OneDrive backup history.

Prefer mocks, temporary directories, dry-run modes, and isolated test remotes for destructive or failure-path testing.

## 15. Implementation Workflow

Before changing any files:

1. Inspect the repository structure and relevant existing scripts, documentation, and service definitions.
2. Verify the current Proxmox guest list and the existing backup configuration.
3. Identify the appropriate location for the script, systemd units, logs, and documentation.
4. Present a concise implementation plan and list any unresolved assumptions.
5. Wait for review before proceeding with changes.

During implementation:

- Make small, reviewable changes.
- Preserve existing PBS configuration and schedules.
- Do not enable the new timer.
- Do not run a full production backup.
- Do not prune or delete any real OneDrive backup data.
- Do not change permissions, storage configuration, or guest configuration unless separately justified and approved.

After implementation:

1. Run static checks and tests.
2. Validate the script's syntax and systemd units.
3. Demonstrate the scheduling configuration.
4. Document installation, manual execution, log inspection, verification, retention, and recovery procedures.
5. Provide a summary of changed files and any remaining manual steps.

## 16. Acceptance Criteria

The feature is complete when:

- The eight intended guests are backed up independently of PBS.
- VMID 120 is explicitly excluded.
- The schedule is Sunday at 06:00 in the `Europe/Lisbon` timezone.
- The script prevents concurrent runs and avoids conflicts with active Proxmox backups.
- Every archive and the manifest are uploaded and verified before the backup set is marked complete.
- The previous known-good backup sets remain untouched after a failed run.
- Retention keeps the three most recent complete, verified backup sets.
- Local cleanup is conservative and only happens after successful remote verification.
- Logs are stored locally, contain useful diagnostic information, and are rotated.
- No email notifications are configured.
- Existing PBS configuration and schedules remain unchanged.
- External LXC bind-mount data is explicitly documented as outside the scope of these guest archives.
- Tests cover critical failure and retention scenarios.
- Documentation and repository comments intended for maintainers are in English.
- The timer remains disabled until the implementation has been reviewed and explicitly approved.

## 17. Operational Documentation

The accompanying documentation must explain:

- Prerequisites and dependencies.
- Installation and systemd unit placement.
- How to inspect and manually run the backup service.
- How to inspect logs and diagnose failures.
- How to verify an existing backup set.
- How to identify incomplete remote versions.
- How retention works and what it is allowed to delete.
- How to restore a VM or LXC from a downloaded `vzdump` archive.
- The distinction between guest backups and external bind-mount data.
- How to disable the timer and stop future scheduled executions.
- Which operations require explicit review before being run against production data.
