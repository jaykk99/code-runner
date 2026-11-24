Live: https://jaykk99.github.io/code-runner/

# Code Runner

Run Python or JavaScript right in your browser. No server, no install, no API key.

Live: https://jaykk99.github.io/code-runner/

## What it does

- **Python** runs on Pyodide (CPython compiled to WebAssembly) inside a Web Worker. sqlite3 is preloaded, other shipped packages load automatically on first use, and `requests` / `urllib` work through a browser networking bridge.
- **JavaScript** runs inside a Web Worker as an async function with a captured `console` (plus `alert` / `prompt` / `confirm` shims, which log instead of crashing).
- **Hung code is killed automatically.** Once your code starts running it gets 30s (Python) or 10s (JavaScript); the worker is terminated on timeout and a fresh one is created for the next run, so the page never freezes. The runtime download itself gets a separate, longer window.
- **Auto-fix.** On an error, local rules patch common problems first (missing imports, indentation, tabs, missing colons). If they cannot fix it, the error goes to a free AI endpoint; the corrected code is pasted in and re-run automatically. If the AI service cannot answer, a built-in explainer shows the likely cause and fix.

## Code Runner Pro (Monico Labs)

The page above is the full free runner. Buying Code Runner from the
Monico Labs shop gets you an access code (`ML-....`) that unlocks Pro
on this page (checked against the shop hub, same as the other Monico
Labs products):

- Python runs up to 120s, JavaScript up to 30s
- Save and reload named snippets (stored in your browser)
- Open `.py` / `.js` files from your computer into the editor

## Files

- `index.html` is the whole app: UI, both execution workers, the auto-fix logic, and the Pro unlock in one file.

## Run locally

```bash
python3 -m http.server
# open http://localhost:8000
```

## Tests

```bash
node test/verify.js
# 25 checks, 0 failures
```

No dependencies. The suite loads the real page script into a VM with DOM
stubs and drives the worker stubs: a Python run that succeeds with stderr
output must not trigger the AI fix chain, a missing-import failure must
still get the rule-based fix and re-run, the JS console shims
(`info`/`debug`/`table`/`dir`/`trace`/`assert`/`count`/`time`/`timeEnd`/
`group`/`clear`) must not throw, and a failed Python networking prelude
must be retried on the next run instead of staying broken for the session.


Internet is required at runtime for the Python runtime (Pyodide loads from the jsDelivr CDN), the AI fix fallback, and Pro code checks.
