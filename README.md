# Eyehouser

Universal data collector for competitive analysis (prices, assortment, API). Chrome extension (MV3) + log-server.

## Quick start

```bash
cd eyehouser
npm install
npm run build    # typecheck + build → .output/chrome-mv3
```

Load unpacked in `chrome://extensions` → click icon to toggle overlay.

**Log server** (Docker):

```bash
docker compose -f deploy/docker-compose.yml up -d
./tail-log.sh -f
```

## Architecture

```
MAIN proxy ──postMessage──► ISOLATED bridge ──Port batch──► SW CaptureController
   │                                                            │
   │  fetch/XHR/blob/data-url                                   ├── RingBuffer (10k)
   │                                                            ├── chrome.storage.local
   │                                                            └── StreamBackend ──► log-server
   │                                                                                 
webRequest ──► WebRequestCollector ──findMeta──► merge with MAIN body (gap-free)
```

Three worlds (MV3): **MAIN** (page, fetch/XHR proxy), **ISOLATED** (bridge, validation, batching), **SW** (controller, storage, webRequest).

## Repo structure

| Path | Description |
|---|---|
| `eyehouser/` | Extension source (WXT, React, Zustand, Tailwind, Zod) |
| `deploy/` | Docker compose + log-server (Express, NDJSON) |
| `docs/` | Technical docs: architecture, collection tech, spec |
| `data/` | Capture logs (NDJSON) |
| `tail-log.sh` | Log viewer |

## Docs

- [`eyehouser/README.md`](eyehouser/README.md) — full extension docs
- [`docs/collector-architecture.md`](docs/collector-architecture.md) — architecture deep dive
- [`docs/collection-tech.md`](docs/collection-tech.md) — collection techniques researched
- [`docs/collector-spec.md`](docs/collector-spec.md) — specification

## License

MIT
