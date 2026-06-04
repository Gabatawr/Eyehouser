# Архитектура универсального сборщика данных

---

## Implementation Status

| Компонент | Статус | Примечание |
|---|---|---|
| Injection (MAIN world) | ✅ | `world: "MAIN"` в manifest.json, WAR: `content-scripts/interception.js` |
| Bridge (ISOLATED) | ✅ | PortBridge, batch queue 200ms/50 items, keepalive ping |
| Background SW | ✅ | CaptureController, WebRequestCollector, alarms keepalive |
| Storage | ✅ | RingBuffer (10k), ChromeStorage (flush 100), StreamBackend (POST) |
| Rules engine | ✅ | 6 полей, 6 операторов, AND/OR, теги |
| Overlay UI | ✅ | iframe top-right 40vw, Ctrl+Shift+E, 4 таба + Detail (с Headers tab) |
| Tags | ✅ | `tags[]` на `CaptureRule`, фильтр `?tag=X` на сервере |
| Log server | ✅ | Node.js HTTP (Docker), NDJSON, сессии, фильтры |
| Log API | ✅ | `/api/logs/recent`, `/api/logs/summary`, `/api/session`, `/health` |
| Session tracking | ✅ | POST `/api/session/start` при старте SW |
| Zod schemas | ✅ | MAIN→ISOLATED, ISOLATED→SW, config, rules |
| blob/data URL | ✅ | `lib/blob-capture.ts` + `lib/data-url-scanner.ts` |
| Request body capture | ✅ | `readBody()` в fetch (config.body, Request) и XHR (send) |
| Chunked XHR | ✅ | `readystatechange` readyState 3, responseText deltas |
| Headers capture | ✅ | fetch: config.headers + response.headers; XHR: setRequestHeader + getAllResponseHeaders |
| Export JSON/HAR | ✅ | `lib/export.ts`, History tab (format selector) |
| MIT license | ✅ | `LICENSE` |
| Tests | 🟡 | Не начаты |

**Dev workflow:**
```bash
docker compose up -d log-server  # Docker → localhost:3001
npm run build     # build + version bump (2.5s) + 🔄 в Chrome
```
`npm run dev` (WXT HMR) не работает в tmux на WSL — inotify не детектит изменения.
Лог-сервер в Docker, build в tmux — не мешают друг другу.
Extension: `eyehouser/.output/chrome-mv3` → Load unpacked

**Log queries (для AI/меня):**
```
GET /api/logs/recent?n=10
GET /api/logs/recent?tag=api&n=5
GET /api/logs/summary?tag=prices
GET /api/session
GET /health
```

---

## 1. Компонентная архитектура (implemented)

```
┌──────────────────────────────────────────────────────────┐
│  MAIN world                    ISOLATED world            │
│  ┌──────────────────┐          ┌─────────────────────┐  │
│  │ interception.js   │─────────▶│ bridge.js            │  │
│  │ (fetch + XHR      │ postMsg  │ PortBridge (batch)   │  │
│  │  proxy + clone)   │          │ chrome.runtime.connect│  │
│  └──────────────────┘          └──────────┬───────────┘  │
│                                            │              │
│  ◄────────── Service Worker ──────────────┘              │
│  ┌────────────────────────────────────────────────────┐  │
│  │ background.js                                      │  │
│  │  ├── CaptureController (merge webRequest + CS)     │  │
│  │  │   ├── RuleEngine → tags                         │  │
│  │  │   ├── RingBuffer (10k)                          │  │
│  │  │   ├── ChromeStorage (flush 100)                 │  │
│  │  │   └── StreamBackend → POST localhost:3001       │  │
│  │  ├── WebRequestCollector (metadata gap-free)       │  │
│  │  └── chrome.alarms (keepalive 30s)                 │  │
│  └────────────────────────────────────────────────────┘  │
│                                            │              │
│  ◄────────── Overlay UI ───────────────────┘              │
│  ┌────────────────────────────────────────────────────┐  │
│  │ overlay.html (iframe)                              │  │
│  │  ├── Live (real-time stream)                       │  │
│  │  ├── History (paginated) + Detail panel            │  │
│  │  ├── Rules (CRUD + tags)                           │  │
│  │  └── Settings (stream endpoint, capture flags)     │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │ External: log-server (localhost:3001)               │  │
│  │  └── data/capture-log.ndjson                       │  │
│  │  └── API: recent, summary, session, health         │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Слой | Технология | Зачем |
|---|---|---|
| Build | **WXT** (Vite-based) | MV3 сборка, HMR, multi-browser |
| UI | **React 18** | Компонентный overlay |
| State | **Zustand** | Единое API SW + UI, subscribeWithSelector |
| CSS | **Tailwind CSS** | Utility-first, `dark:` тема |
| Validation | **Zod** | Планируется на границах миров (MAIN→SW) |
| Language | **TypeScript** | Весь проект |
| Testing | **Vitest + Playwright** | Планируется |

**AI/MCP задел:** сессионный сбор (tabId, capturedAt, timing), теги на правилах — фундамент для AI-анализа паттернов и MCP-серверов.

---
│  └──────────────────────────────────────────────────┘           │
└──────────────────────────────────────────────────────────────────┘
```

