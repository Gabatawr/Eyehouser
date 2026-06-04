import { defineContentScript } from 'wxt/sandbox';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    let iframe: HTMLIFrameElement | null = null;

    chrome.runtime.onMessage.addListener((msg, _, sendResponse) => {
      if (msg.source !== 'eyehouser') return;
      if (msg.type === 'toggle-overlay') {
        if (iframe) { close(); } else { open(); }
        sendResponse?.({ success: true });
      }
    });

    async function getWidth(): Promise<number> {
      try {
        const res = await chrome.storage.local.get('eyehouser_config');
        return res.eyehouser_config?.overlayWidth ?? 50;
      } catch {
        return 50;
      }
    }

    async function open() {
      if (iframe) return;
      const width = await getWidth();
      iframe = document.createElement('iframe');
      iframe.id = 'eyehouser-overlay';
      iframe.src = chrome.runtime.getURL('/overlay.html');
      iframe.style.cssText = `
        position: fixed !important; top: 0 !important; right: 0 !important;
        z-index: 2147483646 !important; height: 100vh !important;
        width: ${width}vw !important; min-width: 320px !important; max-width: 80vw !important;
        border: none !important;
        box-shadow: -4px 0 24px rgba(0,0,0,0.5) !important;
      `;
      document.body.appendChild(iframe);
      document.body.style.overflow = 'hidden';
    }

    function close() {
      iframe?.remove();
      iframe = null;
      document.body.style.overflow = '';
    }
  }
});
