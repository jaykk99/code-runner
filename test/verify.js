// Code Runner checks. No dependencies: node test/verify.js
// Loads the real page script from index.html into a vm context with DOM
// stubs and drives the worker stubs, so the run / auto-fix / console-shim
// logic is tested as shipped (Pyodide itself is not loaded: the Python
// worker is driven with fake results, and its prelude retry is tested
// against a fake Pyodide object).
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const scriptSrc = html.split('<script>')[1].split('</script>')[0];

let checks = 0;
let failures = 0;
function check(name, cond, extra) {
  checks++;
  if (cond) {
    console.log('ok   ' + name);
  } else {
    failures++;
    console.log('FAIL ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : ''));
  }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function settleUntil(fn, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (fn()) return true;
    await sleep(50);
  }
  return fn();
}

// ---------------------------------------------------------------------------
// Page harness: DOM stubs + a Worker stub whose results the test controls.
// ---------------------------------------------------------------------------
function makeEl(id) {
  return {
    id, value: '', textContent: '', innerHTML: '', disabled: false,
    style: {}, files: [],
    addEventListener() {}, removeEventListener() {},
    appendChild() {}, click() {}, focus() {},
  };
}

function loadPage() {
  const els = {};
  ['lang', 'code', 'out', 'notes', 'runBtn', 'fixBtn', 'codeInput', 'gateMsg',
   'proRow', 'snipSel', 'fileInput'].forEach(id => { els[id] = makeEl(id); });
  const fetchCalls = [];
  const workers = [];
  let resultQueue = []; // results delivered in order, one per postMessage
  class FakeWorker {
    constructor(url) {
      this.url = url;
      this.listeners = {};
      this.posts = 0;
      workers.push(this);
    }
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
    removeEventListener(t, fn) { this.listeners[t] = (this.listeners[t] || []).filter(f => f !== fn); }
    postMessage(msg) {
      this.posts++;
      const res = resultQueue.length ? resultQueue.shift()
        : { ok: true, output: '', error: '' };
      setTimeout(() => {
        (this.listeners.message || []).forEach(fn => fn({ data: res }));
      }, 0);
    }
    terminate() { this.terminated = true; }
  }
  const sandbox = {
    console,
    setTimeout, clearTimeout, Promise,
    URL: { createObjectURL: () => 'blob:fake' },
    Blob: class { constructor(parts) { this.parts = parts; } },
    Worker: FakeWorker,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: {
      getElementById: id => els[id] || makeEl(id),
      createElement: () => makeEl('el'),
      body: { appendChild() {} },
    },
    fetch: async (...args) => {
      fetchCalls.push(args);
      throw new Error('fetch stub: should not be called in this test');
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(scriptSrc, sandbox, { filename: 'index.html-script' });
  return {
    sandbox, els, fetchCalls, workers,
    setResults: arr => { resultQueue = arr.slice(); },
  };
}

async function runPython(page, code, results) {
  page.els.lang.value = 'python';
  page.els.code.value = code;
  page.setResults(results);
  page.sandbox.run();
  await settleUntil(() => page.els.runBtn.disabled === false, 15000);
  return page;
}

// ---------------------------------------------------------------------------
// Worker harness: run a worker source string with a controllable sandbox.
// ---------------------------------------------------------------------------
function runWorker(workerSrc, code, extraSandbox) {
  const posted = [];
  const ctx = {
    console, setTimeout, clearTimeout, Promise,
    postMessage: m => posted.push(m),
  };
  Object.assign(ctx, extraSandbox || {});
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(workerSrc, ctx, { filename: 'worker' });
  ctx.onmessage({ data: { code } });
  return { ctx, posted };
}

(async () => {
  // --- 1. Python run that succeeds but writes to stderr: no AI fix. ---
  {
    const page = loadPage();
    await runPython(page, "import warnings\nwarnings.warn('careful')\nprint('ok')",
      [{ ok: true, output: 'ok\n', error: 'UserWarning: careful\n' }]);
    check('stderr success: no AI fetch attempted', page.fetchCalls.length === 0, page.fetchCalls.length);
    check('stderr success: notes do not mention AI fix', !/AI is fixing|AI fix failed/.test(page.els.notes.innerHTML), page.els.notes.innerHTML);
    check('stderr success: output shows stdout + warning', page.els.out.innerHTML.includes('ok') && page.els.out.innerHTML.includes('UserWarning'), page.els.out.innerHTML);
    check('stderr success: run button re-enabled', page.els.runBtn.disabled === false);
  }

  // --- 2. Same, with an auto-load note: the note is still shown. ---
  {
    const page = loadPage();
    await runPython(page, 'print(1)',
      [{ ok: true, output: '1\n', error: 'some warning\n', note: 'Auto-loaded the numpy package and re-ran your code.' }]);
    check('stderr success with note: note shown', page.els.notes.innerHTML.includes('Auto-loaded the numpy package'), page.els.notes.innerHTML);
    check('stderr success with note: no AI fetch', page.fetchCalls.length === 0);
  }

  // --- 3. Clean success: no fetch, output shown. ---
  {
    const page = loadPage();
    await runPython(page, "print('hello')", [{ ok: true, output: 'hello\n', error: '' }]);
    check('clean success: no AI fetch', page.fetchCalls.length === 0);
    check('clean success: output shown', page.els.out.innerHTML.includes('hello'));
  }

  // --- 4. Real failure with a rule fix: import added, re-run succeeds, no AI. ---
  {
    const page = loadPage();
    page.els.lang.value = 'python';
    page.els.code.value = "print(json.dumps({'a': 1}))";
    page.setResults([
      { ok: false, output: '', error: "Traceback (most recent call last):\n  File \"<exec>\", line 1, in <module>\nNameError: name 'json' is not defined" },
      { ok: true, output: '{"a": 1}\n', error: '' },
    ]);
    page.sandbox.run();
    await settleUntil(() => page.els.runBtn.disabled === false, 15000);
    check('rule fix: missing import added', page.els.code.value.startsWith('import json'), page.els.code.value);
    check('rule fix: re-run output shown', page.els.out.innerHTML.includes('{"a": 1}'), page.els.out.innerHTML);
    check('rule fix: no AI fetch needed', page.fetchCalls.length === 0, page.fetchCalls.length);
  }

  // --- 5. Real failure with no rule fix: AI tried, then built-in guidance. ---
  {
    const page = loadPage();
    await runPython(page, 'print(1 / 0)',
      [{ ok: false, output: '', error: 'Traceback (most recent call last):\n  File "<exec>", line 1, in <module>\nZeroDivisionError: division by zero' }]);
    check('unfixable failure: AI was tried', page.fetchCalls.length >= 1, page.fetchCalls.length);
    check('unfixable failure: built-in guidance shown', /Built-in guidance/.test(page.els.notes.innerHTML) && /divided by zero/.test(page.els.notes.innerHTML), page.els.notes.innerHTML.slice(0, 300));
    check('unfixable failure: run button re-enabled', page.els.runBtn.disabled === false);
  }

  // --- 6. JS worker: every console method works, objects stringify. ---
  {
    const page = loadPage();
    const jsSrc = page.sandbox.jsWorkerSrc;
    const { posted } = runWorker(jsSrc,
      "console.info('hello info');\nconsole.debug('dbg');\nconsole.table({a:1});\nconsole.dir({b:2});\nconsole.trace('tr');\nconsole.count('c');\nconsole.count('c');\nconsole.time('t');\nconsole.timeEnd('t');\nconsole.group('g');\nconsole.groupEnd();\nconsole.clear();\nconsole.assert(false, 'boom');\nconsole.log({x: 1});\nconsole.log('ok');");
    await sleep(100);
    const last = posted[posted.length - 1];
    check('js console: run succeeds', last && last.ok === true, last);
    check('js console: info/debug captured', last && last.output.includes('hello info') && last.output.includes('dbg'), last && last.output);
    check('js console: objects JSON-stringified', last && last.output.includes('{"a":1}') && last.output.includes('{"b":2}'), last && last.output);
    check('js console: count/time/assert work', last && /c: 2/.test(last.output) && /t: \d+ms/.test(last.output) && /\[assert\] boom/.test(last.output), last && last.output);
    check('js console: log({x:1}) stringified', last && last.output.includes('{"x":1}'), last && last.output);
  }

  // --- 7. JS worker: throwing code still surfaces the error with prior logs. ---
  {
    const page = loadPage();
    const { posted } = runWorker(page.sandbox.jsWorkerSrc,
      "console.log('before');\nthrow new Error('kaboom');");
    await sleep(100);
    const last = posted[posted.length - 1];
    check('js throw: ok false with error', last && last.ok === false && /kaboom/.test(last.error), last);
    check('js throw: prior logs kept', last && last.output.includes('before'), last && last.output);
  }

  // --- 8. JS worker: top-level await works. ---
  {
    const page = loadPage();
    const { posted } = runWorker(page.sandbox.jsWorkerSrc,
      "await new Promise(r => setTimeout(r, 10));\nconsole.log('later');");
    await sleep(200);
    const last = posted[posted.length - 1];
    check('js await: run succeeds', last && last.ok === true && last.output.includes('later'), last);
  }

  // --- 9. Python worker: a failed prelude is retried on the next run. ---
  {
    const page = loadPage();
    const pySrc = page.sandbox.pythonWorkerSrc;
    let preludeCalls = 0;
    const fakePy = {
      runPython(code) {
        if (code.includes('import sys as _cr_sys')) {
          preludeCalls++;
          if (preludeCalls === 1) throw new Error('prelude boom');
        }
      },
      runPythonAsync: async () => {},
      setStdout() {}, setStderr() {},
      loadPackage: async () => {},
    };
    const posted = [];
    const ctx = {
      console, setTimeout, clearTimeout, Promise,
      importScripts() {},
      loadPyodide: async () => fakePy,
      postMessage: m => posted.push(m),
    };
    ctx.self = ctx;
    vm.createContext(ctx);
    vm.runInContext(pySrc, ctx, { filename: 'python-worker' });
    ctx.onmessage({ data: { code: 'x = 1' } });
    await settleUntil(() => posted.some(m => m.ok !== undefined), 5000);
    const first = posted.filter(m => m.ok !== undefined).pop();
    check('prelude retry: first run notes the failed setup', first && /browser networking setup failed/.test(first.note || ''), first);
    ctx.onmessage({ data: { code: 'x = 2' } });
    await settleUntil(() => posted.filter(m => m.ok !== undefined).length >= 2, 5000);
    const second = posted.filter(m => m.ok !== undefined).pop();
    check('prelude retry: prelude attempted again on next run', preludeCalls === 2, preludeCalls);
    check('prelude retry: second run has no setup-failed note', second && (second.note || '') === '', second);
  }

  console.log('\n' + checks + ' checks, ' + failures + ' failures');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(3); });
