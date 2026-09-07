import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { BrowserProfile, ProfileSummary } from '../shared/profiles';

interface ProfileStore { version: 1; activeProfileId: string; profiles: BrowserProfile[] }
export class ProfileError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'ProfileError'; }
}
const fail = (code: string, message: string): never => { throw new ProfileError(code, message); };

export function validateProfileName(value: unknown): string {
  if (typeof value !== 'string') return fail('INVALID_PROFILE_NAME', 'Nama profil tidak valid.');
  const name = value.normalize('NFC').trim();
  if (!name || name.length > 40 || /[\u0000-\u001f\u007f]/.test(name)) {
    return fail('INVALID_PROFILE_NAME', 'Nama profil harus berisi 1–40 karakter tanpa karakter kontrol.');
  }
  return name;
}

export class ProfileManager {
  private store: ProfileStore;
  private readonly locks = new Map<string, string>();
  private readonly file: string;

  constructor(directory: string) {
    mkdirSync(directory, { recursive: true });
    this.file = path.join(directory, 'profiles.json');
    if (existsSync(this.file)) {
      try {
        if (statSync(this.file).size > 100_000) throw new Error('Oversized');
        this.store = this.validateStore(JSON.parse(readFileSync(this.file, 'utf8')) as unknown);
      } catch {
        throw new ProfileError('PROFILE_STORE_INVALID', 'Daftar profil tidak dapat dibaca. Data asli dipertahankan; periksa profiles.json sebelum membuka ulang.');
      }
    } else {
      this.store = { version: 1, activeProfileId: 'default', profiles: [
        { id: 'default', name: 'Default', createdAt: Date.now() },
        { id: 'instagram', name: 'Instagram', createdAt: Date.now() },
        { id: 'youtube', name: 'YouTube', createdAt: Date.now() },
        { id: 'research', name: 'Riset', createdAt: Date.now() },
      ] };
      this.persist(this.store);
    }
  }

  private validateStore(value: unknown): ProfileStore {
    if (!value || typeof value !== 'object') throw new Error('Invalid');
    const data = value as Record<string, unknown>;
    if (data.version !== 1 || !Array.isArray(data.profiles) || !data.profiles.length || data.profiles.length > 20) throw new Error('Invalid');
    const ids = new Set<string>();
    const names = new Set<string>();
    const profiles: BrowserProfile[] = data.profiles.map((item: unknown) => {
      if (!item || typeof item !== 'object') throw new Error('Invalid');
      const p = item as Record<string, unknown>;
      if (typeof p.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(p.id) ||
          typeof p.createdAt !== 'number' || !Number.isSafeInteger(p.createdAt) || p.createdAt < 0) throw new Error('Invalid');
      const name = validateProfileName(p.name);
      if (ids.has(p.id) || names.has(name.toLocaleLowerCase())) throw new Error('Duplicate');
      ids.add(p.id);
      names.add(name.toLocaleLowerCase());
      return { id: p.id, name, createdAt: p.createdAt };
    });
    if (!ids.has('default') || typeof data.activeProfileId !== 'string' || !ids.has(data.activeProfileId)) throw new Error('Invalid');
    return { version: 1, activeProfileId: data.activeProfileId, profiles };
  }

  private persist(next: ProfileStore): void {
    const temporary = this.file + '.' + randomUUID() + '.tmp';
    try {
      writeFileSync(temporary, JSON.stringify(next, null, 2), { encoding: 'utf8', flag: 'wx', flush: true });
      renameSync(temporary, this.file);
    } catch {
      try { unlinkSync(temporary); } catch { /* Nothing to remove if creation failed. */ }
      fail('PROFILE_STORE_WRITE_FAILED', 'Daftar profil gagal disimpan. Periksa ruang disk dan izin folder aplikasi.');
    }
  }

  get activeProfileId(): string { return this.store.activeProfileId; }
  listProfiles(): ProfileSummary[] {
    return this.store.profiles.map(p => ({ ...p, lockOwner: this.locks.get(p.id) ?? null }));
  }
  getProfile(id: string): BrowserProfile | null {
    const p = this.store.profiles.find(profile => profile.id === id);
    return p ? { ...p } : null;
  }
  requireProfile(id: string): BrowserProfile {
    return this.getProfile(id) ?? fail('PROFILE_NOT_FOUND', 'Profil tidak ditemukan.');
  }
  createProfile(value: string): BrowserProfile {
    const name = validateProfileName(value);
    if (this.store.profiles.length >= 20) return fail('PROFILE_LIMIT', 'Maksimal 20 profil.');
    if (this.store.profiles.some(p => p.name.toLocaleLowerCase() === name.toLocaleLowerCase())) return fail('PROFILE_EXISTS', 'Nama profil sudah digunakan.');
    const profile = { id: randomUUID(), name, createdAt: Date.now() };
    const next = { ...this.store, profiles: [...this.store.profiles, profile] };
    this.persist(next);
    this.store = next;
    return { ...profile };
  }
  switchProfile(id: string): void {
    this.requireProfile(id);
    const next = { ...this.store, activeProfileId: id };
    this.persist(next);
    this.store = next;
  }
  assertUnlocked(id: string): void {
    this.requireProfile(id);
    if (this.locks.has(id)) fail('PROFILE_BUSY', 'Profil sedang digunakan tugas AI.');
  }
  assertDeletable(id: string): void {
    this.assertUnlocked(id);
    if (id === 'default') fail('DEFAULT_PROFILE', 'Profil Default tidak dapat dihapus.');
  }
  deleteProfile(id: string): void {
    this.assertDeletable(id);
    const next = { ...this.store, activeProfileId: this.store.activeProfileId === id ? 'default' : this.store.activeProfileId,
      profiles: this.store.profiles.filter(p => p.id !== id) };
    this.persist(next);
    this.store = next;
  }
  lockProfile(id: string, taskId: string): void {
    this.requireProfile(id);
    if (typeof taskId !== 'string' || !taskId || taskId.length > 128) return fail('INVALID_TASK', 'Identitas tugas tidak valid.');
    const owner = this.locks.get(id);
    if (owner && owner !== taskId) return fail('PROFILE_BUSY', 'Profil sedang digunakan tugas AI lain.');
    this.locks.set(id, taskId);
  }
  unlockProfile(id: string, taskId: string): void {
    this.requireProfile(id);
    const owner = this.locks.get(id);
    if (owner && owner !== taskId) return fail('PROFILE_BUSY', 'Hanya pemilik tugas yang dapat membuka kunci profil.');
    this.locks.delete(id);
  }
}
