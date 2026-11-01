// Lite mode: block images, video, audio and fonts but keep pages and their JavaScript working.
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { shouldBlockMedia, MediaFilter } = require('../dist/main/media-filter');
const { parseCommand } = require('../dist/shared/navigation');

test('shouldBlockMedia blocks media requests and keeps everything a page needs to work', () => {
  const blocked = [
    { resourceType: 'image', url: 'https://p16-sign.tiktokcdn.com/avatar.jpeg' },
    { resourceType: 'media', url: 'https://cdn.example/clip' },
    { resourceType: 'xhr', url: 'https://v16-webapp-prime.tiktok.com/video/tos/alisg/abc/?mime_type=video_mp4' },
    { resourceType: 'xhr', url: 'https://rr3.googlevideo.com/videoplayback?itag=18' },
    { resourceType: 'other', url: 'https://scontent.cdninstagram.com/v/t50/clip.mp4?efg=1' },
    { resourceType: 'xhr', url: 'https://pbs.twimg.com/media/abc.jpg?name=small' },
  ];
  const allowed = [
    { resourceType: 'mainFrame', url: 'https://www.tiktok.com/@a/video/1' },
    { resourceType: 'subFrame', url: 'https://www.youtube.com/embed/x' },
    { resourceType: 'script', url: 'https://sf16.tiktokcdn.com/app.js' },
    { resourceType: 'stylesheet', url: 'https://www.threads.net/app.css' },
    { resourceType: 'xhr', url: 'https://www.tiktok.com/api/comment/list/?aweme_id=1&count=20' },
    { resourceType: 'xhr', url: 'https://www.threads.net/api/graphql' },
    { resourceType: 'webSocket', url: 'wss://edge-chat.example/ws' },
    // Fonts stay: blocking them can hide all text on sites that wait for their font.
    { resourceType: 'font', url: 'https://fonts.gstatic.com/x.woff2' },
    // CAPTCHA puzzles must stay visible so a human can solve them in lite mode.
    { resourceType: 'image', url: 'https://p16-security-sg.ibyteimg.com/img/security-captcha-oversea-singapore/3d_piece.png' },
    { resourceType: 'image', url: 'https://www.google.com/recaptcha/api2/payload?p=abc' },
    { resourceType: 'image', url: 'https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/img.png' },
  ];
  for (const request of blocked) assert.equal(shouldBlockMedia(request), true, request.url);
  for (const request of allowed) assert.equal(shouldBlockMedia(request), false, request.url);
});

test('no-video mode keeps images but blocks video and audio; full blocks nothing', () => {
  const image = { resourceType: 'image', url: 'https://p16-sign.tiktokcdn.com/avatar.jpeg' };
  const xhrImage = { resourceType: 'xhr', url: 'https://pbs.twimg.com/media/abc.jpg?name=small' };
  const tiktokVideo = { resourceType: 'xhr', url: 'https://v16-webapp-prime.tiktok.com/video/tos/alisg/abc/?mime_type=video_mp4' };
  const audio = { resourceType: 'media', url: 'https://cdn.example/song.mp3' };
  assert.equal(shouldBlockMedia(image, 'no-video'), false);
  assert.equal(shouldBlockMedia(xhrImage, 'no-video'), false);
  assert.equal(shouldBlockMedia(tiktokVideo, 'no-video'), true);
  assert.equal(shouldBlockMedia(audio, 'no-video'), true);
  for (const request of [image, xhrImage, tiktokVideo, audio]) assert.equal(shouldBlockMedia(request, 'full'), false);
});

test('MediaFilter remembers the chosen mode across restarts', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'hero-media-'));
  const filter = new MediaFilter(dir);
  assert.equal(filter.getMode(), 'full');
  filter.setMode('lite');
  assert.equal(new MediaFilter(dir).getMode(), 'lite');
  filter.setMode('no-video');
  assert.equal(new MediaFilter(dir).getMode(), 'no-video');
});

test('parseCommand accepts set-media-mode only with a known mode', () => {
  assert.deepEqual(parseCommand({ action: 'set-media-mode', mode: 'lite' }), { action: 'set-media-mode', mode: 'lite' });
  assert.deepEqual(parseCommand({ action: 'set-media-mode', mode: 'no-video' }), { action: 'set-media-mode', mode: 'no-video' });
  assert.throws(() => parseCommand({ action: 'set-media-mode', mode: 'none' }));
  assert.throws(() => parseCommand({ action: 'set-media-mode' }));
});
