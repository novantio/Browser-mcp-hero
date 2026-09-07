const { spawnSync } = require('node:child_process');
const path = require('node:path');
process.chdir(path.join(__dirname, '..'));
for (const config of ['tsconfig.json', 'tsconfig.renderer.json']) {
  const result = spawnSync(process.execPath, [path.join(path.dirname(require.resolve('typescript/package.json')), 'bin/tsc'), '-p', config], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
require('./copy-assets.cjs');
