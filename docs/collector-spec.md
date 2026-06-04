# Техническое задание: Универсальный сборщик данных (Chrome Extension MV3)

---

## Implementation Status

| Раздел | Статус | Файлы |
|---|---|---|
| 1. Injection (MAIN world) | ✅ | `entrypoints/interception.content.ts` — fetch + XHR + blob + data-url |
| 2. Bridge (ISOLATED) | ✅ PortBridge с batch-очередью | `entrypoints/bridge.content.ts`, `lib/messaging.ts` |
| 3. Background SW | ✅ CaptureController, WebRequestCollector, keepalive | `entrypoints/background.ts`, `sw/controllers/capture.ts` |
| 4. Storage | ✅ RingBuffer + ChromeStorage + StreamBackend | `lib/storage/*` |
| 5. Rules engine | ✅ 6 типов условий, 6 операторов, AND/OR, tags | `lib/rules/*` |
| 6. Overlay UI | ✅ 4 таба (Live/History/Rules/Settings) + Detail (Headers tab) | `ui/` (33 файла) |
| 7. Tags | ✅ `tags[]` на правилах, фильтр `?tag=X` в лог-сервере | — |
| 8. Log server | ✅ `data/capture-log.ndjson`, сессии, фильтры | `deploy/log-server.mjs` |
| 9. Session tracking | ✅ SW start → `/api/session/start`, health endpoint | `background.ts`, `deploy/log-server.mjs` |
| 10. Zod schemas | ✅ MAIN→ISOLATED, ISOLATED→SW, config, rules | `lib/validation/schemas.ts` |
| 11. blob/data URL capture | ✅ | `lib/blob-capture.ts` + `lib/data-url-scanner.ts` |
| 12. Request body capture | ✅ | `readBody()` в fetch (config.body, Request) и XHR (send) |
| 13. Chunked XHR | ✅ | readystatechange readyState 3, responseText deltas |
| 14. Headers capture | ✅ | fetch: config.headers + response; XHR: setRequestHeader + getAllResponseHeaders |
| 15. Export JSON/HAR | ✅ | `lib/export.ts`, History tab (format selector) |
| 16. MIT license | ✅ | `LICENSE` |
| 17. Tests | 🟡 Не реализовано | — |

**Текущий pipeline:**
```
MAIN proxy → postMessage → ISOLATED bridge → port batch → SW CaptureController 
  → RingBuffer + ChromeStorage + StreamBackend (POST) → log-server → capture-log.ndjson
```

**Что дальше:**
- Тесты (Vitest)

---

## Tech Stack

| Слой | Технология | Обоснование |
|---|---|---|
| Build | **WXT** (Vite-based) | Сборка MV3, HMR, multi-browser, не нужно настраивать Vite вручную |
| UI | **React 18** | Компонентный overlay, порог входа, экосистема |
| State | **Zustand** | Единое API для SW + UI, subscribeWithSelector, без boilerplate |
| CSS | **Tailwind CSS** | Utility-first, `dark:` для тёмной темы, быстрые итерации |
| Validation | **Zod** | Валидация на границах миров (MAIN→SW — ненадёжный контекст), схемы правил и конфига |
| Language | **TypeScript** | Весь проект, строгая типизация data model |
| Testing | **Vitest + Playwright** | Unit (Vite-native) + e2e (браузерные тесты расширения) |

**AI/MCP задел:**

Data model проектируется с учётом будущих слоёв:
- **Сессионный сбор** — все записи содержат `tabId`, `capturedAt`, `timing.startTime`, `initiator` для группировки в сессии
- **AI-агент** — поверх собранных сессий сможет анализировать паттерны поведения пользователей (цены, ассортимент, поисковые запросы) и формировать similarity sets
- **MCP-серверы** — отдельные надсервисы, подключаемые к архитектуре через стандартный протокол Model Context Protocol

На текущем этапе архитектура закладывает фундамент: чистый сбор данных без логики анализа.

---

## 1. Injection Layer — инъекция сборщика в страницу

### 1.1 MAIN-world скрипт через `world: "MAIN"`

**Что делает:** Внедряет скрипт перехвата в контекст страницы через декларацию `manifest.json`, без `web_accessible_resources` + script tag.

**Файл:** `manifest.json`
```json
{
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["lib/interception.js"],
    "run_at": "document_start",
    "world": "MAIN",
    "all_frames": true
  }, {
    "matches": ["<all_urls>"],
    "js": ["lib/bridge.js"],
    "run_at": "document_start",
    "all_frames": true
  }]
}
```

**Референс:** Deep-Crawler `extension/manifest.json:22-36`

**Требования:**
- Скрипт `interception.js` (MAIN) выполняется ДО загрузки page scripts
- Скрипт `bridge.js` (ISOLATED) принимает postMessage и общается с SW
- Оба — `document_start`, `all_frames: true`
- `interception.js` должен быть указан в `web_accessible_resources` (требование Chrome для `world: "MAIN"`)

---

### 1.2 fetch pass-through proxy

**Что делает:** Подменяет `window.fetch` на прозрачный прокси, читает тело ответа не расходуя оригинал.

**Файл:** `lib/interception.js`

