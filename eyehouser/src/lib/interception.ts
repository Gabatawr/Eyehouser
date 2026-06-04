const REQUEST_ID = () => crypto.randomUUID();
const MAX_BODY = 1_000_000;

export interface CapturedData {
  id: string;
  type: 'fetch' | 'xhr' | 'blob' | 'data-url';
  url: string;
  method?: string;
  status?: number;
  requestBody?: string;
  requestBodySize?: number;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
  responseBodySize?: number;
  responseChunks?: string[];
  contentType?: string;
  timing?: { startTime: number; duration: number };
  blobType?: string;
  blobSize?: number;
  blobContent?: string;
  blobRevoked?: boolean;
}

type Sender = (data: CapturedData) => void;

function readBody(body: unknown): { requestBody?: string; requestBodySize?: number } {
  if (!body || body instanceof ReadableStream) return {};
  if (typeof body === 'string') {
    const size = body.length;
    return size <= MAX_BODY ? { requestBody: body, requestBodySize: size } : { requestBodySize: size };
  }
  if (body instanceof URLSearchParams) {
    const text = body.toString();
    const size = text.length;
    return size <= MAX_BODY ? { requestBody: text, requestBodySize: size } : { requestBodySize: size };
  }
  if (body instanceof Blob) {
    return { requestBodySize: body.size };
  }
  return {};
}

function readRequestHeaders(headers: unknown): Record<string, string> | undefined {
  if (!headers) return undefined;
  if (typeof headers === 'object' && headers instanceof Headers) {
    const result: Record<string, string> = {};
    headers.forEach((v, k) => { result[k] = v; });
    return result;
  }
  if (Array.isArray(headers)) {
    const result: Record<string, string> = {};
    for (const [k, v] of headers) result[k] = v;
    return result;
  }
  return headers as Record<string, string>;
}

function readResponseHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((v, k) => { result[k] = v; });
  return result;
}

function parseXhrHeaders(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx > 0) result[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
  }
  return result;
}

function readRequestFromBody(resource: Request): { requestBody?: string; requestBodySize?: number } {
  const body = resource.body;
  if (!body || body instanceof ReadableStream) return {};
  return readBody(body);
}

export function createFetchProxy(send: Sender) {
  const original = window.fetch;

  window.fetch = function (...args: Parameters<typeof fetch>) {
    const startTime = performance.now();
    const [resource, config] = args;
    const url = typeof resource === 'string' ? resource : (resource instanceof Request ? resource.url : resource.href);
    const method = (config?.method || (typeof resource === 'object' && resource instanceof Request ? resource.method : 'GET')).toUpperCase();
    const id = REQUEST_ID();

    const bodyData = config?.body
      ? readBody(config.body)
      : resource instanceof Request
        ? readRequestFromBody(resource)
        : {};

    const requestHeaders = config?.headers
      ? readRequestHeaders(config.headers)
      : undefined;

    return original.apply(this, args).then(async (response) => {
      const clone = response.clone();
      let responseBody: string | undefined;
      let responseBodySize = 0;
      try {
        const text = await clone.text();
        responseBodySize = text.length;
        if (responseBodySize <= MAX_BODY) responseBody = text;
      } catch {}

      send({
        id, type: 'fetch', url, method,
        status: response.status,
        ...bodyData,
        requestHeaders,
        responseHeaders: readResponseHeaders(response.headers),
        responseBody,
        responseBodySize,
        contentType: response.headers.get('content-type') || '',
        timing: { startTime, duration: performance.now() - startTime },
      });

      return response;
    });
  };

  Object.defineProperty(window, 'fetch', {
    value: window.fetch, writable: true, configurable: true,
  });
}

function readXhrResponse(xhr: XMLHttpRequest): { responseBody?: string; responseBodySize?: number } {
  const type = xhr.responseType;
  if (!type || type === 'text') {
    try {
      const text = xhr.responseText;
      const size = text.length;
      return size <= MAX_BODY ? { responseBody: text, responseBodySize: size } : { responseBodySize: size };
    } catch {
      return {};
    }
  }
  if (type === 'json') {
    try {
      const text = JSON.stringify(xhr.response);
      const size = text.length;
      return size <= MAX_BODY ? { responseBody: text, responseBodySize: size } : { responseBodySize: size };
    } catch {
      return {};
    }
  }
  if (type === 'blob' || type === 'arraybuffer') {
    return { responseBodySize: xhr.response?.size || xhr.response?.byteLength || 0 };
  }
  return {};
}

export function createXhrProxy(send: Sender) {
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

  const meta = new WeakMap<XMLHttpRequest, {
    id: string; url: string; method: string; startTime: number;
    bodyData: { requestBody?: string; requestBodySize?: number };
    requestHeaders: Record<string, string>;
    lastTextLength: number; chunks: string[];
  }>();

  XMLHttpRequest.prototype.open = function (method: string, url: string | URL, ...rest: any[]) {
    meta.set(this, {
      id: REQUEST_ID(),
      url: typeof url === 'string' ? url : url.href,
      method: method.toUpperCase(),
      startTime: performance.now(),
      bodyData: {},
      requestHeaders: {},
      lastTextLength: 0,
      chunks: [],
    });
    return originalOpen.apply(this, [method, url, ...rest] as unknown as Parameters<typeof originalOpen>);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (name: string, value: string) {
    const m = meta.get(this);
    if (m) m.requestHeaders[name] = value;
    return originalSetRequestHeader.apply(this, [name, value]);
  };

  XMLHttpRequest.prototype.send = function (...args: any[]) {
    const m = meta.get(this);
    if (!m) return originalSend.apply(this, args as unknown as Parameters<typeof originalSend>);

    m.bodyData = readBody(args[0]);

    this.addEventListener('readystatechange', () => {
      if (this.readyState === 3) {
        try {
          const text = this.responseText;
          if (text.length > m.lastTextLength) {
            m.chunks.push(text.slice(m.lastTextLength));
            m.lastTextLength = text.length;
          }
        } catch {}
        return;
      }

      if (this.readyState !== 4) return;

      let responseBody: string | undefined;
      let responseBodySize = 0;
      let responseChunks: string[] | undefined;

      try {
        const text = this.responseText;
        responseBodySize = text.length;
        if (responseBodySize <= MAX_BODY) responseBody = text;
      } catch {
        const bodyData = readXhrResponse(this);
        responseBody = bodyData.responseBody;
        responseBodySize = bodyData.responseBodySize ?? 0;
      }

      if (m.chunks.length > 1) {
        responseChunks = m.chunks;
      }

      const bodyData = readXhrResponse(this);

      send({
        id: m.id, type: 'xhr', url: m.url, method: m.method,
        status: this.status,
        ...m.bodyData,
        requestHeaders: Object.keys(m.requestHeaders).length > 0 ? m.requestHeaders : undefined,
        responseHeaders: parseXhrHeaders(this.getAllResponseHeaders()),
        responseBody: responseBody ?? bodyData.responseBody,
        responseBodySize: responseBodySize ?? bodyData.responseBodySize,
        responseChunks,
        contentType: this.getResponseHeader('content-type') || '',
        timing: { startTime: m.startTime, duration: performance.now() - m.startTime },
      });
    });

    return originalSend.apply(this, args as unknown as Parameters<typeof originalSend>);
  };
}
