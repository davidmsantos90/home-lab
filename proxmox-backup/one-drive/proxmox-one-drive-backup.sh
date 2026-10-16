#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
NOTIFY_CONFIG_FILE="${NOTIFY_CONFIG_FILE:-/etc/proxmox-onedrive-backup/notifications.env}"
if [[ ! -f "${ENV_FILE}" && -f "/etc/proxmox-onedrive-backup/.env" ]]; then
  ENV_FILE="/etc/proxmox-onedrive-backup/.env"
fi

# Preserve any runtime overrides passed to the command line, since they should take precedence.
RUNTIME_OVERRIDES=()
for var_name in TIMEZONE RCLONE_CONFIG RCLONE_REMOTE REMOTE_PREFIX STAGING_DIR LOG_DIR LOCK_FILE BACKUP_GUESTS EXCLUDED_GUESTS NOTIFY_EMAIL_TO NOTIFY_SUBJECT_PREFIX NOTIFY_CONFIG_FILE; do
  if [[ -n "${!var_name+x}" ]]; then
    RUNTIME_OVERRIDES+=("${var_name}=${!var_name}")
  fi
done

if [[ -f "${ENV_FILE}" ]]; then
  # shellcheck disable=SC1091
  source "${ENV_FILE}"
fi

if [[ -f "${NOTIFY_CONFIG_FILE}" ]]; then
  # shellcheck disable=SC1091
  source "${NOTIFY_CONFIG_FILE}"
fi

for override_entry in "${RUNTIME_OVERRIDES[@]}"; do
  var_name="${override_entry%%=*}"
  override_value="${override_entry#*=}"
  if [[ "${var_name}" != "${override_entry}" ]]; then
    printf -v "${var_name}" '%s' "${override_value}"
  fi
done

export TZ="${TIMEZONE:-Europe/Lisbon}"
: "${RCLONE_CONFIG:=/root/.config/rclone/rclone.conf}"
: "${RCLONE_REMOTE:=one-drive-crypt}"
: "${REMOTE_PREFIX:=weekly}"
: "${STAGING_DIR:=/var/lib/vz/onedrive-staging}"
: "${LOG_DIR:=/var/log/proxmox-onedrive-backup}"
: "${LOCK_FILE:=/run/proxmox-onedrive-backup.lock}"
: "${BACKUP_GUESTS:=}"
: "${EXCLUDED_GUESTS:=}"
: "${NOTIFY_EMAIL_TO:=}"
: "${NOTIFY_SUBJECT_PREFIX:=[Proxmox Backup]}"
: "${NOTIFY_CONFIG_FILE:=/etc/proxmox-onedrive-backup/notifications.env}"

RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_DATE="$(date +%F)"
REMOTE_ROOT="${RCLONE_REMOTE}:/${REMOTE_PREFIX}"
REMOTE_DIR="${REMOTE_ROOT}/${RUN_DATE}"
RUN_DIR="${STAGING_DIR}/backup-${RUN_DATE}-${RUN_ID}"

mkdir -p "${LOG_DIR}"
LOG_FILE="${LOG_DIR}/$(date +%F)-proxmox-onedrive-backup.log"
exec >> >(tee -a "${LOG_FILE}") 2>&1

LAST_ERROR_MESSAGE=""
CURRENT_PHASE="startup"
NOTIFY_SENT=0

log() {
  printf '%s %s\n' "$(date -Is)" "$*"
}

log_loaded_configuration() {
  log "Effective configuration:"
  log "  ENV_FILE=${ENV_FILE}"
  log "  NOTIFY_CONFIG_FILE=${NOTIFY_CONFIG_FILE:-<unset>}"
  log "  RCLONE_CONFIG=${RCLONE_CONFIG}"
  log "  RCLONE_REMOTE=${RCLONE_REMOTE}"
  log "  REMOTE_PREFIX=${REMOTE_PREFIX}"
  log "  REMOTE_ROOT=${REMOTE_ROOT}"
  log "  STAGING_DIR=${STAGING_DIR}"
  log "  LOG_DIR=${LOG_DIR}"
  log "  LOCK_FILE=${LOCK_FILE}"
  log "  BACKUP_GUESTS=${BACKUP_GUESTS:-<empty>}"
  log "  EXCLUDED_GUESTS=${EXCLUDED_GUESTS:-<empty>}"
  log "  NOTIFY_EMAIL_TO=${NOTIFY_EMAIL_TO:-<empty>}"
  log "  NOTIFY_SUBJECT_PREFIX=${NOTIFY_SUBJECT_PREFIX:-<empty>}"
}