```javascript
const originalFetch = window.fetch;
window.fetch = function(...args) {
  const startTime = performance.now();
  const [resource, config] = args;
  const url = typeof resource === 'string' ? resource : resource.url;
  const method = (config?.method || 'GET').toUpperCase();
  const requestHeaders = config?.headers;
  let requestBody;

  // Читаем тело запроса (если есть и разрешено)
  if (config?.body && config.body instanceof ReadableStream !== true) {
    requestBody = config.body;
  }

  return originalFetch.apply(this, args).then(async response => {
    const duration = performance.now() - startTime;
    const status = response.status;
    const contentType = response.headers.get('content-type') || '';

    // Клонируем и читаем тело ответа (прозрачно — оригинал не расходуется)
    let responseBody;
    let responseBodySize = 0;
    if (config.shouldCaptureResponse !== false) {
      const clone = response.clone();
      const text = await clone.text();
      responseBodySize = text.length;
      if (responseBodySize <= config.maxBodySize) {
        responseBody = text;
      }
    }

    bridge.send('capture:request', {
      id: generateId(),
      type: 'fetch',
      url,
      method,
      status,
      requestBody,
      responseBody,
      responseBodySize,
      requestHeaders,
      responseHeaders: headersToObject(response.headers),
      contentType,
      timing: { startTime, duration }
    });

    return response; // ← pass-through! не модифицируем
  });
};
```

**Референс:** Browser Proxy `src/pageScript/fetchProxy.js`, Deep-Crawler `extension/network-interceptor.js:18-86`

**Требования:**
- ВСЕГДА pass-through (не модифицирует ответ)
- `response.clone().text()` — безопасное чтение
- configurable max body size (default 1MB)
- configurable capture request/response body
- Сохраняет `performance.now()` timing

---

### 1.3 XHR pass-through proxy

**Что делает:** Подменяет `XMLHttpRequest.prototype.open/send` на прозрачный прокси.

**Файл:** `lib/interception.js`

```javascript
const originalOpen = XMLHttpRequest.prototype.open;
const originalSend = XMLHttpRequest.prototype.send;

XMLHttpRequest.prototype.open = function(method, url, ...rest) {
  this._xhrId = generateId();
  this._xhrMethod = (method || 'GET').toUpperCase();
  this._xhrUrl = (typeof url === 'string' ? url : url + '');
  this._xhrStartTime = performance.now();
  this._xhrHeaders = {};
  return originalOpen.apply(this, [method, url, ...rest]);
};

// Перехват setRequestHeader
const originalSetHeader = XMLHttpRequest.prototype.setRequestHeader;
XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
  this._xhrHeaders[name] = value;
  return originalSetHeader.apply(this, arguments);
};

XMLHttpRequest.prototype.send = function(body) {
  this._xhrRequestBody = body;
  const self = this;
  const originalOnLoad = this.onload;
  const originalOnError = this.onerror;

  this.addEventListener('load', function() {
    bridge.send('capture:request', {
      id: self._xhrId,
      type: 'xhr',
      url: self._xhrUrl,
      method: self._xhrMethod,
      status: self.status,
      requestBody: getXhrBodySize(self._xhrRequestBody),
      responseBody: self.responseText,
      responseBodySize: self.responseText?.length || 0,
      requestHeaders: self._xhrHeaders,
      responseHeaders: parseXhrResponseHeaders(self),
      contentType: self.getResponseHeader('content-type') || '',
      timing: {
        startTime: self._xhrStartTime,
        duration: performance.now() - self._xhrStartTime
      }
    });
  });

  return originalSend.apply(this, arguments);
};
```

**Референс:** Browser Proxy `src/pageScript/xhrProxy.js`, Deep-Crawler `extension/network-interceptor.js:96-153`

**Требования:**
- pass-through (не модифицирует)
- `addEventListener('load')` — видит готовый ответ
- Сохраняет request headers (через proxy `setRequestHeader`)

---

### 1.4 blob: URL intercept

**Что делает:** Перехватывает создание blob: URL через прокси `URL.createObjectURL`.

**Файл:** `lib/interception.js`

```javascript
const originalCreateObjectURL = URL.createObjectURL;
URL.createObjectURL = function(blob) {
  const blobUrl = originalCreateObjectURL.call(this, blob);
  bridge.send('capture:blob', {
    url: blobUrl,
    blobType: blob.type,
    blobSize: blob.size,
    timestamp: Date.now()
  });
  return blobUrl;
};
```

**Референс:** Deep-Crawler `extension/background.js:111-138`

**Требования:**
- pass-through
- Фиксирует URL, MIME type, размер
- Из MAIN world (доступен только там)

---

### 1.5 data: URL scanner

**Что делает:** Сканирует DOM и CSS на data: URL через регулярные выражения.

**Файл:** `lib/interception.js`

```javascript
function scanDataUrls() {
  const dataUrls = new Set();
  // Атрибуты всех элементов
  document.querySelectorAll('*').forEach(el => {
    for (const attr of el.attributes) {
      if (attr.value?.includes('data:')) {
        const matches = attr.value.match(/data:[^"'\s;)]+/g);
        matches?.forEach(u => dataUrls.add(u));
      }
    }
  });
  // Computed styles
  document.querySelectorAll('*').forEach(el => {
    try {
      const styles = getComputedStyle(el);
      for (let i = 0; i < styles.length; i++) {
        const val = styles.getPropertyValue(styles[i]);
        if (val?.includes('data:')) {
          val.match(/data:[^"'\s;)]+/g)?.forEach(u => dataUrls.add(u));
        }
      }
    } catch (_) {}
  });
  dataUrls.forEach(url => {
    bridge.send('capture:data-url', { url, timestamp: Date.now() });
  });
}
// При DOMContentLoaded + каждые 5 секунд
document.addEventListener('DOMContentLoaded', scanDataUrls);
setInterval(scanDataUrls, 5000);
```

