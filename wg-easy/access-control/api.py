from __future__ import annotations

from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import pathlib
import subprocess
from typing import Callable
import urllib.error
from urllib.parse import urlparse


@dataclass(frozen=True)
class AccessControlApiService:
    policy_path: pathlib.Path
    aliases_path: pathlib.Path
    openapi_spec_path: pathlib.Path
    get_state: Callable[[], dict]
    get_config: Callable[[], dict]
    put_config: Callable[[dict], dict]
    preview_config: Callable[[dict], dict]
    apply_config: Callable[[dict], dict]
    list_peers: Callable[[], list[dict]]
    get_peer: Callable[[str], dict]
    list_rules: Callable[[], list[dict]]
    get_rule: Callable[[int], dict]
    create_rule: Callable[[dict], dict]
    update_rule: Callable[[int, dict, bool], dict]
    delete_rule: Callable[[int], None]
    list_groups: Callable[[], list[dict]]
    get_group: Callable[[str], dict]
    create_group: Callable[[dict], dict]
    update_group: Callable[[str, dict, bool], dict]
    delete_group: Callable[[str], None]
    list_services: Callable[[], list[dict]]
    get_service: Callable[[str], dict]
    create_service: Callable[[dict], dict]
    update_service: Callable[[str, dict, bool], dict]
    delete_service: Callable[[str], None]


ALLOWED_CORS_HOSTS = {"localhost", "192.168.1.60"}


def set_cors_headers(handler: BaseHTTPRequestHandler, *, methods: str) -> None:
    origin = handler.headers.get("Origin")
    if origin:
        parsed = urlparse(origin)
        if parsed.hostname in ALLOWED_CORS_HOSTS:
            handler.send_header("Access-Control-Allow-Origin", origin)
            handler.send_header("Vary", "Origin")
    handler.send_header("Access-Control-Allow-Methods", methods)
    handler.send_header("Access-Control-Allow-Headers", "Content-Type")


def normalize_api_path(path: str) -> str:
    if path.startswith("/api/v1/"):
        return "/api/" + path.removeprefix("/api/v1/")
    return path


def split_api_path(path: str) -> tuple[str, str | None]:
    normalized = normalize_api_path(path)
    if normalized in {"/api/peers", "/api/groups", "/api/services", "/api/rules"}:
        return normalized, None
    if normalized.startswith("/api/") and normalized.count("/") >= 3:
        head, tail = normalized.rsplit("/", 1)
        if head in {"/api/peers", "/api/groups", "/api/services", "/api/rules"} and tail:
            return head, tail
    return normalized, None


def json_response(handler: BaseHTTPRequestHandler, payload: object, status: int = 200) -> None:
    body = json.dumps(payload, indent=2, sort_keys=True).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    set_cors_headers(handler, methods="GET, POST, PUT, PATCH, DELETE, OPTIONS")
    handler.end_headers()
    handler.wfile.write(body)


def empty_response(handler: BaseHTTPRequestHandler, status: int = 204) -> None:
    handler.send_response(status)
    set_cors_headers(handler, methods="GET, POST, PUT, PATCH, DELETE, OPTIONS")
    handler.end_headers()


def text_response(handler: BaseHTTPRequestHandler, text: str, status: int = 200) -> None:
    body = text.encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "text/plain; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    set_cors_headers(handler, methods="GET, POST, PUT, PATCH, DELETE, OPTIONS")
    handler.end_headers()
    handler.wfile.write(body)