fail() {
  LAST_ERROR_MESSAGE="$*"
  CURRENT_PHASE="${CURRENT_PHASE:-unknown}"
  log "ERROR: $*"
  exit 1
}

send_email_notification() {
  local status="$1"
  local recipient="${NOTIFY_EMAIL_TO:-}"
  local subject="${NOTIFY_SUBJECT_PREFIX:-[Proxmox Backup]} ${status} - $(hostname)"
  local body
  local guest_count=0

  if [[ -n "${selected_guests+x}" ]]; then
    guest_count="${#selected_guests[@]}"
  fi

  if [[ -z "${recipient}" ]]; then
    log "Email notification skipped: NOTIFY_EMAIL_TO is not configured"
    return 0
  fi

  body=$(cat <<EOF
Status: ${status}
Hostname: $(hostname)
Date/Time: $(date -Is)
Run ID: ${RUN_ID:-unknown}
Guests backed up: ${guest_count}
Destination: ${REMOTE_DIR:-unknown}
Log file: ${LOG_FILE:-unknown}
Phase: ${CURRENT_PHASE:-unknown}
Summary: ${LAST_ERROR_MESSAGE:-backup completed successfully}
EOF
)

  if command -v mail >/dev/null 2>&1; then
    if ! printf '%s\n' "${body}" | mail -s "${subject}" "${recipient}" >/dev/null 2>&1; then
      log "Email notification delivery failed for ${recipient}"
    fi
    return 0
  fi

  if command -v sendmail >/dev/null 2>&1; then
    if ! { printf 'To: %s\nSubject: %s\n\n%s\n' "${recipient}" "${subject}" "${body}"; } | sendmail -t >/dev/null 2>&1; then
      log "Email notification delivery failed for ${recipient}"
    fi
    return 0
  fi

  log "Email notification skipped: no mail command is available on this host"
}

notify_run_result() {
  local status="$1"
  if [[ "${NOTIFY_SENT}" -eq 1 ]]; then
    return 0
  fi

  if [[ "${status}" == "SUCCESS" ]]; then
    LAST_ERROR_MESSAGE="backup completed successfully"
  fi

  send_email_notification "${status}"
  NOTIFY_SENT=1
}

cleanup() {
  if [[ -d "${RUN_DIR:-}" ]]; then
    rm -rf "${RUN_DIR}"
  fi
}

handle_exit() {
  local exit_code="$1"
  local status="FAILURE"

  if [[ "${exit_code}" -eq 0 ]]; then
    status="SUCCESS"
  fi

  if [[ "${NOTIFY_SENT}" -eq 1 ]]; then
    return 0
  fi

  notify_run_result "${status}"
}

trap 'exit_code=$?; cleanup; trap - EXIT; handle_exit "${exit_code}"; exit "${exit_code}"' EXIT

CURRENT_PHASE="validate environment and guest selection"
log "Starting Proxmox OneDrive backup run ${RUN_ID}"
log "------------------------------------------------------------"
log_loaded_configuration
log "Phase 1/5: validate environment and guest selection"

if [[ ${EUID} -ne 0 ]]; then
  fail "this script must run as root"
fi

command -v rclone >/dev/null 2>&1 || fail "rclone is required"
command -v vzdump >/dev/null 2>&1 || fail "vzdump is required"
[[ -f "${RCLONE_CONFIG}" ]] || fail "rclone config not found at ${RCLONE_CONFIG}"
mkdir -p "${STAGING_DIR}" || fail "unable to create staging directory ${STAGING_DIR}"

exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
  fail "another Proxmox OneDrive backup run is already active"
fi

if pgrep -x vzdump >/dev/null 2>&1; then
  fail "another vzdump task is already running; aborting to avoid overlap"
