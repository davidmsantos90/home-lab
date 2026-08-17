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
    openapi_spec_path: pathlib.Path
    get_state: Callable[[], dict]
    get_config: Callable[[], dict]
    put_config: Callable[[dict], dict]
    preview_config: Callable[[dict], dict]
    apply_config: Callable[[dict], dict]


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


def json_response(handler: BaseHTTPRequestHandler, payload: dict, status: int = 200) -> None:
    body = json.dumps(payload, indent=2, sort_keys=True).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    set_cors_headers(handler, methods="GET, POST, PUT, OPTIONS")
    handler.end_headers()
    handler.wfile.write(body)


def text_response(handler: BaseHTTPRequestHandler, text: str, status: int = 200) -> None:
    body = text.encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "text/plain; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    set_cors_headers(handler, methods="GET, POST, PUT, OPTIONS")
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
            set_cors_headers(self, methods="GET, POST, PUT, OPTIONS")
            self.end_headers()

        def do_GET(self) -> None:  # noqa: N802
            try:
                if self.path in {"/healthz", "/api/healthz"}:
                    text_response(self, "ok")
                    return
                if self.path in {"/openapi.json", "/api/openapi.json"}:
                    json_response(self, load_openapi_spec(service.openapi_spec_path))
                    return
                if self.path in {"/api/state", "/api/v1/state"}:
                    json_response(self, service.get_state())
                    return
                if self.path in {"/api/config", "/api/v1/config"}:
                    json_response(self, service.get_config())
                    return

                state = None
                if self.path in {
                    "/api/inventory",
                    "/api/v1/inventory",
                    "/api/peers",
                    "/api/v1/peers",
                    "/api/aliases",
                    "/api/v1/aliases",
                    "/api/policies",
                    "/api/v1/policies",
                }:
                    state = service.get_state()
                if self.path in {"/api/inventory", "/api/v1/inventory", "/api/peers", "/api/v1/peers"}:
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
                if self.path in {"/api/aliases", "/api/v1/aliases"}:
                    json_response(self, {"aliases": state["aliases"]})
                    return
                if self.path in {"/api/policies", "/api/v1/policies"}:
                    json_response(self, {"rules": state["rules"]})
                    return
            except urllib.error.HTTPError as exc:
                text_response(self, f"wg-easy API request failed: {exc}", status=502)
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

        def do_PUT(self) -> None:  # noqa: N802
            try:
                if self.path not in {"/api/config", "/api/v1/config"}:
                    json_response(self, {"error": "not found"}, status=404)
                    return
                json_response(self, service.put_config(json_request(self)))
            except urllib.error.HTTPError as exc:
                text_response(self, f"wg-easy API request failed: {exc}", status=502)
            except subprocess.CalledProcessError as exc:
                stderr = exc.stderr.strip() if exc.stderr else ""
                stdout = exc.stdout.strip() if exc.stdout else ""
                message = stderr or stdout or str(exc)
                text_response(self, f"iptables command failed: {message}", status=500)
            except SystemExit as exc:
                text_response(self, str(exc), status=400)

        def do_POST(self) -> None:  # noqa: N802
            try:
                payload = json_request(self)
                if self.path in {"/api/preview", "/api/v1/preview"}:
                    json_response(self, service.preview_config(payload))
                    return
                if self.path in {"/api/config/apply", "/api/v1/config/apply"}:
                    json_response(self, service.apply_config(payload))
                    return
                json_response(self, {"error": "not found"}, status=404)
            except urllib.error.HTTPError as exc:
                text_response(self, f"wg-easy API request failed: {exc}", status=502)
            except subprocess.CalledProcessError as exc:
                stderr = exc.stderr.strip() if exc.stderr else ""
                stdout = exc.stdout.strip() if exc.stdout else ""
                message = stderr or stdout or str(exc)
                text_response(self, f"iptables command failed: {message}", status=500)
            except SystemExit as exc:
                text_response(self, str(exc), status=400)

    return AccessControlAPIHandler


def serve_api(service: AccessControlApiService, host: str, port: int) -> None:
    server = ThreadingHTTPServer((host, port), api_handler(service))
    print(f"Serving access-control API on http://{host}:{port}")
    print(
        "Available endpoints: /healthz, /openapi.json, /api/state, /api/config, /api/inventory, /api/aliases, /api/policies, /api/preview, /api/config/apply"
    )
    try:
        server.serve_forever()
    finally:
        server.server_close()
