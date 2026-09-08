const { spawn } = require('node:child_process');
require('./build.cjs');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), ['.', ...(process.env.HERO_USER_DATA_DIR ? ['--user-data-dir=' + process.env.HERO_USER_DATA_DIR] : [])], { stdio: 'inherit', env });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
