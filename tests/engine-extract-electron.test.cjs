// Regression: inside Electron, node:fs treats *.asar as archives, so writing
// resources/default_app.asar during engine extraction failed on every update.
// Plain-Node tests cannot see this, so extraction runs under the Electron binary.
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

/** Minimal stored (uncompressed) zip writer, enough for yauzl. */
function makeZip(entries) {
  const local = [], central = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const data = Buffer.from(text), file = Buffer.from(name), crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(file.length, 26);
    local.push(header, file, data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(data.length, 20); entry.writeUInt32LE(data.length, 24); entry.writeUInt16LE(file.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, file);
    offset += header.length + file.length + data.length;
  }
  const centralSize = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}

test('extractEngine writes .asar files when running inside Electron', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'hero-engine-asar-'));
  try {
    const zip = path.join(dir, 'engine.zip');
    writeFileSync(zip, makeZip([['electron.exe', 'exe'], ['resources/default_app.asar', 'not really an asar'], ['resources/after.txt', 'after']]));
    const script = path.join(dir, 'run.cjs');
    writeFileSync(script, `
      const { extractEngine } = require(${JSON.stringify(path.join(__dirname, '../dist/main/engine-download.js'))});
      const fs = require('original-fs');
      const out = ${JSON.stringify(path.join(dir, 'out'))};
      extractEngine(${JSON.stringify(zip)}, out, new AbortController().signal)
        .then(() => console.log('RESULT ' + JSON.stringify({ asar: fs.readFileSync(out + '/resources/default_app.asar', 'utf8'), after: fs.existsSync(out + '/resources/after.txt') })))
        .catch(error => console.log('RESULT ' + JSON.stringify({ error: error.message })));`);
    const result = spawnSync(require('electron'), [script], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 60000 });
    const line = (result.stdout || '').split(/\r?\n/).find(l => l.startsWith('RESULT '));
    assert.ok(line, 'electron produced no result: ' + (result.stderr || result.error));
    assert.deepEqual(JSON.parse(line.slice(7)), { asar: 'not really an asar', after: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
