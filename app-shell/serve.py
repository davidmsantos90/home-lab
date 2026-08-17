#!/usr/bin/env python3

from __future__ import annotations

import argparse
import os
import pathlib
import subprocess
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


DEFAULT_DIRECTORY = pathlib.Path(__file__).resolve().parent / "dist"
DEFAULT_CONFIG_PATH = pathlib.Path(os.environ.get("HOME_LAB_DIR", ".")) / "app-shell.config.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Serve the main App Shell bundle.")
    parser.add_argument("--host", default=os.environ.get("APP_SHELL_HOST", "0.0.0.0"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("APP_SHELL_PORT", "3000")))
    parser.add_argument(
        "--directory",
        default=os.environ.get("APP_SHELL_DIST_DIR", str(DEFAULT_DIRECTORY)),
        help="Directory containing the built shell bundle",
    )
    parser.add_argument(
        "--config",
        default=os.environ.get("APP_SHELL_CONFIG_PATH", str(DEFAULT_CONFIG_PATH)),
        help="Path to the hand-edited App Shell config JSON",
    )
    return parser.parse_args()


def load_config(config_path: pathlib.Path) -> dict:
    if not config_path.exists():
        raise SystemExit(f"App Shell config not found: {config_path}")
    return {"path": str(config_path)}


def main() -> int:
    args = parse_args()
    root = pathlib.Path(args.directory).resolve()
    if not root.is_dir():
        raise SystemExit(f"Build output not found: {root}")

    config_path = pathlib.Path(args.config).resolve()
    load_config(config_path)
    generated_script_candidates = [
        root / "scripts" / "app-shell.sh",
        root.parent / "scripts" / "app-shell.sh",
    ]
    generated_script = next((path for path in generated_script_candidates if path.exists()), None)
    if generated_script is None:
        checked = ", ".join(str(path) for path in generated_script_candidates)
        raise SystemExit(f"Generated App Shell script not found. Checked: {checked}")
    subprocess.run(["bash", str(generated_script), str(config_path)], cwd=root, check=True)

    class AppShellHandler(SimpleHTTPRequestHandler):
        def __init__(self, *handler_args, **handler_kwargs):
            super().__init__(*handler_args, directory=str(root), **handler_kwargs)

        def log_message(self, format: str, *args) -> None:  # noqa: A003
            return

        def do_GET(self) -> None:  # noqa: N802
            path = self.path.split("?", 1)[0]
            candidate = (root / path.lstrip("/")).resolve()
            if candidate.is_file():
                super().do_GET()
                return

            index_path = root / "index.html"
            if index_path.exists():
                self.path = "/index.html"
                super().do_GET()
                return

            self.send_response(404)
            self.end_headers()

    server = ThreadingHTTPServer((args.host, args.port), AppShellHandler)
    print(f"Serving App Shell on http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
