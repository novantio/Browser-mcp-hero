import { randomUUID } from 'node:crypto';
import type { Recording, WorkflowStep, ExtractionSpec, Job } from '../../shared/data-contracts';
import { DataStore } from './store';
import { BrowserManager } from '../browser-manager';
import { ProfileManager } from '../profile-manager';
import type { JobRunner } from './job-runner';
import { isWebUrl } from '../../shared/navigation';
import { RpcError } from '../../shared/rpc-error';

export class InteractionRecorder {
  private currentRecording: Recording | null = null;
  private activeCleanups: Array<() => void> = [];

  constructor(
    private readonly store: DataStore,
    private readonly browser: BrowserManager,
    private readonly profiles: ProfileManager,
    private jobRunner: JobRunner | null = null,
  ) {}

  setJobRunner(runner: JobRunner): void {
    this.jobRunner = runner;
  }

  async start(name: string): Promise<Recording> {
    if (this.currentRecording) {
      await this.stop();
    }

    const recording: Recording = {
      id: randomUUID(),
      name,
      profileId: this.profiles.activeProfileId,
      steps: [],
      status: 'recording',
      createdAt: Date.now(),
      omitted: 0,
    };
    this.currentRecording = recording;

    const contents = this.browser.getActiveWebContents();
    const currentUrl = contents.getURL();
    if (currentUrl && isWebUrl(currentUrl)) {
      recording.steps.push({ action: 'navigate', url: currentUrl });
    }

    const onNavigate = (_event: unknown, url: string) => {
      if (this.currentRecording && isWebUrl(url)) {
        this.currentRecording.steps.push({ action: 'navigate', url });
        this.store.put('recording', this.currentRecording.id, this.currentRecording);
      }
    };
    contents.on('did-navigate', onNavigate);
    this.activeCleanups.push(() => contents.off('did-navigate', onNavigate));

    const injectScript = async () => {
      await contents.executeJavaScript(`
        (() => {
          if (window.__HERO_RECORDER_ACTIVE__) return;
          window.__HERO_RECORDER_ACTIVE__ = true;
          window.__HERO_RECORDER_BUFFER__ = [];

          document.addEventListener('click', (e) => {
            const el = e.target;
            if (!el) return;
            let selector = '';
            if (el.id) selector = '#' + el.id;
            else if (el.getAttribute && el.getAttribute('data-testid')) selector = '[data-testid="' + el.getAttribute('data-testid') + '"]';
            else if (el.getAttribute && el.getAttribute('aria-label')) selector = '[aria-label="' + el.getAttribute('aria-label') + '"]';
            else if (el.name) selector = el.tagName.toLowerCase() + '[name="' + el.name + '"]';
            else if (el.className && typeof el.className === 'string' && el.className.trim()) {
              selector = el.tagName.toLowerCase() + '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.');
            } else {
              selector = el.tagName.toLowerCase();
            }
            window.__HERO_RECORDER_BUFFER__.push({ action: 'click', selector });
          }, true);

          document.addEventListener('change', (e) => {
            const el = e.target;
            if (!el || !('value' in el)) return;
            const isSensitive = el.type === 'password' || /password|secret|token|cvv|credit|pin/i.test(el.name || el.id || '');
            let selector = el.id ? '#' + el.id : (el.name ? el.tagName.toLowerCase() + '[name="' + el.name + '"]' : el.tagName.toLowerCase());
            if (isSensitive) {
              window.__HERO_RECORDER_BUFFER__.push({ action: 'type_omitted', selector });
            } else {
              window.__HERO_RECORDER_BUFFER__.push({ action: 'type', selector, text: String(el.value || '').slice(0, 2000) });
            }
          }, true);

          let scrollTimer;
          window.addEventListener('scroll', () => {
            clearTimeout(scrollTimer);
            scrollTimer = setTimeout(() => {
              const y = window.scrollY;
              window.__HERO_RECORDER_BUFFER__.push({ action: 'scroll', direction: 'down', amount: Math.min(Math.max(Math.round(y), 100), 10000) });
            }, 300);
          }, { passive: true });
        })()
      `).catch(() => {});
    };

    void injectScript();
    const onDidFinishLoad = () => { void injectScript(); };
    contents.on('did-finish-load', onDidFinishLoad);
    this.activeCleanups.push(() => contents.off('did-finish-load', onDidFinishLoad));

    this.store.put('recording', recording.id, recording);
    return recording;
  }

  async stop(): Promise<Recording> {
    if (!this.currentRecording) {
      const last = this.list().find(r => r.status === 'recording');
      if (last) {
        last.status = 'stopped';
        this.store.put('recording', last.id, last);
        return last;
      }
      throw new RpcError('RECORDER_NOT_ACTIVE', 'Tidak ada perekaman yang sedang berjalan.');
    }

    const recording = this.currentRecording;
    this.currentRecording = null;

    for (const cleanup of this.activeCleanups) cleanup();
    this.activeCleanups = [];

    try {
      const contents = this.browser.getActiveWebContents();
      const buffered = await contents.executeJavaScript(`
        (() => {
          const buf = window.__HERO_RECORDER_BUFFER__ || [];
          window.__HERO_RECORDER_BUFFER__ = [];
          return buf;
        })()
      `).catch(() => []) as Array<{ action: string; selector?: string; text?: string; direction?: 'up' | 'down' | 'top' | 'bottom'; amount?: number }>;

      for (const item of buffered) {
        if (item.action === 'type_omitted') {
          recording.omitted++;
        } else if (item.action === 'click' && item.selector) {
          recording.steps.push({ action: 'click', selector: item.selector });
        } else if (item.action === 'type' && item.selector) {
          recording.steps.push({ action: 'type', selector: item.selector, text: item.text || '' });
        } else if (item.action === 'scroll') {
          recording.steps.push({ action: 'scroll', direction: item.direction || 'down', amount: item.amount || 500 });
        }
      }
    } catch {
      // Best effort recovery of buffered DOM actions
    }

    recording.status = 'stopped';
    this.store.put('recording', recording.id, recording);
    return recording;
  }

  list(): Recording[] {
    return this.store.list<Recording>('recording');
  }

  update(recordingId: string, steps: WorkflowStep[]): Recording {
    const recording = this.store.get<Recording>('recording', recordingId);
    recording.steps = steps;
    this.store.put('recording', recording.id, recording);
    return recording;
  }

  convert(recordingId: string, schema: ExtractionSpec, name: string, intervalMinutes: number | null): Job {
    if (!this.jobRunner) throw new RpcError('INTERNAL_ERROR', 'JobRunner belum siap.');
    const recording = this.store.get<Recording>('recording', recordingId);

    const nav = recording.steps.find(s => s.action === 'navigate');
    const targetUrl = (nav && 'url' in nav ? nav.url : '') || 'https://example.com';

    const steps = [...recording.steps];
    if (!steps.some(s => s.action === 'extract')) {
      steps.push({ action: 'extract' });
    }

    return this.jobRunner.createJob({
      name,
      profileId: recording.profileId,
      targets: [targetUrl],
      schema,
      steps,
      intervalMinutes,
      topic: '',
      sourceType: 'web',
      captureScreenshot: false,
    });
  }
}
