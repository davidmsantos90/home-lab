#!/usr/bin/env sh
set -eu

# Detect if running inside container or on host
if [ -f "/.dockerenv" ]; then
  # Running inside container, use container name
  WG_EASY_API_URL="${WG_EASY_API_URL:-http://wg-easy:51821}"
else
  # Running on host, use localhost
  WG_EASY_API_URL="${WG_EASY_API_URL:-http://localhost:51821}"
fi

HOME_LAN_SUBNET="${HOME_LAN_SUBNET:-192.168.1.0/24}"
WG_TRANSLATED_LAN_SUBNET="${WG_TRANSLATED_LAN_SUBNET:-10.200.0.0/24}"
WG_VPN_DNS="${WG_VPN_DNS:-10.200.0.60}"
WG_VPN_ALLOWED_IPS="${WG_VPN_ALLOWED_IPS:-10.200.0.0/24,192.168.1.0/24}"
COOKIES_FILE="/tmp/wg-easy-cookies.txt"

if [ -z "${WG_EASY_ADMIN_USERNAME:-}" ] || [ -z "${WG_EASY_ADMIN_PASSWORD:-}" ]; then
  echo "WG_EASY_ADMIN_USERNAME and WG_EASY_ADMIN_PASSWORD are required" >&2
  exit 1
fi

echo "Waiting for wg-easy API..."
i=0
until [ "$i" -ge 60 ]
do
  # Check if API is responding (any HTTP response, including 401)
  if curl -sS -o /dev/null -w "%{http_code}" "${WG_EASY_API_URL}/api/admin/userconfig" 2>/dev/null | grep -q .; then
    break
  fi
  i=$((i + 1))
  sleep 2
done

if [ "$i" -ge 60 ]; then
  echo "wg-easy API did not become ready in time" >&2
  exit 1
fi

echo "Authenticating with wg-easy..."
curl -fsS -c "$COOKIES_FILE" \
  -X POST \
  -H "Content-Type: application/json" \
  --data "{\"username\":\"$WG_EASY_ADMIN_USERNAME\",\"password\":\"$WG_EASY_ADMIN_PASSWORD\"}" \
  "${WG_EASY_API_URL}/api/session" >/dev/null

# Verify authentication worked
if ! curl -fsS -b "$COOKIES_FILE" "${WG_EASY_API_URL}/api/admin/userconfig" >/dev/null 2>&1; then
  echo "Authentication failed. Check your WG_EASY_ADMIN_USERNAME and WG_EASY_ADMIN_PASSWORD" >&2
  rm -f "$COOKIES_FILE"
  exit 1
fi

# Resolve dnsmasq container IP dynamically
echo "Resolving dnsmasq container IP..."
DNSMASQ_IP=$(docker inspect dnsmasq-wg-easy -f '{{.NetworkSettings.Networks.wg_easy_bridge.IPAddress}}' 2>/dev/null || echo "")
if [ -z "$DNSMASQ_IP" ]; then
  echo "Warning: Could not resolve dnsmasq container IP, DNS interception may not work" >&2
  DNSMASQ_IP="127.0.0.1"
fi
echo "Using dnsmasq IP: $DNSMASQ_IP"

