#!/usr/bin/env python3
"""Sync a declarative WireGuard access policy into wg-easy's live firewall.

This is the first RFC-007 implementation slice:
- manual trigger only
- dependency-free policy format (JSON)
- peer identity resolved from the wg-easy API
- live iptables changes inside the running wg-easy container

By default the script performs a dry run. Pass --apply to mutate rules.
"""

from __future__ import annotations

import argparse
import ipaddress
import json
import os
import pathlib
import subprocess
import sys
import urllib.error
import urllib.request
from http.cookiejar import CookieJar


CHAIN_NAME = "WG_ACCESS_CONTROL"
INFRA_CHAIN_NAME = "WG_INFRASTRUCTURE"
NEW_CONN_MATCH = ["-m", "conntrack", "--ctstate", "NEW"]
ESTABLISHED_CONN_ACCEPT = [
    "-t",
    "filter",
    "-A",
    CHAIN_NAME,
    "-m",
    "conntrack",
    "--ctstate",
    "ESTABLISHED,RELATED",
    "-j",
    "ACCEPT",
]
FORWARD_RULES = [
    ["-t", "filter", "-D", "FORWARD", "-i", "wg0", "-j", "ACCEPT"],
    ["-t", "filter", "-D", "FORWARD", "-o", "wg0", "-j", "ACCEPT"],
]


def get_home_lab_dir() -> pathlib.Path:
    """Get HOME_LAB_DIR from env or wg-easy/.env, fall back to repo root."""
    home_lab_dir = setting("HOME_LAB_DIR")
    if home_lab_dir:
        return pathlib.Path(home_lab_dir)
    # Fallback: detect from script location (wg-easy/access-control-sync.py -> ../home-lab)
    return pathlib.Path(__file__).resolve().parents[1]


def wg_easy_dir() -> pathlib.Path:
    return pathlib.Path(__file__).resolve().parent


def load_env_file(path: pathlib.Path) -> dict[str, str]:
    env: dict[str, str] = {}
    if not path.exists():
        return env

    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if value.startswith('"') and value.endswith('"'):
            value = value[1:-1]
        if value.startswith("'") and value.endswith("'"):
            value = value[1:-1]
        env[key] = value
    return env


def setting(name: str, default: str | None = None) -> str | None:
    env_file = load_env_file(wg_easy_dir() / ".env")
    return os.environ.get(name) or env_file.get(name) or default


def api_request(opener: urllib.request.OpenerDirector, api_url: str, method: str, path: str, payload: dict | None = None):
    data = None
    headers = {}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"

    request = urllib.request.Request(
        f"{api_url}{path}",
        data=data,
        method=method,
        headers=headers,
    )
    with opener.open(request) as response:
        raw = response.read().decode("utf-8")
        if not raw:
            return None
        return json.loads(raw)


def auth_and_client_list() -> list[dict]:
    api_url = setting("WG_EASY_API_URL", "http://localhost:51821")
    username = setting("WG_EASY_ADMIN_USERNAME")
    password = setting("WG_EASY_ADMIN_PASSWORD")
    if not username or not password:
        raise SystemExit("WG_EASY_ADMIN_USERNAME and WG_EASY_ADMIN_PASSWORD are required")

    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))
    api_request(
        opener,
        api_url,
        "POST",
        "/api/session",
        {"username": username, "password": password, "remember": True},
    )

    clients = api_request(opener, api_url, "GET", "/api/client")
    if isinstance(clients, dict):
        for key in ("clients", "data", "items"):
            if key in clients and isinstance(clients[key], list):
                return clients[key]
        raise SystemExit("Unexpected /api/client payload shape")
    if not isinstance(clients, list):
        raise SystemExit("Unexpected /api/client payload shape")
    return clients


def normalize_ip(value: str) -> str:
    try:
        return str(ipaddress.ip_interface(value).ip)
    except ValueError:
        return value


def client_ip(client: dict) -> str:
    for key in ("ipv4Address", "ipv4_address", "address", "ip"):
        value = client.get(key)
        if value:
            return normalize_ip(str(value))
    raise SystemExit(f"Client {client.get('name', '<unnamed>')} has no IPv4 address field")


def build_peer_map(clients: list[dict]) -> dict[str, str]:
    peer_map: dict[str, str] = {}
    for client in clients:
        name = client.get("name")
        if not name:
            continue
        peer_map[str(name)] = client_ip(client)
    return peer_map


