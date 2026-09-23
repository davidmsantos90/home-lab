#!/usr/bin/env python3

from __future__ import annotations

import argparse
import os
import pathlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

from api import AccessControlApiService, api_handler, is_allowed_origin
from sync import access_control_dir, build_api_service


DEFAULT_HOST = os.environ.get("ACCESS_CONTROL_HOST", "0.0.0.0")
DEFAULT_PORT = int(os.environ.get("ACCESS_CONTROL_PORT", "8787"))
DEFAULT_DIRECTORY = pathlib.Path(__file__).resolve().parent / "ui" / "dist"
raw_public_path_prefix = os.environ.get("ACCESS_CONTROL_PUBLIC_PATH_PREFIX", "/access-control").strip()
if raw_public_path_prefix and not raw_public_path_prefix.startswith("/"):
    raw_public_path_prefix = f"/{raw_public_path_prefix}"
PUBLIC_PATH_PREFIX = "/" if raw_public_path_prefix == "/" else raw_public_path_prefix.rstrip("/")


def normalize_public_path(path: str) -> str:
    parsed = urlparse(path)
    normalized_path = parsed.path

    if PUBLIC_PATH_PREFIX in {"", "/"}:
        return parsed.geturl()

    if normalized_path == PUBLIC_PATH_PREFIX:
        normalized_path = "/"
    elif normalized_path.startswith(f"{PUBLIC_PATH_PREFIX}/"):
        normalized_path = normalized_path[len(PUBLIC_PATH_PREFIX):]

    normalized = parsed._replace(path=normalized_path)
    return normalized.geturl()


def is_spa_navigation_request(path: str, accept_header: str | None) -> bool:
    if accept_header is None or "text/html" not in accept_header:
        return False
    clean_path = path.split("?", 1)[0]
    if clean_path in {"", "/"}:
        return True
    return "." not in clean_path.rsplit("/", 1)[-1]


def is_api_request_path(path: str) -> bool:
    normalized_path = normalize_public_path(path).split("?", 1)[0]
    if normalized_path in {"/api/healthz", "/api/openapi.json"}:
        return True
    return normalized_path.startswith(
        (
            "/api/state",
            "/api/config",
            "/api/inventory",
            "/api/peers",
            "/api/aliases",
            "/api/policies",
            "/api/groups",
            "/api/services",
            "/api/rules",
            "/api/rule-editors",
            "/api/preview",
            "/api/v1/",
        )
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Serve the access-control API and UI bundle.")
    parser.add_argument("--host", default=DEFAULT_HOST, help="Host to bind to (default: %(default)s)")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="Port to bind to (default: %(default)s)")
    parser.add_argument(
        "--directory",
        default=os.environ.get("ACCESS_CONTROL_UI_DIST_DIR", str(DEFAULT_DIRECTORY)),
        help="Directory containing the built UI bundle (default: %(default)s)",
    )
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
    return parser.parse_args()


def build_ui_handler(root: pathlib.Path, api_service: AccessControlApiService):
    index_path = root / "index.html"
    api = api_handler(api_service)

    class AccessControlHandler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(root), **kwargs)

        def log_message(self, format: str, *args) -> None:  # noqa: A003
            return

        def end_headers(self) -> None:
            if is_api_request_path(self.path):
                super().end_headers()
                return
            origin = self.headers.get("Origin")
            if origin and is_allowed_origin(self, origin):
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            super().end_headers()

        def do_GET(self) -> None:  # noqa: N802
            normalized_path = normalize_public_path(self.path)
            if is_api_request_path(self.path):
                original_path = self.path
                try:
                    self.path = normalized_path
                    api.do_GET(self)
                finally:
                    self.path = original_path
                return
            path = normalized_path.split("?", 1)[0]
            candidate = (root / path.lstrip("/")).resolve()
            if candidate.is_file():
                original_path = self.path
                try:
                    self.path = normalized_path
                    super().do_GET()
                finally:
                    self.path = original_path
                return
            if index_path.exists() and is_spa_navigation_request(path, self.headers.get("Accept")):
                original_path = self.path
                try:
                    self.path = "/index.html"
                    super().do_GET()
                finally:
                    self.path = original_path
                return
            if self.path == "/" and not index_path.exists():
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.end_headers()
                self.wfile.write(
                    b"<!doctype html><html><head><meta charset='utf-8'><title>Access control</title></head>"
                    b"<body><h1>Access control</h1><p>The UI bundle is served from this directory. "
                    b"Configure the main App Shell to consume the bundle modules here.</p></body></html>"
                )
                return
            self.send_response(404)
            self.end_headers()

        def do_OPTIONS(self) -> None:  # noqa: N802
            if is_api_request_path(self.path):
                original_path = self.path
                try:
                    self.path = normalize_public_path(self.path)
                    api.do_OPTIONS(self)
                finally:
                    self.path = original_path
                return
            self.send_response(204)
            self.end_headers()

        def do_POST(self) -> None:  # noqa: N802
            if is_api_request_path(self.path):
                original_path = self.path
                try:
                    self.path = normalize_public_path(self.path)
                    api.do_POST(self)
                finally:
                    self.path = original_path
                return
            self.send_response(405)
            self.end_headers()

        def do_PUT(self) -> None:  # noqa: N802
            if is_api_request_path(self.path):
                original_path = self.path
                try:
                    self.path = normalize_public_path(self.path)
                    api.do_PUT(self)
                finally:
                    self.path = original_path
                return
            self.send_response(405)
            self.end_headers()

        def do_PATCH(self) -> None:  # noqa: N802
            if is_api_request_path(self.path):
                original_path = self.path
                try:
                    self.path = normalize_public_path(self.path)
                    api.do_PATCH(self)
                finally:
                    self.path = original_path
                return
            self.send_response(405)
            self.end_headers()

        def do_DELETE(self) -> None:  # noqa: N802
            if is_api_request_path(self.path):
                original_path = self.path
                try:
                    self.path = normalize_public_path(self.path)
                    api.do_DELETE(self)
                finally:
                    self.path = original_path
                return
            self.send_response(405)
            self.end_headers()

    return AccessControlHandler


def resolve_config_path(path: pathlib.Path, example_path: pathlib.Path, *, label: str) -> pathlib.Path:
    if path.exists():
        return path
    if example_path.exists() and path.name == example_path.name.removesuffix(".example"):
        print(f"{label} file not found, using example: {example_path}")
        return example_path
    raise SystemExit(f"{label} file not found: {path}")


def main() -> int:
    args = parse_args()
    root = pathlib.Path(args.directory).resolve()
    if not root.is_dir():
        raise SystemExit(f"Build output not found: {root}")

    policy_path = resolve_config_path(
        pathlib.Path(args.policies),
        access_control_dir() / "policies.json.example",
        label="Policy",
    )
    aliases_path = resolve_config_path(
        pathlib.Path(args.aliases),
        access_control_dir() / "aliases.json.example",
        label="Alias",
    )

    api_service = build_api_service(policy_path, aliases_path)
    server = ThreadingHTTPServer((args.host, args.port), build_ui_handler(root, api_service))

    print(f"Serving access-control API and UI on http://{args.host}:{args.port}")
    print(f"UI bundle root: {root}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
