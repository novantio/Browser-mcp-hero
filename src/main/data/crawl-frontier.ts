import { randomUUID } from 'node:crypto';
import type { FrontierItem } from '../../shared/data-contracts';

export class CrawlFrontier {
  private readonly queue: FrontierItem[] = [];
  private readonly visited = new Set<string>();
  private readonly failed = new Map<string, { retries: number; error: string }>();
  private readonly maxRetries = 3;

  push(urls: string[], depth = 0, priority = 50): { added: number; totalQueued: number } {
    let added = 0;
    for (const rawUrl of urls) {
      const clean = this.normalizeUrl(rawUrl);
      if (!clean || this.visited.has(clean)) continue;
      if (this.queue.some(item => item.url === clean)) continue;

      let domain = '';
      try { domain = new URL(clean).hostname; } catch { continue; }

      this.queue.push({
        id: randomUUID(),
        url: clean,
        domain,
        depth,
        priority,
        status: 'queued',
        retries: 0,
        discoveredAt: new Date().toISOString(),
      });
      added++;
    }

    // Urutkan berdasarkan priority (tertinggi lebih dulu), lalu depth (terendah lebih dulu)
    this.queue.sort((a, b) => b.priority - a.priority || a.depth - b.depth);
    return { added, totalQueued: this.queue.length };
  }

  popBatch(limit = 10): FrontierItem[] {
    const batch = this.queue.splice(0, Math.min(limit, this.queue.length));
    for (const item of batch) {
      item.status = 'visited';
      this.visited.add(item.url);
    }
    return batch;
  }

  markVisited(url: string): void {
    const clean = this.normalizeUrl(url);
    this.visited.add(clean);
  }

  markFailed(url: string, error: string): void {
    const clean = this.normalizeUrl(url);
    const prev = this.failed.get(clean) || { retries: 0, error };
    const retries = prev.retries + 1;
    this.failed.set(clean, { retries, error });

    if (retries <= this.maxRetries) {
      // Re-queue with lower priority
      let domain = '';
      try { domain = new URL(clean).hostname; } catch {}
      this.queue.push({
        id: randomUUID(),
        url: clean,
        domain,
        depth: 0,
        priority: 20,
        status: 'queued',
        retries,
        discoveredAt: new Date().toISOString(),
        lastAttemptAt: new Date().toISOString(),
        error,
      });
    }
  }

  getStats(): { queued: number; visited: number; failed: number; domains: Record<string, number> } {
    const domains: Record<string, number> = {};
    for (const q of this.queue) {
      domains[q.domain] = (domains[q.domain] || 0) + 1;
    }
    return {
      queued: this.queue.length,
      visited: this.visited.size,
      failed: this.failed.size,
      domains,
    };
  }

  private normalizeUrl(url: string): string {
    try {
      const u = new URL(url.trim());
      u.hash = '';
      return u.href;
    } catch {
      return '';
    }
  }
}