**Референс:** Deep-Crawler `extension/background.js:140-214`

**Требования:**
- pass-through
- Запуск при DOMContentLoaded + periodic polling
- Не нагружать CPU (throttle если страница большая)

---

## 2. Bridge Layer — связь между мирами

### 2.1 postMessage bridge (MAIN → ISOLATED)

**Что делает:** Передаёт данные из MAIN world в ISOLATED content script через `window.postMessage`.

**Файл:** `lib/bridge.js` (ISOLATED world)

```javascript
// MAIN world отправляет:
window.postMessage({ source: 'collector', type, data, id }, '*');

// ISOLATED world принимает:
window.addEventListener('message', (event) => {
  if (event.data?.source !== 'collector') return;
  
  chrome.runtime.sendMessage({
    source: 'collector',
    type: event.data.type,
    data: event.data.data,
    id: event.data.id,
    tabId: getCurrentTabId()
  });
});
```

**Референс:** Все репозитории

**Требования:**
- Фильтр по `source: 'collector'`
- Опционально: ack-based bridge (Requestly style) с timeout 2s
- Дубликат: fallback polling `window.__collectorQueue[]`

**Дополнительно — ack-based вариант (референс: Requestly):**

```javascript
// MAIN world:
function postMessageAndWait(msg, timeout = 2000) {
  return new Promise((resolve, reject) => {
    const handler = (e) => {
      if (e.data?.ack === msg.id) {
        window.removeEventListener('message', handler);
        resolve(e.data);
      }
    };
    window.addEventListener('message', handler);
    window.postMessage({ ...msg, source: 'collector' }, '*');
    setTimeout(() => {
      window.removeEventListener('message', handler);
      reject(new Error('ack timeout'));
    }, timeout);
  });
}
```

---

### 2.2 runtime bridge (ISOLATED → Service Worker)

**Что делает:** Передаёт данные из content script в service worker через `chrome.runtime.sendMessage`.

**Файл:** `lib/bridge.js`

```javascript
const port = chrome.runtime.connect({ name: 'collector-bridge' });
port.onDisconnect.addListener(() => reconnect());

// Пакетная отправка (не каждый запрос по одному)
const queue = [];
let flushTimer = null;
const FLUSH_INTERVAL = 200; // ms
const MAX_BATCH = 50;

function send(type, data) {
  queue.push({ type, data, ts: Date.now() });
  if (queue.length >= MAX_BATCH) flush();
  if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_INTERVAL);
}

function flush() {
  if (queue.length === 0) return;
  const batch = queue.splice(0, MAX_BATCH);
  port.postMessage({ type: 'capture:batch', batch });
  flushTimer = null;
}

// Long-lived port — heartbeat keepalive
setInterval(() => port.postMessage({ type: 'ping' }), 25000);
```

**Референс:** Inssman (ports), Requestly (long-lived ports), Cat-Catch (heartbeat)

**Требования:**
- Long-lived port (keepalive)
- Пакетная отправка (batch, 200ms / 50 items)
- Reconnect при разрыве

---

## 3. Rules Engine — фильтрация сбора

### 3.1 Rule data model

```
Rule {
  id: string (uuid)
  name: string
  enabled: boolean
  conditions: [
    { type: 'url',       operator: 'contains'|'equals'|'regex'|'wildcard',  value: string },
    { type: 'method',    operator: 'equals'|'in',                           value: string|string[] },
    { type: 'status',    operator: 'equals'|'range',                        value: number|{min, max} },
    { type: 'domain',    operator: 'equals'|'contains',                     value: string },
    { type: 'resource',  operator: 'equals',                                value: 'fetch'|'xhr'|'img'|'css'|'media'|'all' },
    { type: 'content-type', operator: 'contains'|'regex',                   value: string }
  ]
  logic: 'and' | 'or'       // как комбинировать conditions
  capture: {
    requestBody: boolean    // default true
    responseBody: boolean   // default true
    headers: boolean        // default true
    timing: boolean         // default true
    maxBodySize: number     // bytes, default 1_000_000
  }
  created: timestamp
  updated: timestamp
}
```

**Референс:** Requestly SourceCondition + Filters, Browser Proxy URL patterns

### 3.2 Rule Engine

**Файл:** `lib/rules/engine.js`

```javascript
class RuleEngine {
  constructor(rules) {
    this.rules = rules;
    this.matchers = {
      url:       (op, val, req) => matchUrl(req.url, op, val),
      method:    (op, val, req) => op === 'in' ? val.includes(req.method) : req.method === val,
      status:    (op, val, req) => op === 'range' ? (req.status >= val.min && req.status <= val.max) : req.status === val,
      domain:    (op, val, req) => op === 'contains' ? req.url.includes(val) : new URL(req.url).hostname === val,
      resource:  (op, val, req) => val === 'all' ? true : req.type === val,
      'content-type': (op, val, req) => op === 'contains' ? req.contentType?.includes(val) : matchRegex(req.contentType, val)
    };
  }

  match(request) {
    for (const rule of this.rules) {
      if (!rule.enabled) continue;
      const results = rule.conditions.map(c => this.matchers[c.type](c.operator, c.value, request));
      const matched = rule.logic === 'and' ? results.every(Boolean) : results.some(Boolean);
      if (matched) return rule;
    }
    return null;
  }
}
```

