const { spawn } = require('node:child_process');
// Restart support: wait until the previous Hero process has exited so the
// single-instance lock is free before building and launching again.
const waitPid = Number(process.env.HERO_WAIT_FOR_PID || 0);
if (waitPid) {
  delete process.env.HERO_WAIT_FOR_PID;
  const deadline = Date.now() + 20000;
  const alive = () => { try { process.kill(waitPid, 0); return true; } catch { return false; } };
  while (alive() && Date.now() < deadline) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
}
const { existsSync } = require('node:fs');
const path = require('node:path');
require('./build.cjs');
const { engineDirectory, readSelection, selectedExecutable, compareVersions } = require('../dist/main/engine-selection');
const baseline = require('electron/package.json').version;
const root = engineDirectory();
let executable = require('electron');
if (existsSync(path.join(root, 'active.json'))) {
  const selection = readSelection(root);
  if (!selection) throw new Error('Metadata engine tidak valid. Data profil tidak diubah; periksa cache engine.');
  if (compareVersions(selection.version, baseline) >= 0) {
    const selected = selectedExecutable(root, baseline);
    if (!selected) throw new Error('Integritas engine tidak valid. Peluncuran dihentikan agar profil tidak dibuka oleh engine lama.');
    executable = selected;
  }
}
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const args = ['.', ...process.argv.slice(2)];
if (env.HERO_USER_DATA_DIR && !args.some(arg => arg.startsWith('--user-data-dir'))) args.push('--user-data-dir=' + env.HERO_USER_DATA_DIR);
const child = spawn(executable, args, { stdio: 'inherit', env, windowsHide: true });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
