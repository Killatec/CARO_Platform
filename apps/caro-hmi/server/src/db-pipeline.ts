export interface DbWriteEntry {
  moduleTs: number;
  tags: { tagId: number; value: number | boolean | string | null }[];
}

export class DbPipeline {
  private queue: DbWriteEntry[] = [];
  private maxQueueSize: number;

  constructor(maxQueueSize = 100) {
    this.maxQueueSize = maxQueueSize;
  }

  enqueue(entry: DbWriteEntry): void {
    if (this.queue.length >= this.maxQueueSize) {
      this.queue.shift();
      console.warn('[DbPipeline] Queue full, dropping oldest entry');
    }
    this.queue.push(entry);
  }

  flush(): DbWriteEntry[] {
    const batch = this.queue.splice(0);
    // Placeholder — silent flush. Real implementation writes to TimescaleDB.
    return batch;
  }

  get queueSize(): number {
    return this.queue.length;
  }
}
