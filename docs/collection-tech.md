# Technology Map: Data Collection in Chrome Extensions (No F12, No Native Proxy)

---

## Framework: что Chrome позволяет легально

```
┌─────────────────────────────────────────────────────────────────────┐
│                    CHROME EXTENSION SANDBOX                          │
│                                                                     │
│  SW (service_worker.js)     ← 30s life → heartbeat/alarms needed    │
│  ├─ webRequest API           → metadata: url, headers, timing        │
│  │                            → NO body access (MV3 limitation)      │
│  ├─ DNR                      → zero data back to extension           │
│  ├─ scripting.executeScript  → dynamic injection                     │
│  └─ runtime.sendMessage      → hub for all data                      │
│                                                                     │
│  Content Script (ISOLATED)   ← postMessage bridge to MAIN            │
│  ├─ runtime.sendMessage → SW  ← relay layer                          │
│  └─ window.postMessage       ← receive from MAIN                     │
│                                                                     │
│  Page Script (MAIN)          ← THE ONLY way to get response body     │
│  ├─ proxy fetch()             → clone.text() = body                  │
│  ├─ proxy XMLHttpRequest      → responseText = body                  │
│  ├─ proxy URL.createObjectURL → blob: URL capture                   │
│  └─ DOM scan                  → data: URL capture                   │
└─────────────────────────────────────────────────────────────────────┘
```

## 4 архитектуры из наших репозиториев

### A. Single-layer: MAIN proxy только (Browser Proxy)

```
MAIN: proxy fetch/XHR → clone body → postMessage
  → ISOLATED: relay
    → SW: Redux store
```

- Прозрачный
- Тело ответа ✅
- Не видит запросы ДО инъекции
- CSP-sensitive (WAR+script tag)
- ❌ Нет webRequest backup — теряет img, css, js

### B. Dual-layer: webRequest + MAIN proxy (API Inspector)

```
SW: webRequest metadata → Map<requestId, meta>
MAIN: proxy fetch/XHR → body
  → ISOLATED: body → SW → merge by URL+method
```

- Гарантия: webRequest видит всё, MAIN даёт тело
- Нет gap'а (webRequest срабатывает сразу)
- ❌ `document_idle` — поздняя инъекция (можно починить на `document_start`)
- ❌ Матчинг по URL+method вместо requestId

### C. SW-centric: webRequest sniffing (Cat-Catch)

```
SW: webRequest.onSendHeaders/onResponseStarted → sniff URLs
MAIN: MediaSource proxy + String proxy → body
```

- webRequest видит сразу, не ждёт инъекцию
- Не предназначен для API данных (медиа-фокус)
- String proxy (JSON.parse, indexOf) — хрупко

### D. Manifest-native: world:MAIN без WAR (Deep-Crawler)

```
manifest.json:
  content_scripts: [{
    world: "MAIN",
    run_at: "document_start",
    js: ["network-interceptor.js"]
  }]

MAIN: proxy fetch/XHR → metadata → postMessage
  → ISOLATED: → local array → batch → sendMessage → SW → backend
```

- ✅ CSP-safe (не создаёт script tag)
- ✅ `document_start` — раньше всех page scripts
- ❌ Не читает тело ответа (можно добавить)
- blob/data URL capture ✅

---

## Что Chrome API дают для сбора — точная карта

| API / метод | Видит | Не видит | Легально? | CWS risk |
|---|---|---|---|---|
| `webRequest` | url, headers, status, timing, type | body (request+response) | ✅ | low |
| `DNR` | ничего | ничего (только modify) | ✅ | low |
| `content_scripts` ISOLATED | DOM | JS переменные, fetch/XHR | ✅ | low |
| `content_scripts` MAIN (`world: "MAIN"`) | всё в page context | — | ⚠️ спорно | medium |
| WAR + script tag | всё | — | ⚠️ CSP workaround | medium |
| `scripting.executeScript` | что запросили | — | ✅ | low |
| `tabs.captureVisibleTab` | скриншот | network | ✅ | low |
| `debugger` (CDP) | всё | — | ❌ нужен DevTools | high |
| `proxy` | всё (через MITM) | — | ❌ нужен бинарник | high |

**CWS risk для MAIN мира:**

Правила Chrome Web Store:
- **Нельзя** модифицировать страницу без явного consent пользователя
- **Можно** делать read-only наблюдение (pass-through proxy)
- Monkey-patching `fetch`/`XHR` — серая зона. Если не меняешь данные и не ломаешь страницу — обычно проходят. Если модифицируешь — рискуешь.
- `world: "MAIN"` в manifest — новый API, легитимность подтверждена Chrome (иначе бы не добавили)

