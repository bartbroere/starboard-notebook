/**
 * Builds an inline version of pyodide.js that embeds all required binary
 * assets (pyodide.asm.js, pyodide.asm.wasm, python_stdlib.zip,
 * pyodide-lock.json) so Pyodide can run without any network requests.
 *
 * The output dist/pyodide.js is a drop-in replacement for the normal copy
 * and is picked up by the subsequent rollup build automatically.
 *
 * Technique:
 *  - pyodide.asm.js is wrapped in an IIFE and prepended so that
 *    _createPyodideModule is already defined; importScripts is patched to
 *    skip the asm.js URL.
 *  - fetch is patched to serve pyodide.asm.wasm, python_stdlib.zip and
 *    pyodide-lock.json from base64-encoded inline data.
 */

'use strict';
const fs   = require('fs');
const path = require('path');

const pyodideDir   = path.dirname(require.resolve('pyodide/pyodide.js'));
const pyodideJs    = fs.readFileSync(path.join(pyodideDir, 'pyodide.js'), 'utf8');
const pyodideAsmJs = fs.readFileSync(path.join(pyodideDir, 'pyodide.asm.js'), 'utf8');
const wasmBuf      = fs.readFileSync(path.join(pyodideDir, 'pyodide.asm.wasm'));
const stdlibBuf    = fs.readFileSync(path.join(pyodideDir, 'python_stdlib.zip'));
const lockJson     = fs.readFileSync(path.join(pyodideDir, 'pyodide-lock.json'), 'utf8');

const wasmB64   = wasmBuf.toString('base64');
const stdlibB64 = stdlibBuf.toString('base64');

console.log('pyodide.asm.js  :', (Buffer.byteLength(pyodideAsmJs) / 1024 / 1024).toFixed(1), 'MB');
console.log('pyodide.asm.wasm:', (wasmBuf.length   / 1024 / 1024).toFixed(1), 'MB  →',
  (wasmB64.length   / 1024 / 1024).toFixed(1), 'MB base64');
console.log('python_stdlib   :', (stdlibBuf.length  / 1024 / 1024).toFixed(1), 'MB  →',
  (stdlibB64.length / 1024 / 1024).toFixed(1), 'MB base64');

// ─── preamble 1: inline pyodide.asm.js ──────────────────────────────────────
// Wrapped in an IIFE with a stub `module` object so CommonJS boilerplate
// inside asm.js doesn't throw.  The last line of pyodide.asm.js already does
//   globalThis._createPyodideModule = _createPyodideModule;
// so the symbol is visible to the rest of pyodide.js.
const asmPreamble = [
  '// ---- starboard inline: pyodide.asm.js ----',
  '(function () {',
  '  var module = { exports: {} };',
  pyodideAsmJs,
  '})();',
  '// ---- end pyodide.asm.js ----',
  '',
].join('\n');

// ─── preamble 2: fetch / importScripts interceptor ──────────────────────────
// Intercepts the three binary assets pyodide.js tries to fetch at runtime.
// base64 strings are embedded directly; atob is used for decoding (works in
// both browser main-thread and web-worker contexts).
const interceptorPreamble = [
  '// ---- starboard inline: asset interceptor ----',
  '(function () {',
  '  function b64ToU8(b64) {',
  '    var s = atob(b64), n = s.length, u = new Uint8Array(n);',
  '    for (var i = 0; i < n; i++) u[i] = s.charCodeAt(i);',
  '    return u;',
  '  }',
  '  var WASM_B64   = "' + wasmB64   + '";',
  '  var STDLIB_B64 = "' + stdlibB64 + '";',
  '  var LOCK       = '  + lockJson  + ';',
  '',
  '  var _fetch = globalThis.fetch;',
  '  globalThis.fetch = function (url, opts) {',
  '    var s = typeof url === "string" ? url',
  '           : url instanceof URL     ? url.href',
  '           : String(url);',
  '    if (s.includes("pyodide.asm.wasm"))',
  '      return Promise.resolve(new Response(b64ToU8(WASM_B64),',
  '        { status: 200, headers: { "Content-Type": "application/wasm" } }));',
  '    if (s.includes("python_stdlib.zip"))',
  '      return Promise.resolve(new Response(b64ToU8(STDLIB_B64),',
  '        { status: 200, headers: { "Content-Type": "application/zip" } }));',
  '    if (s.includes("pyodide-lock.json"))',
  '      return Promise.resolve(new Response(JSON.stringify(LOCK),',
  '        { status: 200, headers: { "Content-Type": "application/json" } }));',
  '    return _fetch ? _fetch.call(this, url, opts)',
  '      : Promise.reject(new Error("fetch unavailable in offline build"));',
  '  };',
  '',
  '  // importScripts for pyodide.asm.js is a no-op: it is already inlined.',
  '  if (typeof importScripts !== "undefined") {',
  '    var _importScripts = importScripts;',
  '    globalThis.importScripts = function () {',
  '      var rest = Array.prototype.filter.call(arguments,',
  '        function (u) { return !String(u).includes("pyodide.asm.js"); });',
  '      if (rest.length > 0) return _importScripts.apply(this, rest);',
  '    };',
  '  }',
  '})();',
  '// ---- end asset interceptor ----',
  '',
].join('\n');

// ─── write output ────────────────────────────────────────────────────────────
const outDir  = path.resolve(__dirname, '../dist');
const outPath = path.join(outDir, 'pyodide.js');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outPath, interceptorPreamble + asmPreamble + pyodideJs, 'utf8');

const sizeMB = (fs.statSync(outPath).size / 1024 / 1024).toFixed(1);
console.log('Wrote', outPath, '(' + sizeMB, 'MB)');
