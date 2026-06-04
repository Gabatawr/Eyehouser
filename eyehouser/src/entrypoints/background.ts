import { defineBackground } from 'wxt/sandbox';
import { CaptureController } from '../sw/controllers/capture';
import { BatchMessageSchema } from '../lib/validation/schemas';

const STREAM = 'http://localhost:3001/api/capture';
const BASE = 'http://localhost:3001';

function post(url: string, body: object) {
  fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => {});
}

export default defineBackground({
  main() {
    post(`${BASE}/api/session/start`, { startedAt: new Date().toISOString() });

    chrome.action.onClicked.addListener(() => {
      chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
        if (!tab?.id) return;
        chrome.tabs.sendMessage(tab.id, { source: 'eyehouser', type: 'toggle-overlay' }).catch(() => {
          const id = tab.id as number;
          Promise.all([
            chrome.scripting.executeScript({ target: { tabId: id, allFrames: true }, files: ['content-scripts/interception.js'], world: 'MAIN' }),
            chrome.scripting.executeScript({ target: { tabId: id, allFrames: true }, files: ['content-scripts/bridge.js'] }),
            chrome.scripting.executeScript({ target: { tabId: id }, files: ['content-scripts/inject.js'] }),
          ]).then(() => {
            chrome.tabs.sendMessage(id, { source: 'eyehouser', type: 'toggle-overlay' });
          }).catch(() => {});
        });
      });
    });

    chrome.storage.local.get('eyehouser_config').then((res) => {
      const cfg = res.eyehouser_config || {};

      const controller = new CaptureController({
        captureAll: cfg.captureAll ?? true,
        captureFetch: cfg.captureFetch ?? true,
        captureXhr: cfg.captureXhr ?? true,
        captureBlob: cfg.captureBlob ?? false,
        captureDataUrls: cfg.captureDataUrls ?? false,
        maxBodySize: cfg.maxBodySize ?? 1_000_000,
        maxEntries: cfg.maxEntries ?? 10_000,
        autoSaveToStorage: cfg.autoSaveToStorage ?? true,
        streamEndpoint: cfg.streamEndpoint || STREAM,
      });

      let captureCount = res.eyehouser_count ?? 0;
      let badgeTimer: ReturnType<typeof setTimeout> | null = null;
      const updateBadge = () => {
        const text = captureCount > 999 ? '999+' : String(captureCount);
        chrome.action.setBadgeText({ text }).catch(() => {});
        chrome.action.setBadgeBackgroundColor({ color: '#3b82f6' }).catch(() => {});
      };
      const debounceBadge = () => {
        if (badgeTimer) return;
        badgeTimer = setTimeout(() => { badgeTimer = null; updateBadge(); }, 400);
      };
      controller.onCaptured((req) => {
        controller.flush();
        captureCount++;
        debounceBadge();
        chrome.runtime.sendMessage({ source: 'eyehouser', type: 'capture', data: req }).catch(() => {});
      });

      controller.start();

      chrome.runtime.onMessage.addListener((msg, _, sendResponse) => {
        if (msg.source === 'eyehouser' && msg.type === 'clear') {
          captureCount = 0;
          controller.clear();
          updateBadge();
          sendResponse?.({ success: true });
        }
      });

      chrome.runtime.onConnect.addListener((port) => {
        if (port.name !== 'eyehouser-bridge') return;
        port.onMessage.addListener((msg) => {
          const parsed = BatchMessageSchema.safeParse(msg);
          if (!parsed.success) return;
          const tabId = port.sender?.tab?.id;
          for (const item of parsed.data.batch) {
            if (tabId) item.data.tabId = tabId;
            controller.processFromContent(item.data);
          }
        });
      });

      chrome.alarms?.create('eyehouser-keepalive', { periodInMinutes: 0.5 });
      chrome.alarms?.onAlarm.addListener(() => {
        controller.flush();
        chrome.storage.local.set({ eyehouser_count: captureCount }).catch(() => {});
      });
    }).catch(() => {});
  }
});
