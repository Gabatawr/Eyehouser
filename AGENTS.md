# Eyehouser — Developer Guide

## Project Goal
Research open-source Chrome extensions for data collection (no F12/CDP). Design and implement a universal data collector for competitive analysis (prices, assortment, API). Foundation for session-based collection → AI pattern analysis → MCP services.

## Current Phase
Assembly and iterative improvement based on analysis of 6 reference repositories. All base features implemented.

## Architecture

### Worlds (Chrome MV3)

| World | JS context | DOM | CSP | chrome.* API |
|---|---|---|---|---|
| **MAIN** | shared with page | ✅ | ⚠️ no | ❌ no |
| **ISOLATED** | isolated | ✅ | ✅ | ✅ **yes** |
| **SERVICE_WORKER** | separate thread | ❌ | ✅ | ✅ **yes** |

### Bridge: MAIN → ISOLATED → SW

```
MAIN: window.postMessage({source:'eyehouser', type:'capture', data})
        │ Structured Clone Algorithm (Blink)
        ▼
ISOLATED: window.addEventListener('message')
        │
        ▼
ISOLATED: PortBridge — batch queue (50 / 200ms) — keepalive ping (25s)
        │ chrome.runtime.Port (long-lived)
        ▼
SW: CaptureController.processFromContent()
```

**Structured Clone Algorithm** — browser IPC that clones objects (not references) between worlds. Only way MAIN → ISOLATED, not blocked by CSP.

**Long-lived port** needed instead of `chrome.runtime.sendMessage` because hundreds of req/s with one-shot calls create race conditions and GC pressure.

### Dual-layer: MAIN + webRequest

```
MAIN proxy → request/response body
webRequest → tabId, initiator, precise duration, status (even if MAIN didn't capture)
```

`findMeta(url, method, refTime)` — matches MAIN entry with webRequest metadata by `(url + method + time window < 1s)`.

## Key Architecture Decisions

1. `world: "MAIN"` in manifest.json for CSP-safe injection (ref: Deep-Crawler)
2. `fetch/XHR pass-through proxy` — `response.clone().text()`, no modification (ref: Browser Proxy)
3. **Dual-layer** — webRequest (metadata) + MAIN proxy (body) = gap-free (ref: API Inspector)
4. **Long-lived port** + batch queue for MAIN→SW transfer (ref: Inssman, Requestly)
5. **RingBuffer** in-memory (10k entries) + chrome.storage.local flush + optional stream (ref: Deep-Crawler)
6. **Rules engine** — URL/method/status/domain/content-type, operators: equals/contains/regex/wildcard/range/in (ref: Requestly)
7. **Session collection** — all entries with `tabId`, `capturedAt`, `timing.startTime`, `initiator` for grouping
8. **AI-ready** — data model designed for MCP servers and agent-based pattern analysis

## Dev Workflow

### Build

```bash
cd eyehouser
npm install
npm run build    # prebuild: npm version --no-git-tag-version patch
```

Output: `eyehouser/.output/chrome-mv3`

### Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select `eyehouser/.output/chrome-mv3`
5. Toggle overlay: click the Eyehouser icon in the toolbar

### Log server

```bash
export COMPOSE='docker compose -f deploy/docker-compose.yml'
$COMPOSE up -d                                    # start log-server
$COMPOSE down                                     # stop
$COMPOSE logs -f                                  # logs (Ctrl+C to exit)
```

### View capture log

```bash
./tail-log.sh           # last 10 entries (pretty-print)
./tail-log.sh -f        # real-time follow
./tail-log.sh 50        # last 50
```

### Pipeline

```
Extension ──POST batch──► log-server (Docker, :3001)
                                │
                                └──► NDJSON (data/capture-log.ndjson)
```

## Known Issues

- `npm run dev` (WXT HMR) — **doesn't work** in tmux on WSL (inotify doesn't detect changes)
- Working cycle: `npm run build` (2.5s) → reload in `chrome://extensions`
- Log server in Docker, build in tmux — they don't interfere

### Fix history

- `srcDir: 'src'` → public/** in `src/public/`, not in root
- WAR references `content-scripts/interception.js`, not `lib/interception.js`
- `version` removed from wxt.config.ts — read from package.json
- `npm run build` — prebuild `npm version --no-git-tag-version patch`
