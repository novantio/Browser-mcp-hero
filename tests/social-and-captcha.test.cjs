const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');

const { evaluateSocialCookies } = require('../dist/main/social-detector.js');
const { checkPageChallenge } = require('../dist/main/challenge-detector.js');
const { McpBridge } = require('../dist/main/mcp-bridge.js');
const { ProfileManager } = require('../dist/main/profile-manager.js');
const { TaskManager } = require('../dist/main/task-manager.js');

test('evaluateSocialCookies detects TikTok session cookies correctly', () => {
  const futureExp = Math.floor(Date.now() / 1000) + 86400;
  const tiktokCookies = [
    { name: 'sessionid', value: 'a1b2c3d4e5f6', domain: '.tiktok.com', expirationDate: futureExp },
    { name: 'uid_tt', value: '71234567890', domain: '.tiktok.com', expirationDate: futureExp },
    { name: 'tt_csrf_token', value: 'token123', domain: '.tiktok.com', expirationDate: futureExp },
  ];

  const detected = evaluateSocialCookies(tiktokCookies);
  assert.equal(detected.length, 1);
  assert.equal(detected[0].platform, 'tiktok');
  assert.equal(detected[0].name, 'TikTok');
  assert.equal(detected[0].loggedIn, true);
  assert.match(detected[0].username, /User \(71234567\)/);
});

test('evaluateSocialCookies detects multiple social platforms (TikTok, YouTube, Instagram, X)', () => {
  const futureExp = Math.floor(Date.now() / 1000) + 86400;
  const multiCookies = [
    { name: 'sessionid', value: 'tiktok_sess_abc', domain: '.tiktok.com', expirationDate: futureExp },
    { name: 'LOGIN_INFO', value: 'youtube_login_xyz', domain: '.youtube.com', expirationDate: futureExp },
    { name: 'sessionid', value: 'insta_sess_123', domain: '.instagram.com', expirationDate: futureExp },
    { name: 'ds_user_id', value: '987654321', domain: '.instagram.com', expirationDate: futureExp },
    { name: 'auth_token', value: 'twitter_auth_456', domain: '.x.com', expirationDate: futureExp },
    { name: 'twid', value: 'u%3D123456789', domain: '.x.com', expirationDate: futureExp },
    { name: 'user_session', value: 'github_sess_789', domain: '.github.com', expirationDate: futureExp },
    { name: 'dotcom_user', value: 'supercoder', domain: '.github.com', expirationDate: futureExp },
  ];

  const detected = evaluateSocialCookies(multiCookies);
  const platforms = detected.map(d => d.platform);
  assert.ok(platforms.includes('tiktok'), 'TikTok should be detected');
  assert.ok(platforms.includes('youtube'), 'YouTube should be detected');
  assert.ok(platforms.includes('instagram'), 'Instagram should be detected');
  assert.ok(platforms.includes('x'), 'Twitter/X should be detected');
  assert.ok(platforms.includes('github'), 'GitHub should be detected');

  const github = detected.find(d => d.platform === 'github');
  assert.equal(github.username, 'supercoder');
});

test('evaluateSocialCookies ignores expired or unrelated cookies', () => {
  const pastExp = Math.floor(Date.now() / 1000) - 3600;
  const expiredCookies = [
    { name: 'sessionid', value: 'expired_tiktok', domain: '.tiktok.com', expirationDate: pastExp },
    { name: 'random_tracker', value: '12345', domain: '.example.com' },
  ];

  const detected = evaluateSocialCookies(expiredCookies);
  assert.equal(detected.length, 0);
});

test('checkPageChallenge detects TikTok / ByteDance SecSDK CAPTCHA elements', () => {
  // Simulate DOM elements for TikTok Captcha
  global.document = {
    title: 'TikTok - Make Your Day',
    body: { innerText: 'Please verify to continue' },
    querySelector: (selector) => {
      if (selector.includes('#captcha_container')) {
        return { id: 'captcha_container' };
      }
      return null;
    },
  };
  global.window = {
    location: { hostname: 'www.tiktok.com' },
  };

  const res = checkPageChallenge();
  assert.equal(res.detected, true);
  assert.equal(res.provider, 'tiktok_captcha');
  assert.match(res.details, /TikTok \/ ByteDance SecSDK CAPTCHA/);
});

test('checkPageChallenge detects TikTok puzzle slider iframe and verification texts', () => {
  global.document = {
    title: 'TikTok Verification',
    body: { innerText: 'Tarik penggeser untuk melengkapi teka-teki' },
    querySelector: (selector) => {
      if (selector.includes('security-captcha')) {
        return { src: 'https://www.tiktok.com/falcon/security-captcha' };
      }
      return null;
    },
  };
  global.window = {
    location: { hostname: 'www.tiktok.com' },
  };

  const res = checkPageChallenge();
  assert.equal(res.detected, true);
  assert.equal(res.provider, 'tiktok_captcha');
});

test('McpBridge profiles.getLogins returns recommendations and profiles list with social logins', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hero-social-test-'));
  const profiles = new ProfileManager(dir);
  const tasks = new TaskManager(profiles);

  // Mock SessionManager
  const mockSessions = {
    async getSocialLogins(profileId) {
      if (profileId === 'default') {
        return [{ platform: 'tiktok', name: 'TikTok', loggedIn: true, username: 'User (12345)' }];
      }
      if (profileId === 'youtube') {
        return [{ platform: 'youtube', name: 'YouTube', loggedIn: true }];
      }
      return [];
    },
    async getLoggedInServices(profileId) {
      const accounts = await this.getSocialLogins(profileId);
      return accounts.map(a => a.platform);
    },
  };

  const mockBrowser = {
    snapshot: () => ({ tabs: [] }),
    listProfiles: () => profiles.listProfiles(),
  };

  const bridge = new McpBridge({
    userDataDir: dir,
    browser: mockBrowser,
    profiles,
    tasks,
    sessions: mockSessions,
  });

  try {
    const info = await bridge.start();

    // Helper for RPC request
    const rpc = (method, params = {}) => new Promise((resolve, reject) => {
      const postData = JSON.stringify({ method, params });
      const req = http.request({
        hostname: '127.0.0.1',
        port: info.port,
        path: '/rpc',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          Authorization: 'Bearer ' + info.token,
        },
      }, res => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', c => { raw += c; });
        res.on('end', () => resolve(JSON.parse(raw)));
      });
      req.on('error', reject);
      req.end(postData);
    });

    // 1. Check profiles.list returns loggedInServices
    const listRes = await rpc('profiles.list');
    assert.equal(listRes.ok, true);
    const defaultProfile = listRes.result.find(p => p.id === 'default');
    assert.ok(defaultProfile);
    assert.deepEqual(defaultProfile.loggedInServices, ['tiktok']);
    assert.equal(defaultProfile.socialAccounts[0].platform, 'tiktok');

    // 2. Check profiles.getLogins
    const loginsRes = await rpc('profiles.getLogins');
    assert.equal(loginsRes.ok, true);
    assert.equal(loginsRes.result.recommendations.tiktok, 'default');
    assert.equal(loginsRes.result.recommendations.youtube, 'youtube');

    await bridge.stop();
    tasks.dispose();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
