// Human/agent profile management: rename, duplicate naming, UI commands and agent-visible errors.
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { ProfileManager } = require('../dist/main/profile-manager');
const { parseCommand } = require('../dist/shared/navigation');
const { publicError } = require('../dist/shared/rpc-error');

const create = () => new ProfileManager(mkdtempSync(path.join(os.tmpdir(), 'hero-profile-mgmt-')));

test('renameProfile renames, persists and rejects names already used by another profile', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'hero-profile-mgmt-'));
  const profiles = new ProfileManager(dir);
  const work = profiles.createProfile('Kerja');
  assert.equal(profiles.renameProfile(work.id, 'Kerja A1').name, 'Kerja A1');
  assert.equal(new ProfileManager(dir).requireProfile(work.id).name, 'Kerja A1');
  assert.equal(profiles.renameProfile(work.id, 'kerja a1').name, 'kerja a1', 'changing only the case of its own name is allowed');
  assert.throws(() => profiles.renameProfile(work.id, 'YouTube'), { code: 'PROFILE_EXISTS' });
  assert.throws(() => profiles.renameProfile(work.id, '   '), { code: 'INVALID_PROFILE_NAME' });
});

test('suggestCopyName picks the first free "(salinan N)" name', () => {
  const profiles = create();
  assert.equal(profiles.suggestCopyName('youtube'), 'YouTube (salinan)');
  profiles.createProfile('YouTube (salinan)');
  assert.equal(profiles.suggestCopyName('youtube'), 'YouTube (salinan 2)');
});

test('parseCommand accepts rename/duplicate profile commands and rejects malformed ones', () => {
  assert.deepEqual(parseCommand({ action: 'rename-profile', profileId: 'research', name: 'Riset A' }), { action: 'rename-profile', profileId: 'research', name: 'Riset A' });
  assert.deepEqual(parseCommand({ action: 'duplicate-profile', profileId: 'default', name: 'Default B', copyLogin: true }),
    { action: 'duplicate-profile', profileId: 'default', name: 'Default B', copyLogin: true });
  for (const bad of [
    { action: 'rename-profile', profileId: '../x', name: 'a' },
    { action: 'rename-profile', profileId: 'research' },
    { action: 'duplicate-profile', profileId: 'default', name: 'x', copyLogin: 'yes' },
    { action: 'duplicate-profile', profileId: 'default', name: 'x', copyLogin: true, extra: 1 },
  ]) assert.throws(() => parseCommand(bad));
});

test('publicError passes fixed ProfileManager messages through to agents', () => {
  const profiles = create();
  let error;
  try { profiles.createProfile('YouTube'); } catch (caught) { error = caught; }
  assert.deepEqual(publicError(error), { code: 'PROFILE_EXISTS', message: 'Nama profil sudah digunakan.' });
  assert.equal(publicError(new Error('secret https://x?token=1')).code, 'OPERATION_FAILED', 'other errors stay generic');
});
