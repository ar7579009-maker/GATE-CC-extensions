// Lists every className token used by the bundle sources that has no selector in a given shell.  usage: node scripts/check-css.js index-win.html [...]
const fs = require('fs');
const src = ['App.jsx', 'plan-ui.jsx', 'timer.jsx', 'sync.jsx', 'ui.js'].map((f) => fs.readFileSync(f, 'utf8')).join('\n');
const used = new Set();
for (const m of src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{'([^']*)'\})/g)) {
  const raw = (m[1] || m[2] || m[3] || '').replace(/\$\{[^}]*\}/g, ' ');
  raw.split(/\s+/).filter((t) => /^[a-z][\w-]*$/i.test(t)).forEach((t) => used.add(t));
}
// tokens inside ${...} ternaries like className={`btn ${x ? 'on' : ''}`} or className={cond ? 'a b' : 'c'}
for (const m of src.matchAll(/className=\{([^}]*)\}/g)) for (const q of m[1].matchAll(/'([^']*)'/g)) q[1].split(/\s+/).filter((t) => /^[a-z][\w-]*$/i.test(t)).forEach((t) => used.add(t));
for (const f of process.argv.slice(2)) {
  const css = [...fs.readFileSync(f, 'utf8').matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
  const have = new Set([...css.matchAll(/\.([a-z][\w-]*)/gi)].map((m) => m[1]));
  const html = fs.readFileSync(f, 'utf8');
  const miss = [...used].filter((t) => !have.has(t)).sort();
  console.log(f + ' missing (' + miss.length + '): ' + miss.join(' '));
}
