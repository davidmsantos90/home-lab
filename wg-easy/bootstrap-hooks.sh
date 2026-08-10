#!/usr/bin/env sh
set -eu

# Load .env file if it exists and credentials not already set
if [ -z "${WG_EASY_ADMIN_USERNAME:-}" ] || [ -z "${WG_EASY_ADMIN_PASSWORD:-}" ]; then
  if [ -f ".env" ]; then
    # Source .env but only load WG_EASY variables (safe subset)
    set +e
    eval "$(grep '^WG_EASY_ADMIN_' .env)"
    set -e
  fi
fi

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
WG_VPN_DNS="${WG_VPN_DNS:-10.200.0.1,1.1.1.1}"
WG_VPN_ALLOWED_IPS="${WG_VPN_ALLOWED_IPS:-10.200.0.0/24,192.168.1.0/24}"
# WireGuard-recommended keepalive so client-side NAT/router mappings don't
# expire during idle periods (prevents needing to manually reconnect after
# the connection has been idle for a while).
WG_VPN_PERSISTENT_KEEPALIVE="${WG_VPN_PERSISTENT_KEEPALIVE:-25}"
# Expose wg-easy's own admin UI to VPN clients at a dedicated translated IP,
# mapped 1:1 to wg-easy's pinned homelab-bridge IP (must match the "wg-easy"
# service's ipv4_address in compose.yaml).
WG_EASY_ADMIN_HOMELAB_IP="${WG_EASY_ADMIN_HOMELAB_IP:-192.168.100.9}"
WG_EASY_ADMIN_TRANSLATED_IP="${WG_EASY_ADMIN_TRANSLATED_IP:-10.200.0.9}"
COOKIES_FILE="/tmp/wg-easy-cookies.txt"

if [ -z "${WG_EASY_ADMIN_USERNAME:-}" ] || [ -z "${WG_EASY_ADMIN_PASSWORD:-}" ]; then
  echo "WG_EASY_ADMIN_USERNAME and WG_EASY_ADMIN_PASSWORD are required" >&2
  echo "Set them as environment variables or in .env file" >&2
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
  --data "{\"username\":\"$WG_EASY_ADMIN_USERNAME\",\"password\":\"$WG_EASY_ADMIN_PASSWORD\",\"remember\":true}" \
  "${WG_EASY_API_URL}/api/session" >/dev/null

# Verify authentication worked
if ! curl -fsS -b "$COOKIES_FILE" "${WG_EASY_API_URL}/api/admin/userconfig" >/dev/null 2>&1; then
  echo "Authentication failed. Check your WG_EASY_ADMIN_USERNAME and WG_EASY_ADMIN_PASSWORD" >&2
  rm -f "$COOKIES_FILE"
  exit 1
fi

# dnsmasq's IP on wg_easy_internal is pinned (see compose.yaml) specifically
# so this doesn't need runtime resolution at all. Previously this WAS
# dynamically resolved (via getent/docker inspect) because dnsmasq had no
# static IP — but PostUp/PostDown embed this IP as a literal value in
# wg-easy's persisted config, so any drift there (unpinned = dynamic Docker
# IPAM reassigning it across restarts) silently made the saved rules stale,
# forcing a hook-rerun + wg-easy-recreate cycle just to catch up. Pinning it
# removes that whole class of bug: this value should now never change.
DNSMASQ_IP="${DNSMASQ_IP:-172.28.0.2}"
echo "Using dnsmasq IP: $DNSMASQ_IP"