def load_policy(path: pathlib.Path) -> dict:
    if not path.exists():
        raise SystemExit(f"Policy file not found: {path}")
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def expand_group(group_name: str, groups: dict[str, list[str]], peer_map: dict[str, str]) -> list[str]:
    if group_name not in groups:
        raise SystemExit(f"Unknown group: {group_name}")
    resolved: list[str] = []
    for member in groups[group_name]:
        if member not in peer_map:
            raise SystemExit(f"Group {group_name} references unknown peer: {member}")
        resolved.append(peer_map[member])
    return resolved


def expand_selector(selector, peer_map: dict[str, str], groups: dict[str, list[str]]) -> list[str]:
    if selector is None:
        return [None]  # type: ignore[list-item]
    if isinstance(selector, list):
        out: list[str] = []
        for item in selector:
            out.extend(expand_selector(item, peer_map, groups))
        return out
    if not isinstance(selector, str):
        raise SystemExit(f"Unsupported selector type: {selector!r}")

    # Magic keyword: "*" expands to all active peers
    if selector == "*":
        return list(peer_map.values())

    if selector in groups:
        return expand_group(selector, groups, peer_map)
    if selector in peer_map:
        return [peer_map[selector]]

    try:
        ipaddress.ip_network(selector, strict=False)
        return [selector]
    except ValueError:
        pass

    raise SystemExit(f"Unknown peer or address selector: {selector}")


def protocol_variants(protocol: str | None, port: int | None) -> list[str | None]:
    if protocol is None or protocol.lower() in {"any", "*"}:
        if port is None:
            return [None]
        return ["tcp", "udp"]
    protocol = protocol.lower()
    if protocol not in {"tcp", "udp"}:
        raise SystemExit(f"Unsupported protocol: {protocol}")
    return [protocol]


def rule_to_iptables(rule: dict, peer_map: dict[str, str], groups: dict[str, list[str]]) -> list[list[str]]:
    action = str(rule.get("action", "")).lower()
    if action not in {"allow", "deny", "drop", "reject"}:
        raise SystemExit(f"Unsupported action: {rule.get('action')!r}")

    if "source" in rule and "source_group" in rule:
        raise SystemExit("Use either source or source_group, not both")
    if "destination" in rule and "destination_group" in rule:
        raise SystemExit("Use either destination or destination_group, not both")

    sources = expand_selector(rule.get("source") or rule.get("source_group"), peer_map, groups)
    destinations = expand_selector(rule.get("destination") or rule.get("destination_group"), peer_map, groups)
    port = rule.get("port")
    if port is not None and port != "any":
        port = int(port)
    else:
        port = None

    commands: list[list[str]] = []
    for source in sources:
        for destination in destinations:
            for protocol in protocol_variants(rule.get("protocol"), port):
                command = [
                    "-t",
                    "filter",
                    "-A",
                    CHAIN_NAME,
                ]
                if source is not None:
                    command += ["-s", source]
                if destination is not None:
                    command += ["-d", destination]
                if protocol is not None:
                    command += ["-p", protocol]
                if port is not None:
                    command += ["--dport", str(port)]
                command += NEW_CONN_MATCH
                if action == "allow":
                    command += ["-j", "ACCEPT"]
                elif action in {"deny", "drop"}:
                    command += ["-j", "DROP"]
                else:
                    command += ["-j", "REJECT"]
                    if protocol == "tcp":
                        command += ["--reject-with", "tcp-reset"]
                commands.append(command)
    return commands


def run_iptables(args: list[str], check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["docker", "exec", "wg-easy", "iptables", *args],
        check=check,
        text=True,
        capture_output=True,
    )


def ensure_chain(chain_name: str) -> None:
    result = run_iptables(["-t", "filter", "-S", chain_name], check=False)
    if result.returncode != 0:
        result = run_iptables(["-t", "filter", "-N", chain_name], check=False)
        if result.returncode != 0:
            raise SystemExit(result.stderr.strip() or f"Failed to create chain {chain_name}")
    run_iptables(["-t", "filter", "-F", chain_name])


def remove_forward_jump(chain_name: str) -> None:
    while run_iptables(["-t", "filter", "-D", "FORWARD", "-j", chain_name], check=False).returncode == 0:
        pass


