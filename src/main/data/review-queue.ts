import { randomUUID } from 'node:crypto';
import type { ReviewItem, Json } from '../../shared/data-contracts';

export class ReviewQueue {
  private readonly items: ReviewItem[] = [];

  addItem(entry: {
    type: 'schema_drift' | 'low_confidence' | 'ambiguous_duplicate' | 'pii_flag';
    jobId?: string;
    recordId?: string;
    payload: Record<string, Json>;
    confidence: number;
  }): ReviewItem {
    const item: ReviewItem = {
      id: randomUUID(),
      type: entry.type,
      jobId: entry.jobId,
      recordId: entry.recordId,
      payload: entry.payload,
      confidence: entry.confidence,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    this.items.unshift(item);
    if (this.items.length > 500) {
      this.items.length = 500;
    }
    return item;
  }

  listItems(status: 'all' | 'pending' | 'approved' | 'rejected' | 'merged' = 'pending', limit = 50): ReviewItem[] {
    let res = this.items;
    if (status !== 'all') {
      res = res.filter(i => i.status === status);
    }
    return res.slice(0, Math.min(limit, 200));
  }

  resolveItem(reviewId: string, resolution: 'approved' | 'rejected' | 'merged' | 'edited', editedData?: Record<string, Json>): ReviewItem {
    const item = this.items.find(i => i.id === reviewId);
    if (!item) throw new Error('Item review tidak ditemukan: ' + reviewId);

    item.status = resolution;
    item.resolvedAt = new Date().toISOString();
    if (editedData) {
      item.payload = { ...item.payload, ...editedData };
    }
    return item;
  }

  getStats(): { pending: number; approved: number; rejected: number; merged: number } {
    return {
      pending: this.items.filter(i => i.status === 'pending').length,
      approved: this.items.filter(i => i.status === 'approved').length,
      rejected: this.items.filter(i => i.status === 'rejected').length,
      merged: this.items.filter(i => i.status === 'merged' || i.status === 'edited').length,
    };
  }
}
