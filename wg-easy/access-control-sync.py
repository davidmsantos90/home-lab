#!/usr/bin/env python3
"""Sync a declarative WireGuard access policy into wg-easy's live firewall.

The synchronizer is manually triggered, resolves peer identity from the wg-easy
API, applies live firewall changes inside the running container, and uses
ipset-backed selector sets when the policy references multiple peers or
addresses.

By default the script performs a dry run. Pass --apply to mutate rules.
"""

from __future__ import annotations

import argparse
import hashlib
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
IPSET_PREFIX = "wgac"
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


def load_json_file(path: pathlib.Path) -> dict:
    if not path.exists():
        raise SystemExit(f"File not found: {path}")
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        raise SystemExit(f"File must contain a JSON object: {path}")
    return data


def load_json_array(path: pathlib.Path) -> list:
    if not path.exists():
        raise SystemExit(f"File not found: {path}")
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, list):
        raise SystemExit(f"File must contain a JSON array: {path}")
    return data


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


def load_policy(path: pathlib.Path) -> list[dict]:
    rules = load_json_array(path)
    for index, rule in enumerate(rules):
        if not isinstance(rule, dict):
            raise SystemExit(f"Policy rule at index {index} must be a JSON object")
    return rules


def normalize_selector_list(value, label: str) -> list[str]:
    if not isinstance(value, list):
        raise SystemExit(f"{label} must be a list of strings")
    out: list[str] = []
    for item in value:
        if not isinstance(item, str):
            raise SystemExit(f"{label} entries must be strings")
        trimmed = item.strip()
        if not trimmed:
            raise SystemExit(f"{label} entries must not be empty")
        out.append(trimmed)
    return out


def normalize_group_members(value, group_name: str) -> list[str]:
    if isinstance(value, list):
        return normalize_selector_list(value, f"Group {group_name}")
    if isinstance(value, dict):
        members = value.get("members")
        if members is None:
            members = value.get("peers")
        if members is None:
            raise SystemExit(f"Group {group_name} must define members")
        return normalize_selector_list(members, f"Group {group_name}")
    raise SystemExit(f"Unsupported group definition for {group_name!r}")


def normalize_host_addresses(value, host_name: str) -> list[str]:
    if isinstance(value, str):
        trimmed = value.strip()
        if not trimmed:
            raise SystemExit(f"Host {host_name} address must not be empty")
        return [trimmed]
    if isinstance(value, dict):
        addresses = value.get("addresses")
        if addresses is not None:
            return normalize_selector_list(addresses, f"Host {host_name} addresses")
        address = value.get("address")
        if address is None:
            raise SystemExit(f"Host {host_name} must define address or addresses")
        if not isinstance(address, str):
            raise SystemExit(f"Host {host_name} address must be a string")
        trimmed = address.strip()
        if not trimmed:
            raise SystemExit(f"Host {host_name} address must not be empty")
        return [trimmed]
    raise SystemExit(f"Unsupported host definition for {host_name!r}")


def normalize_service_entries(value, service_name: str) -> list[dict]:
    entries = value
    if isinstance(value, dict) and "entries" in value:
        entries = value["entries"]
    elif isinstance(value, dict) and "protocol" in value and "port" in value:
        entries = [value]
    if not isinstance(entries, list):
        raise SystemExit(f"Service {service_name} must be an object or a list of objects")

    normalized: list[dict] = []
    for entry in entries:
        if not isinstance(entry, dict):
            raise SystemExit(f"Service {service_name} entries must be objects")
        protocol = entry.get("protocol")
        port = entry.get("port")
        if not isinstance(protocol, str) or not protocol.strip():
            raise SystemExit(f"Service {service_name} entry must define protocol")
        if port is None:
            raise SystemExit(f"Service {service_name} entry must define port")
        try:
            normalized_port = int(port)
        except (TypeError, ValueError) as exc:
            raise SystemExit(f"Service {service_name} port must be an integer") from exc
        normalized.append(
            {
                "protocol": protocol.strip().lower(),
                "port": normalized_port,
            }
        )
    return normalized


