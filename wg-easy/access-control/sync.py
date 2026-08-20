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
import tempfile
import urllib.error
import urllib.request
from http.cookiejar import CookieJar

from api import AccessControlApiService, serve_api


CHAIN_NAME = "WG_ACCESS_CONTROL"
INFRA_CHAIN_NAME = "WG_INFRASTRUCTURE"
IPSET_PREFIX = "wgac"
DEFAULT_API_HOST = "127.0.0.1"
DEFAULT_API_PORT = 8787
OPENAPI_SPEC_PATH = pathlib.Path(__file__).resolve().parent / "openapi.json"
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
    # Fallback: detect from script location (wg-easy/access-control/sync.py -> ../home-lab)
    return pathlib.Path(__file__).resolve().parents[1]


def wg_easy_dir() -> pathlib.Path:
    return pathlib.Path(__file__).resolve().parent


def access_control_dir() -> pathlib.Path:
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


def setting_int(name: str, default: int) -> int:
    value = setting(name)
    if value is None:
        return default
    try:
        return int(value)
    except ValueError as exc:
        raise SystemExit(f"{name} must be an integer") from exc


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


def normalize_policy_rules(rules: list) -> list[dict]:
    if not isinstance(rules, list):
        raise SystemExit("Policy file must contain a JSON array")
    normalized_rules: list[dict] = []
    for index, rule in enumerate(rules):
        if not isinstance(rule, dict):
            raise SystemExit(f"Policy rule at index {index} must be a JSON object")
        normalized_rule = dict(rule)
        # Temporary backward compatibility for older clients sending scalar selectors.
        # Remove this once all callers send array-only source/destination/service fields.
        for key in ("source", "destination", "service"):
            value = normalized_rule.get(key)
            if value is None:
                continue
            if isinstance(value, str):
                normalized_rule[key] = [value]
                continue
            if isinstance(value, list):
                normalized_rule[key] = normalize_selector_list(
                    value,
                    f"Policy rule at index {index} field {key}",
                )
                continue
            raise SystemExit(
                f"Policy rule at index {index} field {key} must be a string array"
            )
        normalized_rules.append(normalized_rule)
    return normalized_rules


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
    return normalize_policy_rules(load_json_array(path))


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


def normalize_aliases_document(aliases: dict) -> dict[str, dict]:
    extra_keys = set(aliases) - {"groups", "hosts", "services"}
    if extra_keys:
        raise SystemExit("Alias file may only contain top-level groups, hosts, and services")

    groups_raw = aliases.get("groups", {})
    hosts_raw = aliases.get("hosts", {})
    services_raw = aliases.get("services", {})
    if not isinstance(groups_raw, dict) or not isinstance(hosts_raw, dict) or not isinstance(services_raw, dict):
        raise SystemExit("Alias file must contain top-level 'groups', 'hosts', and 'services' objects")

    groups = {name: normalize_group_members(value, name) for name, value in groups_raw.items()}
    hosts = {name: normalize_host_addresses(value, name) for name, value in hosts_raw.items()}
    services = {name: normalize_service_entries(value, name) for name, value in services_raw.items()}
    return {"groups": groups, "hosts": hosts, "services": services}


def load_aliases(path: pathlib.Path) -> dict[str, dict]:
    return normalize_aliases_document(load_json_file(path))


def normalize_client_inventory(client: dict) -> dict:
    name = client.get("name")
    if not name:
        name = "<unnamed>"
    return {
        "name": str(name),
        "ipv4Address": client_ip(client),
        "raw": client,
    }


def resolve_writable_config_path(path: pathlib.Path) -> pathlib.Path:
    if path.name.endswith(".example"):
        return path.with_name(path.name.removesuffix(".example"))
    return path


def resolve_effective_config_path(path: pathlib.Path) -> pathlib.Path:
    writable_path = resolve_writable_config_path(path)
    if writable_path.exists():
        return writable_path
    return path


