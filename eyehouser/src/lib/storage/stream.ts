const MAX_QUEUE = 1000;
const MAX_RETRY_MS = 60_000;

export class StreamBackend {
  private queue: any[] = [];
  private timer: ReturnType<typeof setTimeout>;
  private retryDelay = 1000;

  constructor(
    private endpoint: string,
    flushInterval = 5000,
    private maxBatch = 50
  ) {
    this.timer = setTimeout(() => this.flush(), flushInterval);
  }

  async save(item: any) {
    if (this.queue.length >= MAX_QUEUE) {
      this.queue.splice(0, this.queue.length - MAX_QUEUE + 1);
    }
    this.queue.push(item);
    if (this.queue.length >= this.maxBatch) await this.flush();
  }

  private async flush() {
    if (this.queue.length === 0) {
      this.schedule();
      return;
    }
    const batch = this.queue.splice(0, this.maxBatch);
    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batch }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.retryDelay = 1000;
    } catch {
      this.queue.push(...batch);
      this.retryDelay = Math.min(this.retryDelay * 2, MAX_RETRY_MS);
    }
    this.schedule();
  }

  private schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.retryDelay);
  }

  destroy() { clearTimeout(this.timer); }
}