---

## Что реально работает для background-сбора без F12 и proxy

Только **одна комбинация** даёт тело ответа:

```
MAIN world (document_start) → proxy fetch/XHR → clone().text() → postMessage
∪
SW webRequest (metadata backup, no gap)
```

Это то, что делает Browser Proxy (без SW) и частично API Inspector.

---

## Ограничения Chrome, которые не обойти в MV3

| Ограничение | Почему | Что делать |
|---|---|---|
| Нет response body в webRequest | MV3 отключил | Только MAIN proxy |
| Нет requestBody в webRequest | MV3 отключил | Только MAIN proxy |
| SW живёт ~30s | Экономия памяти | Heartbeat (alarms / port keepalive) |
| Нет доступа к page JS из ISOLATED | Security model | postMessage bridge |
| CSP блокирует WAR script injection | Безопасность | `world: "MAIN"` в manifest |
| `document_idle` пропускает ранние запросы | Timing | Исправить на `document_start` |
| postMessage не имеет requestId | Нет correlation | Матчить по URL+method+timestamp |
| 256KB limit в некоторых реализациях | API Inspector | Своя имплементация без лимита |
| Blob URL — только URL, не содержимое | Security | Принимаем ограничение |

---

## Исследовательский фреймворк

**Как анализировать следующий репозиторий:**

1. Определить **категорию**:
   - Какое Chrome API используется для перехвата?
   - Есть ли MAIN world injection?
   - Есть ли webRequest для metadata?
   - Есть ли DNR?

2. Определить **capabilities**:
   - Видит тело ответа? Через что?
   - Прозрачный или модифицирующий?
   - Timing инъекции?
   - Работает в фоне?

3. Определить **data flow**:
   - Как данные идут от точки перехвата до storage?
   - postMessage? runtime.sendMessage? Ports?
   - Какой message pattern?

4. Определить **CWS permissibility**:
   - Есть ли read-only mode?
   - Требует ли специфических permission?
   - Есть ли fallback при отказе?

---

## Под капотом: code patterns из репозиториев

### fetch proxy (pass-through, с телом)
```javascript
// Browser Proxy style
const originalFetch = window.fetch;
window.fetch = function(...args) {
  return originalFetch.apply(this, args).then(async response => {
    const body = await response.clone().text();
    window.postMessage({ type: 'NET_REQ', url: response.url, body }, '*');
    return response; // ← transparent
  });
};
```

### XHR proxy (pass-through, с телом)
```javascript
// Browser Proxy style
const originalOpen = XMLHttpRequest.prototype.open;
const originalSend = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.open = function(method, url) {
  this._url = url; this._method = method;
  return originalOpen.apply(this, arguments);
};
XMLHttpRequest.prototype.send = function(body) {
  this.addEventListener('load', () => {
    window.postMessage({
      type: 'NET_REQ', url: this._url, status: this.status,
      body: this.responseText
    }, '*');
  });
  return originalSend.call(this, body);
};
```

### postMessage bridge (MAIN → ISOLATED)
```javascript
// All repos
// MAIN:
window.postMessage({ source: 'ext', type: 'NET_REQ', data: {...} }, '*');

// ISOLATED:
window.addEventListener('message', (e) => {
  if (e.data?.source === 'ext') {
    chrome.runtime.sendMessage(e.data);
  }
});
```

### Ack-based bridge (Requestly style)
```javascript
// postMessageAndWaitForAck
window.postMessage(msg, '*');
await new Promise((resolve, reject) => {
  const handler = (e) => {
    if (e.data?.ackFor === msg.id) {
      window.removeEventListener('message', handler);
      resolve(e.data);
    }
  };
  window.addEventListener('message', handler);
  setTimeout(() => reject(new Error('timeout')), 2000);
});
```

### webRequest metadata + body merge
```javascript
// API Inspector style
// SW:
chrome.webRequest.onCompleted.addListener((d) => {
  metadata.set(d.requestId, { url: d.url, status: d.statusCode, ... });
});

// Content script:
// proxy fetch → получает body, шлёт { url, method, body }
// SW матчит: metadata.find(m => m.url === bodyMsg.url && m.status...)
```

---

## Что дальше

С этим фреймворком можно:
1. **Классифицировать** любой новый репозиторий за 5 минут
2. **Сравнивать** подходы по объективным критериям
3. **Выявлять** пробелы (чего Chrome не даёт, что приходится обходить)
4. **Проектировать** архитектуру под конкретную задачу сбора