def json_request(handler: BaseHTTPRequestHandler) -> dict:
    length_header = handler.headers.get("Content-Length")
    if length_header is None:
        raise SystemExit("Request body is required")
    try:
        content_length = int(length_header)
    except ValueError as exc:
        raise SystemExit("Content-Length header must be an integer") from exc
    raw_body = handler.rfile.read(content_length)
    try:
        payload = json.loads(raw_body.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Invalid JSON body: {exc.msg}") from exc
    if not isinstance(payload, dict):
        raise SystemExit("Request body must be a JSON object")
    return payload


def load_openapi_spec(path: pathlib.Path) -> dict:
    if not path.exists():
        raise SystemExit(f"OpenAPI spec not found: {path}")
    with path.open("r", encoding="utf-8") as handle:
        spec = json.load(handle)
    if not isinstance(spec, dict):
        raise SystemExit(f"OpenAPI spec must be a JSON object: {path}")
    return spec


def api_handler(service: AccessControlApiService):
    class AccessControlAPIHandler(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args) -> None:  # noqa: A003
            return

        def do_OPTIONS(self) -> None:  # noqa: N802
            self.send_response(204)
            set_cors_headers(self, methods="GET, POST, PUT, PATCH, DELETE, OPTIONS")
            self.end_headers()

        def do_GET(self) -> None:  # noqa: N802
            try:
                path = normalize_api_path(self.path)
                head, tail = split_api_path(path)
                if path in {"/healthz", "/api/healthz"}:
                    text_response(self, "ok")
                    return
                if path in {"/openapi.json", "/api/openapi.json"}:
                    json_response(self, load_openapi_spec(service.openapi_spec_path))
                    return
                if path in {"/api/state"}:
                    json_response(self, service.get_state())
                    return
                if path in {"/api/config"}:
                    json_response(self, service.get_config())
                    return

                state = None
                if path in {
                    "/api/inventory",
                    "/api/peers",
                    "/api/aliases",
                    "/api/policies",
                }:
                    state = service.get_state()
                if path == "/api/inventory":
                    json_response(
                        self,
                        {
                            "backend": state["backend"],
                            "policyPath": state["policyPath"],
                            "aliasesPath": state["aliasesPath"],
                            "peers": state["peers"],
                            "aliases": state["aliases"],
                        },
                    )
                    return
                if path == "/api/peers":
                    json_response(self, service.list_peers())
                    return
                if head == "/api/peers" and tail is not None:
                    json_response(self, service.get_peer(tail))
                    return
                if path == "/api/aliases":
                    json_response(self, {"aliases": state["aliases"]})
                    return
                if path == "/api/policies":
                    json_response(self, {"rules": state["rules"]})
                    return
                if path == "/api/rules" and tail is None:
                    json_response(self, service.list_rules())
                    return
                if head == "/api/rules" and tail is not None:
                    json_response(self, service.get_rule(int(tail)))
                    return
                if path == "/api/groups" and tail is None:
                    json_response(self, service.list_groups())
                    return
                if head == "/api/groups" and tail is not None:
                    json_response(self, service.get_group(tail))
                    return
                if path == "/api/services" and tail is None:
                    json_response(self, service.list_services())
                    return
                if head == "/api/services" and tail is not None:
                    json_response(self, service.get_service(tail))
                    return
            except urllib.error.HTTPError as exc:
                text_response(self, f"wg-easy API request failed: {exc}", status=502)
                return
            except KeyError as exc:
                text_response(self, f"Resource not found: {exc.args[0]}", status=404)
                return
            except subprocess.CalledProcessError as exc:
                stderr = exc.stderr.strip() if exc.stderr else ""
                stdout = exc.stdout.strip() if exc.stdout else ""
                message = stderr or stdout or str(exc)
                text_response(self, f"iptables command failed: {message}", status=500)
                return
            except SystemExit as exc:
                text_response(self, str(exc), status=400)
                return

            json_response(self, {"error": "not found"}, status=404)

        def do_DELETE(self) -> None:  # noqa: N802
            try:
                path = normalize_api_path(self.path)
                head, tail = split_api_path(path)
                if head == "/api/rules" and tail is not None:
                    service.delete_rule(int(tail))
                    empty_response(self)
                    return
                if head == "/api/groups" and tail is not None:
                    service.delete_group(tail)
                    empty_response(self)
                    return
                if head == "/api/services" and tail is not None:
                    service.delete_service(tail)
                    empty_response(self)
                    return
                json_response(self, {"error": "not found"}, status=404)
            except KeyError as exc:
                text_response(self, f"Resource not found: {exc.args[0]}", status=404)
            except SystemExit as exc:
                text_response(self, str(exc), status=400)

        def do_PATCH(self) -> None:  # noqa: N802
            try:
                path = normalize_api_path(self.path)
                head, tail = split_api_path(path)
                payload = json_request(self)
                if head == "/api/rules" and tail is not None:
                    json_response(self, service.update_rule(int(tail), payload, True))
                    return
                if head == "/api/groups" and tail is not None:
                    json_response(self, service.update_group(tail, payload, True))
                    return
                if head == "/api/services" and tail is not None:
                    json_response(self, service.update_service(tail, payload, True))
                    return
                json_response(self, {"error": "not found"}, status=404)
            except KeyError as exc:
                text_response(self, f"Resource not found: {exc.args[0]}", status=404)
            except SystemExit as exc:
                text_response(self, str(exc), status=400)

        def do_PUT(self) -> None:  # noqa: N802
            try:
                path = normalize_api_path(self.path)
                head, tail = split_api_path(path)
                if path in {"/api/config"}:
                    json_response(self, service.put_config(json_request(self)))
                    return
                payload = json_request(self)
                if head == "/api/rules" and tail is not None:
                    json_response(self, service.update_rule(int(tail), payload, False))
                    return
                if head == "/api/groups" and tail is not None:
                    json_response(self, service.update_group(tail, payload, False))
                    return
                if head == "/api/services" and tail is not None:
                    json_response(self, service.update_service(tail, payload, False))
                    return
                if head == "/api/groups" and tail is None:
                    json_response(self, service.create_group(payload))
                    return
                if head == "/api/services" and tail is None:
                    json_response(self, service.create_service(payload))
                    return
                if head == "/api/rules" and tail is None:
                    json_response(self, service.create_rule(payload))
                    return
                if path not in {"/api/config"}:
                    json_response(self, {"error": "not found"}, status=404)
                    return
            except urllib.error.HTTPError as exc:
                text_response(self, f"wg-easy API request failed: {exc}", status=502)
            except subprocess.CalledProcessError as exc:
                stderr = exc.stderr.strip() if exc.stderr else ""
                stdout = exc.stdout.strip() if exc.stdout else ""
                message = stderr or stdout or str(exc)
                text_response(self, f"iptables command failed: {message}", status=500)
            except KeyError as exc:
                text_response(self, f"Resource not found: {exc.args[0]}", status=404)
            except SystemExit as exc:
                text_response(self, str(exc), status=400)

        def do_POST(self) -> None:  # noqa: N802
            try:
                payload = json_request(self)
                path = normalize_api_path(self.path)
                if path == "/api/preview":
                    json_response(self, service.preview_config(payload))
                    return
                if path == "/api/config/apply":
                    json_response(self, service.apply_config(payload))
                    return
                if path == "/api/rules":
                    json_response(self, service.create_rule(payload))
                    return
                if path == "/api/groups":
                    json_response(self, service.create_group(payload))
                    return
                if path == "/api/services":
                    json_response(self, service.create_service(payload))
                    return
                json_response(self, {"error": "not found"}, status=404)
            except urllib.error.HTTPError as exc:
                text_response(self, f"wg-easy API request failed: {exc}", status=502)
            except subprocess.CalledProcessError as exc:
                stderr = exc.stderr.strip() if exc.stderr else ""
                stdout = exc.stdout.strip() if exc.stdout else ""
                message = stderr or stdout or str(exc)
                text_response(self, f"iptables command failed: {message}", status=500)
            except KeyError as exc:
                text_response(self, f"Resource not found: {exc.args[0]}", status=404)
            except SystemExit as exc:
                text_response(self, str(exc), status=400)

    return AccessControlAPIHandler


def serve_api(service: AccessControlApiService, host: str, port: int) -> None:
    server = ThreadingHTTPServer((host, port), api_handler(service))
    print(f"Serving access-control API on http://{host}:{port}")
    print(
        "Available endpoints: /healthz, /openapi.json, /api/state, /api/config, /api/inventory, /api/peers, /api/aliases, /api/policies, /api/rules, /api/groups, /api/services, /api/preview, /api/config/apply"
    )
    try:
        server.serve_forever()
    finally:
        server.server_close()
