import type { ExtractionSpec, DriftReport, Json } from '../../shared/data-contracts';

interface FieldStats {
  count: number;
  nullCount: number;
  sum: number;
  mean: number;
  types: Set<string>;
}

export class DriftDetector {
  private readonly baselineStats = new Map<string, Map<string, FieldStats>>(); // jobId -> field -> stats

  checkDrift(jobId: string, schema: ExtractionSpec, currentRows: Record<string, Json>[]): DriftReport {
    let jobBaseline = this.baselineStats.get(jobId);
    const isFirstRun = !jobBaseline;

    if (!jobBaseline) {
      jobBaseline = new Map();
      this.baselineStats.set(jobId, jobBaseline);
    }

    const currentStats = new Map<string, FieldStats>();
    const totalCurrent = currentRows.length;

    // Hitung statistik batch saat ini
    for (const field of schema.fields) {
      let nullCount = 0;
      let sum = 0;
      let numCount = 0;
      const types = new Set<string>();

      for (const row of currentRows) {
        const val = this.resolvePath(row, field.path);
        if (val === null || val === undefined || val === '') {
          nullCount++;
        } else {
          types.add(typeof val);
          if (typeof val === 'number') {
            sum += val;
            numCount++;
          } else if (typeof val === 'string' && !isNaN(Number(val)) && field.type === 'integer') {
            sum += Number(val);
            numCount++;
          }
        }
      }

      currentStats.set(field.path, {
        count: totalCurrent,
        nullCount,
        sum,
        mean: numCount > 0 ? sum / numCount : 0,
        types,
      });
    }

    // Jika ini run pertama, simpan sebagai baseline dan laporkan tidak ada drift
    if (isFirstRun || totalCurrent === 0) {
      for (const [k, v] of currentStats.entries()) {
        jobBaseline.set(k, v);
      }
      return {
        jobId,
        timestamp: new Date().toISOString(),
        hasDrift: false,
        fields: [],
      };
    }

    // Bandingkan dengan baseline
    let hasDrift = false;
    const driftedFields: DriftReport['fields'] = [];

    for (const field of schema.fields) {
      const prev = jobBaseline.get(field.path) || { count: 0, nullCount: 0, sum: 0, mean: 0, types: new Set() };
      const curr = currentStats.get(field.path)!;

      const prevNullPct = prev.count > 0 ? (prev.nullCount / prev.count) * 100 : 0;
      const currNullPct = curr.count > 0 ? (curr.nullCount / curr.count) * 100 : 0;

      let driftType: 'none' | 'null_spike' | 'distribution_shift' | 'type_mismatch' = 'none';
      let message = 'Normal';
      let confidence = 0;

      // 1. Cek lonjakan nilai NULL (misal sebelumnya < 15%, sekarang > 60%)
      if (currNullPct >= 50 && prevNullPct < 20 && (field.required || currNullPct - prevNullPct >= 40)) {
        driftType = 'null_spike';
        confidence = 0.95;
        message = `Lonjakan nilai NULL drastis pada field '${field.path}': dari ${prevNullPct.toFixed(1)}% menjadi ${currNullPct.toFixed(1)}%`;
        hasDrift = true;
      }
      // 2. Cek pergeseran distribusi nilai numerik (misal rata-rata turun/naik > 75%)
      else if (prev.mean > 0 && curr.mean >= 0 && curr.count >= 5 && prev.count >= 5) {
        const ratio = curr.mean / prev.mean;
        if (ratio < 0.25 || ratio > 4.0) {
          driftType = 'distribution_shift';
          confidence = 0.90;
          message = `Pergeseran distribusi nilai '${field.path}': rata-rata sebelumnya ${prev.mean.toFixed(1)}, saat ini ${curr.mean.toFixed(1)}`;
          hasDrift = true;
        }
      }

      if (driftType !== 'none') {
        driftedFields.push({
          field: field.path,
          expectedType: field.type,
          driftType,
          confidence,
          previousStats: { mean: prev.mean, nullPercentage: prevNullPct, count: prev.count },
          currentStats: { mean: curr.mean, nullPercentage: currNullPct, count: curr.count },
          message,
        });
      }

      // Perbarui baseline dengan moving average
      jobBaseline.set(field.path, {
        count: prev.count + curr.count,
        nullCount: prev.nullCount + curr.nullCount,
        sum: prev.sum + curr.sum,
        mean: (prev.sum + curr.sum) / Math.max(1, (prev.count + curr.count - prev.nullCount - curr.nullCount)),
        types: new Set([...prev.types, ...curr.types]),
      });
    }

    return {
      jobId,
      timestamp: new Date().toISOString(),
      hasDrift,
      fields: driftedFields,
    };
  }

  private resolvePath(obj: Record<string, Json>, path: string): Json {
    const parts = path.split('.');
    let cur: any = obj;
    for (const p of parts) {
      if (!cur || typeof cur !== 'object') return null;
      cur = cur[p];
    }
    return cur ?? null;
  }
}
