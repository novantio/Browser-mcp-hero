import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { normalizeCertHost } from '../shared/navigation';

interface TrustStoreShape { version: 1; hosts: string[] }

/**
 * Persists the set of hosts whose TLS certificate the user has explicitly chosen
 * to trust (the browser's "Proceed" on a certificate warning). Decisions survive
 * restarts, mirroring a browser's remembered exception, and are stored atomically
 * next to the app's other data.
 */
export class CertificateTrustStore {
  private readonly file: string;
  private hosts: Set<string>;

  constructor(directory: string) {
    mkdirSync(directory, { recursive: true });
    this.file = path.join(directory, 'trusted-certificates.json');
    this.hosts = this.load();
  }

  private load(): Set<string> {
    if (!existsSync(this.file)) return new Set();
    try {
      if (statSync(this.file).size > 100_000) throw new Error('Oversized');
      const data = JSON.parse(readFileSync(this.file, 'utf8')) as unknown;
      if (!data || typeof data !== 'object') throw new Error('Invalid');
      const raw = (data as Record<string, unknown>).hosts;
      if (!Array.isArray(raw)) throw new Error('Invalid');
      const hosts = raw.filter((item): item is string => typeof item === 'string')
        .map(normalizeCertHost).filter(Boolean);
      return new Set(hosts);
    } catch {
      // Corrupt file: start clean but keep the original for inspection.
      return new Set();
    }
  }

  private persist(): void {
    const payload: TrustStoreShape = { version: 1, hosts: [...this.hosts].sort() };
    const temporary = this.file + '.' + randomUUID() + '.tmp';
    try {
      writeFileSync(temporary, JSON.stringify(payload, null, 2), { encoding: 'utf8', flag: 'wx', flush: true });
      renameSync(temporary, this.file);
    } catch {
      try { unlinkSync(temporary); } catch { /* Nothing to remove if creation failed. */ }
    }
  }

  has(host: string): boolean {
    return this.hosts.has(normalizeCertHost(host));
  }

  get size(): number { return this.hosts.size; }

  list(): string[] { return [...this.hosts].sort(); }

  add(host: string): boolean {
    const entry = normalizeCertHost(host);
    if (!entry || this.hosts.has(entry)) return false;
    this.hosts.add(entry);
    this.persist();
    return true;
  }

  remove(host: string): boolean {
    const entry = normalizeCertHost(host);
    if (!entry || !this.hosts.delete(entry)) return false;
    this.persist();
    return true;
  }

  clear(): void {
    if (this.hosts.size === 0) return;
    this.hosts.clear();
    this.persist();
  }
}
