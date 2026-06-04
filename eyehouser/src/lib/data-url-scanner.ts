import { CapturedData } from './interception';

const DATA_URL_RE = /data:[^"'\s;)]+/g;
const MAX_ELEMENTS = 2000;
const POLL_INTERVAL = 5000;
const SCAN_TIMEOUT_MS = 100;

type Sender = (data: CapturedData) => void;

function scanDataUrls(): string[] {
  const found = new Set<string>();

  const elements = document.querySelectorAll('*');
  if (elements.length > MAX_ELEMENTS) return [];

  const deadline = performance.now() + SCAN_TIMEOUT_MS;

  for (const el of elements) {
    if (performance.now() > deadline) break;
    for (const attr of el.attributes) {
      if (attr.value.includes('data:')) {
        attr.value.match(DATA_URL_RE)?.forEach((u) => found.add(u));
      }
    }
  }

  if (performance.now() < deadline) {
    for (const el of elements) {
      if (performance.now() > deadline) break;
      try {
        const styles = getComputedStyle(el);
        for (let i = 0; i < styles.length; i++) {
          const val = styles.getPropertyValue(styles[i]);
          if (val.includes('data:')) {
            val.match(DATA_URL_RE)?.forEach((u) => found.add(u));
          }
        }
      } catch {}
    }
  }

  return [...found];
}

export function createDataUrlScanner(send: Sender) {
  let known = new Set<string>();

  function scanAndSend() {
    const urls = scanDataUrls();
    for (const url of urls) {
      if (known.has(url)) continue;
      known.add(url);

      const mime = url.split(',')[0].replace('data:', '').split(';')[0];

      send({
        id: crypto.randomUUID(),
        type: 'data-url',
        url,
        contentType: mime,
        timing: { startTime: performance.now(), duration: 0 },
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scanAndSend, { once: true });
  } else {
    scanAndSend();
  }

  const observer = new MutationObserver(() => {
    scanAndSend();
  });
  observer.observe(document.documentElement, {
    attributes: true, childList: true, subtree: true, attributeFilter: ['src', 'href', 'style'],
  });

  setInterval(scanAndSend, POLL_INTERVAL);
}