---

## 2. Модули (отдельные библиотеки)

### interception-lib (MAIN world)
```
interception-lib/
├── src/
│   ├── interceptors/
│   │   ├── fetch.js          ← Browser Proxy style + Deep-Crawler style
│   │   ├── xhr.js            ← Browser Proxy style
│   │   ├── blob-url.js       ← Deep-Crawler style
│   │   ├── data-url-scanner.js ← Deep-Crawler style
│   │   └── metrics.js        ← timing, size, contentType
│   ├── transparent.js        ← pass-through guard (не модифицируем)
│   ├── bridge.js             ← postMessage + fallback global var
│   └── index.js
```

**API:**
```javascript
// Всегда пассивный (transparent) — не модифицирует трафик
createCollector({
  captureRequestBody: true,   // default: true
  captureResponseBody: true,  // default: true
  captureBlobUrls: false,     // default: false  
  captureDataUrls: false,     // default: false
  maxBodySize: 1_000_000,     // 1MB default
  urlFilter: '*.example.com/*' // glob pattern (опционально)
}).start();

// Collector отправляет данные через bridge
collector.on('request', ({ id, url, method, status, requestBody, responseBody, headers, timing }) => {
  bridge.send('capture', data);
});
```

### messaging-lib (postMessage bridge)
```
messaging-lib/
├── src/
│   ├── bridge.js             ← postMessage MAIN → ISOLATED
│   ├── runtime.js            ← chrome.runtime.sendMessage ISOLATED → SW
│   ├── ports.js              ← chrome.runtime.connect (long-lived)
│   ├── ack.js                ← Requestly-style ack with timeout
│   └── index.js
```

### rules-lib (фильтрация и правила сбора)
```
rules-lib/
├── src/
│   ├── engine.js             ← match request against rules
│   ├── matchers/
│   │   ├── url.js            ← equals / contains / regex / wildcard / glob
│   │   ├── method.js         ← GET/POST/PUT/...
│   │   ├── resource-type.js  ← xhr/fetch/img/css/...
│   │   ├── status.js         ← 2xx/3xx/4xx/5xx
│   │   └── domain.js         ← page origin
│   ├── storage.js            ← rules CRUD via chrome.storage
│   ├── conditions.js         ← AND/OR/NOT composition
│   └── index.js
```

**API:**
```javascript
const engine = createRuleEngine([
  {
    name: 'My API',
    enabled: true,
    conditions: [
      { type: 'url', operator: 'contains', value: '/api/' },
      { type: 'method', operator: 'equals', value: 'GET' },
      { type: 'status', operator: 'range', min: 200, max: 299 }
    ],
    actions: {
      captureRequest: true,
      captureResponse: true,
      captureHeaders: true
    }
  }
]);
engine.match(request); // => matched rule or null
```

### storage-lib (сохранение данных)
```
storage-lib/
├── src/
│   ├── chrome-storage.js     ← chrome.storage.local (KV, ~5MB)
│   ├── indexed-db.js         ← IndexedDB (large data, ~GB)
│   ├── in-memory.js          ← RingBuffer (max N entries)
│   ├── stream.js             ← stream to backend (Deep-Crawler style)
│   └── index.js
```

