#!/usr/bin/env sh
set -eu

WG_EASY_API_URL="${WG_EASY_API_URL:-http://wg-easy:51821}"
HOME_LAN_SUBNET="${HOME_LAN_SUBNET:-192.168.1.0/24}"
WG_TRANSLATED_LAN_SUBNET="${WG_TRANSLATED_LAN_SUBNET:-10.200.0.0/24}"

if [ -z "${WG_EASY_ADMIN_USERNAME:-}" ] || [ -z "${WG_EASY_ADMIN_PASSWORD:-}" ]; then
  echo "WG_EASY_ADMIN_USERNAME and WG_EASY_ADMIN_PASSWORD are required" >&2
  exit 1
fi

AUTH="$(printf '%s:%s' "$WG_EASY_ADMIN_USERNAME" "$WG_EASY_ADMIN_PASSWORD" | base64 | tr -d '\n')"

echo "Waiting for wg-easy API..."
i=0
until [ "$i" -ge 60 ]
do
  if curl -fsS -H "Authorization: Basic $AUTH" "${WG_EASY_API_URL}/api/admin/hooks" >/dev/null; then
    break
  fi
  i=$((i + 1))
  sleep 2
done

if [ "$i" -ge 60 ]; then
  echo "wg-easy API did not become ready in time" >&2
  exit 1
fi

POST_UP="DEFAULT_IF=\$(ip route show default | cut -d' ' -f5 | head -n1); T=${WG_TRANSLATED_LAN_SUBNET}; H=${HOME_LAN_SUBNET}; iptables -t nat -A POSTROUTING -s 10.8.0.0/24 -o \"\$DEFAULT_IF\" -j MASQUERADE; modprobe xt_NETMAP || true; iptables -t nat -A PREROUTING -d \"\$T\" -j NETMAP --to \"\$H\"; iptables -t nat -A POSTROUTING -s \"\$H\" -j NETMAP --to \"\$T\"; iptables -A INPUT -p udp -m udp --dport 51820 -j ACCEPT; iptables -A FORWARD -i wg0 -j ACCEPT; iptables -A FORWARD -o wg0 -j ACCEPT;"
POST_DOWN="DEFAULT_IF=\$(ip route show default | cut -d' ' -f5 | head -n1); T=${WG_TRANSLATED_LAN_SUBNET}; H=${HOME_LAN_SUBNET}; iptables -t nat -D POSTROUTING -s 10.8.0.0/24 -o \"\$DEFAULT_IF\" -j MASQUERADE; iptables -t nat -D PREROUTING -d \"\$T\" -j NETMAP --to \"\$H\"; iptables -t nat -D POSTROUTING -s \"\$H\" -j NETMAP --to \"\$T\"; iptables -D INPUT -p udp -m udp --dport 51820 -j ACCEPT; iptables -D FORWARD -i wg0 -j ACCEPT; iptables -D FORWARD -o wg0 -j ACCEPT;"

escape_json() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

POST_UP_JSON="$(escape_json "$POST_UP")"
POST_DOWN_JSON="$(escape_json "$POST_DOWN")"

PAYLOAD="$(cat <<EOF
{"preUp":"","postUp":"${POST_UP_JSON}","preDown":"","postDown":"${POST_DOWN_JSON}"}
EOF
)"

curl -fsS \
  -X POST \
  -H "Authorization: Basic $AUTH" \
  -H "Content-Type: application/json" \
  --data "$PAYLOAD" \
  "${WG_EASY_API_URL}/api/admin/hooks" >/dev/null

echo "wg-easy hooks applied successfully"
