export interface Condition {
  type: 'url' | 'method' | 'status' | 'domain' | 'resource-type' | 'content-type';
  operator: string;
  value: string;
  min?: number;
  max?: number;
}

export interface CaptureRule {
  id: string;
  name: string;
  enabled: boolean;
  conditions: Condition[];
  logic: 'and' | 'or';
  tags?: string[];
  capture: {
    requestBody: boolean;
    responseBody: boolean;
    headers: boolean;
    maxBodySize: number;
  };
  created?: number;
  updated?: number;
}

export function matchUrl(url: string, op: string, pattern: string): boolean {
  switch (op) {
    case 'equals': return url === pattern;
    case 'contains': return url.toLowerCase().includes(pattern.toLowerCase());
    case 'regex': try { return new RegExp(pattern, 'i').test(url); } catch { return false; }
    case 'wildcard': {
      const re = '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$';
      try { return new RegExp(re, 'i').test(url); } catch { return false; }
    }
    default: return false;
  }
}

export function matchMethod(method: string, op: string, value: string): boolean {
  if (op === 'in') return value.split(',').map(s => s.trim().toUpperCase()).includes(method.toUpperCase());
  return method.toUpperCase() === value.toUpperCase();
}

export function matchStatus(status: number, op: string, value: string, min?: number, max?: number): boolean {
  if (op === 'range') return status >= (min ?? 0) && status <= (max ?? 999);
  return status === Number(value);
}

export function matchDomain(url: string, op: string, value: string): boolean {
  let domain = '';
  try { domain = new URL(url).hostname; } catch { return false; }
  if (op === 'equals') return domain === value;
  if (op === 'contains') return domain.includes(value);
  return false;
}

export function matchContentType(ct: string, op: string, value: string): boolean {
  if (op === 'contains') return ct.toLowerCase().includes(value.toLowerCase());
  if (op === 'regex') try { return new RegExp(value, 'i').test(ct); } catch { return false; }
  return false;
}

export const matchers: Record<string, (val: string, op: string, cond: Condition) => boolean> = {
  'url': (val, op, c) => matchUrl(val, op, c.value),
  'method': (val, op, c) => matchMethod(val, op, c.value),
  'status': (val, op, c) => matchStatus(Number(val), op, c.value, c.min, c.max),
  'domain': (val, op, c) => matchDomain(val, op, c.value),
  'resource-type': (val, op, c) => op === 'equals' ? val === c.value : false,
  'content-type': (val, op, c) => matchContentType(val, op, c.value),
};

function getMatchValue(req: any, type: string): string {
  switch (type) {
    case 'url': return req.url || '';
    case 'method': return req.method || '';
    case 'status': return String(req.status ?? 0);
    case 'domain': return req.url || '';
    case 'resource-type': return req.type || '';
    case 'content-type': return req.contentType || '';
    default: return '';
  }
}

export function matchRule(rule: CaptureRule, request: any): boolean {
  if (!rule.enabled) return false;
  const results = rule.conditions.map((c) => {
    const fn = matchers[c.type];
    if (!fn) return false;
    const val = getMatchValue(request, c.type);
    return fn(val, c.operator, c);
  });
  return rule.logic === 'and' ? results.every(Boolean) : results.some(Boolean);
}
