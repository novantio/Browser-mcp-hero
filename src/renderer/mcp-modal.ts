import { element, showToast } from './dom.js';

/** Dialog that shows and copies the MCP client configuration. */
export function setupMcpConfigModal(): void {
  const modal = element('mcp-modal');
  const codeDisplay = element('mcp-code-display');

  const btnOpenMenu = document.getElementById('btn-mcp-menu') as HTMLElement | null;
  const btnOpenSide = document.getElementById('btn-open-mcp-modal') as HTMLElement | null;
  const btnClose = document.getElementById('close-mcp-modal') as HTMLElement | null;
  const btnDone = document.getElementById('btn-done-mcp-modal') as HTMLElement | null;
  const codeFilename = document.getElementById('mcp-config-filename') as HTMLElement | null;
  const configLocation = document.getElementById('mcp-config-location') as HTMLElement | null;
  const btnCopy = document.getElementById('btn-copy-mcp-config') as HTMLButtonElement | null;
  const copyText = document.getElementById('copy-text') as HTMLElement | null;
  const copyIcon = document.getElementById('copy-icon') as HTMLElement | null;

  const tabClaude = document.getElementById('tab-client-claude') as HTMLElement | null;
  const tabAntigravity = document.getElementById('tab-client-antigravity') as HTMLElement | null;
  const tabCli = document.getElementById('tab-client-cli') as HTMLElement | null;

  type ClientMode = 'claude' | 'antigravity' | 'cli';
  let activeMode: ClientMode = 'claude';
  let mcpConfigData: any = null;

  const defaultClaude = {
    mcpServers: {
      'hero-browser': {
        command: 'node',
        args: ['D:/project/node/2026/Browser-mcp-hero/dist/mcp/index.js'],
      },
    },
  };

  const defaultAntigravity = {
    'hero-browser': {
      command: 'node',
      args: ['D:/project/node/2026/Browser-mcp-hero/dist/mcp/index.js'],
    },
  };

  function updateDisplay(): void {
    if (!codeDisplay) return;
    if (activeMode === 'claude') {
      const cfg = mcpConfigData?.claudeDesktopConfig || defaultClaude;
      codeDisplay.textContent = JSON.stringify(cfg, null, 2);
      if (codeFilename) codeFilename.textContent = 'claude_desktop_config.json / .cursor/mcp.json';
      if (configLocation) configLocation.textContent = '%APPDATA%\\Claude\\claude_desktop_config.json  |  .cursor/mcp.json';
    } else if (activeMode === 'antigravity') {
      const cfg = mcpConfigData?.geminiAntigravityConfig || defaultAntigravity;
      codeDisplay.textContent = JSON.stringify(cfg, null, 2);
      if (codeFilename) codeFilename.textContent = 'mcp_config.json (Antigravity IDE / Gemini CLI)';
      if (configLocation) configLocation.textContent = '~/.gemini/antigravity-ide/mcp_config.json';
    } else {
      const script = mcpConfigData?.mcpScriptPath || 'D:/project/node/2026/Browser-mcp-hero/dist/mcp/index.js';
      codeDisplay.textContent = `node "${script}"`;
      if (codeFilename) codeFilename.textContent = 'Command CLI';
      if (configLocation) configLocation.textContent = 'Jalankan langsung di terminal atau subproses AI Agent';
    }

    tabClaude?.classList.toggle('active', activeMode === 'claude');
    tabAntigravity?.classList.toggle('active', activeMode === 'antigravity');
    tabCli?.classList.toggle('active', activeMode === 'cli');
  }

  async function openModal(): Promise<void> {
    try {
      if (window.browser.getMcpConfig) {
        mcpConfigData = await window.browser.getMcpConfig();
      }
    } catch {}
    updateDisplay();
    modal.hidden = false;
  }

  function closeModal(): void {
    modal.hidden = true;
  }

  btnOpenMenu?.addEventListener('click', openModal);
  btnOpenSide?.addEventListener('click', openModal);
  btnClose?.addEventListener('click', closeModal);
  btnDone?.addEventListener('click', closeModal);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) {
      closeModal();
    }
  });

  if (window.browser.onOpenMcpModal) {
    window.browser.onOpenMcpModal(() => {
      void openModal();
    });
  }

  tabClaude?.addEventListener('click', () => {
    activeMode = 'claude';
    updateDisplay();
  });
  tabAntigravity?.addEventListener('click', () => {
    activeMode = 'antigravity';
    updateDisplay();
  });
  tabCli?.addEventListener('click', () => {
    activeMode = 'cli';
    updateDisplay();
  });

  btnCopy?.addEventListener('click', async () => {
    const textToCopy = codeDisplay.textContent || '';
    try {
      if (window.browser.copyToClipboard) {
        await window.browser.copyToClipboard(textToCopy);
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(textToCopy);
      }
    } catch {
      try {
        await navigator.clipboard.writeText(textToCopy);
      } catch {}
    }

    if (btnCopy && copyText && copyIcon) {
      btnCopy.classList.add('copied');
      copyText.textContent = 'Tersalin!';
      copyIcon.textContent = '✓';
      showToast('Konfigurasi MCP berhasil disalin ke clipboard!');
      setTimeout(() => {
        btnCopy.classList.remove('copied');
        copyText.textContent = 'Salin JSON';
        copyIcon.textContent = '📋';
      }, 2500);
    }
  });
}
