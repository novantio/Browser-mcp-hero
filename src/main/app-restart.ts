import { app } from 'electron';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';

/**
 * Rebuild and relaunch through scripts/start.cjs so code changes and the selected engine
 * apply. The helper waits for this process to exit first, otherwise the single-instance
 * lock would make the new instance quit immediately.
 */
export function restartApp(): void {
  const startScript = path.join(app.getAppPath(), 'scripts/start.cjs');
  if (app.isPackaged || !existsSync(startScript)) { app.relaunch(); app.quit(); return; }
  const env: NodeJS.ProcessEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1', HERO_WAIT_FOR_PID: String(process.pid) };
  const child = spawn(process.execPath, [startScript, ...process.argv.slice(2)], {
    cwd: app.getAppPath(), detached: true, stdio: 'ignore', windowsHide: true, env,
  });
  child.on('error', () => { app.relaunch(); app.quit(); });
  child.unref();
  app.quit();
  setTimeout(() => app.exit(0), 5000).unref();
}
