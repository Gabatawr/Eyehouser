import { CapturedData } from './interception';

const MAX_BODY = 1_000_000;

type Sender = (data: CapturedData) => void;

function isTextType(mime: string): boolean {
  return !mime || mime.startsWith('text/') || mime.startsWith('application/json')
    || mime.startsWith('application/xml') || mime.startsWith('application/javascript');
}

function readBlobContent(blob: Blob): Promise<string | undefined> {
  if (isTextType(blob.type)) {
    return blob.text().catch(() => undefined);
  }
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string || undefined);
    reader.onerror = () => resolve(undefined);
    reader.readAsDataURL(blob);
  });
}

export function createBlobProxy(send: Sender) {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  URL.createObjectURL = function (blob: Blob) {
    const startTime = performance.now();
    const blobUrl = originalCreateObjectURL.call(this, blob);

    const data: CapturedData = {
      id: crypto.randomUUID(),
      type: 'blob',
      url: blobUrl,
      contentType: blob.type,
      blobType: blob.type,
      blobSize: blob.size,
      timing: { startTime, duration: performance.now() - startTime },
    };

    if (blob.size <= MAX_BODY) {
      readBlobContent(blob).then((content) => {
        data.blobContent = content;
        send(data);
      });
    } else {
      send(data);
    }

    return blobUrl;
  };

  URL.revokeObjectURL = function (url: string) {
    const data: CapturedData = {
      id: crypto.randomUUID(),
      type: 'blob',
      url,
      contentType: '',
      blobType: '',
      blobSize: 0,
      blobRevoked: true,
      timing: { startTime: performance.now(), duration: 0 },
    };
    send(data);
    return originalRevokeObjectURL.call(this, url);
  };

  Object.defineProperties(URL, {
    createObjectURL: { value: URL.createObjectURL, writable: true, configurable: true },
    revokeObjectURL: { value: URL.revokeObjectURL, writable: true, configurable: true },
  });
}