# NOTE: DNS interception rules MUST come first in PREROUTING. Once a packet
# matches a NAT rule (DNAT/NETMAP/REDIRECT), iptables stops evaluating further
# rules in that chain for that packet. Since the translated subnet
# (10.200.0.0/24) includes the wg0 gateway address clients use for DNS
# (10.200.0.1), a NETMAP/NPM rule placed before the DNS rule would catch DNS
# traffic first and prevent it from ever reaching dnsmasq.
#
# Likewise, the NPM and wg-easy-admin host exceptions MUST come before the
# broad NETMAP catch-all below, since their destination IPs (10.200.0.5,
# 10.200.0.9) fall inside the NETMAP's translated subnet ($T) — NETMAP would
# otherwise translate them to an unrelated real LAN host (192.168.1.5/.9)
# instead of routing to the actual homelab-bridge container.
POST_UP="DEFAULT_IF=\$(ip route show default | cut -d' ' -f5 | head -n1); T=${WG_TRANSLATED_LAN_SUBNET}; H=${HOME_LAN_SUBNET}; D=${DNSMASQ_IP}; A=${WG_EASY_ADMIN_HOMELAB_IP}; AT=${WG_EASY_ADMIN_TRANSLATED_IP}; iptables -t nat -A POSTROUTING -s 10.8.0.0/24 -o \"\$DEFAULT_IF\" -j MASQUERADE; modprobe xt_NETMAP || true; iptables -t nat -A PREROUTING -i wg0 -p udp --dport 53 -j DNAT --to-destination \"\$D:5353\"; iptables -t nat -A PREROUTING -i wg0 -p tcp --dport 53 -j DNAT --to-destination \"\$D:5353\"; iptables -t nat -A POSTROUTING -d \"\$D/32\" -p udp --dport 5353 -j MASQUERADE; iptables -t nat -A POSTROUTING -d \"\$D/32\" -p tcp --dport 5353 -j MASQUERADE; iptables -t nat -A PREROUTING -d 10.200.0.5/32 -j DNAT --to 192.168.100.5; iptables -t nat -A POSTROUTING -s 192.168.100.5/32 -j SNAT --to 10.200.0.5; iptables -t nat -A PREROUTING -d \"\$AT/32\" -j DNAT --to \"\$A\"; iptables -t nat -A POSTROUTING -s \"\$A/32\" -j SNAT --to \"\$AT\"; iptables -t nat -A PREROUTING -d \"\$T\" -j NETMAP --to \"\$H\"; iptables -t nat -A POSTROUTING -s \"\$H\" -j NETMAP --to \"\$T\"; iptables -A INPUT -p udp -m udp --dport 51820 -j ACCEPT; iptables -A FORWARD -i wg0 -j ACCEPT; iptables -A FORWARD -o wg0 -j ACCEPT;"
POST_DOWN="DEFAULT_IF=\$(ip route show default | cut -d' ' -f5 | head -n1); T=${WG_TRANSLATED_LAN_SUBNET}; H=${HOME_LAN_SUBNET}; D=${DNSMASQ_IP}; A=${WG_EASY_ADMIN_HOMELAB_IP}; AT=${WG_EASY_ADMIN_TRANSLATED_IP}; iptables -t nat -D POSTROUTING -s 10.8.0.0/24 -o \"\$DEFAULT_IF\" -j MASQUERADE; iptables -t nat -D PREROUTING -i wg0 -p udp --dport 53 -j DNAT --to-destination \"\$D:5353\"; iptables -t nat -D PREROUTING -i wg0 -p tcp --dport 53 -j DNAT --to-destination \"\$D:5353\"; iptables -t nat -D POSTROUTING -d \"\$D/32\" -p udp --dport 5353 -j MASQUERADE; iptables -t nat -D POSTROUTING -d \"\$D/32\" -p tcp --dport 5353 -j MASQUERADE; iptables -t nat -D PREROUTING -d 10.200.0.5/32 -j DNAT --to 192.168.100.5; iptables -t nat -D POSTROUTING -s 192.168.100.5/32 -j SNAT --to 10.200.0.5; iptables -t nat -D PREROUTING -d \"\$AT/32\" -j DNAT --to \"\$A\"; iptables -t nat -D POSTROUTING -s \"\$A/32\" -j SNAT --to \"\$AT\"; iptables -t nat -D PREROUTING -d \"\$T\" -j NETMAP --to \"\$H\"; iptables -t nat -D POSTROUTING -s \"\$H\" -j NETMAP --to \"\$T\"; iptables -D INPUT -p udp -m udp --dport 51820 -j ACCEPT; iptables -D FORWARD -i wg0 -j ACCEPT; iptables -D FORWARD -o wg0 -j ACCEPT;"

escape_json() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

POST_UP_JSON="$(escape_json "$POST_UP")"
POST_DOWN_JSON="$(escape_json "$POST_DOWN")"

PAYLOAD="$(cat <<EOF
{"preUp":"","postUp":"${POST_UP_JSON}","preDown":"","postDown":"${POST_DOWN_JSON}"}
EOF
)"

