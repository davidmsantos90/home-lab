import importlib.util
import json
import os
import subprocess
import sys
import threading
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
import unittest
from urllib.parse import urlparse


sys.path.insert(0, str(Path(__file__).resolve().parent))
MODULE_PATH = Path(__file__).with_name("sync.py")
spec = importlib.util.spec_from_file_location("wg_easy_sync", MODULE_PATH)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class FakeWgEasyServer(BaseHTTPRequestHandler):
    server_version = "FakeWgEasy/15.5"
    auth_success = {"username": "admin", "password": "admin"}
    last_request = None

    def do_POST(self):
        parsed = urlparse(self.path)
        self.__class__.last_request = parsed.path
        body = self.rfile.read(int(self.headers.get("Content-Length", "0"))).decode("utf-8")
        payload = json.loads(body or "{}")

        if parsed.path == "/api/auth/password":
            if payload.get("username") == self.auth_success["username"] and payload.get("password") == self.auth_success["password"]:
                self.send_response(200)
                self.send_header("Set-Cookie", "session=abc123; Path=/")
                self.end_headers()
                self.wfile.write(b"{}")
                return
            self.send_response(401)
            self.end_headers()
            self.wfile.write(b"{}")
            return

        if parsed.path == "/api/session":
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"{}")
            return

        self.send_response(404)
        self.end_headers()
        self.wfile.write(b"{}")

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/admin/userconfig":
            auth = self.headers.get("Authorization", "")
            if auth not in ("", "Basic YWRtaW46YWRtaW4="):
                self.send_response(401)
                self.end_headers()
                self.wfile.write(b"{}")
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"defaultDns":["10.8.0.1"],"defaultAllowedIps":["10.8.0.0/24"]}')
            return
        if parsed.path == "/api/client":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'[{"name":"test-client","ipv4Address":"10.8.0.2"}]')
            return
        self.send_response(404)
        self.end_headers()

    def log_message(self, *args, **kwargs):
        return


class LoginCompatibilityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", 0), FakeWgEasyServer)
        cls.server_url = f"http://127.0.0.1:{cls.server.server_address[1]}"
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)

    def test_old_login_route_fails_on_v15_5_server(self):
        request = urllib.request.Request(
            f"{self.server_url}/api/session",
            data=json.dumps({"username": "admin", "password": "admin", "remember": True}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with self.assertRaises(urllib.error.HTTPError):
            urllib.request.urlopen(request, timeout=5)

    def test_login_compatibility_uses_basic_auth_when_cookie_login_is_rejected(self):
        class BasicAuthServer(FakeWgEasyServer):
            def do_POST(self):
                parsed = urlparse(self.path)
                if parsed.path in {"/api/auth/password", "/api/session"}:
                    self.send_response(403)
                    self.end_headers()
                    self.wfile.write(b"{}")
                    return
                self.send_response(404)
                self.end_headers()

            def do_GET(self):
                parsed = urlparse(self.path)
                if parsed.path == "/api/admin/userconfig":
                    auth = self.headers.get("Authorization", "")
                    if auth == "Basic YWRtaW46YWRtaW4=":
                        self.send_response(200)
                        self.send_header("Content-Type", "application/json")
                        self.end_headers()
                        self.wfile.write(b'{"defaultDns":["10.8.0.1"],"defaultAllowedIps":["10.8.0.0/24"]}')
                        return
                    self.send_response(401)
                    self.end_headers()
                    self.wfile.write(b"{}")
                    return
                super().do_GET()

        basic_server = HTTPServer(("127.0.0.1", 0), BasicAuthServer)
        basic_url = f"http://127.0.0.1:{basic_server.server_address[1]}"
        basic_thread = threading.Thread(target=basic_server.serve_forever, daemon=True)
        basic_thread.start()
        try:
            cookiejar = module.CookieJar()
            opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookiejar))
            session = module.login_with_wg_easy_compat(opener, basic_url, "admin", "admin")
            self.assertTrue(session)
        finally:
            basic_server.shutdown()
            basic_server.server_close()
            basic_thread.join(timeout=5)

    def test_login_compatibility_uses_new_route_first(self):
        cookiejar = module.CookieJar()
        opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookiejar))
        session = module.login_with_wg_easy_compat(opener, self.server_url, "admin", "admin")
        self.assertTrue(session)
        self.assertIn(FakeWgEasyServer.last_request, {"/api/admin/userconfig", "/api/auth/password"})

    def test_login_compatibility_falls_back_to_legacy_route_when_new_route_is_unavailable(self):
        class LegacyOnlyServer(FakeWgEasyServer):
            def do_POST(self):
                parsed = urlparse(self.path)
                self.__class__.last_request = parsed.path
                if parsed.path == "/api/auth/password":
                    self.send_response(404)
                    self.end_headers()
                    self.wfile.write(b"{}")
                    return
                if parsed.path == "/api/session":
                    payload = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))).decode("utf-8"))
                    if payload.get("username") == "admin" and payload.get("password") == "admin":
                        self.send_response(200)
                        self.send_header("Set-Cookie", "session=legacy; Path=/")
                        self.end_headers()
                        self.wfile.write(b"{}")
                        return
                    self.send_response(401)
                    self.end_headers()
                    self.wfile.write(b"{}")
                    return
                self.send_response(404)
                self.end_headers()

            def do_GET(self):
                if urlparse(self.path).path == "/api/admin/userconfig":
                    self.send_response(401)
                    self.end_headers()
                    self.wfile.write(b"{}")
                    return
                super().do_GET()

        legacy_server = HTTPServer(("127.0.0.1", 0), LegacyOnlyServer)
        legacy_url = f"http://127.0.0.1:{legacy_server.server_address[1]}"
        legacy_thread = threading.Thread(target=legacy_server.serve_forever, daemon=True)
        legacy_thread.start()
        try:
            cookiejar = module.CookieJar()
            opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookiejar))
            session = module.login_with_wg_easy_compat(opener, legacy_url, "admin", "admin")
            self.assertTrue(session)
            self.assertTrue(any(cookie.name == "session" for cookie in cookiejar))
            self.assertEqual(LegacyOnlyServer.last_request, "/api/session")
        finally:
            legacy_server.shutdown()
            legacy_server.server_close()
            legacy_thread.join(timeout=5)

    def test_invalid_credentials_are_not_masked(self):
        opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(module.CookieJar()))
        with self.assertRaises(urllib.error.HTTPError):
            module.login_with_wg_easy_compat(opener, self.server_url, "admin", "wrong-password")

    def test_disabled_password_auth_is_not_masked(self):
        class PasswordAuthDisabledServer(FakeWgEasyServer):
            def do_POST(self):
                parsed = urlparse(self.path)
                if parsed.path in {"/api/auth/password", "/api/session"}:
                    self.send_response(403)
                    self.end_headers()
                    self.wfile.write(b"{}")
                    return
                super().do_POST()

            def do_GET(self):
                parsed = urlparse(self.path)
                if parsed.path == "/api/admin/userconfig":
                    self.send_response(403)
                    self.end_headers()
                    self.wfile.write(b"{}")
                    return
                super().do_GET()

        disabled_server = HTTPServer(("127.0.0.1", 0), PasswordAuthDisabledServer)
        disabled_url = f"http://127.0.0.1:{disabled_server.server_address[1]}"
        disabled_thread = threading.Thread(target=disabled_server.serve_forever, daemon=True)
        disabled_thread.start()
        try:
            opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(module.CookieJar()))
            with self.assertRaises(urllib.error.HTTPError):
                module.login_with_wg_easy_compat(opener, disabled_url, "admin", "admin")
        finally:
            disabled_server.shutdown()
            disabled_server.server_close()
            disabled_thread.join(timeout=5)

    def test_bootstrap_script_uses_password_login_route(self):
        class BootstrapApiServer(BaseHTTPRequestHandler):
            request_log = []

            def do_POST(self):
                parsed = urlparse(self.path)
                self.__class__.request_log.append(parsed.path)
                if parsed.path == "/api/auth/password":
                    payload = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))).decode("utf-8"))
                    self.send_response(200 if payload.get("username") == "admin" and payload.get("password") == "admin" else 401)
                    self.send_header("Set-Cookie", "session=bootstrap; Path=/")
                    self.end_headers()
                    self.wfile.write(b"{}")
                    return
                if parsed.path == "/api/admin/hooks":
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(b'{"postUp":"","postDown":""}')
                    return
                if parsed.path == "/api/admin/userconfig":
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(b'{"defaultDns":["10.8.0.1"],"defaultAllowedIps":["10.8.0.0/24"],"defaultPersistentKeepalive":25}')
                    return
                self.send_response(404)
                self.end_headers()

            def do_GET(self):
                parsed = urlparse(self.path)
                self.__class__.request_log.append(parsed.path)
                if parsed.path == "/api/admin/userconfig":
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(b'{"defaultDns":["10.8.0.1"],"defaultAllowedIps":["10.8.0.0/24"],"defaultPersistentKeepalive":25}')
                    return
                if parsed.path == "/api/admin/hooks":
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(b'{"postUp":"","postDown":""}')
                    return
                self.send_response(404)
                self.end_headers()

            def log_message(self, *args, **kwargs):
                return

        bootstrap_server = HTTPServer(("127.0.0.1", 0), BootstrapApiServer)
        bootstrap_url = f"http://127.0.0.1:{bootstrap_server.server_address[1]}"
        bootstrap_thread = threading.Thread(target=bootstrap_server.serve_forever, daemon=True)
        bootstrap_thread.start()
        try:
            env = os.environ.copy()
            env["WG_EASY_API_URL"] = bootstrap_url
            env["WG_EASY_ADMIN_USERNAME"] = "admin"
            env["WG_EASY_ADMIN_PASSWORD"] = "admin"
            env["HOME_LAN_SUBNET"] = "10.10.10.0/24"
            env["WG_VPN_DNS"] = "10.8.0.1"
            env["WG_VPN_ALLOWED_IPS"] = "10.8.0.0/24,10.10.10.0/24"
            env["WG_VPN_PERSISTENT_KEEPALIVE"] = "25"
            env["WG_EASY_HOST"] = "example.com"
            result = subprocess.run(
                ["bash", str(Path(__file__).resolve().parents[1] / "hooks" / "bootstrap-hooks.sh")],
                cwd=str(Path(__file__).resolve().parents[1]),
                env=env,
                capture_output=True,
                text=True,
                timeout=30,
            )
            self.assertEqual(result.returncode, 0, msg=result.stderr)
            self.assertIn("BOOTSTRAP_RESULT=changed", result.stdout)
            self.assertIn("Hooks (PostUp/PostDown) differ from desired state", result.stdout)
            self.assertIn("VPN client defaults differ from desired state", result.stdout)
            self.assertTrue(
                any(path in {"/api/auth/password", "/api/admin/userconfig"} for path in BootstrapApiServer.request_log),
                msg=BootstrapApiServer.request_log,
            )
        finally:
            bootstrap_server.shutdown()
            bootstrap_server.server_close()
            bootstrap_thread.join(timeout=5)

    def test_network_errors_are_surfaces(self):
        opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(module.CookieJar()))
        with self.assertRaises(urllib.error.URLError):
            module.login_with_wg_easy_compat(opener, "http://127.0.0.1:1", "admin", "admin")


if __name__ == "__main__":
    unittest.main()