fi

if [[ ! -d "${STAGING_DIR}" ]]; then
  fail "staging directory does not exist: ${STAGING_DIR}"
fi

available_kib=$(df -k "${STAGING_DIR}" | awk 'NR==2 {print $4}')
required_kib=$((5 * 1024 * 1024))
if (( available_kib < required_kib )); then
  fail "insufficient space in ${STAGING_DIR}; ${available_kib} KiB available, ${required_kib} KiB required"
fi

# Keep the guest list explicit and easy to audit.
selected_guests=()
if [[ -n "${BACKUP_GUESTS}" ]]; then
  for guest_id in ${BACKUP_GUESTS}; do
    if [[ -n "${EXCLUDED_GUESTS}" ]] && [[ " ${EXCLUDED_GUESTS} " == *" ${guest_id} "* ]]; then
      log "Skipping excluded guest ${guest_id}"
      continue
    fi
    selected_guests+=("${guest_id}")
  done
else
  mapfile -t all_guests < <({ qm list 2>/dev/null || true; pct list 2>/dev/null || true; } | awk 'NR>1 && $1 ~ /^[0-9]+$/ {print $1}' | sort -u)
  for guest_id in "${all_guests[@]}"; do
    if [[ -n "${EXCLUDED_GUESTS}" ]] && [[ " ${EXCLUDED_GUESTS} " == *" ${guest_id} "* ]]; then
      log "Skipping excluded guest ${guest_id}"
      continue
    fi
    selected_guests+=("${guest_id}")
  done
fi