### export-lib (экспорт)
```
export-lib/
├── src/
│   ├── json.js               ← JSON download (API Inspector style)
│   ├── har.js                ← HAR format (standard)
│   ├── csv.js                ← CSV for spreadsheets
│   └── index.js
```

---

## 3. Data Model

```typescript
interface CapturedRequest {
  id: string;                    // unique ID
  tabId: number;
  url: string;                   // full URL
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | ...
  status: number;                // 0 = error, 200 = ok, ...
  statusText?: string;
  
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  
  requestBody?: string;          // JSON / text / base64
  responseBody?: string;         // JSON / text / base64
  requestBodySize?: number;
  responseBodySize?: number;
  
  contentType?: string;          // response Content-Type
  requestContentType?: string;   // request Content-Type
  
  timing: {
    startTime: number;           // Date.now() at request start
    endTime?: number;
    duration?: number;           // ms
    dnsLookup?: number;
    tcpConnect?: number;
    tlsHandshake?: number;
    firstByte?: number;
  };
  
  resourceType: 'fetch' | 'xhr' | 'img' | 'css' | 'script' | 'media' | 'font' | 'ws';
  initiator?: string;            // page URL that initiated request
  frameId?: number;
  
  matchedRule?: string;          // name of matched collection rule
  ruleId?: string;
  
  blobUrl?: boolean;             // true if captured via blob: URL
  dataUrl?: boolean;             // true if captured via data: URL
  
  error?: string;                // error message if failed
  
  capturedAt: number;            // timestamp when extension captured
}
```

---

## 4. Логин сбора (CaptureController)

```javascript
// Service Worker
class CaptureController {
  constructor() {
    this.rulesEngine = new RuleEngine();
    this.collector = null;       // remote proxy to MAIN world interceptor
    this.webRequest = new WebRequestMetadata();
    this.store = new StorageService();
  }
  
  start() {
    // 1. webRequest — metadata для ВСЕХ запросов (gap-free)
    chrome.webRequest.onBeforeRequest.addListener(this.onBeforeRequest);
    chrome.webRequest.onCompleted.addListener(this.onCompleted);
    
    // 2. content script — injects MAIN world interceptor
    chrome.scripting.registerContentScripts([{
      id: 'collector',
      world: 'MAIN',
      runAt: 'document_start',
      allFrames: true,
      matches: ['<all_urls>'],
      js: ['interception-lib/index.js']
    }]);
    
    // 3. listen for incoming captured data from content script
    chrome.runtime.onMessage.addListener(this.onCapturedData);
  }
  
  async onCapturedData(message, sender) {
    if (message.type === 'capture:request') {
      const request = message.data;
      
      // Match against rules
      const rule = this.rulesEngine.match(request);
      if (!rule && !this.config.captureAll) return;  // skip if no rule match
      
      request.matchedRule = rule?.name;
      request.matchedRuleId = rule?.id;
      
      // Merge with webRequest metadata (API Inspector pattern)
      const meta = this.webRequestMetadata.get(message.sourceRequestId);
      if (meta) {
        request.timing = { ...request.timing, ...meta.timing };
      }
      
      // Store
      await this.store.save(request);
      
      // Notify UI
      this.broadcast('new-request', request);
    }
  }
}
```

---

## 5. UI Tabs & Панели

### Tab 1: Live Stream (реал-тайм)
```
┌────────────────────────────────────────────────────────────────┐
│ [Pause/Resume] [Clear] [Filter...]             Captured: 1,234 │
├────────────────────────────────────────────────────────────────┤
│  Method  │ URL                                    │ Status│Time│
│  GET     │ /api/products?page=1                    │ 200   │ 45 │
│  POST    │ /api/orders                             │ 201   │120 │
│  GET     │ /api/products?page=2                    │ 200   │ 32 │
│  PUT     │ /api/users/123                          │ 200   │ 67 │
├────────────────────────────────────────────────────────────────┤
│ [Selected detail: Headers | Body | Response | Timing]          │
└────────────────────────────────────────────────────────────────┘
```

