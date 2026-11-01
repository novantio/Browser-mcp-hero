const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { CertificateTrustStore } = require('../dist/main/certificate-trust');

function create() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'hero-cert-trust-'));
  return { dir, store: new CertificateTrustStore(dir) };
}

test('trust store remembers approved hosts permanently across restarts', () => {
  const { dir, store } = create();
  assert.equal(store.has('10.6.6.100'), false);
  assert.equal(store.add('10.6.6.100'), true);
  assert.equal(store.add('10.6.6.100'), false); // idempotent
  assert.equal(store.has('10.6.6.100'), true);

  const reloaded = new CertificateTrustStore(dir);
  assert.equal(reloaded.has('10.6.6.100'), true);
  assert.deepEqual(reloaded.list(), ['10.6.6.100']);
  assert.equal(reloaded.size, 1);
});

test('trust store normalizes hosts (case, port, IPv6 brackets)', () => {
  const { store } = create();
  store.add('Es-Corp.LOCAL:8443');
  assert.equal(store.has('es-corp.local'), true);
  assert.equal(store.has('ES-CORP.LOCAL'), true);
  store.add('[::1]:9200');
  assert.equal(store.has('::1'), true);
  assert.equal(store.has('[::1]'), true);
});

test('trust store removal and clearing update persistence', () => {
  const { dir, store } = create();
  store.add('10.6.6.100');
  store.add('10.6.13.92');
  assert.equal(store.remove('10.6.6.100'), true);
  assert.equal(store.remove('10.6.6.100'), false);
  const reloaded = new CertificateTrustStore(dir);
  assert.deepEqual(reloaded.list(), ['10.6.13.92']);
  reloaded.clear();
  assert.equal(new CertificateTrustStore(dir).size, 0);
});

test('trust store ignores empty hosts and tolerates a corrupt file', () => {
  const { dir, store } = create();
  store.add('');
  assert.equal(store.size, 0);

  writeFileSync(path.join(dir, 'trusted-certificates.json'), '{ not json', 'utf8');
  const recovered = new CertificateTrustStore(dir);
  assert.equal(recovered.size, 0);
  assert.equal(recovered.add('10.6.6.100'), true);
  assert.equal(existsSync(path.join(dir, 'trusted-certificates.json')), true);
  assert.equal(new CertificateTrustStore(dir).has('10.6.6.100'), true);
});
