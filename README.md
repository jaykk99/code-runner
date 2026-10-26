Live: https://jaykk99.github.io/code-runner/

# Code Runner

Run Python or JavaScript right in your browser. No server, no install, no API key.

Live: https://jaykk99.github.io/code-runner/

## What it does

- **Python** runs on Pyodide (CPython compiled to WebAssembly) inside a Web Worker.
- **JavaScript** runs inside a Web Worker as an async function with a captured `console`.
- **Hung code is killed automatically.** Python runs time out at 30s and JavaScript at 10s; the worker is terminated and a fresh one is created for the next run, so the page never freezes.
- **Auto-fix.** On an error, local rules patch common problems (missing imports, undefined names, syntax slips). If they cannot fix it, the error is sent to a free AI endpoint that returns corrected code you can run with one click.

## Files

- `index.html` is the whole app: UI, both execution workers, and the auto-fix logic in one file.

## Run locally

```bash
python3 -m http.server
# open http://localhost:8000
```

Internet is required at runtime for the Python runtime (Pyodide loads from the jsDelivr CDN) and for the AI fix fallback.