### 3.3 URL matching

```javascript
function matchUrl(url, operator, pattern) {
  switch (operator) {
    case 'equals':   return url === pattern;
    case 'contains': return url.includes(pattern);
    case 'regex':    return new RegExp(pattern, 'i').test(url);
    case 'wildcard': return new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i').test(url);
  }
}
```

**Референс:** Browser Proxy glob patterns, Requestly regex/wildcard matchers

---

## 4. Capture Layer — сбор и обработка

### 4.1 CaptureController (Service Worker)

**Файл:** `sw/controllers/capture.js`

```javascript
class CaptureController {
  constructor({ store, rules, config }) {
    this.store = store;
    this.rulesEngine = new RuleEngine(rules);
    this.config = config;
    this.pending = new Map();     // requestId → partial data
    this.webRequestMeta = new Map();
    this.stats = { total: 0, failed: 0, slow: 0, avgDuration: 0, totalDuration: 0 };
  }

  start() {
    this.setupWebRequestListeners();
    this.setupMessageListeners();
  }

  // webRequest — metadata для ВСЕХ запросов (gap-free)
  setupWebRequestListeners() {
    chrome.webRequest.onBeforeRequest.addListener((details) => {
      if (this.shouldTrack(details)) {
        this.pending.set(details.requestId, {
          requestId: details.requestId,
          tabId: details.tabId,
          url: details.url,
          method: details.method,
          type: details.type,
          startTime: details.timeStamp,
          frameId: details.frameId,
          initiator: details.initiator
        });
      }
    }, { urls: ['<all_urls>'] });

    chrome.webRequest.onCompleted.addListener((details) => {
      const entry = this.pending.get(details.requestId);
      if (entry) {
        entry.status = details.statusCode;
        entry.responseHeaders = headersToObject(details.responseHeaders);
        entry.endTime = details.timeStamp;
        entry.duration = details.timeStamp - entry.startTime;
        this.onComplete(entry);
      }
    }, { urls: ['<all_urls>'] });

    chrome.webRequest.onErrorOccurred.addListener((details) => {
      const entry = this.pending.get(details.requestId);
      if (entry) {
        entry.status = 0;
        entry.error = details.error;
        this.onComplete(entry);
      }
    }, { urls: ['<all_urls>'] });
  }

  // Приём данных от content script (тело запроса/ответа)
  setupMessageListeners() {
    chrome.runtime.onConnect.addListener((port) => {
      if (port.name !== 'collector-bridge') return;
      port.onMessage.addListener((msg) => {
        if (msg.type === 'capture:batch') {
          for (const item of msg.batch) {
            this.processCapturedItem(item);
          }
        }
      });
    });
  }

  processCapturedItem(item) {
    const rule = this.config.captureAll ? null : this.rulesEngine.match(item);
    if (!rule && !this.config.captureAll) return;

    // Merge с webRequest metadata
    const meta = this.findMatchingMeta(item);
    const captured = {
      id: item.data.id,
      url: item.data.url,
      method: item.data.method,
      status: item.data.status || meta?.status || 0,
      type: item.data.type,
      requestBody: item.data.requestBody,
      responseBody: item.data.responseBody,
      responseBodySize: item.data.responseBodySize,
      requestHeaders: item.data.requestHeaders || meta?.requestHeaders,
      responseHeaders: item.data.responseHeaders || meta?.responseHeaders,
      contentType: item.data.contentType,
      timing: {
        startTime: meta?.startTime || item.data.timing.startTime,
        duration: meta?.duration || item.data.timing.duration
      },
      tabId: item.tabId,
      initiator: meta?.initiator,
      matchedRule: rule?.name,
      matchedRuleId: rule?.id,
      capturedAt: Date.now()
    };

    this.updateStats(captured);
    this.store.save(captured);
    this.broadcast('new-request', captured);
  }

  findMatchingMeta(item) {
    // Match по URL + method + близкий timestamp (API Inspector pattern)
    for (const [_, meta] of this.pending) {
      if (meta.url === item.data.url &&
          meta.method === item.data.method &&
          Math.abs(meta.startTime - item.data.timing.startTime) < 1000) {
        this.pending.delete(meta.requestId);
        return meta;
      }
    }
    return null;
  }

  shouldTrack(details) {
    return ['xmlhttprequest', 'fetch'].includes(details.type);
  }

  updateStats(req) {
    this.stats.total++;
    if (req.status >= 400 || req.error) this.stats.failed++;
    if (req.timing.duration > 3000) this.stats.slow++;
    this.stats.totalDuration += req.timing.duration || 0;
    this.stats.avgDuration = this.stats.totalDuration / this.stats.total;
  }

  broadcast(type, data) {
    // SW → overlay UI
    chrome.runtime.sendMessage({ source: 'collector', type, data });
  }
}
```

**Референс:**
- webRequest metadata: API Inspector `src/background.js`
- Content script capture: Browser Proxy + Deep-Crawler
- Merge by URL+method+timestamp: API Inspector
- Port-based batch: Inssman

---

### 4.2 WebRequest metadata collector

**Файл:** `sw/services/webrequest.js`

