const { cpSync, mkdirSync } = require('node:fs');
mkdirSync('dist/ui/renderer', { recursive: true });
for (const name of ['index.html', 'styles.css']) {
  cpSync(`src/renderer/${name}`, `dist/ui/renderer/${name}`);
}
