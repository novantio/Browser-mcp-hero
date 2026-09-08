/**
 * Stealth anti-bot evasion module for Hero Browser.
 * Disguises automation fingerprints to prevent false positives on Google, Cloudflare, Twitter, etc.
 */
export const STEALTH_SCRIPT = `
(() => {
  try {
    // 1. Cloak navigator.webdriver
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
      configurable: true,
    });
    try {
      delete Object.getPrototypeOf(navigator).webdriver;
    } catch {}

    // 2. Mock realistic window.chrome runtime
    if (!window.chrome) {
      window.chrome = {};
    }
    if (!window.chrome.runtime) {
      window.chrome.runtime = {
        connect: function() {},
        sendMessage: function() {},
        id: undefined,
      };
    }
    if (!window.chrome.loadTimes) {
      window.chrome.loadTimes = function() {
        return {
          requestTime: Date.now() / 1000,
          startLoadTime: Date.now() / 1000,
          commitLoadTime: Date.now() / 1000,
          finishDocumentLoadTime: Date.now() / 1000,
          finishLoadTime: Date.now() / 1000,
          firstPaintTime: Date.now() / 1000,
          firstPaintAfterLoadTime: 0,
          navigationType: 'Other',
          wasFetchedViaSpdy: false,
          wasNpnNegotiated: false,
          npnNegotiatedProtocol: '',
          wasAlternateProtocolAvailable: false,
          connectionInfo: 'http/1.1',
        };
      };
    }
    if (!window.chrome.csi) {
      window.chrome.csi = function() {
        return {
          startE: Date.now(),
          onloadT: Date.now(),
          pageT: 100,
          tran: 15,
        };
      };
    }

    // 3. Mock navigator.plugins and mimeTypes
    const pluginData = [
      { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      { name: 'Microsoft Edge PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      { name: 'WebKit built-in PDF', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
    ];
    const mimeTypeData = [
      { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
      { type: 'text/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
    ];

    try {
      Object.defineProperty(navigator, 'plugins', {
        get: () => pluginData,
        configurable: true,
      });
      Object.defineProperty(navigator, 'mimeTypes', {
        get: () => mimeTypeData,
        configurable: true,
      });
    } catch {}

    // 4. Mock navigator.languages
    try {
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en', 'id'],
        configurable: true,
      });
    } catch {}

    // 5. Mock navigator.permissions.query for notifications
    if (navigator.permissions && navigator.permissions.query) {
      const origQuery = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = (param) => {
        if (param && param.name === 'notifications') {
          return Promise.resolve({
            state: typeof Notification !== 'undefined' && Notification.permission === 'granted' ? 'granted' : 'prompt',
            onchange: null,
          });
        }
        return origQuery(param);
      };
    }
  } catch {}
})();
`;