```javascript
class WebRequestCollector {
  constructor() {
    this.active = new Map(); // tabId → Set<requestId>
  }

  onBeforeRequest(details) {
    if (!this.shouldTrack(details)) return;
    if (!this.active.has(details.tabId)) this.active.set(details.tabId, new Set());
    this.active.get(details.tabId).add(details.requestId);
    return { requestId: details.requestId,
      url: details.url,
      method: details.method,
      type: details.type,
      startTime: details.timeStamp,
      tabId: details.tabId,
      frameId: details.frameId,
      initiator: details.initiator
    };
  }

  onCompleted(details) {
    if (!this.active.get(details.tabId)?.has(details.requestId)) return;
    this.active.get(details.tabId).delete(details.requestId);
    return { requestId: details.requestId, status: details.statusCode,
      responseHeaders: headersToObject(details.responseHeaders),
      endTime: details.timeStamp,
      duration: details.timeStamp - (details.timeStamp - this.getStartTime(details))
    };
  }

  shouldTrack(details) {
    return ['xmlhttprequest', 'fetch', 'websocket'].includes(details.type);
  }
}
```

---

## 5. Storage Layer

### 5.1 In-memory RingBuffer

**Файл:** `lib/storage/memory.js`

```javascript
class RingBuffer {
  constructor(maxSize = 10000) {
    this.buffer = new Array(maxSize);
    this.maxSize = maxSize;
    this.head = 0;   // next write
    this.tail = 0;   // oldest valid
    this._size = 0;
  }

  push(item) {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.maxSize;
    if (this._size === this.maxSize) {
      this.tail = (this.tail + 1) % this.maxSize; // overwrite oldest
    } else {
      this._size++;
    }
  }

  getAll() {
    const result = [];
    for (let i = 0; i < this._size; i++) {
      result.push(this.buffer[(this.tail + i) % this.maxSize]);
    }
    return result;
  }

  clear() {
    this.head = 0;
    this.tail = 0;
    this._size = 0;
  }

  get size() { return this._size; }
}
```

### 5.2 chrome.storage persistence

**Файл:** `lib/storage/chrome.js`

```javascript
class ChromeStorageBackend {
  constructor(key = 'captured_requests') {
    this.key = key;
    this.cache = [];
  }

  async save(request) {
    this.cache.push(request);
    // Flush every N items
    if (this.cache.length >= 100) await this.flush();
  }

  async flush() {
    const data = this.cache.splice(0, 100);
    const existing = await this.getAll();
    const all = [...data, ...existing].slice(0, 10000);
    await chrome.storage.local.set({ [this.key]: all });
  }

  async getAll() {
    const result = await chrome.storage.local.get(this.key);
    return result[this.key] || [];
  }

  async clear() {
    this.cache = [];
    await chrome.storage.local.remove(this.key);
  }
}
```

### 5.3 Stream to endpoint

**Файл:** `lib/storage/stream.js` (Deep-Crawler pattern)

```javascript
class StreamBackend {
  constructor(endpoint, flushInterval = 5000, maxBatch = 50) {
    this.endpoint = endpoint;
    this.queue = [];
    this.flushInterval = flushInterval;
    this.maxBatch = maxBatch;
    this.timer = setInterval(() => this.flush(), flushInterval);
  }

  async save(request) {
    this.queue.push(request);
    if (this.queue.length >= this.maxBatch) await this.flush();
  }

  async flush() {
    if (this.queue.length === 0) return;
    const batch = this.queue.splice(0, this.maxBatch);
    try {
      await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batch })
      });
    } catch (err) {
      this.queue.unshift(...batch); // retry
    }
  }
}
```

---

## 6. Export Layer

### 6.1 JSON export

**Файл:** `lib/export/json.js`

```javascript
function exportJSON(requests, options = {}) {
  const data = options.pretty
    ? JSON.stringify(requests, null, 2)
    : JSON.stringify(requests);

  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `collector-export-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
```

### 6.2 HAR export

**Файл:** `lib/export/har.js`

```javascript
function exportHAR(requests) {
  const har = {
    log: {
      version: '1.2',
      creator: { name: 'Universal Collector', version: '1.0' },
      entries: requests.map(r => ({
        startedDateTime: new Date(r.timing.startTime).toISOString(),
        time: r.timing.duration || 0,
        request: {
          method: r.method,
          url: r.url,
          headers: objectToKvArray(r.requestHeaders),
          postData: r.requestBody ? { text: r.requestBody, mimeType: r.contentType } : undefined
        },
        response: {
          status: r.status,
          statusText: r.statusText || '',
          headers: objectToKvArray(r.responseHeaders),
          content: {
            text: r.responseBody,
            mimeType: r.contentType,
            size: r.responseBodySize
          }
        },
        cache: {},
        timings: {
          send: 0, wait: r.timing.duration || 0, receive: 0
        }
      }))
    }
  };
  downloadJSON(har, `collector-export-${Date.now()}.har`);
}
```

---

## 7. UI Layer

### 7.1 Overlay container (full-screen, top-right, resizable)

**Файл:** `ui/overlay/index.js`

```html
<div id="collector-overlay" class="collector-overlay">
  <div class="collector-header">
    <div class="collector-title">Collector</div>
    <div class="collector-header-actions">
      <button id="collector-toggle">—</button>
      <button id="collector-close">✕</button>
    </div>
  </div>
  <div class="collector-body">
    <div class="collector-sidebar">
      <nav>...</nav>
    </div>
    <div class="collector-main">
      <div class="collector-tabs">
        <button data-tab="live">Live</button>
        <button data-tab="history">History</button>
        <button data-tab="rules">Rules</button>
        <button data-tab="settings">Settings</button>
      </div>
      <div class="collector-content">
        <div id="tab-live">...</div>
        <div id="tab-history">...</div>
        <div id="tab-rules">...</div>
        <div id="tab-settings">...</div>
      </div>
    </div>
  </div>
