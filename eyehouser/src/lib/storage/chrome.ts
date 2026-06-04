const STORAGE_KEY = 'eyehouser_requests';
const MAX_ENTRIES = 5000;
const MAX_SIZE_BYTES = 4_000_000;

function estimateSize(data: unknown[]): number {
  let size = 0;
  for (const item of data) {
    size += JSON.stringify(item).length;
    if (size > MAX_SIZE_BYTES) return size;
  }
  return size;
}

function trimToFit(data: unknown[]): unknown[] {
  while (data.length > 1 && estimateSize(data) > MAX_SIZE_BYTES) {
    data.pop();
  }
  return data;
}

export class ChromeStorage {
  private cache: any[] = [];
  private readonly flushThreshold = 100;

  async save(item: any) {
    this.cache.push(item);
    if (this.cache.length >= this.flushThreshold) await this.flush().catch(() => {});
  }

  async flush() {
    if (this.cache.length === 0) return;
    const batch = this.cache.splice(0);
    const existing = await this.getAll().catch(() => [] as any[]);
    const all = trimToFit([...batch, ...existing].slice(0, MAX_ENTRIES));
    await chrome.storage.local.set({ [STORAGE_KEY]: all }).catch(() => {});
  }

  async getAll() {
    const res = await chrome.storage.local.get(STORAGE_KEY);
    return res[STORAGE_KEY] || [];
  }

  async clear() {
    this.cache = [];
    await chrome.storage.local.remove(STORAGE_KEY).catch(() => {});
  }
}
