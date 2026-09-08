import { randomUUID } from 'node:crypto';
import type { AutomationTask, HumanInterventionRequest } from '../shared/types';
import type { ProfileManager } from './profile-manager';
import { RpcError } from '../shared/rpc-error';

export interface HumanInterventionOptions { reason: string; message: string; timeoutMs?: number }
export interface HumanRequired {
  status: 'human_required'; reason: string; message: string; taskId: string; resumeToken: string;
}

export class TaskManager {
  private readonly tasks = new Map<string, AutomationTask>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly interventions = new Map<string, { token: string; timer: ReturnType<typeof setTimeout> }>();
  private onInterventionListener?: (request: HumanInterventionRequest | null) => void;
  private onChange?: () => void;
  private sweepTimer?: ReturnType<typeof setInterval>;

  constructor(private readonly profiles: ProfileManager) {
    this.sweepTimer = setInterval(() => this.sweepExpiredTasks(), 3000);
    if (this.sweepTimer.unref) this.sweepTimer.unref();
  }

  setChangeListener(listener: () => void): void { this.onChange = listener; }
  setInterventionListener(listener: (request: HumanInterventionRequest | null) => void): void {
    this.onInterventionListener = listener;
    this.publish();
  }
  private publish(): void {
    const task = [...this.tasks.values()].find(t => t.status === 'WAITING_FOR_HUMAN');
    this.onInterventionListener?.(task?.intervention ? {
      taskId: task.id, profileId: task.profileId, reason: task.intervention.reason, message: task.intervention.message,
    } : null);
    this.onChange?.();
  }
  private requireTask(id: string): AutomationTask {
    const task = this.tasks.get(id);
    if (!task) throw new RpcError('TASK_NOT_FOUND', 'Tugas tidak ditemukan.');
    return task;
  }
  createTask(profileId: string, customId?: string, ttlSeconds = 120): AutomationTask {
    const id = customId || randomUUID();
    if (this.tasks.has(id)) throw new RpcError('TASK_EXISTS', 'ID tugas sudah digunakan.');
    if (this.tasks.size >= 500) {
      const terminal = [...this.tasks.values()].find(t => ['COMPLETED', 'FAILED', 'CANCELLED'].includes(t.status));
      if (!terminal) throw new RpcError('TASK_LIMIT', 'Terlalu banyak tugas aktif.');
      this.tasks.delete(terminal.id);
    }
    this.profiles.lockProfile(profileId, id);
    const now = Date.now();
    const ttlMs = ttlSeconds > 0 ? ttlSeconds * 1000 : 0;
    this.tasks.set(id, { id, profileId, status: 'RUNNING', createdAt: now, updatedAt: now, ttlMs });
    this.controllers.set(id, new AbortController());
    this.publish();
    return this.getTask(id)!;
  }
  touchTask(id: string): void {
    const task = this.tasks.get(id);
    if (task && task.status === 'RUNNING') {
      task.updatedAt = Date.now();
    }
  }
  forceUnlockProfile(profileId: string): void {
    const owner = this.profiles.getLockOwner(profileId);
    if (owner && this.tasks.has(owner)) {
      const task = this.tasks.get(owner)!;
      if (['RUNNING', 'PAUSED', 'WAITING_FOR_HUMAN'].includes(task.status)) {
        this.cancelTask(owner);
        return;
      }
    }
    this.profiles.forceUnlock(profileId);
  }
  sweepExpiredTasks(): void {
    const now = Date.now();
    for (const task of this.tasks.values()) {
      if (task.status === 'RUNNING' && task.ttlMs && task.ttlMs > 0) {
        if (now - task.updatedAt > task.ttlMs) {
          try {
            this.failTask(task.id, 'Waktu tunggu inaktivitas tugas habis (inactivity timeout).');
          } catch {
            // Task might have already finished
          }
        }
      }
    }
  }
  getTask(id: string): AutomationTask | null {
    const task = this.tasks.get(id);
    return task ? structuredClone(task) : null;
  }
  listTasks(): AutomationTask[] { return [...this.tasks.keys()].map(id => this.getTask(id)!); }
  assertRunnable(id: string): AutomationTask {
    const task = this.requireTask(id);
    if (task.status !== 'RUNNING') throw new RpcError('TASK_NOT_RUNNING', 'Tugas dijeda atau sudah berakhir.');
    if (this.profiles.getLockOwner(task.profileId) !== id) throw new RpcError('TASK_NOT_OWNER', 'Tugas tidak memiliki sesi ini.');
    task.updatedAt = Date.now();
    return this.getTask(id)!;
  }
  signal(id: string): AbortSignal { this.assertRunnable(id); return this.controllers.get(id)!.signal; }
  private clearIntervention(id: string): void {
    const pending = this.interventions.get(id);
    if (pending) clearTimeout(pending.timer);
    this.interventions.delete(id);
  }
  private suspend(id: string, status: 'PAUSED' | 'WAITING_FOR_HUMAN'): AutomationTask {
    this.assertRunnable(id);
    const task = this.requireTask(id);
    task.status = status; task.updatedAt = Date.now();
    this.controllers.get(id)?.abort(new RpcError('TASK_PAUSED', 'Tugas dijeda.'));
    return task;
  }
  pauseTask(id: string): AutomationTask {
    this.suspend(id, 'PAUSED'); this.publish(); return this.getTask(id)!;
  }
  requestHumanIntervention(id: string, options: HumanInterventionOptions): HumanRequired {
    const task = this.suspend(id, 'WAITING_FOR_HUMAN');
    task.intervention = { reason: options.reason, message: options.message, requestedAt: Date.now() };
    const token = randomUUID();
    const timer = setTimeout(() => this.failTask(id, 'Waktu tunggu tindakan manusia habis.'),
      Math.min(Math.max(options.timeoutMs ?? 300000, 5000), 1800000));
    this.interventions.set(id, { token, timer });
    this.publish();
    return { status: 'human_required', taskId: id, reason: options.reason, message: options.message, resumeToken: token };
  }
  resumeTask(id: string, token?: string, trustedHuman = false): AutomationTask {
    const task = this.requireTask(id);
    if (!['PAUSED', 'WAITING_FOR_HUMAN'].includes(task.status))
      throw new RpcError('INVALID_TASK_STATE', 'Hanya tugas yang dijeda dapat dilanjutkan.');
    if (task.status === 'WAITING_FOR_HUMAN' && !trustedHuman && token !== this.interventions.get(id)?.token)
      throw new RpcError('INVALID_RESUME_TOKEN', 'Token untuk melanjutkan tidak valid.');
    this.profiles.lockProfile(task.profileId, id);
    this.clearIntervention(id);
    task.status = 'RUNNING'; task.updatedAt = Date.now(); delete task.intervention;
    this.controllers.set(id, new AbortController()); this.publish();
    return this.getTask(id)!;
  }
  // Only trusted shell IPC calls this method; MCP must provide a resume token.
  resumeHumanIntervention(id: string): boolean {
    if (this.getTask(id)?.status !== 'WAITING_FOR_HUMAN') return false;
    this.resumeTask(id, undefined, true); return true;
  }
  private finish(id: string, status: 'COMPLETED' | 'FAILED' | 'CANCELLED', error?: string): void {
    const task = this.requireTask(id);
    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(task.status))
      throw new RpcError('INVALID_TASK_STATE', 'Tugas sudah berakhir.');
    this.clearIntervention(id);
    task.status = status; task.updatedAt = Date.now(); delete task.intervention;
    if (error) task.error = error;
    this.controllers.get(id)?.abort(new RpcError('TASK_ENDED', 'Tugas sudah berakhir.'));
    this.controllers.delete(id);
    this.profiles.unlockProfile(task.profileId, id);
    this.publish();
  }
  completeTask(id: string): void { this.finish(id, 'COMPLETED'); }
  failTask(id: string, error: string): void { this.finish(id, 'FAILED', error); }
  cancelTask(id: string): void { this.finish(id, 'CANCELLED'); }
  dispose(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = undefined;
    }
    for (const task of this.listTasks()) {
      if (['RUNNING', 'PAUSED', 'WAITING_FOR_HUMAN'].includes(task.status)) this.cancelTask(task.id);
    }
  }
}