</div>
```

**Референс:** API Inspector floating overlay, Browser Proxy layout

**Требования:**
- Фиксированная позиция: top: 0, right: 0
- Ширина: по умолчанию 40vw, min 320px, max 80vw
- Высота: по умолчанию 100vh, min 400px
- Resizable: левая граница (drag to resize)
- Draggable: перетаскивание за header
- Минимизация: иконка на панели (уменьшить до 48x48 в углу)
- Тёмная тема (CSS переменные)

---

### 7.2 Tab: Live Stream

**Файл:** `ui/tabs/live.js`

```
┌────────────────────────────────────────────────────────────────┐
│ [Pause/Resume] [Clear] [Filter by URL...]  Total: 1,234       │
│ ┌────────────────────────────────────────────────────────────┐ │
│ │ 200 │ GET │ /api/products    │ 1.2 MB │ 45ms │  Server A  │ │
│ │ 201 │ POST│ /api/orders      │ 340 B  │120ms │  Server A  │ │
│ │ 200 │ GET │ /api/products    │ 1.2 MB │ 32ms │  Server A  │ │
│ │ 404 │ GET │ /api/old         │ 2 KB   │ 8ms  │  Server A  │ │
│ └────────────────────────────────────────────────────────────┘ │
│ Stats: ► failed: 2 ► slow: 1 ► avg: 52ms                      │
└────────────────────────────────────────────────────────────────┘
```

**Элементы:**
- Pause/Resume кнопка (приостановить сбор)
- Clear (очистить список)
- Search input (фильтр по URL)
- Stats bar (total, failed, slow, avg duration) — API Inspector стиль
- Request table: Status badge, Method badge, URL, Size, Duration, Domain
- Цветовые индикаторы: метод (GET=green, POST=blue, PUT=yellow, DELETE=red), статус (2xx=green, 3xx=yellow, 4xx=orange, 5xx=red)
- Клик по строке → открывает Detail panel

---

### 7.3 Tab: Request History

```
┌────────────────────────────────────────────────────────────────┐
│ [Search...] [Method ▼] [Status ▼] [Domain ▼] [Apply] [Clear] │
│ [Export ▼] => JSON | HAR | CSV                                │
│ ┌────────────────────────────────────────────────────────────┐ │
│ │ Method│ URL                  │ Status│ Time  │ Size │ Rule │ │
│ │ GET   │ /api/products        │ 200   │ 45ms  │ 1.2M │ Prod │ │
│ │ GET   │ /api/products        │ 200   │ 32ms  │ 1.2M │ Prod │ │
│ │ ... (pagination)                                            │ │
│ └────────────────────────────────────────────────────────────┘ │
│ [< Prev] Page 1 of 10 [Next >]                                │
└────────────────────────────────────────────────────────────────┘
```

**Референс:** Browser Proxy RequestCard + pagination, API Inspector DevTools filters

**Элементы:**
- Фильтры: URL search, method select, status range, domain input
- Export dropdown: JSON / HAR / CSV
- Таблица с сортируемыми колонками
- Pagination (40 per page)
- Bulk select + bulk delete
- Clear all

---

### 7.4 Detail Panel (по клику на запрос)

```
┌────────────────────────────────────────────────────────────────┐
│ GET /api/products  [200]  45ms  1.2 MB                        │
├────────────────────────────────────────────────────────────────┤
│ [General] [Headers·Req] [Headers·Res] [Body·Req] [Body·Res]   │
├────────────────────────────────────────────────────────────────┤
│ General:                                                      │
│  URL:     https://example.com/api/products?page=1             │
│  Method:  GET                                                 │
│  Status:  200 OK                                              │
│  Time:    45ms (DNS: 2ms, TCP: 3ms, TLS: 5ms, Wait: 35ms)   │
│  Size:    1.2 MB (1,234,567 bytes)                            │
│  Type:    fetch                                               │
│  Domain:  example.com                                         │
│  Rule:    Product API                                         │
│  Captured: 2026-05-16T12:34:56.789Z                          │
├────────────────────────────────────────────────────────────────┤
│ Response Body (жирный JSON):                                  │
│ ┌────────────────────────────────────────────────────────────┐│
│ │ {                                                          ││
│ │   "products": [                                            ││
│ │     { "id": 1, "name": "Widget", "price": 9.99 },          ││
│ │     ...                                                    ││
│ │   ]                                                        ││
│ │ }                                                          ││
│ └────────────────────────────────────────────────────────────┘│
└────────────────────────────────────────────────────────────────┘
```

**Референс:** API Inspector detail panel, Requestly DevTools detail

**Табы:**
1. **General** — URL, method, status, timing (разбивка), size, type, domain, rule, captured at
2. **Headers Request** — key:value list
3. **Headers Response** — key:value list
4. **Body Request** — pretty-printed JSON в pre block (scrollable)
5. **Body Response** — pretty-printed JSON в pre block (scrollable, max-height)

---

### 7.5 Tab: Rules Editor

**Файл:** `ui/tabs/rules.js`

```
┌────────────────────────────────────────────────────────────────┐
│ [Add Rule] [Import] [Export]              [Save All]           │
├────────────────────────────────────────────────────────────────┤
│ ┌────────────────────────────────────────────────────────────┐│
│ │ ○ [Name: Product API]  ... [Enabled]  [Edit] [Delete]     ││
│ │   Conditions:                                              ││
│ │     URL   [contains]  [/api/products]                      ││
│ │     + Method [in]  [GET, POST]                             ││
│ │     + Status [range]  [200]  —  [299]                     ││
│ │   [Add Condition]                                          ││
│ │   Capture: [✓] ReqBody [✓] ResBody [✓] Headers  Max: [500]││
│ │   AND/OR: [and ▼]                                          ││
│ ├────────────────────────────────────────────────────────────┤│
│ │ ○ [Name: Search]  ... [Enabled]  [Edit] [Delete]          ││
│ │   URL   [regex]  [/search\?q=]                             ││
│ │   Capture: [✓] ResBody [ ] ReqBody                         ││
│ └────────────────────────────────────────────────────────────┘│
└────────────────────────────────────────────────────────────────┘
```

**Референс:** Browser Proxy domain/override settings, Requestly rule editor

**Элементы:**
- Список правил (каждый — карточка)
- Add Rule → открывает форму создания
- Import/Export rules (JSON)
- Per rule:
  - Name (edit inline)
  - Enable toggle
  - Conditions list (AND/OR)
  - Add Condition button
  - Capture toggles (req body, res body, headers)
  - Max body size
  - Delete (с подтверждением)

**Condition form:**
- Type dropdown: `url`, `method`, `status`, `domain`, `resource-type`, `content-type`
- Operator dropdown: зависит от type
  - url: `contains`, `equals`, `regex`, `wildcard`
  - method: `equals`, `in`
  - status: `equals`, `range`
  - domain: `equals`, `contains`
  - resource-type: `equals`
  - content-type: `contains`, `regex`
- Value input (или min/max для range)

---

### 7.6 Tab: Settings

```
┌────────────────────────────────────────────────────────────────┐
│ Interception:                                                  │
│   [✓] Capture fetch requests                                   │
│   [✓] Capture XHR requests                                     │
│   [✓] Capture blob: URLs                                       │
│   [ ] Capture data: URLs                                       │
│   [✓] webRequest metadata backup (gap-free)                    │
│   Injection timing: [document_start ▼]                         │
│   Max body size: [1000] KB                                     │
│   Max in-memory entries: [10000]                               │
│                                                               │
│ Storage:                                                       │
│   [✓] Save to chrome.storage.local                             │
│   [ ] Save to IndexedDB                                        │
│   [ ] Stream to endpoint: [________________________]           │
│   [Test Connection]                                            │
│                                                               │
│ Auto-crawl: [Disabled ▼]                                       │
│   [ ] Scroll to trigger lazy load                              │
│   [ ] Click buttons                                            │
│   [ ] Trigger inputs                                           │
│   [ ] Keyboard events                                          │
│                                                               │
│ Display:                                                       │
│   Overlay width: [40] % of viewport                             │
│   Theme: [Dark ▼]                                              │
│   Show stats in extension badge                                │
│                                                               │
│ Data:                                                          │
│   [Export All] [Clear All] [Import Rules]                      │
└────────────────────────────────────────────────────────────────┘
```

**Референс:** Cat-Catch options (17 sections), Deep-Crawler options

---

## 8. Service Worker Orchestration

### 8.1 Main SW entry point

**Файл:** `sw/index.js`

```javascript
import { CaptureController } from './controllers/capture.js';
import { RuleEngine } from '../lib/rules/engine.js';
import { ChromeStorageBackend } from '../lib/storage/chrome.js';
import { RingBuffer } from '../lib/storage/memory.js';

