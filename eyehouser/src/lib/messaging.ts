interface Message {
  source: string;
  type: string;
  data?: any;
}

export class PortBridge {
  private port: chrome.runtime.Port | null = null;
  private queue: Message[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly flushInterval = 200;
  private readonly maxBatch = 50;

  connect(name = 'eyehouser-bridge') {
    this.port = chrome.runtime.connect({ name });
    this.port.onDisconnect.addListener(() => {
      this.port = null;
      setTimeout(() => this.connect(name), 1000);
    });
    return this;
  }

  send(msg: Message) {
    this.queue.push(msg);
    if (this.queue.length >= this.maxBatch) this.flush();
    if (!this.timer) this.timer = setTimeout(() => this.flush(), this.flushInterval);
  }

  private flush() {
    if (this.queue.length === 0) return;
    const batch = this.queue.splice(0, this.maxBatch);
    this.port?.postMessage({ type: 'batch', batch });
    this.timer = null;
  }

  startPing(interval = 25000) {
    setInterval(() => {
      try { this.port?.postMessage({ type: 'ping' }); } catch {}
    }, interval);
  }

  onMessage(handler: (msg: Message) => void) {
    this.port?.onMessage.addListener(handler);
  }
}

export function postMessageToMain(msg: Message) {
  window.postMessage(msg, '*');
}

export function onMessageFromMain(handler: (msg: Message) => void) {
  window.addEventListener('message', (event) => {
    if (event.data?.source === 'eyehouser') handler(event.data);
  });
}
