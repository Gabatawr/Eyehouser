import { RuleEngine } from '../../lib/rules/engine';
import { WebRequestCollector, WebRequestMeta } from '../services/webrequest';
import { RingBuffer } from '../../lib/storage/memory';
import { ChromeStorage } from '../../lib/storage/chrome';
import { StreamBackend } from '../../lib/storage/stream';
import { CaptureRule } from '../../lib/rules/matchers';

interface CapturedRequest {
  id: string;
  type: 'fetch' | 'xhr' | 'blob' | 'data-url';
  url: string;
  method?: string;
  status?: number;
  requestBody?: string;
  requestBodySize?: number;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
  responseBodySize?: number;
  responseChunks?: string[];
  contentType?: string;
  timing?: { startTime: number; duration?: number };
  matchedRule?: string;
  matchedRuleId?: string;
  tags?: string[];
  capturedAt: number;
  tabId?: number;
  initiator?: string;
  blobType?: string;
  blobSize?: number;
  blobContent?: string;
  blobRevoked?: boolean;
}

interface CaptureConfig {
  captureAll: boolean;
  captureFetch: boolean;
  captureXhr: boolean;
  captureBlob: boolean;
  captureDataUrls: boolean;
  maxBodySize: number;
  maxEntries: number;
  autoSaveToStorage: boolean;
  streamEndpoint: string;
}

export class CaptureController {
  private webRequest = new WebRequestCollector();
  private rulesEngine = new RuleEngine([]);
  private buffer: RingBuffer<CapturedRequest>;
  private chromeStorage: ChromeStorage;
  private stream: StreamBackend | null = null;
  private config: CaptureConfig;
  private onCapture?: (req: CapturedRequest) => void;

  stats = { total: 0, failed: 0, slow: 0, totalDuration: 0, avgDuration: 0 };

  constructor(config: CaptureConfig) {
    this.config = config;
    this.buffer = new RingBuffer(config.maxEntries);
    this.chromeStorage = new ChromeStorage();
    if (config.streamEndpoint) {
      this.stream = new StreamBackend(config.streamEndpoint);
    }
  }

  onCaptured(handler: (req: CapturedRequest) => void) {
    this.onCapture = handler;
  }

  setRules(rules: CaptureRule[]) {
    this.rulesEngine.updateRules(rules);
  }

  start() {
    this.webRequest.onMeta((meta) => this.handleWebRequestMeta(meta));
    this.webRequest.start();
  }

  processFromContent(data: any) {
    if (data.type === 'blob' && !this.config.captureBlob) return;
    if (data.type === 'data-url' && !this.config.captureDataUrls) return;

    const isSpecial = data.type === 'blob' || data.type === 'data-url';
    const rule = this.config.captureAll ? null : this.rulesEngine.match(data);

    if (!this.config.captureAll && !rule) return;

    const meta = !isSpecial
      ? this.webRequest.findMeta(data.url, data.method, data.tabId)
      : undefined;

    const req: CapturedRequest = {
      id: data.id,
      type: data.type,
      url: data.url,
      method: data.method,
      status: data.status || meta?.status || 0,
      requestBody: data.requestBody,
      requestBodySize: data.requestBodySize,
      requestHeaders: data.requestHeaders,
      responseHeaders: data.responseHeaders,
      responseBody: data.responseBody,
      responseBodySize: data.responseBodySize,
      responseChunks: data.responseChunks,
      contentType: data.contentType,
      timing: data.timing ? {
        startTime: meta?.startTime || data.timing.startTime || Date.now(),
        duration: meta?.duration || data.timing.duration,
      } : undefined,
      matchedRule: rule?.name,
      matchedRuleId: rule?.id,
      tags: rule?.tags,
      capturedAt: Date.now(),
      tabId: meta?.tabId,
      initiator: meta?.initiator,
      blobType: data.blobType,
      blobSize: data.blobSize,
      blobContent: data.blobContent,
      blobRevoked: data.blobRevoked,
    };

    this.updateStats(req);
    this.buffer.push(req);

    if (this.config.autoSaveToStorage) this.chromeStorage.save(req);
    this.stream?.save(req);

    this.onCapture?.(req);
  }

  private handleWebRequestMeta(_meta: WebRequestMeta) {
    // webRequest metadata is used for merging with CS data
  }

  private updateStats(req: CapturedRequest) {
    this.stats.total++;
    if (req.status && req.status >= 400) this.stats.failed++;
    if ((req.timing?.duration || 0) > 3000) this.stats.slow++;
    this.stats.totalDuration += req.timing?.duration || 0;
    this.stats.avgDuration = this.stats.totalDuration / this.stats.total;
  }

  getAll() { return this.buffer.getAll(); }
  flush() { this.chromeStorage.flush(); }
  clear() { this.buffer.clear(); this.chromeStorage.clear(); this.stats = { total: 0, failed: 0, slow: 0, totalDuration: 0, avgDuration: 0 }; }
}