def ensure_forward_path() -> None:
    remove_forward_jump(INFRA_CHAIN_NAME)
    remove_forward_jump(CHAIN_NAME)
    run_iptables(["-t", "filter", "-I", "FORWARD", "1", "-j", CHAIN_NAME])
    run_iptables(["-t", "filter", "-I", "FORWARD", "1", "-j", INFRA_CHAIN_NAME])


def remove_forwards() -> None:
    for rule in FORWARD_RULES:
        while run_iptables(rule, check=False).returncode == 0:
            pass


def ensure_infrastructure_chain(dnsmasq_ip: str) -> None:
    try:
        dns_ip = str(ipaddress.ip_address(dnsmasq_ip))
    except ValueError as exc:
        raise SystemExit(f"Invalid DNSMASQ_IP value: {dnsmasq_ip!r}") from exc

    ensure_chain(INFRA_CHAIN_NAME)
    run_iptables(["-t", "filter", "-A", INFRA_CHAIN_NAME, "-i", "wg0", "-p", "udp", "-d", f"{dns_ip}/32", "--dport", "5353", "-j", "ACCEPT"])
    run_iptables(["-t", "filter", "-A", INFRA_CHAIN_NAME, "-i", "wg0", "-p", "tcp", "-d", f"{dns_ip}/32", "--dport", "5353", "-j", "ACCEPT"])
    run_iptables(["-t", "filter", "-A", INFRA_CHAIN_NAME, "-j", "RETURN"])


def apply_rules(commands: list[list[str]]) -> None:
    dnsmasq_ip = setting("DNSMASQ_IP", "172.28.0.2")
    if dnsmasq_ip is None:
        raise SystemExit("DNSMASQ_IP must not be empty")

    ensure_infrastructure_chain(dnsmasq_ip)
    ensure_chain(CHAIN_NAME)
    run_iptables(ESTABLISHED_CONN_ACCEPT)
    for command in commands:
        run_iptables(command)
    run_iptables(["-t", "filter", "-A", CHAIN_NAME, "-j", "DROP"])
    ensure_forward_path()
    remove_forwards()


def summarize(rules: list[dict], peer_map: dict[str, str]) -> None:
    print("wg-easy peers:")
    for name, ip in sorted(peer_map.items()):
        print(f"  {name}: {ip}")
    print("")
    print(f"Loaded {len(rules)} policy rules")
    for rule in rules:
        print(f"  {rule}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync wg-easy access-control rules")
    parser.add_argument(
        "--policies",
        default=str(get_home_lab_dir() / "access-control" / "policies.json"),
        help="Path to access policy JSON file",
    )
    parser.add_argument("--apply", action="store_true", help="Apply rules live inside the wg-easy container")
    args = parser.parse_args()

    policy_path = pathlib.Path(args.policies)
    if not policy_path.exists():
        example_path = get_home_lab_dir() / "access-control" / "policies.json.example"
        if not args.apply and example_path.exists() and policy_path.name == "policies.json":
            policy_path = example_path
            print(f"Policy file not found, using example for dry run: {policy_path}")
        else:
            raise SystemExit(f"Policy file not found: {policy_path}")

    policy = load_policy(policy_path)
    clients = auth_and_client_list()
    peer_map = build_peer_map(clients)
    groups = policy.get("groups", {})
    rules = policy.get("rules", [])
    if not isinstance(groups, dict) or not isinstance(rules, list):
        raise SystemExit("Policy file must contain top-level 'groups' object and 'rules' array")

    summarize(rules, peer_map)

    rule_commands: list[list[str]] = []
    for rule in rules:
        rule_commands.extend(rule_to_iptables(rule, peer_map, groups))

    if not args.apply:
        print("")
        print("Dry run only. Re-run with --apply to mutate live firewall rules.")
        return 0

    print("")
    print("Applying access-control rules...")
    apply_rules(rule_commands)
    print("Done.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except urllib.error.HTTPError as exc:
        print(f"wg-easy API request failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
    except subprocess.CalledProcessError as exc:
        stderr = exc.stderr.strip() if exc.stderr else ""
        stdout = exc.stdout.strip() if exc.stdout else ""
        message = stderr or stdout or str(exc)
        print(f"iptables command failed: {message}", file=sys.stderr)
        raise SystemExit(1)
