import { command, reportBounds } from './app-state.js';

/** Banner shown when an AI task needs the human (CAPTCHA, login, MFA). */
export function setupIntervention(): void {
  let activeInterventionTaskId: string | null = null;
  const banner = document.getElementById('intervention-banner') as HTMLDivElement | null;
  const bannerTitle = document.getElementById('intervention-title') as HTMLElement | null;
  const bannerMessage = document.getElementById('intervention-message') as HTMLElement | null;
  const bannerButton = document.getElementById('intervention-resume') as HTMLButtonElement | null;
  
  if (banner && bannerButton) {
    bannerButton.addEventListener('click', () => {
      if (activeInterventionTaskId) {
        void command({ action: 'resume-human-intervention', taskId: activeInterventionTaskId });
      }
    });
  
    window.browser.onHumanIntervention(req => {
      if (req) {
        activeInterventionTaskId = req.taskId;
        const isCaptcha = (req.reason || '').toLowerCase().includes('captcha') || (req.message || '').toLowerCase().includes('captcha');
        const icon = banner.querySelector('.intervention-icon') as HTMLElement | null;
        if (icon) icon.textContent = isCaptcha ? '🧩' : '🤖';
        if (bannerTitle) bannerTitle.textContent = req.reason || 'Tindakan Manusia Diperlukan';
        if (bannerMessage) bannerMessage.textContent = req.message || 'Selesaikan tindakan di browser lalu klik tombol lanjutkan.';
        banner.hidden = false;
      } else {
        activeInterventionTaskId = null;
        banner.hidden = true;
      }
      reportBounds();
    });
  }
}
