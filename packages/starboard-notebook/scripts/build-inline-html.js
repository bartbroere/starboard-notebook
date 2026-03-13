/**
 * Packages the webpack dist output into a single self-contained HTML file.
 *
 * What gets inlined:
 *  - All CSS (starboard-notebook.css + monaco.starboard-notebook.css) with
 *    every font reference replaced by a base64 data: URI.
 *  - All *.chunk.js files as <script> tags placed before the main script so
 *    webpack's chunk registry (webpackChunkstarboard_notebook) is pre-filled.
 *  - Worker files (editor.worker.js, css.worker.js, html.worker.js,
 *    ts.worker.js) via a Worker constructor shim that intercepts URL-based
 *    worker creation by filename and redirects to blob: URLs built from the
 *    inlined content.
 *  - The main starboard-notebook.js.
 *  - The favicon as a data: URI.
 *
 * Output: dist/starboard-notebook-inline.html
 *
 * Run after either `build` (CDN Pyodide) or `build:inline` (offline Pyodide).
 */

'use strict';
const fs   = require('fs');
const path = require('path');

const distDir  = path.resolve(__dirname, '../dist');
const outFile  = path.join(distDir, 'starboard-notebook-inline.html');

// ─── helpers ─────────────────────────────────────────────────────────────────

function read(name)    { return fs.readFileSync(path.join(distDir, name), 'utf8'); }
function readBin(name) { return fs.readFileSync(path.join(distDir, name)); }
function exists(name)  { return fs.existsSync(path.join(distDir, name)); }

/** Replace every occurrence of a filename in CSS with its base64 data: URI. */
function inlineFontsInCss(css) {
  const fontExts = { woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf' };
  return css.replace(/url\((['"]?)([^)'"]+\.(woff2?|ttf))(\?[^)'"]*)?(['"]?)\)/g,
    (match, q1, filePath, ext) => {
      const filename = path.basename(filePath.split('?')[0]);
      const fullPath = path.join(distDir, filename);
      if (!fs.existsSync(fullPath)) return match;   // leave unknown refs alone
      const b64  = fs.readFileSync(fullPath).toString('base64');
      const mime = fontExts[ext] || 'application/octet-stream';
      return 'url("data:' + mime + ';base64,' + b64 + '")';
    }
  );
}

// ─── CSS ─────────────────────────────────────────────────────────────────────

let css = '';
for (const cssFile of ['starboard-notebook.css', 'monaco.starboard-notebook.css']) {
  if (exists(cssFile)) css += '\n' + inlineFontsInCss(read(cssFile));
}

// ─── JS chunks (pre-fill webpack chunk registry) ─────────────────────────────

const chunkFiles = fs.readdirSync(distDir)
  .filter(f => f.endsWith('.chunk.js'))
  .sort(); // deterministic order

const chunkScripts = chunkFiles
  .map(f => '<script>' + read(f) + '</script>')
  .join('\n');

// ─── Monaco workers (blob: URL shim) ─────────────────────────────────────────
// Monaco looks up workers by filename (e.g. "editor.worker.js"). We intercept
// the Worker constructor to catch those URLs and redirect to blob: URLs.

const workerNames = ['editor.worker.js', 'css.worker.js', 'html.worker.js', 'ts.worker.js'];
const workerEntries = workerNames
  .filter(w => exists(w))
  .map(w => JSON.stringify(w) + ':' + JSON.stringify(read(w)));

const workerShim = [
  '(function () {',
  '  var _workerSrc = {',
  '    ' + workerEntries.join(',\n    '),
  '  };',
  '  var _OrigWorker = globalThis.Worker;',
  '  function PatchedWorker(url, opts) {',
  '    var filename = String(url).split("/").pop().split("?")[0];',
  '    if (_workerSrc[filename]) {',
  '      url = URL.createObjectURL(',
  '        new Blob([_workerSrc[filename]], { type: "application/javascript" })',
  '      );',
  '    }',
  '    return new _OrigWorker(url, opts);',
  '  }',
  '  PatchedWorker.prototype = _OrigWorker.prototype;',
  '  globalThis.Worker = PatchedWorker;',
  '})();',
].join('\n');

// ─── favicon data URI ─────────────────────────────────────────────────────────

let faviconTag = '<link rel="icon" href="favicon.ico">';
if (exists('favicon.ico')) {
  const b64 = readBin('favicon.ico').toString('base64');
  faviconTag = '<link rel="icon" type="image/x-icon" href="data:image/x-icon;base64,' + b64 + '">';
}

// ─── main JS ─────────────────────────────────────────────────────────────────

const mainJs = read('starboard-notebook.js');

// ─── assemble HTML ────────────────────────────────────────────────────────────

const html = [
  '<!doctype html>',
  '<html>',
  '<head>',
  '  <meta charset="utf-8">',
  '  <title>Starboard Notebook</title>',
  '  <meta name="viewport" content="width=device-width,initial-scale=1">',
  '  ' + faviconTag,
  '  <style>' + css + '</style>',
  '</head>',
  '<body>',
  // Chunks must run before the main script so the chunk registry is populated.
  chunkScripts,
  // Worker shim must run before the main script creates any Worker.
  '<script>' + workerShim + '</script>',
  '<script>' + mainJs + '</script>',
  '</body>',
  '</html>',
].join('\n');

fs.writeFileSync(outFile, html, 'utf8');

const sizeMB = (fs.statSync(outFile).size / 1024 / 1024).toFixed(1);
console.log('Wrote', outFile, '(' + sizeMB + ' MB)');
console.log('  CSS inlined (fonts as data: URIs)');
console.log('  ' + chunkFiles.length + ' chunk files inlined');
console.log('  ' + workerEntries.length + ' workers inlined via blob: URL shim');
