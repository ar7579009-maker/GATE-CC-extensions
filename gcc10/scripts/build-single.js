// Builds ONE self-contained HTML file (app + styles + icon) that runs from a double-click, a USB stick or a phone file manager.
// Data lives in that browser's localStorage; use Export/Import to move it. Sync works when online.
const fs = require('fs'), path = require('path');
const read = (f) => fs.readFileSync(f, 'utf8');
let html = read('index.html');
const bundle = read('bundle.js').replace(/<\/script/gi, '<\\/script');
const icon = 'data:image/png;base64,' + fs.readFileSync('icon.png').toString('base64');

const before = html;
html = html
  .replace(/<link rel="manifest"[^>]*>\s*/i, '')
  .replace(/<link rel="apple-touch-icon"[^>]*>\s*/i, '')
  .replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
  .replace(/<title>/i, `<link rel="icon" href="${icon}" />\n<title>`)
  .replace('<script src="bundle.js"></script>', () => `<script>${bundle}</script>`);
if (html === before || html.includes('src="bundle.js"') || !html.includes("'unsafe-inline'") || !html.includes('<script>')) throw new Error('index.html changed shape; update scripts/build-single.js');

fs.mkdirSync('dist-html', { recursive: true });
const out = path.join('dist-html', 'GATE-Command-Center.html');
fs.writeFileSync(out, html);
console.log(out, (Buffer.byteLength(html) / 1024).toFixed(0) + ' KB');