### Tab 2: Request History
- Просмотр собранных запросов
- Фильтры по URL, method, status, domain, rule
- Экспорт (JSON, HAR, CSV)
- Удаление/очистка

### Tab 3: Rules Editor
```
┌────────────────────────────────────────────────────────────────┐
│ [Add Rule] [Import] [Export]                                   │
├────────────────────────────────────────────────────────────────┤
│ ○ Name: My Product API                          [Enabled]     │
│ Conditions:                                                    │
│   URL  [contains] [/api/products]                              │
│   + Method [equals] [GET]                                      │
│   + Status [range] [200] - [299]                              │
│   [Add Condition]                                              │
│                                                               │
│ Capture: [✓] Request Body  [✓] Response Body  [✓] Headers     │
│ Max body size: [500] KB                                        │
├────────────────────────────────────────────────────────────────┤
│ ○ Name: Search Queries                          [Enabled]     │
│   URL  [regex] [/search\?q=]                                   │
│ Capture: [✓] Response Body  [✓] Request Body                  │
└────────────────────────────────────────────────────────────────┘
```

### Tab 4: Settings
```
┌────────────────────────────────────────────────────────────────┐
│ Interception:                                                  │
│   [✓] Capture fetch/XHR (MAIN world)                          │
│   [✓] Capture blob: URLs                                       │
│   [✓] Capture data: URLs                                       │
│   [✓] webRequest metadata backup                               │
│   Injection timing: [document_start]                            │
│   Max entries: [10,000] in memory                              │
│                                                               │
│ Storage:                                                       │
│   [/] chrome.storage.local (auto-save)                         │
│   [ ] IndexedDB (large data)                                   │
│   [ ] Stream to endpoint: _________________________            │
│   Flush interval: [5] sec OR [100] entries                     │
│                                                               │
│ Auto-crawl: [Disabled]                                         │
│   [ ] Scroll, [ ] Click buttons, [ ] Trigger inputs            │
│                                                               │
│ Export defaults: [JSON] [Pretty] [Include bodies]              │
└────────────────────────────────────────────────────────────────┘
```

---

## 6. По кнопкам — что откуда взято

| Элемент | Источник | Реализация |
|---|---|---|
| Floating overlay | API Inspector | Full-screen, top-right, resizable |
| Drag-to-move | API Inspector | Header mousedown |
| Sidebar tree (sites/rules) | Browser Proxy | React + react-dnd |
| Live stream table | API Inspector + Cat-Catch | Sortable columns |
| Request detail tabs (General/Headers/Body) | API Inspector + Requestly | Tab system |
| Rule editor | Browser Proxy + Requestly | Conditions + Actions |
| Source conditions (URL/method/status) | Requestly | equals/contains/regex/wildcard |
| Advanced filters (domain/type) | Requestly | AND/OR conditions |
| Stats bar (total/failed/slow/avg) | API Inspector | Live counters |
| Search + filter pills | Browser Proxy | Regex search, token pills |
| Pagination | Browser Proxy | Page numbers |
| Body viewer (JSON pretty-print) | API Inspector | Pre block, max-height scroll |
| Schema validation | API Inspector | URL pattern + JSON schema |
| Export JSON | API Inspector | Download file |
| Export HAR | — | Standard format |
| Clear / Pause / Resume | All | Toggle capture state |
| Empty state (illustration) | Browser Proxy + Requestly | SVG + text |
| Toast notifications | API Inspector | Auto-dismiss |
| PostMessage bridge | All | MAIN → ISOLATED → SW |
| webRequest metadata backup | API Inspector | SW listeners |
| Ack-based bridge (optional) | Requestly | Timeout + race |
| Blob URL capture | Deep-Crawler | URL.createObjectURL proxy |
| Data URL scan | Deep-Crawler | DOM + CSS scan |
| Auto-crawl (scroll/click/input) | Deep-Crawler | Programmatic interaction |
| Chunked body editor | Browser Proxy | Multi-chunk with delay |
| Variables (regex capture groups) | Browser Proxy | Name + regex |
| URL query params editor | Browser Proxy | Key/value breakdown |
| File-based body (ArrayBuffer) | Browser Proxy | Base64 upload |
| Aria2 / MQTT integration | Cat-Catch | External service hooks |
