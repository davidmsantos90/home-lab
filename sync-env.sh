#!/usr/bin/env bash
# Synchronize local service environment files to the Raspberry Pi.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REMOTE="pi@little-pi4"
REMOTE_DIR="/home/pi/github/home-lab"

command -v rsync >/dev/null || {
    echo "rsync is required but was not found." >&2
    exit 1
}

command -v ssh >/dev/null || {
    echo "ssh is required but was not found." >&2
    exit 1
}

ssh "$REMOTE" "mkdir -p $REMOTE_DIR"

(
    cd "$SCRIPT_DIR"
    find . -path ./.git -prune -o -type f -name .env -print0 |
        rsync --archive --verbose --from0 --files-from=- --relative \
            ./ "$REMOTE:$REMOTE_DIR/"
)

ssh "$REMOTE" "find '$REMOTE_DIR' -type f -name .env -exec chmod 600 {} +"
