import { dialog } from 'electron';
import type { BrowserWindow } from 'electron';
import type { BrowserManager } from './browser-manager';
import type { ProfileManager } from './profile-manager';
import type { SessionManager } from './session-manager';
import type { TaskManager } from './task-manager';
import type { BrowserCommand } from '../shared/types';

export interface UiCommandContext { window: BrowserWindow; profiles: ProfileManager; sessions: SessionManager; tasks: TaskManager }

/** Executes a command from the browser UI; destructive ones ask the human first. */
export async function handleCommand(ctx: UiCommandContext, browser: BrowserManager, command: BrowserCommand): Promise<void> {
  const { profiles, sessions, tasks } = ctx;

  if (command.action === 'open-google') {
    browser.newTab();
    browser.execute({ action: 'navigate', input: 'https://mail.google.com/' });
    return;
  }
  if (command.action === 'share-session') {
    const plan = profiles.planShareSession(profiles.activeProfileId, command.targetIds);
    const source = profiles.requireProfile(plan.sourceId);
    const names = plan.targetIds.map(id => profiles.requireProfile(id).name).join(', ');
    const result = await dialog.showMessageBox(ctx.window, {
      type: 'question', title: 'Share sesi', message: 'Gunakan sesi “' + source.name + '” bersama?',
      detail: 'Profil tujuan: ' + names + '.\n\nSemua login situs dan perubahan logout akan digunakan bersama. Tab tujuan ditutup; simpan pekerjaan terlebih dahulu. Sesi pribadi tujuan tetap tersimpan dan bisa dipakai kembali setelah berbagi dihentikan.',
      buttons: ['Batal', 'Share sesi'], defaultId: 0, cancelId: 0, noLink: true,
    });
    if (result.response === 1) await browser.changeSharedSession(() => profiles.shareSession(plan.sourceId, plan.targetIds));
    return;
  }
  if (command.action === 'stop-sharing') {
    const changed = profiles.planStopSharing(profiles.activeProfileId);
    if (!changed.length) throw new Error('Profil ini belum berbagi sesi.');
    const names = changed.map(id => profiles.requireProfile(id).name).join(', ');
    const result = await dialog.showMessageBox(ctx.window, {
      type: 'question', title: 'Hentikan berbagi', message: 'Kembali memakai sesi pribadi?',
      detail: 'Profil: ' + names + '. Tab profil ini akan ditutup. Sesi pribadi sebelumnya akan digunakan kembali; login dari sesi bersama tidak disalin.',
      buttons: ['Batal', 'Hentikan berbagi'], defaultId: 0, cancelId: 0, noLink: true,
    });
    if (result.response === 1) await browser.changeSharedSession(() => profiles.stopSharing(profiles.activeProfileId));
    return;
  }

  if (command.action === 'resume-human-intervention') {
    tasks.resumeHumanIntervention(command.taskId);
    return;
  }
  if (command.action === 'create-profile') { browser.createProfile(command.name); return; }
  if (command.action === 'switch-profile') { browser.switchProfile(command.profileId); return; }
  if (command.action === 'clear-site-data') {
    const profile = profiles.requireProfile(command.profileId);
    const result = await dialog.showMessageBox(ctx.window, {
      type: 'warning', title: 'Hapus data situs', message: 'Hapus data ' + command.domain + ' di profil “' + profile.name + '”?',
      detail: 'Cookie, penyimpanan lokal, IndexedDB, dan cache situs ini (termasuk subdomainnya) dihapus dari profil ini saja. Anda akan keluar (logout) dari situs tersebut dan perlu login ulang. Situs lain dan profil lain tidak terpengaruh.',
      buttons: ['Batal', 'Hapus data situs'], defaultId: 0, cancelId: 0, noLink: true,
    });
    if (result.response === 1) await browser.clearSiteData(command.profileId, command.domain);
    return;
  }
  if (command.action === 'set-session-cookies') { profiles.setPersistSessionCookies(command.profileId, command.enabled); browser.emitState(); return; }
  if (command.action === 'set-stealth') { browser.setStealth(command.profileId, command.enabled); return; }
  if (command.action === 'set-media-mode') { await browser.setMediaMode(command.mode); return; }
  if (command.action === 'rename-profile') { browser.renameProfile(command.profileId, command.name); return; }
  if (command.action === 'duplicate-profile') {
    // The copy is an independent profile; switch to it so the human sees the result.
    await browser.duplicateProfile(command.profileId, { name: command.name, copyLogin: command.copyLogin, switchTo: true });
    return;
  }
  if (command.action === 'save-session') { await sessions.flush(); return; }
  if (command.action === 'delete-profile') {
    profiles.assertDeletable(command.profileId);
    const profile = profiles.requireProfile(command.profileId);
    const result = await dialog.showMessageBox(ctx.window, {
      type: 'warning', title: 'Hapus profil', message: 'Hapus profil “' + profile.name + '”?',
      detail: profile.sharedWith ? 'Tab dan sesi pribadi profil ini akan dihapus. Sesi bersama milik profil sumber tetap tersedia.' : 'Semua tab, login, cookie, dan data situs di profil ini akan dihapus dari perangkat. Profil lain tetap tersedia.',
      buttons: ['Batal', 'Hapus profil'], defaultId: 0, cancelId: 0, noLink: true,
    });
    if (result.response === 1) await browser.deleteProfile(command.profileId);
    return;
  }
  browser.execute(command);
}

