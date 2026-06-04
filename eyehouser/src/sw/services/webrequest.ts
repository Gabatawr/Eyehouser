export interface WebRequestMeta {
  requestId: string;
  url: string;
  method: string;
  type: string;
  tabId?: number;
  startTime: number;
  status?: number;
  endTime?: number;
  duration?: number;
  initiator?: string;
  error?: string;
}

const PENDING_TTL = 60_000;
const CLEANUP_INTERVAL = 30_000;
const MAX_PENDING = 5000;

export class WebRequestCollector {
  private pending = new Map<string, WebRequestMeta>();
  private handler?: (meta: WebRequestMeta) => void;

  onMeta(handler: (meta: WebRequestMeta) => void) {
    this.handler = handler;
  }

  private cleanup() {
    const now = performance.now();
    let count = 0;
    for (const [id, meta] of this.pending) {
      if (now - meta.startTime > PENDING_TTL) {
        this.pending.delete(id);
      } else if (++count > MAX_PENDING) {
        this.pending.delete(id);
      }
    }
  }

  start() {
    setInterval(() => this.cleanup(), CLEANUP_INTERVAL);
    chrome.webRequest.onBeforeRequest.addListener((details) => {
      if (!['xmlhttprequest', 'fetch'].includes(details.type)) return;
      this.pending.set(details.requestId, {
        requestId: details.requestId,
        url: details.url,
        method: details.method,
        type: details.type,
        tabId: details.tabId,
        startTime: details.timeStamp,
        initiator: details.initiator,
      });
    }, { urls: ['<all_urls>'] });

    chrome.webRequest.onCompleted.addListener((details) => {
      const entry = this.pending.get(details.requestId);
      if (!entry) return;
      this.pending.delete(details.requestId);
      entry.status = details.statusCode;
      entry.endTime = details.timeStamp;
      entry.duration = details.timeStamp - entry.startTime;
      this.handler?.(entry);
    }, { urls: ['<all_urls>'] });

    chrome.webRequest.onErrorOccurred.addListener((details) => {
      const entry = this.pending.get(details.requestId);
      if (!entry) return;
      this.pending.delete(details.requestId);
      entry.status = 0;
      entry.error = details.error;
      this.handler?.(entry);
    }, { urls: ['<all_urls>'] });
  }

  findMeta(url: string, method: string, tabId?: number): WebRequestMeta | null {
    const matches: WebRequestMeta[] = [];
    for (const [_, meta] of this.pending) {
      if (meta.url === url && meta.method === method && (!tabId || meta.tabId === tabId)) {
        matches.push(meta);
      }
    }
    if (matches.length === 0) return null;
    if (matches.length === 1) {
      this.pending.delete(matches[0].requestId);
      return matches[0];
    }
    matches.sort((a, b) => b.startTime - a.startTime);
    const meta = matches[0];
    this.pending.delete(meta.requestId);
    return meta;
  }
}
