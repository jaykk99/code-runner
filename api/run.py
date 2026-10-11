import json
import subprocess
import tempfile
import os
import sys
from http.server import BaseHTTPRequestHandler


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length) or b"{}")
        except Exception:
            return self._send(400, {"error": "bad request"})
        language = body.get("language", "python")
        code = body.get("code", "")
        if not code or len(code) > 100000:
            return self._send(400, {"error": "code required (max 100k chars)"})
        if language == "python":
            result = run_python(code)
        elif language == "javascript":
            result = run_js(code)
        else:
            return self._send(400, {"error": "language must be python or javascript"})
        return self._send(200, result)

    def _send(self, status, obj):
        data = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def run_python(code):
    with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False) as f:
        f.write(code)
        path = f.name
    try:
        p = subprocess.run([sys.executable, path], capture_output=True, text=True, timeout=20)
        return {"stdout": p.stdout[-8000:], "stderr": p.stderr[-8000:], "exitCode": p.returncode}
    except subprocess.TimeoutExpired:
        return {"stdout": "", "stderr": "Timeout: code ran over 20s", "exitCode": 124}
    except Exception as e:
        return {"stdout": "", "stderr": str(e), "exitCode": 1}
    finally:
        try:
            os.unlink(path)
        except Exception:
            pass


def run_js(code):
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as f:
        f.write(code)
        path = f.name
    try:
        p = subprocess.run(["node", path], capture_output=True, text=True, timeout=20)
        return {"stdout": p.stdout[-8000:], "stderr": p.stderr[-8000:], "exitCode": p.returncode}
    except subprocess.TimeoutExpired:
        return {"stdout": "", "stderr": "Timeout: code ran over 20s", "exitCode": 124}
    except FileNotFoundError:
        return {"stdout": "", "stderr": "node not available on this host", "exitCode": 1}
    except Exception as e:
        return {"stdout": "", "stderr": str(e), "exitCode": 1}
    finally:
        try:
            os.unlink(path)
        except Exception:
            pass
