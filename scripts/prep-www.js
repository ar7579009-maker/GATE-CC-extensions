// Builds www/ for Capacitor (Android) and for the web app (GitHub Pages).
const fs = require('fs'), path = require('path');
fs.rmSync('www', { recursive: true, force: true }); fs.mkdirSync('www');
['index.html', 'bundle.js', 'icon.png'].forEach((f) => fs.copyFileSync(f, path.join('www', f)));
fs.readdirSync('web').forEach((f) => fs.copyFileSync(path.join('web', f), path.join('www', f)));
const sw = path.join('www', 'sw.js'); // stamp the cache name so every deploy replaces the old cache
fs.writeFileSync(sw, fs.readFileSync(sw, 'utf8').replace('__BUILD__', String(Date.now())));
fs.writeFileSync(path.join('www', '.nojekyll'), '');
console.log('www/ ready');