def load_aliases(path: pathlib.Path) -> dict[str, dict]:
    aliases = load_json_file(path)
    extra_keys = set(aliases) - {"groups", "hosts", "services"}
    if extra_keys:
        raise SystemExit(f"Alias file may only contain top-level groups, hosts, and services: {path}")

    groups_raw = aliases.get("groups", {})
    hosts_raw = aliases.get("hosts", {})
    services_raw = aliases.get("services", {})
    if not isinstance(groups_raw, dict) or not isinstance(hosts_raw, dict) or not isinstance(services_raw, dict):
        raise SystemExit("Alias file must contain top-level 'groups', 'hosts', and 'services' objects")

    groups = {name: normalize_group_members(value, name) for name, value in groups_raw.items()}
    hosts = {name: normalize_host_addresses(value, name) for name, value in hosts_raw.items()}
    services = {name: normalize_service_entries(value, name) for name, value in services_raw.items()}
    return {"groups": groups, "hosts": hosts, "services": services}


def expand_group(group_name: str, groups: dict[str, list[str]], peer_map: dict[str, str]) -> list[str]:
    if group_name not in groups:
        raise SystemExit(f"Unknown group: {group_name}")
    resolved: list[str] = []
    for member in groups[group_name]:
        if member not in peer_map:
            raise SystemExit(f"Group {group_name} references unknown peer: {member}")
        resolved.append(peer_map[member])
    return resolved


def expand_selector(selector, peer_map: dict[str, str], groups: dict[str, list[str]], hosts: dict[str, list[str]]) -> list[str]:
    if selector is None:
        return [None]  # type: ignore[list-item]
    if isinstance(selector, list):
        out: list[str] = []
        for item in selector:
            out.extend(expand_selector(item, peer_map, groups, hosts))
        return out
    if not isinstance(selector, str):
        raise SystemExit(f"Unsupported selector type: {selector!r}")

    # Magic keyword: "*" expands to all active peers
    if selector == "*":
        return list(peer_map.values())

    matches: list[tuple[str, list[str]]] = []
    if selector in groups:
        matches.append(("group", expand_group(selector, groups, peer_map)))
    if selector in peer_map:
        matches.append(("peer", [peer_map[selector]]))
    if selector in hosts:
        matches.append(("host", hosts[selector]))

    if matches:
        if len(matches) > 1:
            kinds = ", ".join(kind for kind, _ in matches)
            raise SystemExit(f"Ambiguous selector {selector!r}; it matches multiple alias kinds: {kinds}")
        return matches[0][1]

    try:
        ipaddress.ip_network(selector, strict=False)
        return [selector]
    except ValueError:
        pass

    raise SystemExit(f"Unknown peer or address selector: {selector}")


def dedupe_preserve_order(values: list[str]) -> list[str]:
    seen: set[str] = set()
    deduped: list[str] = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        deduped.append(value)
    return deduped


def selector_values(selector, peer_map: dict[str, str], groups: dict[str, list[str]], hosts: dict[str, list[str]]) -> list[str]:
    values = [value for value in expand_selector(selector, peer_map, groups, hosts) if value is not None]
    return dedupe_preserve_order(values)


def is_single_ip(value: str) -> bool:
    try:
        network = ipaddress.ip_network(value, strict=False)
    except ValueError:
        return False
    return network.prefixlen == network.max_prefixlen


def stable_set_name(role: str, values: list[str]) -> str:
    payload = "\0".join(sorted(values))
    digest = hashlib.sha1(payload.encode("utf-8")).hexdigest()[:12]
    return f"{IPSET_PREFIX}_{role}_{digest}"


def ipset_available() -> bool:
    result = subprocess.run(
        ["docker", "exec", "wg-easy", "sh", "-lc", "command -v ipset >/dev/null 2>&1"],
        check=False,
        text=True,
        capture_output=True,
    )
    return result.returncode == 0


def run_ipset(args: list[str], check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["docker", "exec", "wg-easy", "ipset", *args],
        check=check,
        text=True,
        capture_output=True,
    )