if [[ ${#selected_guests[@]} -eq 0 ]]; then
  fail "no valid guest IDs selected for backup; set BACKUP_GUESTS or EXCLUDED_GUESTS in ${SCRIPT_DIR}/.env"
fi

log "Selected guests: ${selected_guests[*]}"
mkdir -p "${RUN_DIR}"
CURRENT_PHASE="creating backup archives"
log "Phase 2/5: creating backup archives for selected guests"

archive_files=()
for guest_id in "${selected_guests[@]}"; do
  guest_dir="${RUN_DIR}/${guest_id}"
  mkdir -p "${guest_dir}"
  log "------------------------------------------------------------"
  log "Guest ${guest_id}: starting vzdump backup"

  if ! { vzdump --compress zstd --dumpdir "${guest_dir}" "${guest_id}" 2>&1 | tee "${guest_dir}/vzdump.log"; }; then
    tail -n 50 "${guest_dir}/vzdump.log" || true
    fail "vzdump failed for guest ${guest_id}"
  fi

  mapfile -t created_archives < <(find "${guest_dir}" -maxdepth 1 -type f ! -name 'vzdump.log' ! -name '*.log' -print | sort)
  if [[ ${#created_archives[@]} -eq 0 ]]; then
    fail "vzdump did not produce an archive for guest ${guest_id}"
  fi

  archive_path=""
  for candidate in "${created_archives[@]}"; do
    if zstd -t "${candidate}" >/dev/null 2>&1; then
      archive_path="${candidate}"
      break
    fi
  done

  if [[ -z "${archive_path}" ]]; then
    fail "archive validation failed for guest ${guest_id}: no valid compressed archive found in ${guest_dir}"
  fi

  log "Guest ${guest_id}: archive created successfully -> ${archive_path}"
  archive_files+=("${archive_path}")
done

CURRENT_PHASE="building backup manifest"
log "Phase 3/5: building backup manifest"
manifest_path="${RUN_DIR}/manifest.json"
python3 - "${manifest_path}" "${RUN_DIR}" "${RUN_DATE}" "${RUN_ID}" <<'PY'
import hashlib
import json
import os
import sys

manifest_path, run_dir, run_date, run_id = sys.argv[1:5]
records = []
for guest_name in sorted(os.listdir(run_dir), key=lambda item: int(item) if item.isdigit() else item):
    guest_dir = os.path.join(run_dir, guest_name)
    if not os.path.isdir(guest_dir):
        continue
    for filename in sorted(os.listdir(guest_dir)):
        if filename == 'vzdump.log':
            continue
        path = os.path.join(guest_dir, filename)
        if not os.path.isfile(path):
            continue
        h = hashlib.sha256()
        with open(path, 'rb') as fh:
            for chunk in iter(lambda: fh.read(1024 * 1024), b''):
                h.update(chunk)
        records.append({
            'guest': guest_name,
            'filename': filename,
            'size': os.path.getsize(path),
            'sha256': h.hexdigest(),
        })

payload = {
    'backup_date': run_date,
    'run_id': run_id,
    'guests': [int(item) for item in sorted([r['guest'] for r in records], key=lambda v: int(v))],
    'files': records,
}
with open(manifest_path, 'w', encoding='utf-8') as fh:
    json.dump(payload, fh, indent=2)
    fh.write('\n')
PY

# Upload the local archives and manifest to the encrypted remote.
CURRENT_PHASE="uploading backup set"
log "Phase 4/5: uploading backup set to ${REMOTE_DIR}"
log "Uploading backup set to ${REMOTE_DIR}"
rclone mkdir "${REMOTE_DIR}" --config "${RCLONE_CONFIG}" >/dev/null 2>&1 || fail "unable to create remote directory ${REMOTE_DIR}"
verify_dir="${RUN_DIR}/verification"
mkdir -p "${verify_dir}"

for archive_path in "${archive_files[@]}"; do
  archive_name="$(basename "${archive_path}")"
  rclone copyto "${archive_path}" "${REMOTE_DIR}/${archive_name}" --config "${RCLONE_CONFIG}" >/dev/null || fail "upload failed for archive ${archive_name}"
  cp "${archive_path}" "${verify_dir}/${archive_name}"
done
rclone copyto "${manifest_path}" "${REMOTE_DIR}/manifest.json" --config "${RCLONE_CONFIG}" >/dev/null || fail "upload failed for manifest"
cp "${manifest_path}" "${verify_dir}/manifest.json"

# Verify only the uploaded payload using rclone cryptcheck.
# The staging directory contains unuploaded per-guest logs, so they must not be part of the comparison.
# rclone expects the plain local source first and the encrypted remote as the destination.
CURRENT_PHASE="verifying upload and retention"
log "Running rclone cryptcheck for the uploaded backup set"
log "Phase 5/5: verifying upload and applying retention"
if ! rclone cryptcheck "${verify_dir}" "${REMOTE_DIR}" --config "${RCLONE_CONFIG}" >/dev/null 2>&1; then
  fail "cryptcheck verification failed for backup set ${REMOTE_DIR}"
fi

marker_path="${RUN_DIR}/complete.marker"
cat > "${marker_path}" <<EOF
backup_date=${RUN_DATE}
run_id=${RUN_ID}
state=complete
EOF
rclone copyto "${marker_path}" "${REMOTE_DIR}/complete.marker" --config "${RCLONE_CONFIG}" >/dev/null || fail "failed to upload completion marker"

# Retention: keep the three most recent verified backup directories.
log "Applying retention policy"
mapfile -t remote_dirs < <(rclone lsd "${REMOTE_ROOT}" --config "${RCLONE_CONFIG}" 2>/dev/null | awk '{print $NF}' | sort -r)
valid_dirs=()
for remote_dir in "${remote_dirs[@]}"; do
  if [[ -z "${remote_dir}" ]]; then
    continue
  fi
  if rclone lsjson "${REMOTE_ROOT}/${remote_dir}" --config "${RCLONE_CONFIG}" 2>/dev/null | grep -q 'complete.marker'; then
    valid_dirs+=("${remote_dir}")
  fi
done

if (( ${#valid_dirs[@]} > 3 )); then
  for remote_dir in "${valid_dirs[@]:3}"; do
    log "Deleting old backup directory ${REMOTE_ROOT}/${remote_dir}"
    rclone delete "${REMOTE_ROOT}/${remote_dir}" --config "${RCLONE_CONFIG}" >/dev/null || fail "failed deleting stale backup directory ${remote_dir}"
  done
fi

# Remove only the local run directory after success.
rm -rf "${RUN_DIR}"
log "------------------------------------------------------------"
log "Proxmox OneDrive backup run completed successfully"
CURRENT_PHASE="completed successfully"
