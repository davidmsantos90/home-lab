#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="${1:-wg-easy}"
OUTPUT_DIR="${2:-./data/backups}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
OUTPUT_FILE="${OUTPUT_DIR}/wg-easy-hooks-${TIMESTAMP}.txt"

mkdir -p "${OUTPUT_DIR}"

{
  echo "# wg-easy hook backup"
  echo "# generated: ${TIMESTAMP}"
  echo "# container: ${CONTAINER_NAME}"
  echo
  echo "## Effective hook lines from /etc/wireguard/wg0.conf"
  docker exec "${CONTAINER_NAME}" sh -lc "grep -E '^(PreUp|PostUp|PreDown|PostDown) =' /etc/wireguard/wg0.conf"
  echo
  echo "## NAT table snapshot"
  docker exec "${CONTAINER_NAME}" sh -lc "iptables -t nat -S"
} > "${OUTPUT_FILE}"

echo "Backup saved to ${OUTPUT_FILE}"