def cleanup_generated_ipsets() -> None:
    result = run_ipset(["list", "-name"], check=False)
    if result.returncode != 0:
        return

    for name in result.stdout.splitlines():
        if not name.startswith(f"{IPSET_PREFIX}_"):
            continue
        run_ipset(["destroy", name], check=False)


def protocol_variants(protocol: str | None, port: int | None) -> list[str | None]:
    if protocol is None or protocol.lower() in {"any", "*"}:
        if port is None:
            return [None]
        return ["tcp", "udp"]
    protocol = protocol.lower()
    if protocol not in {"tcp", "udp"}:
        raise SystemExit(f"Unsupported protocol: {protocol}")
    return [protocol]


def service_selector_values(selector, services: dict[str, list[dict]]) -> list[dict]:
    if selector is None:
        return []
    def dedupe(entries: list[dict]) -> list[dict]:
        deduped: list[dict] = []
        seen: set[tuple[str, int]] = set()
        for entry in entries:
            key = (entry["protocol"], entry["port"])
            if key in seen:
                continue
            seen.add(key)
            deduped.append(entry)
        return deduped

    if isinstance(selector, list):
        expanded: list[dict] = []
        for item in selector:
            expanded.extend(service_selector_values(item, services))
        return dedupe(expanded)
    if not isinstance(selector, str):
        raise SystemExit(f"Unsupported service selector type: {selector!r}")
    if selector not in services:
        raise SystemExit(f"Unknown service alias: {selector}")
    return dedupe(list(services[selector]))


def rule_to_iptables(
    rule: dict,
    peer_map: dict[str, str],
    groups: dict[str, list[str]],
    hosts: dict[str, list[str]],
    services: dict[str, list[dict]],
    backend: str,
    set_registry: dict[str, tuple[str, ...]],
) -> list[list[str]]:
    action = str(rule.get("action", "")).lower()
    if action not in {"allow", "deny", "drop", "reject"}:
        raise SystemExit(f"Unsupported action: {rule.get('action')!r}")

    if "source" in rule and "source_group" in rule:
        raise SystemExit("Use either source or source_group, not both")
    if "destination" in rule and "destination_group" in rule:
        raise SystemExit("Use either destination or destination_group, not both")
    if "service" in rule and (rule.get("protocol") is not None or rule.get("port") is not None):
        raise SystemExit("Use either service or protocol/port, not both")

    sources = selector_values(rule.get("source") or rule.get("source_group"), peer_map, groups, hosts)
    destinations = selector_values(rule.get("destination") or rule.get("destination_group"), peer_map, groups, hosts)

    service_specs = service_selector_values(rule.get("service"), services)
    if service_specs:
        match_specs = service_specs
    else:
        port = rule.get("port")
        if port is not None and port != "any":
            try:
                normalized_port = int(port)
            except (TypeError, ValueError) as exc:
                raise SystemExit(f"Invalid port: {port!r}") from exc
        else:
            normalized_port = None
        match_specs = []
        for protocol in protocol_variants(rule.get("protocol"), normalized_port):
            match_specs.append({"protocol": protocol, "port": normalized_port})

    comment = rule.get("comment")
    if comment is not None and not isinstance(comment, str):
        raise SystemExit("Rule comment must be a string")
    if isinstance(comment, str):
        comment = comment.strip()
        if not comment:
            comment = None
        elif len(comment) > 256:
            raise SystemExit("Rule comment must be 256 characters or fewer")

    def selector_clauses(role: str, values: list[str]) -> list[list[str]]:
        if not values:
            return [[]]
        if backend == "ipset" and len(values) > 1 and all(is_single_ip(value) for value in values):
            set_name = stable_set_name(role, values)
            set_registry.setdefault(set_name, tuple(sorted(values)))
            return [["-m", "set", "--match-set", set_name, role]]
        flag = "-s" if role == "src" else "-d"
        return [[flag, value] for value in values]

    commands: list[list[str]] = []
    for source_match in selector_clauses("src", sources):
        for destination_match in selector_clauses("dst", destinations):
            for spec in match_specs:
                command = [
                    "-t",
                    "filter",
                    "-A",
                    CHAIN_NAME,
                ]
                command += source_match
                command += destination_match
                if spec["protocol"] is not None:
                    command += ["-p", spec["protocol"]]
                if spec["port"] is not None:
                    command += ["--dport", str(spec["port"])]
                command += NEW_CONN_MATCH
                if comment is not None:
                    command += ["-m", "comment", "--comment", comment]
                if action == "allow":
                    command += ["-j", "ACCEPT"]
                elif action in {"deny", "drop"}:
                    command += ["-j", "DROP"]
                else:
                    command += ["-j", "REJECT"]
                    if spec["protocol"] == "tcp":
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


