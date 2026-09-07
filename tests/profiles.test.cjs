const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { ProfileManager } = require('../dist/main/profile-manager');
function create() {
  const dir = mkdtempSync(path.join(require('node:os').tmpdir(), 'hero-profile-unit-'));
  return { dir, profiles: new ProfileManager(dir) };
}

test('profile creation and selected profile survive manager restart', () => {
  const { dir, profiles } = create();
  const profile = profiles.createProfile('  Kerja saya  ');
  profiles.switchProfile(profile.id);
  const reloaded = new ProfileManager(dir);
  assert.equal(reloaded.activeProfileId, profile.id);
  assert.equal(reloaded.getProfile(profile.id).name, 'Kerja saya');
  assert.equal(reloaded.listProfiles().length, 5);
});

test('profile names are labels, cannot be empty or duplicates', () => {
  const { profiles } = create();
  assert.throws(() => profiles.createProfile('   '));
  assert.throws(() => profiles.createProfile('INSTAGRAM'));
  assert.throws(() => profiles.createProfile('x'.repeat(41)));
  const created = profiles.createProfile('../../another directory');
  assert.match(created.id, /^[a-f0-9-]{36}$/);
  assert.notEqual(created.id, created.name);
});

test('locks prevent a second owner from controlling or deleting a profile', () => {
  const { profiles } = create();
  profiles.lockProfile('instagram', 'task-a');
  profiles.lockProfile('instagram', 'task-a');
  assert.throws(() => profiles.lockProfile('instagram', 'task-b'), { code: 'PROFILE_BUSY' });
  assert.throws(() => profiles.unlockProfile('instagram', 'task-b'), { code: 'PROFILE_BUSY' });
  assert.throws(() => profiles.deleteProfile('instagram'), { code: 'PROFILE_BUSY' });
  profiles.unlockProfile('instagram', 'task-a');
  profiles.deleteProfile('instagram');
  assert.equal(profiles.getProfile('instagram'), null);
});

test('default cannot be removed and deleting selected profile selects default', () => {
  const { dir, profiles } = create();
  assert.throws(() => profiles.deleteProfile('default'));
  profiles.switchProfile('youtube');
  profiles.deleteProfile('youtube');
  const reloaded = new ProfileManager(dir);
  assert.equal(reloaded.activeProfileId, 'default');
  assert.equal(reloaded.getProfile('youtube'), null);
  assert.throws(() => reloaded.switchProfile('../outside'));
});

test('mutating returned snapshots cannot modify stored profiles', () => {
  const { profiles } = create();
  profiles.listProfiles()[0].name = 'mutated';
  assert.equal(profiles.getProfile('default').name, 'Default');
});

test('corrupt metadata is reported without overwriting the original', () => {
  const { dir } = create();
  const file = path.join(dir, 'profiles.json');
  writeFileSync(file, '{broken');
  assert.throws(() => new ProfileManager(dir), { code: 'PROFILE_STORE_INVALID' });
  assert.equal(readFileSync(file, 'utf8'), '{broken');
});

test('unsafe IDs in on-disk metadata are rejected', () => {
  const { dir } = create();
  const file = path.join(dir, 'profiles.json');
  writeFileSync(file, JSON.stringify({ version: 1, activeProfileId: 'default', profiles: [{ id: '../outside', name: 'Default', createdAt: 1 }] }));
  assert.throws(() => new ProfileManager(dir), { code: 'PROFILE_STORE_INVALID' });
});
