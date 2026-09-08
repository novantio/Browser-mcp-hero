export interface RateLimitStatus {
  allowed: boolean;
  waitMs: number;
  reason?: string;
}

export class RateLimiter {
  private readonly domainHistory = new Map<string, number[]>(); // domain -> timestamps
  private readonly cooldowns = new Map<string, { until: number; retries: number; reason: string }>();
  private readonly defaultRpm: number;

  constructor(rpm = 30) {
    this.defaultRpm = rpm;
  }

  checkLimit(domain: string): RateLimitStatus {
    const d = domain.toLowerCase();
    const now = Date.now();

    // 1. Cek apakah domain sedang dalam masa cooldown / backoff
    const cd = this.cooldowns.get(d);
    if (cd && now < cd.until) {
      const remaining = cd.until - now;
      return {
        allowed: false,
        waitMs: remaining,
        reason: `Rate limit aktif (${cd.reason}). Menunggu cooldown ${Math.round(remaining / 1000)} detik.`,
      };
    } else if (cd && now >= cd.until) {
      this.cooldowns.delete(d);
    }

    // 2. Cek RPM (requests per minute)
    let timestamps = this.domainHistory.get(d) || [];
    timestamps = timestamps.filter(t => now - t < 60000);
    this.domainHistory.set(d, timestamps);

    if (timestamps.length >= this.defaultRpm) {
      const oldest = timestamps[0] ?? now;
      const waitMs = Math.max(100, 60000 - (now - oldest));
      return {
        allowed: false,
        waitMs,
        reason: `Mencapai batas kecepatan domain ${domain} (${this.defaultRpm} req/menit).`,
      };
    }

    // Rekam request
    timestamps.push(now);
    return { allowed: true, waitMs: 0 };
  }

  recordResponse(domain: string, statusCode: number): void {
    const d = domain.toLowerCase();
    const now = Date.now();

    if (statusCode === 429 || statusCode === 503) {
      const prev = this.cooldowns.get(d) || { until: 0, retries: 0, reason: '' };
      const retries = prev.retries + 1;
      // Exponential backoff: 10s * (2 ^ (retries - 1)) + jitter up to 5s
      const jitter = Math.floor(Math.random() * 5000);
      const backoffDuration = Math.min(10000 * Math.pow(2, Math.min(retries - 1, 5)) + jitter, 600000); // max 10 menit

      this.cooldowns.set(d, {
        until: now + backoffDuration,
        retries,
        reason: statusCode === 429 ? 'HTTP 429 Too Many Requests' : 'HTTP 503 Service Unavailable',
      });
    } else if (statusCode >= 200 && statusCode < 300) {
      // Sukses: reset retries jika sudah berhasil
      const prev = this.cooldowns.get(d);
      if (prev && prev.retries > 0) {
        this.cooldowns.set(d, { ...prev, retries: 0 });
      }
    }
  }

  getCooldown(domain: string): { paused: boolean; remainingMs: number; reason?: string } {
    const d = domain.toLowerCase();
    const cd = this.cooldowns.get(d);
    if (!cd) return { paused: false, remainingMs: 0 };
    const remaining = Math.max(0, cd.until - Date.now());
    return {
      paused: remaining > 0,
      remainingMs: remaining,
      reason: cd.reason,
    };
  }
}
