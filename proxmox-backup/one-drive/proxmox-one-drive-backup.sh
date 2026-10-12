#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "${SCRIPT_DIR}/.env" ]]; then
  # shellcheck disable=SC1091
  source "${SCRIPT_DIR}/.env"
fi

export TZ="${TIMEZONE:-Europe/Lisbon}"
: "${RCLONE_CONFIG:=/root/.config/rclone/rclone.conf}"
: "${RCLONE_REMOTE:=one-drive-crypt}"
: "${REMOTE_PREFIX:=Backups-Proxmox/weekly}"
: "${STAGING_DIR:=/var/lib/vz/onedrive-staging}"
: "${LOG_DIR:=/var/log/proxmox-onedrive-backup}"
: "${LOCK_FILE:=/run/proxmox-onedrive-backup.lock}"
: "${BACKUP_GUESTS:=}"
: "${EXCLUDED_GUESTS:=}"

RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_DATE="$(date +%F)"
REMOTE_ROOT="${RCLONE_REMOTE}:/${REMOTE_PREFIX}"
REMOTE_DIR="${REMOTE_ROOT}/${RUN_DATE}"
RUN_DIR="${STAGING_DIR}/backup-${RUN_DATE}-${RUN_ID}"

mkdir -p "${LOG_DIR}"
LOG_FILE="${LOG_DIR}/$(date +%F)-proxmox-onedrive-backup.log"
exec >> >(tee -a "${LOG_FILE}") 2>&1

log() {
  printf '%s %s\n' "$(date -Is)" "$*"
}

fail() {
  log "ERROR: $*"
  exit 1
}

cleanup() {
  if [[ -d "${RUN_DIR:-}" ]]; then
    rm -rf "${RUN_DIR}"
  fi
}
trap cleanup EXIT

log "Starting Proxmox OneDrive backup run ${RUN_ID}"
log "------------------------------------------------------------"
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
log "Running rclone cryptcheck for the uploaded backup set"
log "Phase 5/5: verifying upload and applying retention"
if ! rclone cryptcheck "${REMOTE_DIR}" "${verify_dir}" --config "${RCLONE_CONFIG}" >/dev/null 2>&1; then
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