const config = {
  captureAll: true,        // default: capture everything
  captureFetch: true,
  captureXhr: true,
  captureBlob: false,
  captureDataUrls: false,
  useWebRequestBackup: true,
  maxBodySize: 1_000_000,
  maxEntries: 10_000,
  'auto-crawl': 'disabled',
  autoSaveToStorage: true,
  streamEndpoint: null,
  storageFlushInterval: 5000,
  theme: 'dark'
};

// Load config from storage, then init
chrome.storage.local.get('collector_config', (result) => {
  Object.assign(config, result.config);

  const store = config.streamEndpoint
    ? new StreamBackend(config.streamEndpoint)
    : new RingBuffer(config.maxEntries);

  const chromeStorage = new ChromeStorageBackend();

  const controller = new CaptureController({
    store,
    rules: [], // loaded from storage
    config
  });

  controller.start();
});
```

### 8.2 Heartbeat keepalive

```javascript
// SW может быть убит через ~30s бездействия
// Решение: chrome.alarms + port keepalive
chrome.alarms.create('collector-heartbeat', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'collector-heartbeat') {
    // Просто продлеваем жизнь SW
  }
});
```

**Референс:** Cat-Catch heartbeat (importScripts + alarms)

---

## 9. Pipeline (полный поток данных)

```
1. Page делает fetch('https://api.example.com/products')
         │
2. MAIN world: window.fetch proxy
   ├── Фиксирует startTime, url, method, requestBody
   └── Ждёт ответ
         │
3. MAIN world: response.clone().text()
   ├── Читает тело ответа (прозрачно)
   └── Формирует CapturedRequest { id, url, method, status, requestBody, responseBody, timing }
         │
