// Build a single dependency-free index.html by inlining styles.css, engine.js
// (as an ES module — it assigns globalThis.Fretboard), and ui.js (classic IIFE).
// No external fonts, no network: fully self-contained and offline-capable.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const css = read('src/styles.css');
const engine = read('src/engine.js');
const ui = read('src/ui.js');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="dark" />
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%230a0c13'/%3E%3Ccircle cx='16' cy='16' r='7' fill='%235eead4'/%3E%3C/svg%3E" />
<title>Fretboard — 3-string voicing explorer</title>
<style>
${css}
</style>
</head>
<body>
<div class="app">
  <header class="app-head">
    <div class="brand">
      <h1>Fretboard</h1>
      <span class="sub">3-string voicing explorer</span>
    </div>
    <div class="controls">
      <div class="chaos">
        <label for="chaos">Chaos</label>
        <input id="chaos" type="range" min="0" max="100" value="0" />
        <span class="val" id="chaosVal">0.00</span>
      </div>
      <button class="shuffle" id="shuffle">Shuffle</button>
    </div>
  </header>

  <div class="meta-strip">
    <span class="chip seq" id="seqChips">— → — → — → —</span>
    <span class="chip">strings <b id="ssChip">—</b></span>
    <span class="chip">seed <b id="seedChip">1</b></span>
    <span class="chip">
      common
      <span class="commonness-bar"><i id="commonBar" style="transform:scaleX(0)"></i></span>
    </span>
    <div class="legend">
      <span><i class="sw" style="background:#f5b94a"></i>root</span>
      <span><i class="sw" style="background:#2bbfa8"></i>note</span>
      <span><i class="sw" style="background:#ff8a45"></i>outside</span>
      <span><i class="sw mk-key"></i>key</span>
      <span><i class="sw mk-chord"></i>chord root</span>
      <span><i class="sw" style="background:#5eead4"></i>⌒↑</span>
      <span><i class="sw" style="background:#c08cff"></i>⌣↓</span>
      <span><i class="sw" style="background:#7c9cff"></i>∕</span>
      <span><i class="sw" style="background:#ff7eb6"></i>↝</span>
    </div>
  </div>

  <div class="stage-wrap">
    <div id="stage-mount"></div>
  </div>

  <footer class="hint">strings vertical · frets horizontal · 12-fret relative window · no fret numbers</footer>
</div>

<script type="module">
${engine}
</script>
<script>
${ui}
</script>
<script>
  window.addEventListener('DOMContentLoaded', function () {
    window.FretboardUI.init('stage-mount');
  });
</script>
</body>
</html>
`;

writeFileSync(join(root, 'index.html'), html);
console.log('wrote index.html (' + html.length + ' bytes)');
