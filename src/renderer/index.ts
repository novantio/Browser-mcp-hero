import type { BrowserState } from '../shared/types.js';
import { setupDataWorkspace, refreshDataView } from './data-workspace.js';
import { app, reportBounds } from './app-state.js';
import { showError } from './dom.js';
import { setupPanel, togglePanel } from './panel.js';
import { renderProfiles, setupProfileControls } from './profiles-ui.js';
import { openProfilesModal, renderProfilesModal, setupProfilesModal } from './profiles-modal.js';
import { focusAddress, renderTabs, setupNavigation } from './tabs-ui.js';
import { renderStatus, setupEngineControls } from './status-ui.js';
import { setupIntervention } from './intervention.js';
import { setupActivityFeed } from './activity.js';
import { setupMcpConfigModal } from './mcp-modal.js';

/** Renderer entry point: wires the UI modules to state pushed by the main process. */
function render(state: BrowserState): void {
  renderStatus(state);
  const previousId = app.current?.activeTabId;
  const previousProfileId = app.current?.activeProfileId;
  app.current = state;
  renderProfiles(state, previousProfileId);
  renderProfilesModal(state);
  renderTabs(state, previousId);
}

setupPanel();
setupNavigation(togglePanel);
setupProfileControls();
setupProfilesModal();
setupEngineControls(render);
setupIntervention();
setupActivityFeed();
setupDataWorkspace();
setupMcpConfigModal();

new ResizeObserver(reportBounds).observe(document.getElementById('browser-surface')!);
window.browser.onState(render);
window.browser.onFocusAddress(focusAddress);
window.browser.onMenuAction?.(action => {
  if (action === 'toggle-panel') togglePanel();
  if (action === 'manage-profiles') openProfilesModal();
});

void window.browser.getState().then(state => {
  if (!app.current) render(state);
  void refreshDataView();
}).catch(() => showError('Browser tidak dapat dimulai. Buka ulang aplikasi.'));
