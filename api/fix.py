import json
import re


def handler(request):
    try:
        body = json.loads(request.body or b"{}") if hasattr(request, "body") else {}
    except Exception:
        return resp(400, {"error": "bad request"})
    language = body.get("language", "python")
    code = body.get("code", "")
    stderr = body.get("stderr", "")
    if language == "python":
        fixed, notes = autofix_python(code, stderr)
    elif language == "javascript":
        fixed, notes = autofix_js(code, stderr)
    else:
        return resp(400, {"error": "language must be python or javascript"})
    return resp(200, {"fixed": fixed, "notes": notes, "changed": fixed != code})


def resp(status, obj):
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(obj),
    }


def autofix_python(code, stderr):
    notes = []
    lines = code.split("\n")

    m = re.search(r"ModuleNotFoundError: No module named '([^']+)'", stderr)
    if m:
        mod = m.group(1).split(".")[0]
        notes.append("Missing module '%s'. Install it with: pip install %s" % (mod, mod))

    m = re.search(r"NameError: name '(\w+)' is not defined", stderr)
    if m:
        name = m.group(1)
        if name in ("requests", "json", "re", "os", "sys", "math", "time", "random", "datetime"):
            if not re.search(r"^import\s+%s\b" % name, code, re.M):
                lines.insert(0, "import %s" % name)
                notes.append("Added missing 'import %s'" % name)

    m = re.search(r"line (\d+)", stderr)
    err_line = int(m.group(1)) if m else None

    if "IndentationError: unexpected indent" in stderr and err_line and 1 <= err_line <= len(lines):
        idx = err_line - 1
        stripped = lines[idx].lstrip()
        prev_indent = ""
        for j in range(idx - 1, -1, -1):
            if lines[j].strip():
                prev_indent = lines[j][: len(lines[j]) - len(lines[j].lstrip())]
                break
        lines[idx] = prev_indent + stripped
        notes.append("Fixed unexpected indent on line %d" % err_line)

    if "TabError" in stderr:
        lines = [l.replace("\t", "    ") for l in lines]
        notes.append("Converted tabs to 4 spaces")

    if "SyntaxError" in stderr and err_line and 1 <= err_line <= len(lines):
        idx = err_line - 1
        s = lines[idx].rstrip()
        if re.match(r"^\s*(if|elif|else|for|while|def|class|try|except|finally|with)\b", s) and not s.endswith(":"):
            lines[idx] = s + ":"
            notes.append("Added missing colon on line %d" % err_line)

    if "SyntaxError" in stderr and re.search(r"^\s*print\s+[^(]", code, re.M):
        lines = [re.sub(r"^(\s*)print\s+(.+)$", r"\1print(\2)", l) for l in lines]
        notes.append("Converted print statements to print() calls")

    fixed = "\n".join(lines)
    if fixed == code and not notes:
        notes.append("No automatic fix found. The error type and line number in the traceback point at the problem.")
    return fixed, notes


def autofix_js(code, stderr):
    notes = []
    m = re.search(r"SyntaxError: Unexpected token '([^']+)'", stderr)
    if m:
        notes.append("Syntax error near '%s'. Check for unclosed brackets, quotes, or a typo on that line." % m.group(1))
    m = re.search(r"ReferenceError: (\w+) is not defined", stderr)
    if m:
        notes.append("'%s' is not defined. Check the spelling or add the missing require/import." % m.group(1))
    m = re.search(r"Cannot find module '([^']+)'", stderr)
    if m:
        notes.append("Module '%s' not found. Bundle it or use a built-in module." % m.group(1))
    if not notes:
        notes.append("No automatic fix found. The stack trace line number points at the problem.")
    return code, notes