def apply_rules(commands: list[list[str]], backend: str, set_registry: dict[str, tuple[str, ...]]) -> None:
    dnsmasq_ip = setting("DNSMASQ_IP", "172.28.0.2")
    if dnsmasq_ip is None:
        raise SystemExit("DNSMASQ_IP must not be empty")

    ensure_infrastructure_chain(dnsmasq_ip)
    ensure_chain(CHAIN_NAME)
    run_iptables(ESTABLISHED_CONN_ACCEPT)
    if backend == "ipset":
        cleanup_generated_ipsets()
        for set_name, members in set_registry.items():
            run_ipset(["create", set_name, "hash:ip", "family", "inet", "-exist"])
            run_ipset(["flush", set_name])
            for member in members:
                run_ipset(["add", set_name, member, "-exist"])
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


def compile_rules(
    rules: list[dict],
    peer_map: dict[str, str],
    groups: dict[str, list[str]],
    hosts: dict[str, list[str]],
    services: dict[str, list[dict]],
    backend: str,
) -> tuple[list[list[str]], dict[str, tuple[str, ...]]]:
    commands: list[list[str]] = []
    set_registry: dict[str, tuple[str, ...]] = {}
    for rule in rules:
        commands.extend(rule_to_iptables(rule, peer_map, groups, hosts, services, backend, set_registry))
    return commands, set_registry


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync wg-easy access-control rules")
    parser.add_argument(
        "--policies",
        default=str(get_home_lab_dir() / "access-control" / "policies.json"),
        help="Path to access policy JSON file",
    )
    parser.add_argument(
        "--aliases",
        default=str(get_home_lab_dir() / "access-control" / "aliases.json"),
        help="Path to alias JSON file",
    )
    parser.add_argument("--apply", action="store_true", help="Apply rules live inside the wg-easy container")
    args = parser.parse_args()

    policy_path = pathlib.Path(args.policies)
    policy_example_path = get_home_lab_dir() / "access-control" / "policies.json.example"
    if not policy_path.exists():
        if not args.apply and policy_example_path.exists() and policy_path.name == "policies.json":
            policy_path = policy_example_path
            print(f"Policy file not found, using example for dry run: {policy_path}")
        else:
            raise SystemExit(f"Policy file not found: {policy_path}")

    aliases_path = pathlib.Path(args.aliases)
    aliases_example_path = get_home_lab_dir() / "access-control" / "aliases.json.example"
    if not aliases_path.exists():
        if not args.apply and aliases_example_path.exists() and aliases_path.name == "aliases.json":
            aliases_path = aliases_example_path
            print(f"Alias file not found, using example for dry run: {aliases_path}")
        else:
            raise SystemExit(f"Alias file not found: {aliases_path}")

    rules = load_policy(policy_path)
    aliases = load_aliases(aliases_path)
    clients = auth_and_client_list()
    peer_map = build_peer_map(clients)
    groups = aliases["groups"]
    hosts = aliases["hosts"]
    services = aliases["services"]

    backend = "ipset" if ipset_available() else "iptables"
    print(f"Selected firewall backend: {backend}")
    summarize(rules, peer_map)
    print(f"Loaded aliases: {len(groups)} groups, {len(hosts)} hosts, {len(services)} services")

    rule_commands, set_registry = compile_rules(rules, peer_map, groups, hosts, services, backend)

    if not args.apply:
        print("")
        print("Dry run only. Re-run with --apply to mutate live firewall rules.")
        return 0

    print("")
    print("Applying access-control rules...")
    apply_rules(rule_commands, backend, set_registry)
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
