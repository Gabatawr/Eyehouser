# Eyehouser — Universal Data Collector (Chrome MV3)

A dual-layer network request interceptor for competitive analysis: request/response body via MAIN-world fetch/XHR proxies, metadata via `chrome.webRequest`. In-memory ring buffer + chrome.storage + streaming backend.

> ⚠️ **Educational / Research project.** This extension captures network data for competitive and analytical purposes. Use responsibly and in compliance with website terms of service.

## Architecture

```
MAIN World (page)          ISOLATED (bridge)         Service Worker            Log Server :3001
┌─────────────────┐       ┌────────────────┐       ┌────────────────────┐     ┌─────────────────┐
│ window.fetch ───┼──►    │ onMessage      │       │ CaptureController  │     │ POST /api/capture│
│ XMLHttpRequest  │       │ PortBridge     │       │ WebRequestCollector│────►│ capture-log.ndjson│
│ createObjectURL │       │ batch (50/200ms)│      │ RuleEngine         │     └─────────────────┘
│ DOM data-urls   │       │ chrome.runtime │       │ RingBuffer (10k)   │
└───────┬─────────┘       │ .Port          │       │ ChromeStorage      │
        │ postMessage     └────────┬───────┘       │ StreamBackend      │
        └──────────────────────────┘               └────────────────────┘
                              │ chrome.runtime
                              │ .sendMessage
                              ▼
                        ┌────────────────┐
                        │ Overlay UI     │
                        │ (React/Zustand)│
                        └────────────────┘
```

## Single-request pipeline

```
MAIN proxy → postMessage{source:'eyehouser'} → ISOLATED bridge → port batch
→ SW CaptureController → RingBuffer + ChromeStorage + StreamBackend → log-server
                                                      ↓
                                               UI (Zustand → React)
```

**Dual-layer merge:** MAIN proxy captures request/response body; `chrome.webRequest` provides `tabId`, `initiator`, precise `duration`, status code. `findMeta(url, method, refTime)` matches them within a 1-second window.

## Storage layers

| Layer | Capacity | Speed | Persistence | Purpose |
|---|---|---|---|---|
| **RingBuffer** | 10,000 | O(1) | no (dies with SW) | UI, live stream |
| **chrome.storage.local** | 10,000 (tail) | ~10ms/batch | ✅ yes (survives SW restart) | History between sessions |
| **NDJSON (log-server)** | ∞ (file) | ~1ms POST | ✅ yes | Analytics, AI reading |

## Interception mechanisms

| Mechanism | Technique |
|---|---|
| **fetch** | `const original = window.fetch` → `response.clone().text()` → read body without consuming |
| **XHR** | `WeakMap<XHR, Meta>` → `readyState 3` chunks (streaming), `readyState 4` final body |
| **Blob** | `URL.createObjectURL` → `blob.text()` / `FileReader.readAsDataURL` |
| **Data URL** | Periodic DOM scan (5s) → `querySelectorAll` + regex `/data:.../` |

## Comparison with reference implementations

| Feature | Eyehouser | Deep-Crawler | API-Inspector | Browser-Proxy | Cat-Catch | Requestly | Inssman |
|---|---|---|---|---|---|---|---|
| MAIN world inj. | `world:"MAIN"` manifest | ✅ manifest | ❌ ISOLATED | ✅ WAR | ✅ scripting | ✅ register | ✅ register |
| Fetch body | ✅ clone.text() | ❌ meta only | ⚠️ broken | ✅ clone.text() | ❌ | ✅ conditional | ✅ conditional |
| XHR body | ✅ responseText | ❌ meta only | ⚠️ broken | ✅ response | ❌ | ✅ conditional | ✅ conditional |
| XHR chunks | ✅ readyState 3 | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Blob + content | ✅ text/DataURL | ⚠️ URL only | ❌ | ❌ | ❌ | ❌ | ❌ |
| Data URL | ✅ DOM scan | ✅ DOM scan | ❌ | ❌ | ❌ | ❌ | ❌ |
| webRequest merge | ✅ findMeta | ❌ | ✅ | ❌ | ✅ | ✅ | ✅ |
| Batch port | ✅ 200ms/50 | ❌ sendMsg | ❌ sendMsg | ❌ sendMsg | ❌ sendMsg | ❌ ack | ❌ pub/sub |
| RingBuffer | ✅ 10k | ❌ 5k array | ❌ 300 Map | ❌ | ❌ | ❌ | ❌ |
| NDJSON stream | ✅ POST batch | ✅ fetch POST | ❌ | ❌ | ❌ | ❌ | ❌ |
| Rules engine | ✅ 6 types | ❌ | ❌ | ❌ | ❌ | ✅ complex | ✅ complex |
| Zod validation | ✅ world boundaries | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| CSP-safe | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Transparent | ✅ (collector) | ✅ (collector) | ✅ (collector) | ✅ (proxy) | ✅ (sniffer) | ❌ (modifier) | ❌ (modifier) |