def write_json_document(path: pathlib.Path, payload, *, sort_keys: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f"{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            temp_path = handle.name
            json.dump(payload, handle, indent=2, sort_keys=sort_keys)
            handle.write("\n")
        os.replace(temp_path, path)
    finally:
        if temp_path and os.path.exists(temp_path):
            os.unlink(temp_path)


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

    if "service" in rule and (rule.get("protocol") is not None or rule.get("port") is not None):
        raise SystemExit("Use either service or protocol/port, not both")

    sources = selector_values(rule.get("source"), peer_map, groups, hosts)
    destinations = selector_values(rule.get("destination"), peer_map, groups, hosts)

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


def build_access_control_state(
    rules: list[dict],
    aliases: dict[str, dict],
    policy_path: pathlib.Path,
    aliases_path: pathlib.Path,
) -> tuple[dict, list[list[str]], dict[str, tuple[str, ...]], str]:
    clients = auth_and_client_list()
    peer_map = build_peer_map(clients)
    groups = aliases["groups"]
    hosts = aliases["hosts"]
    services = aliases["services"]
    backend = "ipset" if ipset_available() else "iptables"
    commands, set_registry = compile_rules(rules, peer_map, groups, hosts, services, backend)
    state = {
        "backend": backend,
        "policyPath": str(policy_path),
        "aliasesPath": str(aliases_path),
        "peers": [normalize_client_inventory(client) for client in clients],
        "peerMap": peer_map,
        "aliases": aliases,
        "rules": rules,
        "compiled": {
            "iptables": commands,
            "ipsets": [
                {"name": name, "members": list(members)}
                for name, members in sorted(set_registry.items())
            ],
        },
    }
    return state, commands, set_registry, backend


def load_access_control_state(policy_path: pathlib.Path, aliases_path: pathlib.Path) -> dict:
    effective_policy_path = resolve_effective_config_path(policy_path)
    effective_aliases_path = resolve_effective_config_path(aliases_path)
    rules = load_policy(effective_policy_path)
    aliases = load_aliases(effective_aliases_path)
    state, _, _, _ = build_access_control_state(
        rules,
        aliases,
        effective_policy_path,
        effective_aliases_path,
    )
    return state


def load_access_control_inventory(policy_path: pathlib.Path, aliases_path: pathlib.Path) -> dict:
    state = load_access_control_state(policy_path, aliases_path)
    return {
        "backend": state["backend"],
        "policyPath": state["policyPath"],
        "aliasesPath": state["aliasesPath"],
        "peers": state["peers"],
        "aliases": state["aliases"],
    }


def load_access_control_policy_document(policy_path: pathlib.Path) -> list[dict]:
    effective_policy_path = resolve_effective_config_path(policy_path)
    return load_policy(effective_policy_path)


def save_access_control_policy_document(policy_path: pathlib.Path, rules: list[dict]) -> None:
    writable_policy_path = resolve_writable_config_path(policy_path)
    write_json_document(writable_policy_path, rules)


def load_access_control_aliases_document(aliases_path: pathlib.Path) -> dict[str, dict]:
    effective_aliases_path = resolve_effective_config_path(aliases_path)
    return load_json_file(effective_aliases_path)


def save_access_control_aliases_document(aliases_path: pathlib.Path, aliases: dict[str, dict]) -> None:
    writable_aliases_path = resolve_writable_config_path(aliases_path)
    write_json_document(writable_aliases_path, aliases, sort_keys=True)


def peer_item_from_state(peer: dict) -> dict:
    return {
        "name": peer["name"],
        "ipv4Address": peer["ipv4Address"],
        "raw": peer["raw"],
    }


def list_access_control_peers(policy_path: pathlib.Path, aliases_path: pathlib.Path) -> list[dict]:
    state = load_access_control_state(policy_path, aliases_path)
    return [peer_item_from_state(peer) for peer in state["peers"]]


def get_access_control_peer(policy_path: pathlib.Path, aliases_path: pathlib.Path, name: str) -> dict:
    for peer in list_access_control_peers(policy_path, aliases_path):
        if peer["name"] == name:
            return peer
    raise KeyError(name)


def rule_item_from_rules(rules: list[dict], index: int) -> dict:
    if index < 0 or index >= len(rules):
        raise KeyError(index)
    return {
        "index": index,
        "rule": rules[index],
    }


def list_access_control_rules(policy_path: pathlib.Path) -> list[dict]:
    return load_access_control_policy_document(policy_path)


def get_access_control_rule(policy_path: pathlib.Path, index: int) -> dict:
    return rule_item_from_rules(list_access_control_rules(policy_path), index)


def store_access_control_rules(policy_path: pathlib.Path, rules: list[dict]) -> list[dict]:
    save_access_control_policy_document(policy_path, rules)
    return load_access_control_policy_document(policy_path)


def create_access_control_rule(policy_path: pathlib.Path, payload: dict) -> dict:
    if not isinstance(payload, dict):
        raise SystemExit("Rule payload must be a JSON object")
    rules = list_access_control_rules(policy_path)
    normalized_rule = normalize_policy_rules([payload])[0]
    rules.append(normalized_rule)
    updated_rules = store_access_control_rules(policy_path, rules)
    return rule_item_from_rules(updated_rules, len(updated_rules) - 1)


def update_access_control_rule(policy_path: pathlib.Path, index: int, payload: dict, *, merge: bool = False) -> dict:
    if not isinstance(payload, dict):
        raise SystemExit("Rule payload must be a JSON object")
    rules = list_access_control_rules(policy_path)
    if index < 0 or index >= len(rules):
        raise KeyError(index)
    next_rule = dict(rules[index]) if merge else {}
    next_rule.update(payload)
    normalized_rule = normalize_policy_rules([next_rule])[0]
    rules[index] = normalized_rule
    updated_rules = store_access_control_rules(policy_path, rules)
    return rule_item_from_rules(updated_rules, index)


def delete_access_control_rule(policy_path: pathlib.Path, index: int) -> None:
    rules = list_access_control_rules(policy_path)
    if index < 0 or index >= len(rules):
        raise KeyError(index)
    del rules[index]
    store_access_control_rules(policy_path, rules)


def aliases_document_groups(aliases: dict[str, dict]) -> dict[str, list[str]]:
    groups_raw = aliases.get("groups", {})
    if not isinstance(groups_raw, dict):
        raise SystemExit("Alias file must contain a groups object")
    return {name: normalize_group_members(value, name) for name, value in groups_raw.items()}


def aliases_document_services(aliases: dict[str, dict]) -> dict[str, list[dict]]:
    services_raw = aliases.get("services", {})
    if not isinstance(services_raw, dict):
        raise SystemExit("Alias file must contain a services object")
    return {name: normalize_service_entries(value, name) for name, value in services_raw.items()}


def group_item_from_value(name: str, value) -> dict:
    return {
        "name": name,
        "members": normalize_group_members(value, name),
    }


def list_access_control_groups(aliases_path: pathlib.Path) -> list[dict]:
    aliases = load_access_control_aliases_document(aliases_path)
    groups = aliases.get("groups", {})
    if not isinstance(groups, dict):
        raise SystemExit("Alias file must contain a groups object")
    return [group_item_from_value(name, value) for name, value in sorted(groups.items())]


def get_access_control_group(aliases_path: pathlib.Path, name: str) -> dict:
    aliases = load_access_control_aliases_document(aliases_path)
    groups = aliases.get("groups", {})
    if not isinstance(groups, dict):
        raise SystemExit("Alias file must contain a groups object")
    if name not in groups:
        raise KeyError(name)
    return group_item_from_value(name, groups[name])


def persist_access_control_aliases(aliases_path: pathlib.Path, aliases: dict[str, dict]) -> dict[str, dict]:
    save_access_control_aliases_document(aliases_path, aliases)
    return load_access_control_aliases_document(aliases_path)


def parse_group_payload(payload: dict, *, fallback_name: str | None = None) -> tuple[str, list[str]]:
    if not isinstance(payload, dict):
        raise SystemExit("Group payload must be a JSON object")
    name = payload.get("name", fallback_name)
    if not isinstance(name, str) or not name.strip():
        raise SystemExit("Group name must be a non-empty string")
    members = payload.get("members")
    if members is None:
        members = payload.get("peers")
    if members is None:
        raise SystemExit("Group payload must contain members")
    return name.strip(), normalize_selector_list(members, f"Group {name}")


def create_access_control_group(aliases_path: pathlib.Path, payload: dict) -> dict:
    name, members = parse_group_payload(payload)
    aliases = load_access_control_aliases_document(aliases_path)
    groups = aliases.get("groups", {})
    if not isinstance(groups, dict):
        raise SystemExit("Alias file must contain a groups object")
    if name in groups:
        raise SystemExit(f"Group already exists: {name}")
    groups[name] = members
    aliases["groups"] = groups
    aliases = persist_access_control_aliases(aliases_path, aliases)
    return group_item_from_value(name, aliases["groups"][name])


def update_access_control_group(aliases_path: pathlib.Path, name: str, payload: dict, *, merge: bool = False) -> dict:
    aliases = load_access_control_aliases_document(aliases_path)
    groups = aliases.get("groups", {})
    if not isinstance(groups, dict):
        raise SystemExit("Alias file must contain a groups object")
    if name not in groups:
        raise KeyError(name)
    next_payload = {"name": name, "members": groups[name]}
    if merge:
        next_payload.update(payload)
    else:
        next_payload = dict(payload)
        next_payload["name"] = name
    next_name, members = parse_group_payload(next_payload, fallback_name=name)
    if next_name != name:
        if next_name in groups and next_name != name:
            raise SystemExit(f"Group already exists: {next_name}")
        groups.pop(name)
        name = next_name
    groups[name] = members
    aliases["groups"] = groups
    aliases = persist_access_control_aliases(aliases_path, aliases)
    return group_item_from_value(name, aliases["groups"][name])


def delete_access_control_group(aliases_path: pathlib.Path, name: str) -> None:
    aliases = load_access_control_aliases_document(aliases_path)
    groups = aliases.get("groups", {})
    if not isinstance(groups, dict):
        raise SystemExit("Alias file must contain a groups object")
    if name not in groups:
        raise KeyError(name)
    groups.pop(name)
    aliases["groups"] = groups
    persist_access_control_aliases(aliases_path, aliases)


def service_item_from_value(name: str, value) -> dict:
    if isinstance(value, list):
        return {"name": name, "entries": normalize_service_entries(value, name)}
    if isinstance(value, dict) and "entries" in value:
        return {"name": name, "entries": normalize_service_entries(value, name)}
    if isinstance(value, dict) and "protocol" in value and "port" in value:
        normalized_entries = normalize_service_entries(value, name)
        if len(normalized_entries) == 1:
            return {"name": name, **normalized_entries[0]}
        return {"name": name, "entries": normalized_entries}
    raise SystemExit(f"Unsupported service definition for {name!r}")


def list_access_control_services(aliases_path: pathlib.Path) -> list[dict]:
    aliases = load_access_control_aliases_document(aliases_path)
    services = aliases.get("services", {})
    if not isinstance(services, dict):
        raise SystemExit("Alias file must contain a services object")
    return [service_item_from_value(name, value) for name, value in sorted(services.items())]


def get_access_control_service(aliases_path: pathlib.Path, name: str) -> dict:
    aliases = load_access_control_aliases_document(aliases_path)
    services = aliases.get("services", {})
    if not isinstance(services, dict):
        raise SystemExit("Alias file must contain a services object")
    if name not in services:
        raise KeyError(name)
    return service_item_from_value(name, services[name])


def parse_service_payload(payload: dict, *, fallback_name: str | None = None) -> tuple[str, dict | list]:
    if not isinstance(payload, dict):
        raise SystemExit("Service payload must be a JSON object")
    name = payload.get("name", fallback_name)
    if not isinstance(name, str) or not name.strip():
        raise SystemExit("Service name must be a non-empty string")
    if "entries" in payload:
        entries = normalize_service_entries(payload, name)
        return name.strip(), entries
    if "protocol" in payload or "port" in payload:
        entries = normalize_service_entries(payload, name)
        if len(entries) == 1:
            return name.strip(), entries[0]
        return name.strip(), entries
    raise SystemExit("Service payload must contain protocol/port or entries")


def create_access_control_service(aliases_path: pathlib.Path, payload: dict) -> dict:
    name, service_value = parse_service_payload(payload)
    aliases = load_access_control_aliases_document(aliases_path)
    services = aliases.get("services", {})
    if not isinstance(services, dict):
        raise SystemExit("Alias file must contain a services object")
    if name in services:
        raise SystemExit(f"Service already exists: {name}")
    services[name] = service_value
    aliases["services"] = services
    aliases = persist_access_control_aliases(aliases_path, aliases)
    return service_item_from_value(name, aliases["services"][name])


def update_access_control_service(aliases_path: pathlib.Path, name: str, payload: dict, *, merge: bool = False) -> dict:
    aliases = load_access_control_aliases_document(aliases_path)
    services = aliases.get("services", {})
    if not isinstance(services, dict):
        raise SystemExit("Alias file must contain a services object")
    if name not in services:
        raise KeyError(name)
    next_payload = {"name": name, **service_item_from_value(name, services[name])}
    if merge:
        next_payload.update(payload)
    else:
        next_payload = dict(payload)
        next_payload["name"] = name
    next_name, service_value = parse_service_payload(next_payload, fallback_name=name)
    if next_name != name:
        if next_name in services and next_name != name:
            raise SystemExit(f"Service already exists: {next_name}")
        services.pop(name)
        name = next_name
    services[name] = service_value
    aliases["services"] = services
    aliases = persist_access_control_aliases(aliases_path, aliases)
    return service_item_from_value(name, aliases["services"][name])


def delete_access_control_service(aliases_path: pathlib.Path, name: str) -> None:
    aliases = load_access_control_aliases_document(aliases_path)
    services = aliases.get("services", {})
    if not isinstance(services, dict):
        raise SystemExit("Alias file must contain a services object")
    if name not in services:
        raise KeyError(name)
    services.pop(name)
    aliases["services"] = services
    persist_access_control_aliases(aliases_path, aliases)


def parse_access_control_draft(payload: dict) -> tuple[dict[str, dict], list[dict]]:
    aliases = payload.get("aliases")
    rules = payload.get("rules")
    if not isinstance(aliases, dict):
        raise SystemExit("Request body must contain an aliases object")
    if not isinstance(rules, list):
        raise SystemExit("Request body must contain a rules array")
    return normalize_aliases_document(aliases), normalize_policy_rules(rules)


def build_mutation_result(state: dict, *, persisted: bool, applied: bool) -> dict:
    return {
        "state": state,
        "persisted": persisted,
        "applied": applied,
    }


def persist_access_control_draft(
    policy_path: pathlib.Path,
    aliases_path: pathlib.Path,
    rules: list[dict],
    aliases: dict[str, dict],
) -> tuple[pathlib.Path, pathlib.Path]:
    writable_policy_path = resolve_writable_config_path(policy_path)
    writable_aliases_path = resolve_writable_config_path(aliases_path)
    write_json_document(writable_policy_path, rules)
    write_json_document(writable_aliases_path, aliases, sort_keys=True)
    return writable_policy_path, writable_aliases_path


def load_access_control_config(policy_path: pathlib.Path, aliases_path: pathlib.Path) -> dict:
    effective_policy_path = resolve_effective_config_path(policy_path)
    effective_aliases_path = resolve_effective_config_path(aliases_path)
    return {
        "policyPath": str(effective_policy_path),
        "aliasesPath": str(effective_aliases_path),
        "aliases": load_aliases(effective_aliases_path),
        "rules": load_policy(effective_policy_path),
    }


def preview_access_control_draft(policy_path: pathlib.Path, aliases_path: pathlib.Path, payload: dict) -> dict:
    aliases, rules = parse_access_control_draft(payload)
    preview_policy_path = resolve_writable_config_path(policy_path)
    preview_aliases_path = resolve_writable_config_path(aliases_path)
    state, _, _, _ = build_access_control_state(
        rules,
        aliases,
        preview_policy_path,
        preview_aliases_path,
    )
    return build_mutation_result(state, persisted=False, applied=False)


def save_access_control_draft(policy_path: pathlib.Path, aliases_path: pathlib.Path, payload: dict) -> dict:
    aliases, rules = parse_access_control_draft(payload)
    persist_access_control_draft(policy_path, aliases_path, rules, aliases)
    state = load_access_control_state(policy_path, aliases_path)
    return build_mutation_result(state, persisted=True, applied=False)


def apply_access_control_draft(policy_path: pathlib.Path, aliases_path: pathlib.Path, payload: dict) -> dict:
    aliases, rules = parse_access_control_draft(payload)
    applied_policy_path, applied_aliases_path = persist_access_control_draft(
        policy_path,
        aliases_path,
        rules,
        aliases,
    )
    state, commands, set_registry, backend = build_access_control_state(
        rules,
        aliases,
        applied_policy_path,
        applied_aliases_path,
    )
    apply_rules(commands, backend, set_registry)
    return build_mutation_result(state, persisted=True, applied=True)


def build_api_service(policy_path: pathlib.Path, aliases_path: pathlib.Path) -> AccessControlApiService:
    return AccessControlApiService(
        policy_path=policy_path,
        aliases_path=aliases_path,
        openapi_spec_path=OPENAPI_SPEC_PATH,
        get_state=lambda: load_access_control_state(policy_path, aliases_path),
        get_config=lambda: load_access_control_config(policy_path, aliases_path),
        put_config=lambda payload: save_access_control_draft(policy_path, aliases_path, payload),
        preview_config=lambda payload: preview_access_control_draft(policy_path, aliases_path, payload),
        apply_config=lambda payload: apply_access_control_draft(policy_path, aliases_path, payload),
        list_peers=lambda: list_access_control_peers(policy_path, aliases_path),
        get_peer=lambda name: get_access_control_peer(policy_path, aliases_path, name),
        list_rules=lambda: list_access_control_rules(policy_path),
        get_rule=lambda index: get_access_control_rule(policy_path, index),
        create_rule=lambda payload: create_access_control_rule(policy_path, payload),
        update_rule=lambda index, payload, merge=False: update_access_control_rule(policy_path, index, payload, merge=merge),
        delete_rule=lambda index: delete_access_control_rule(policy_path, index),
        list_groups=lambda: list_access_control_groups(aliases_path),
        get_group=lambda name: get_access_control_group(aliases_path, name),
        create_group=lambda payload: create_access_control_group(aliases_path, payload),
        update_group=lambda name, payload, merge=False: update_access_control_group(aliases_path, name, payload, merge=merge),
        delete_group=lambda name: delete_access_control_group(aliases_path, name),
        list_services=lambda: list_access_control_services(aliases_path),
        get_service=lambda name: get_access_control_service(aliases_path, name),
        create_service=lambda payload: create_access_control_service(aliases_path, payload),
        update_service=lambda name, payload, merge=False: update_access_control_service(aliases_path, name, payload, merge=merge),
        delete_service=lambda name: delete_access_control_service(aliases_path, name),
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync wg-easy access-control rules")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true", help="Apply rules live inside the wg-easy container")
    mode.add_argument("--serve", action="store_true", help="Serve the access-control API")
    parser.add_argument(
        "--policies",
        default=str(access_control_dir() / "policies.json"),
        help="Path to access policy JSON file",
    )
    parser.add_argument(
        "--aliases",
        default=str(access_control_dir() / "aliases.json"),
        help="Path to alias JSON file",
    )
    parser.add_argument("--host", default=setting("WG_ACCESS_CONTROL_API_HOST", DEFAULT_API_HOST), help="API host to bind")
    parser.add_argument(
        "--port",
        type=int,
        default=setting_int("WG_ACCESS_CONTROL_API_PORT", DEFAULT_API_PORT),
        help="API port to bind",
    )
    args = parser.parse_args()

    policy_path = pathlib.Path(args.policies)
    policy_example_path = access_control_dir() / "policies.json.example"
    if not policy_path.exists():
        if not args.apply and policy_example_path.exists() and policy_path.name == "policies.json":
            policy_path = policy_example_path
            print(f"Policy file not found, using example for dry run: {policy_path}")
        else:
            raise SystemExit(f"Policy file not found: {policy_path}")

    aliases_path = pathlib.Path(args.aliases)
    aliases_example_path = access_control_dir() / "aliases.json.example"
    if not aliases_path.exists():
        if not args.apply and aliases_example_path.exists() and aliases_path.name == "aliases.json":
            aliases_path = aliases_example_path
            print(f"Alias file not found, using example for dry run: {aliases_path}")
        else:
            raise SystemExit(f"Alias file not found: {aliases_path}")

    if args.serve:
        serve_api(build_api_service(policy_path, aliases_path), args.host, args.port)
        return 0

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