4. MAIN world: window.postMessage({ source: 'collector', type: 'capture:request', data })
         │
5. ISOLATED world: bridge.js
   ├── Принимает postMessage (фильтр по source)
   └── Ставит в очередь (batch 50 items / 200ms)
         │
6. ISOLATED world: port.postMessage({ type: 'capture:batch', batch })
         │
7. SW: CaptureController
   ├── Принимает batch через port.onMessage
   ├── RulesEngine.match(request) — фильтр по правилам
   ├── Merge с webRequest метаданными (status, headers, timing)
   ├── updateStats()
   ├── RingBuffer.push(captured) + StorageBackend.save()
   └── broadcast('new-request', captured) → UI
         │
   Параллельно (gap-free):
   ├── SW: webRequest.onBeforeRequest → pending Map
   ├── SW: webRequest.onCompleted → достаёт из pending, ждёт body от CS
   └── Merge когда body приходит (match по URL+method+timestamp)
         │
8. UI: Tab Live Stream
   ├── Принимает broadcast → добавляет строку в таблицу
   └── Обновляет stats
         │
9. UI: Tab History
   └── Загружает все записи из store, отображает с пагинацией
         │
10. UI: Export
    └── Берёт текущие отфильтрованные записи → JSON/HAR/CSV → download
```

---

## 10. Структура проекта

```
collector/
├── public/
│   ├── manifest.json
│   └── icons/
├── lib/
│   ├── interception.js      ← MAIN world (fetch, XHR, blob, data)
│   ├── bridge.js             ← ISOLATED world (postMessage → runtime)
│   ├── messaging.js          ← port management, batch, ack, keepalive
│   ├── rules/
│   │   ├── engine.js         ← match request against rules
│   │   ├── matchers.js       ← URL, method, status, domain matchers
│   │   └── storage.js        ← rules CRUD
│   └── storage/
│       ├── memory.js         ← RingBuffer
│       ├── chrome.js         ← chrome.storage.local
│       ├── stream.js          ← fetch to endpoint
│       └── indexed-db.js      ← optional IndexedDB
├── sw/
│   ├── index.js              ← SW entry, config, init
│   ├── controllers/
│   │   ├── capture.js        ← CaptureController
│   │   ├── rules.js          ← RuleManager
│   │   └── ui.js             ← broadcast to overlay
│   └── services/
│       ├── webrequest.js     ← webRequest listeners
│       ├── export.js         ← JSON/HAR/CSV generation
│       └── keepalive.js      ← heartbeat
├── ui/
│   ├── overlay/
│   │   ├── index.html
│   │   ├── index.js          ← React/vanilla entry
│   │   ├── style.css
│   │   └── resizer.js        ← drag to resize
│   ├── tabs/
│   │   ├── live.js           ← Live stream table
│   │   ├── history.js        ← History with filters + pagination
│   │   ├── detail.js         ← Detail panel (tabbed)
│   │   ├── rules.js          ← Rules editor
│   │   └── settings.js       ← Settings form
│   ├── components/
│   │   ├── table.js          ← Reusable sortable table
│   │   ├── badge.js          ← Method/Status colored badge
│   │   ├── tabs.js           ← Tab switcher
│   │   ├── modal.js          ← Modal dialog
│   │   ├── toast.js          ← Toast notification
│   │   ├── pre.js            ← Pretty-printed JSON block
│   │   └── pagination.js     ← Pagination bar
│   └── state.js              ← Simple state management
├── docs/
│   ├── collection-tech.md
│   ├── collector-architecture.md
│   └── collector-spec.md
└── package.json
```

---

## 11. Итого: что откуда взято (reference map)

| Компонент | Основной референс | Доп. референс |
|---|---|---|
| world:MAIN injection | Deep-Crawler manifest | — |
| fetch proxy + clone().text() | Browser Proxy | Deep-Crawler (адаптация) |
| XHR proxy (load event) | Browser Proxy | Deep-Crawler |
| blob: URL capture | Deep-Crawler | — |
| data: URL scan | Deep-Crawler | — |
| postMessage bridge | Все репы | — |
| fallback global var | Deep-Crawler | — |
| Ack-based bridge | Requestly (optional) | — |
| Long-lived port (batch) | Inssman, Requestly | — |
| Heartbeat keepalive | Cat-Catch | — |
| webRequest metadata (gap-free) | API Inspector | — |
| Merge SW + CS (URL+method+ts) | API Inspector | — |
| Stats bar (total/failed/slow/avg) | API Inspector | — |
| Rule engine (conditions) | Requestly | Browser Proxy |
| Source filters (domain/type/method) | Requestly | — |
| URL matchers (equals/contains/regex/wildcard) | Requestly | Browser Proxy |
| Drag-to-move overlay | API Inspector | — |
| Inline rename | Browser Proxy | — |
| Pagination | Browser Proxy | — |
| Search pills | Browser Proxy | — |
| Detail tabs (General/Headers/Body) | API Inspector | Requestly |
| JSON pretty-print | API Inspector | — |
| Schema validation | API Inspector | — |
| Toast notifications | API Inspector | — |
| Export JSON | API Inspector | — |
| Export HAR | Standard | — |
| Empty state illustration | Browser Proxy, Requestly | — |
| Auto-crawl (scroll/click/input) | Deep-Crawler | — |
| Stream to endpoint | Deep-Crawler | — |
| 17-section options | Cat-Catch | — |
| Extension badge | Cat-Catch | — |
