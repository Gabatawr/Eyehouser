import { defineContentScript } from 'wxt/sandbox';
import { PortBridge, onMessageFromMain } from '../lib/messaging';
import { MainMessageSchema } from '../lib/validation/schemas';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  allFrames: true,
  main() {
    const bridge = new PortBridge();
    bridge.connect();
    bridge.startPing();

    onMessageFromMain((msg) => {
      if (!MainMessageSchema.safeParse(msg).success) return;
      bridge.send(msg);
    });
  }
});
