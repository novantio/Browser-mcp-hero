import { randomUUID } from 'node:crypto';
import type { DataRecord, Job, Json } from '../../shared/data-contracts';
import { assess, hash, privateText } from './processing';

/** Turns one extracted row into a redacted, quality-scored record with full provenance. */
export function buildRecord(row: Record<string, Json>, origin: { job: Job; url: string; snapshotId: string; collectedAt: string }): DataRecord {
  const { job, url, snapshotId, collectedAt } = origin;
  const rowText = Object.entries(row)
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join('\n');
  const safe = privateText(rowText);
  const info = assess(safe.text);
  let domain = '';
  try { domain = new URL(url).hostname; } catch {}
  return {
    id: randomUUID(),
    text: safe.text,
    data: row,
    hash: hash(row),
    language: info.language,
    quality: info.quality,
    pii: safe.pii,
    spam: info.spam,
    source: {
      url,
      domain,
      sourceType: job.sourceType || 'web',
      collectedAt,
      profileId: job.profileId,
      topic: job.topic || '',
    },
    provenance: {
      jobId: job.id,
      runId: job.runId || '',
      snapshotId,
      extractorVersion: 'v1',
    },
  };
}
