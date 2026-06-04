import { defineContentScript } from 'wxt/sandbox';
import { createFetchProxy, createXhrProxy } from '../lib/interception';
import { createBlobProxy } from '../lib/blob-capture';
import { createDataUrlScanner } from '../lib/data-url-scanner';
import { postMessageToMain } from '../lib/messaging';

export default defineContentScript({
  matches: ['<all_urls>'],
  world: 'MAIN',
  runAt: 'document_start',
  allFrames: true,
  main() {
    if ((window as any).__eyehouserInjected) return;
    (window as any).__eyehouserInjected = true;

    const send = (data: any) => {
      postMessageToMain({ source: 'eyehouser', type: 'capture', data });
    };

    createFetchProxy(send);
    createXhrProxy(send);
    createBlobProxy(send);
    createDataUrlScanner(send);
  }
});