## Getting started

### Prerequisites

- Node.js 18+
- Chrome/Edge browser
- Docker (for log server, optional)

### Build

```bash
cd eyehouser
npm install
npm run build
```

The built extension will be at `eyehouser/.output/chrome-mv3`.

### Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select `eyehouser/.output/chrome-mv3`

### Toggle overlay

Click the Eyehouser icon in the browser toolbar to show/hide the overlay.

### Log server (optional)

```bash
docker compose -f deploy/docker-compose.yml up -d
```

Receives POST batches at `http://localhost:3001/api/capture` and appends to `data/capture-log.ndjson`.

### Log API

| Endpoint | Purpose |
|---|---|
| `GET /health` | Server status + file path |
| `GET /api/session` | Current session info |
| `POST /api/session/start` | Start a new session |
| `POST /api/session/end` | End current session |
| `GET /api/logs/recent?n=10&tag=` | Last N entries (optional tag filter) |
| `GET /api/logs/summary?tag=` | Aggregated summary by method/status/type |

### View logs

```bash
./tail-log.sh           # last 10 entries (pretty-print)
./tail-log.sh -f        # real-time follow
./tail-log.sh 50        # last 50
```

## Tech stack

| Layer | Technology | Purpose |
|---|---|---|
| Build | **WXT** (Vite) | MV3 extension build, HMR, multi-browser |
| UI | **React 18** | Component overlay |
| State | **Zustand** | Unified API for SW + UI, subscribeWithSelector |
| CSS | **Tailwind CSS** | Utility-first, dark theme via `dark:` |
| Validation | **Zod** | Schemas at world boundaries (MAIN→SW, rules, config) |
| Language | **TypeScript** | Full project |
| Testing | **Vitest + Playwright** | Unit + e2e |

## Project structure

```
eyehouser/
├── src/
│   ├── entrypoints/
│   │   ├── background.ts           ← Service Worker
│   │   ├── bridge.content.ts       ← ISOLATED world bridge
│   │   ├── inject.content.ts       ← WAR overlay injector
│   │   ├── interception.content.ts ← MAIN world (world: "MAIN")
│   │   └── overlay/               ← React app
│   ├── lib/
│   │   ├── interception.ts         ← fetch/XHR/blob/data-url proxies
│   │   ├── messaging.ts            ← PortBridge, postMessage
│   │   ├── blob-capture.ts
│   │   ├── data-url-scanner.ts
│   │   ├── rules/                  ← engine, matchers, storage
│   │   ├── storage/                ← RingBuffer, ChromeStorage, StreamBackend
│   │   └── validation/schemas.ts   ← Zod schemas
│   ├── sw/
│   │   ├── controllers/capture.ts
│   │   └── services/webrequest.ts
│   └── ui/
│       ├── overlay/App.tsx
│       ├── store/                  ← Zustand (requests, rules, config)
│       ├── tabs/                   ← Live, History, Detail, Rules, Settings
│       └── components/             ← Table, Badge, Toast, Pagination, etc.
├── deploy/
│   ├── docker-compose.yml
│   └── log-server.mjs
└── docs/
    ├── collection-tech.md
    ├── collector-architecture.md
    └── collector-spec.md
```

## References

- [Deep-Crawler](https://github.com/usemanusai/Deep-Crawler) — MAIN world manifest, data-url scanner, stream backend
- [API Inspector](https://github.com/guimmamanna/Api-Inspector) — dual-layer (webRequest + content script), overlay UI
- [Browser Proxy](https://github.com/Vladislav-Boiko/browser-proxy) — WAR injection, Proxy-based fetch, XhrProxy class
- [Cat-Catch](https://github.com/xifangczy/cat-catch) — MediaSource proxy, DNR, session storage
- [Requestly](https://github.com/requestly/requestly) — registerContentScripts, ack-based bridge, complex rules engine
- [Inssman](https://github.com/vvmgev/Inssman) — registerContentScripts, ListenerService pub/sub, code injection

## License

MIT — see [LICENSE](eyehouser/LICENSE).
