import json
import re
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
        stderr = body.get("stderr", "")
        if language == "python":
            fixed, notes = autofix_python(code, stderr)
        elif language == "javascript":
            fixed, notes = autofix_js(code, stderr)
        else:
            return self._send(400, {"error": "language must be python or javascript"})
        data = json.dumps({"fixed": fixed, "notes": notes, "changed": fixed != code}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _send(self, status, obj):
        data = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


COMMON_IMPORTS = {
    "requests": "requests", "bs4": "beautifulsoup4", "BeautifulSoup": "beautifulsoup4",
    "numpy": "numpy", "np": "numpy", "pandas": "pandas", "pd": "pandas",
    "PIL": "pillow", "Image": "pillow", "cv2": "opencv-python",
    "flask": "flask", "django": "django", "lxml": "lxml",
}


def autofix_python(code, stderr):
    notes = []
    lines = code.split("\n")

    # 1. ModuleNotFoundError -> note the pip install (can't pip install on serverless reliably)
    m = re.search(r"ModuleNotFoundError: No module named '([^']+)'", stderr)
    if m:
        mod = m.group(1).split(".")[0]
        pkg = COMMON_IMPORTS.get(mod, mod)
        notes.append("Missing module '%s'. Add a requirements note or install: pip install %s" % (mod, pkg))

    # 2. NameError -> check for common missing imports at top
    m = re.search(r"NameError: name '(\w+)' is not defined", stderr)
    if m:
        name = m.group(1)
        if name in ("requests", "json", "re", "os", "sys", "math", "time", "random", "datetime"):
            if not re.search(r"^import\s+%s\b" % name, code, re.M):
                lines.insert(0, "import %s" % name)
                notes.append("Added missing 'import %s'" % name)

    # 3. IndentationError: unexpected indent -> try dedenting the flagged line
    m = re.search(r'File "<string>", line (\d+)', stderr) or re.search(r'line (\d+)', stderr)
    err_line = int(m.group(1)) if m else None

    if "IndentationError: unexpected indent" in stderr and err_line and 1 <= err_line <= len(lines):
        idx = err_line - 1
        stripped = lines[idx].lstrip()
        # match indent of previous non-empty line
        prev_indent = ""
        for j in range(idx - 1, -1, -1):
            if lines[j].strip():
                prev_indent = lines[j][: len(lines[j]) - len(lines[j].lstrip())]
                break
        lines[idx] = prev_indent + stripped
        notes.append("Fixed unexpected indent on line %d" % err_line)

    # 4. TabError -> convert tabs to 4 spaces
    if "TabError" in stderr:
        lines = [l.replace("\t", "    ") for l in lines]
        notes.append("Converted tabs to 4 spaces")

    # 5. SyntaxError: missing colon on compound statements
    if "SyntaxError" in stderr and err_line and 1 <= err_line <= len(lines):
        idx = err_line - 1
        s = lines[idx].rstrip()
        if re.match(r"^\s*(if|elif|else|for|while|def|class|try|except|finally|with)\b", s) and not s.endswith(":"):
            lines[idx] = s + ":"
            notes.append("Added missing colon on line %d" % err_line)

    # 6. print statement (py2 style) -> print()
    if "SyntaxError" in stderr and re.search(r"^\s*print\s+[^(]", code, re.M):
        lines = [re.sub(r"^(\s*)print\s+(.+)$", r"\1print(\2)", l) for l in lines]
        notes.append("Converted print statements to print() calls")

    fixed = "\n".join(lines)
    if fixed == code and not notes:
        notes.append("No automatic fix found. Read the traceback: the error type and line number point at the problem.")
    return fixed, notes


def autofix_js(code, stderr):
    notes = []
    # 1. Missing semicolons rarely break node, but "Unexpected token" often means a typo
    m = re.search(r"SyntaxError: Unexpected token '([^']+)'", stderr)
    if m:
        notes.append("Syntax error near '%s'. Check for unclosed brackets, quotes, or a typo on that line." % m.group(1))
    m = re.search(r"ReferenceError: (\w+) is not defined", stderr)
    if m:
        notes.append("'%s' is not defined. Check the spelling or add the missing require/import." % m.group(1))
    m = re.search(r"Cannot find module '([^']+)'", stderr)
    if m:
        notes.append("Module '%s' not found. Serverless hosts can't npm install at runtime; bundle it or use a built-in." % m.group(1))
    if not notes:
        notes.append("No automatic fix found. The stack trace line number points at the problem.")
    return code, notes
