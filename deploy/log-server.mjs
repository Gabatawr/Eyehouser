import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = parseInt(process.env.PORT || '3001');
const LOG_FILE = process.env.LOG_FILE || path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'capture-log.ndjson',
);

fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
if (!fs.existsSync(LOG_FILE)) fs.writeFileSync(LOG_FILE, '');

let currentSession = { id: null, startedAt: null, count: 0 };

function readEntries() {
  if (!fs.existsSync(LOG_FILE)) return [];
  const text = fs.readFileSync(LOG_FILE, 'utf-8');
  const entries = [];
  for (const line of text.trim().split('\n')) {
    if (!line) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.type === 'session-start' || entry.type === 'session-end') continue;
      entries.push(entry);
    } catch {}
  }
  return entries;
}

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/api/capture' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => body += chunk);
    req.on('end', () => {
      try {
        const { batch } = JSON.parse(body);
        const capturedAt = new Date().toISOString();
        const lines = batch.map((item) => {
          const flat = item.data ? { capturedAt, ...item.data } : { capturedAt, ...item };
          return JSON.stringify(flat) + '\n';
        }).join('');
        fs.appendFileSync(LOG_FILE, lines);
        currentSession.count += batch.length;
        console.log(`[${capturedAt}] +${batch.length} (${currentSession.count} this session)`);
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, count: batch.length }));
      } catch {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'invalid json' }));
      }
    });
    return;
  }

  if (url.pathname === '/api/session/start' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        currentSession = { id: data.id || crypto.randomUUID(), startedAt: data.startedAt || new Date().toISOString(), count: 0 };
        fs.appendFileSync(LOG_FILE, JSON.stringify({ type: 'session-start', ...currentSession }) + '\n');
        console.log(`[session] start ${currentSession.id}`);
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, session: currentSession.id }));
      } catch { res.writeHead(400); }
    });
    return;
  }

  if (url.pathname === '/api/session/end' && req.method === 'POST') {
    if (currentSession.id) {
      fs.appendFileSync(LOG_FILE, JSON.stringify({ type: 'session-end', id: currentSession.id, count: currentSession.count, endedAt: new Date().toISOString() }) + '\n');
      console.log(`[session] end ${currentSession.id} (${currentSession.count} requests)`);
    }
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (url.pathname === '/api/logs/recent' && req.method === 'GET') {
    const n = parseInt(url.searchParams.get('n')) || 10;
    const tagFilter = url.searchParams.get('tag');
    let entries = readEntries();
    if (tagFilter) {
      entries = entries.filter((e) => e.tags && e.tags.includes(tagFilter));
    }
    const recent = entries.slice(-n).reverse();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ count: recent.length, total: entries.length, entries: recent }));
    return;
  }

  if (url.pathname === '/api/logs/summary' && req.method === 'GET') {
    const tagFilter = url.searchParams.get('tag');
    let entries = readEntries();
    if (tagFilter) {
      entries = entries.filter((e) => e.tags && e.tags.includes(tagFilter));
    }
    const summary = { total: entries.length, byMethod: {}, byStatus: {}, byType: {} };
    for (const e of entries) {
      summary.byMethod[e.method] = (summary.byMethod[e.method] || 0) + 1;
      const sc = Math.floor(e.status / 100) * 100;
      summary.byStatus[`${sc}s`] = (summary.byStatus[`${sc}s`] || 0) + 1;
      summary.byType[e.type] = (summary.byType[e.type] || 0) + 1;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(summary));
    return;
  }

  if (url.pathname === '/api/session' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ session: currentSession }));
    return;
  }

  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      name: 'Universal Collector — Log Server',
      version: '1.0',
      endpoints: {
        'GET /': 'this help',
        'GET /health': 'server status + file path',
        'GET /api/session': 'current session info',
        'POST /api/session/start': 'start a new session (body: { id?, startedAt? })',
        'POST /api/session/end': 'end current session',
        'POST /api/capture': 'submit a batch of captured entries (body: { batch: [...] })',
        'GET /api/logs/recent?n=10&tag=': 'last N entries, optional tag filter',
        'GET /api/logs/summary?tag=': 'aggregated summary (by method/status/type)',
      },
      usage: 'Extension sends POST /api/capture with { batch: [{ url, method, status, type, ... }] }. Use GET /api/logs/recent to inspect.',
      log_file: LOG_FILE,
    }));
    return;
  }

  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', session: currentSession.id, file: LOG_FILE }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
}).listen(PORT, () => {
  console.log(`[log-server] :${PORT} → ${LOG_FILE}`);
});
