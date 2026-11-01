const { cpSync, mkdirSync, readdirSync } = require('node:fs');
mkdirSync('dist/ui/renderer', { recursive: true });
// index.html plus every stylesheet (styles are split per area to stay small).
for (const name of readdirSync('src/renderer').filter(file => file === 'index.html' || file.endsWith('.css'))) {
  cpSync(`src/renderer/${name}`, `dist/ui/renderer/${name}`);
}