# Idempotency check: only POST (and thus only trigger the caller's
# force-recreate-to-apply-PostUp/PostDown cycle) if the stored hooks
# actually differ from what we'd write. Once dnsmasq's IP is pinned, the
# desired PostUp/PostDown never change between runs, so on every ordinary
# restart this ends up being a no-op — saving the disruptive wg-easy
# recreate that would otherwise happen on every single restart for no
# reason. Substring match (not full JSON equality) is intentional: it's
# resilient to extra fields/ordering in the GET response, and both sides
# use the same simple backslash/quote JSON-escaping for this content.
CURRENT_HOOKS="$(curl -fsS -b "$COOKIES_FILE" "${WG_EASY_API_URL}/api/admin/hooks")"
HOOKS_CHANGED=false
if ! printf '%s' "$CURRENT_HOOKS" | grep -qF "\"postUp\":\"${POST_UP_JSON}\"" \
  || ! printf '%s' "$CURRENT_HOOKS" | grep -qF "\"postDown\":\"${POST_DOWN_JSON}\""; then
  HOOKS_CHANGED=true
  echo "Hooks (PostUp/PostDown) differ from desired state — updating..."
  curl -fsS -b "$COOKIES_FILE" \
    -X POST \
    -H "Content-Type: application/json" \
    --data "$PAYLOAD" \
    "${WG_EASY_API_URL}/api/admin/hooks" >/dev/null
else
  echo "Hooks (PostUp/PostDown) already up to date — skipping"
fi

USERCONFIG="$(curl -fsS -b "$COOKIES_FILE" "${WG_EASY_API_URL}/api/admin/userconfig")"

# Build a JSON array from a comma-separated list (used for both
# WG_VPN_ALLOWED_IPS and WG_VPN_DNS, which may each hold multiple entries).
csv_to_json_array() {
  json='['
  OLD_IFS="$IFS"
  IFS=','
  for item in $1; do
    trimmed="$(echo "$item" | sed 's/^ *//; s/ *$//')"
    [ -z "$trimmed" ] && continue
    if [ "$json" != "[" ]; then
      json="${json},"
    fi
    json="${json}\"${trimmed}\""
  done
  IFS="$OLD_IFS"
  printf '%s]' "$json"
}

allowed_ips_json="$(csv_to_json_array "$WG_VPN_ALLOWED_IPS")"
dns_json="$(csv_to_json_array "$WG_VPN_DNS")"

escape_sed_replacement() {
  printf '%s' "$1" | sed 's/[\/&]/\\&/g'
}

DNS_REPL="$(escape_sed_replacement "\"defaultDns\":${dns_json}")"
ALLOWED_REPL="$(escape_sed_replacement "\"defaultAllowedIps\":${allowed_ips_json}")"
KEEPALIVE_REPL="$(escape_sed_replacement "\"defaultPersistentKeepalive\":${WG_VPN_PERSISTENT_KEEPALIVE}")"

UPDATED_USERCONFIG="$(printf '%s' "$USERCONFIG" | sed -E \
  "s|\"defaultDns\":\[[^]]*\]|${DNS_REPL}|; s|\"defaultAllowedIps\":\[[^]]*\]|${ALLOWED_REPL}|; s|\"defaultPersistentKeepalive\":[0-9]+|${KEEPALIVE_REPL}|")"

USERCONFIG_CHANGED=false
if [ "$UPDATED_USERCONFIG" != "$USERCONFIG" ]; then
  USERCONFIG_CHANGED=true
  echo "VPN client defaults differ from desired state — updating..."
  curl -fsS -b "$COOKIES_FILE" \
    -X POST \
    -H "Content-Type: application/json" \
    --data "$UPDATED_USERCONFIG" \
    "${WG_EASY_API_URL}/api/admin/userconfig" >/dev/null
else
  echo "VPN client defaults already up to date — skipping"
fi

# Cleanup
rm -f "$COOKIES_FILE"

# Parseable marker, read by lab.sh's run_bootstrap_hooks() to decide whether
# a wg-easy recreate is actually needed: recreating is only required when
# hooks changed (PostUp/PostDown need the interface cycled to take effect).
# A userconfig-only change (client defaults) applies to newly created
# clients immediately with no interface cycle needed at all.
if $HOOKS_CHANGED; then
  echo "wg-easy hooks and VPN defaults applied successfully"
  echo "BOOTSTRAP_RESULT=changed"
else
  echo "wg-easy hooks and VPN defaults already up to date, nothing to apply"
  echo "BOOTSTRAP_RESULT=unchanged"
fi