POST_UP="DEFAULT_IF=\$(ip route show default | cut -d' ' -f5 | head -n1); T=${WG_TRANSLATED_LAN_SUBNET}; H=${HOME_LAN_SUBNET}; D=${DNSMASQ_IP}; iptables -t nat -A POSTROUTING -s 10.8.0.0/24 -o \"\$DEFAULT_IF\" -j MASQUERADE; modprobe xt_NETMAP || true; iptables -t nat -A PREROUTING -d 10.200.0.5/32 -j DNAT --to 192.168.100.5; iptables -t nat -A POSTROUTING -s 192.168.100.5/32 -j SNAT --to 10.200.0.5; iptables -t nat -A PREROUTING -d \"\$T\" -j NETMAP --to \"\$H\"; iptables -t nat -A POSTROUTING -s \"\$H\" -j NETMAP --to \"\$T\"; iptables -t nat -A PREROUTING -i wg0 -p udp --dport 53 -j DNAT --to-destination \"\$D:5353\"; iptables -t nat -A PREROUTING -i wg0 -p tcp --dport 53 -j DNAT --to-destination \"\$D:5353\"; iptables -t nat -A POSTROUTING -d \"\$D/32\" -p udp --dport 5353 -j MASQUERADE; iptables -t nat -A POSTROUTING -d \"\$D/32\" -p tcp --dport 5353 -j MASQUERADE; iptables -A INPUT -p udp -m udp --dport 51820 -j ACCEPT; iptables -A FORWARD -i wg0 -j ACCEPT; iptables -A FORWARD -o wg0 -j ACCEPT;"
POST_DOWN="DEFAULT_IF=\$(ip route show default | cut -d' ' -f5 | head -n1); T=${WG_TRANSLATED_LAN_SUBNET}; H=${HOME_LAN_SUBNET}; D=${DNSMASQ_IP}; iptables -t nat -D POSTROUTING -s 10.8.0.0/24 -o \"\$DEFAULT_IF\" -j MASQUERADE; iptables -t nat -D PREROUTING -d 10.200.0.5/32 -j DNAT --to 192.168.100.5; iptables -t nat -D POSTROUTING -s 192.168.100.5/32 -j SNAT --to 10.200.0.5; iptables -t nat -D PREROUTING -d \"\$T\" -j NETMAP --to \"\$H\"; iptables -t nat -D POSTROUTING -s \"\$H\" -j NETMAP --to \"\$T\"; iptables -t nat -D PREROUTING -i wg0 -p udp --dport 53 -j DNAT --to-destination \"\$D:5353\"; iptables -t nat -D PREROUTING -i wg0 -p tcp --dport 53 -j DNAT --to-destination \"\$D:5353\"; iptables -t nat -D POSTROUTING -d \"\$D/32\" -p udp --dport 5353 -j MASQUERADE; iptables -t nat -D POSTROUTING -d \"\$D/32\" -p tcp --dport 5353 -j MASQUERADE; iptables -D INPUT -p udp -m udp --dport 51820 -j ACCEPT; iptables -D FORWARD -i wg0 -j ACCEPT; iptables -D FORWARD -o wg0 -j ACCEPT;"

escape_json() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

POST_UP_JSON="$(escape_json "$POST_UP")"
POST_DOWN_JSON="$(escape_json "$POST_DOWN")"

PAYLOAD="$(cat <<EOF
{"preUp":"","postUp":"${POST_UP_JSON}","preDown":"","postDown":"${POST_DOWN_JSON}"}
EOF
)"

curl -fsS -b "$COOKIES_FILE" \
  -X POST \
  -H "Content-Type: application/json" \
  --data "$PAYLOAD" \
  "${WG_EASY_API_URL}/api/admin/hooks" >/dev/null

USERCONFIG="$(curl -fsS -b "$COOKIES_FILE" "${WG_EASY_API_URL}/api/admin/userconfig")"

allowed_ips_json='['
OLD_IFS="$IFS"
IFS=','
for cidr in $WG_VPN_ALLOWED_IPS; do
  trimmed="$(echo "$cidr" | sed 's/^ *//; s/ *$//')"
  [ -z "$trimmed" ] && continue
  if [ "$allowed_ips_json" != "[" ]; then
    allowed_ips_json="${allowed_ips_json},"
  fi
  allowed_ips_json="${allowed_ips_json}\"${trimmed}\""
done
IFS="$OLD_IFS"
allowed_ips_json="${allowed_ips_json}]"

escape_sed_replacement() {
  printf '%s' "$1" | sed 's/[\/&]/\\&/g'
}

DNS_REPL="$(escape_sed_replacement "\"defaultDns\":[\"${WG_VPN_DNS}\"]")"
ALLOWED_REPL="$(escape_sed_replacement "\"defaultAllowedIps\":${allowed_ips_json}")"

UPDATED_USERCONFIG="$(printf '%s' "$USERCONFIG" | sed -E \
  "s|\"defaultDns\":\[[^]]*\]|${DNS_REPL}|; s|\"defaultAllowedIps\":\[[^]]*\]|${ALLOWED_REPL}|")"

curl -fsS -b "$COOKIES_FILE" \
  -X POST \
  -H "Content-Type: application/json" \
  --data "$UPDATED_USERCONFIG" \
  "${WG_EASY_API_URL}/api/admin/userconfig" >/dev/null

# Cleanup
rm -f "$COOKIES_FILE"

echo "wg-easy hooks and VPN defaults applied successfully"
