export function downloadJSON(data: any, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function headersToArray(headers?: Record<string, string>): { name: string; value: string }[] {
  if (!headers) return [];
  return Object.entries(headers).map(([name, value]) => ({ name, value }));
}

export function toHAR(requests: any[]) {
  return {
    log: {
      version: '1.2',
      creator: { name: 'Eyehouser', version: '0.1' },
      entries: requests.map((r) => ({
        startedDateTime: new Date(r.timing?.startTime || Date.now()).toISOString(),
        time: r.timing?.duration || 0,
        request: {
          method: r.method,
          url: r.url,
          headers: headersToArray(r.requestHeaders),
          postData: r.requestBody ? { text: r.requestBody, mimeType: r.contentType } : undefined,
        },
        response: {
          status: r.status || 0,
          statusText: '',
          headers: headersToArray(r.responseHeaders),
          content: {
            text: r.responseBody,
            mimeType: r.contentType,
            size: r.responseBodySize,
          },
        },
        cache: {},
        timings: { send: 0, wait: r.timing?.duration || 0, receive: 0 },
      })),
    },
  };
}
