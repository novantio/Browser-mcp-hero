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

test('sharing links selected profiles to one persistent session and survives restart', () => {
  const { dir, profiles } = create();
  profiles.shareSession('youtube', ['instagram', 'research']);
  assert.equal(profiles.getSessionProfileId('instagram'), 'youtube');
  assert.equal(profiles.getSessionProfileId('research'), 'youtube');
  assert.equal(profiles.getSessionProfileId('default'), 'default');
  assert.equal(new ProfileManager(dir).getSessionProfileId('instagram'), 'youtube');
});
test('leaving shared session restores the original private partition', () => {
  const { profiles } = create();
  profiles.shareSession('youtube', ['instagram', 'research']);
  assert.deepEqual(profiles.stopSharing('instagram'), ['instagram']);
  assert.equal(profiles.getSessionProfileId('instagram'), 'instagram');
  assert.equal(profiles.getSessionProfileId('research'), 'youtube');
  profiles.stopSharing('youtube');
  assert.equal(profiles.getSessionProfileId('research'), 'research');
});
test('sharing an existing session owner includes its dependent profiles without cycles', () => {
  const { profiles } = create();
  profiles.shareSession('instagram', ['research']);
  const plan = profiles.planShareSession('youtube', ['instagram']);
  assert.deepEqual(new Set(plan.targetIds), new Set(['instagram', 'research']));
  profiles.shareSession('youtube', ['instagram']);
  assert.equal(profiles.getSessionProfileId('research'), 'youtube');
  profiles.shareSession('research', ['default']);
  assert.equal(profiles.getSessionProfileId('default'), 'youtube');
});
test('shared session is locked as one resource and owners cannot be deleted while shared', () => {
  const { profiles } = create();
  profiles.shareSession('youtube', ['instagram']);
  profiles.lockProfile('youtube', 'task-a');
  assert.throws(() => profiles.lockProfile('instagram', 'task-b'), { code: 'PROFILE_BUSY' });
  assert.throws(() => profiles.stopSharing('instagram'), { code: 'PROFILE_BUSY' });
  profiles.unlockProfile('instagram', 'task-a');
  assert.throws(() => profiles.deleteProfile('youtube'), { code: 'PROFILE_SHARED' });
  profiles.deleteProfile('instagram');
  assert.equal(profiles.getSessionProfileId('youtube'), 'youtube');
});
test('invalid sharing requests and corrupt sharing cycles fail without altering metadata', () => {
  const { dir, profiles } = create();
  assert.throws(() => profiles.shareSession('youtube', ['missing']));
  assert.throws(() => profiles.shareSession('youtube', []));
  const file = path.join(dir, 'profiles.json');
  const data = JSON.parse(readFileSync(file, 'utf8'));
  data.profiles.find(p => p.id === 'youtube').sharedWith = 'instagram';
  data.profiles.find(p => p.id === 'instagram').sharedWith = 'youtube';
  writeFileSync(file, JSON.stringify(data));
  assert.throws(() => new ProfileManager(dir), { code: 'PROFILE_STORE_INVALID' });
});

test('legacy profile metadata preserves original session identity when upgraded', () => {
  const { dir } = create();
  const file = path.join(dir, 'profiles.json');
  const legacy = { version: 1, activeProfileId: 'default', profiles: [{ id: 'default', name: 'Default', createdAt: 123 }] };
  writeFileSync(file, JSON.stringify(legacy));
  const profiles = new ProfileManager(dir);
  assert.equal(profiles.getSessionProfileId('default'), 'default');
  profiles.createProfile('Tambahan');
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).version, 2);
  assert.equal(profiles.getProfile('default').createdAt, 123);
});
