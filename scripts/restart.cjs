// Restarts a running Hero Browser through its local MCP bridge (rebuild + relaunch),
// or starts it when no instance is reachable. Usage: npm run restart
const { readFileSync } = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

const appData = process.env.APPDATA || (process.platform === 'darwin'
  ? path.join(process.env.HOME || '', 'Library/Application Support') : path.join(process.env.HOME || '', '.config'));
const bridgeFile = path.join(process.env.HERO_USER_DATA_DIR || path.join(appData, 'Hero Browser Profiles'), 'mcp-bridge.json');

function rpc(info, method) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ method, params: {} });
    const req = http.request({
      hostname: '127.0.0.1', port: info.port, path: '/rpc', method: 'POST', timeout: 5000,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Authorization: 'Bearer ' + info.token },
    }, res => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch (error) { reject(error); } });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(body);
  });
}

(async () => {
  try {
    const info = JSON.parse(readFileSync(bridgeFile, 'utf8'));
    const reply = await rpc(info, 'app.restart');
    if (!reply.ok) throw new Error(reply.error || 'restart ditolak');
    console.log('Hero Browser sedang di-restart.');
  } catch {
    console.log('Hero Browser tidak berjalan; membuka aplikasi...');
    const child = spawn(process.execPath, [path.join(__dirname, 'start.cjs')], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
  }
})();
