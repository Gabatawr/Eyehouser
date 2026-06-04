import { useState } from 'react';
import { useRequestsStore } from '../store/requests';
import { useConfigStore } from '../store/config';
import { MethodBadge, StatusBadge } from '../components/Badge';
import Tabs from '../components/Tabs';
import PreBlock from '../components/PreBlock';
import { shortUrl, formatSize, formatHeaders } from '../../lib/utils';
import { downloadJSON } from '../../lib/export';
import { CopyIcon, CloseIcon, DownloadIcon } from '../components/Icons';

type Tab = 'general' | 'headers' | 'request' | 'response';

export default function Detail() {
  const { items, selectedId, setSelectedId } = useRequestsStore();
  const overlayWidth = useConfigStore((s) => s.config.overlayWidth);
  const req = items.find((r) => r.id === selectedId);
  const [tab, setTab] = useState<Tab>('general');

  if (!req) return null;

  const tabs = [
    { key: 'general', label: 'General' },
    { key: 'headers', label: 'Headers' },
    { key: 'request', label: 'Request' },
    { key: 'response', label: 'Response' },
  ] as const;

  const headerEntries = (obj?: Record<string, string>) =>
    obj ? Object.entries(obj).map(([k, v]) => ({ k, v })) : [];

  return (
    <aside
      className="border-l border-gray-800 flex flex-col bg-gray-900 overflow-hidden shrink-0"
      style={{ flex: overlayWidth, minWidth: 320 }}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <MethodBadge method={req.method} />
          <StatusBadge status={req.status} />
          <span className="text-gray-300 text-xs truncate" title={req.url}>{shortUrl(req.url)}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => downloadJSON(req, `eyehouser-${req.id.slice(0, 8)}.json`)}
            className="text-gray-500 hover:text-gray-300"
            aria-label="Export this request"
          >
            <DownloadIcon className="w-4 h-4" />
          </button>
          <button onClick={() => setSelectedId(null)} className="text-gray-500 hover:text-gray-300" aria-label="Close detail panel">
            <CloseIcon className="w-4 h-4" />
          </button>
        </div>
      </div>

      <Tabs tabs={tabs} active={tab} onChange={(k) => setTab(k as Tab)} />

      <div className="flex-1 overflow-auto p-3 text-xs">
        {tab === 'general' && (
          <div className="space-y-2">
            <KV label="URL" value={req.url} copy />
            <KV label="Method" value={req.method} />
            <KV label="Status" value={`${req.status}`} />
            <KV label="Duration" value={req.timing?.duration ? `${Math.round(req.timing.duration)}ms` : '…'} />
            <KV label="Size" value={req.responseBodySize ? formatSize(req.responseBodySize) : '—'} />
            <KV label="Content-Type" value={req.contentType || '—'} />
            <KV label="Source" value={req.type} />
            <KV label="Captured" value={new Date(req.capturedAt).toLocaleString()} />
            {req.matchedRule && <KV label="Rule" value={req.matchedRule} />}
          </div>
        )}

        {tab === 'headers' && (
          <div className="space-y-3">
            {headerEntries(req.requestHeaders).length > 0 && (
              <div>
                <div className="text-gray-400 mb-1 font-bold">
                  Request Headers
                  <CopyBtn text={formatHeaders(req.requestHeaders)} />
                </div>
                {headerEntries(req.requestHeaders).map(({ k, v }) => (
                  <KV key={k} label={k} value={v} copy />
                ))}
              </div>
            )}
            {headerEntries(req.responseHeaders).length > 0 && (
              <div>
                <div className="text-gray-400 mb-1 font-bold">
                  Response Headers
                  <CopyBtn text={formatHeaders(req.responseHeaders)} />
                </div>
                {headerEntries(req.responseHeaders).map(({ k, v }) => (
                  <KV key={k} label={k} value={v} copy />
                ))}
              </div>
            )}
            {(!req.requestHeaders || Object.keys(req.requestHeaders).length === 0) &&
             (!req.responseHeaders || Object.keys(req.responseHeaders).length === 0) && (
              <div className="text-gray-500">No headers captured</div>
            )}
          </div>
        )}

        {tab === 'request' && (
          <div className="flex flex-col min-h-0" style={{ height: '100%' }}>
            <PreBlock text={req.requestBody} label={`Request Body${req.requestBody ? ` (${formatSize(req.requestBody.length)})` : ' (empty)'}`} fillHeight />
          </div>
        )}

        {tab === 'response' && (
          <div className="flex flex-col min-h-0" style={{ height: '100%' }}>
            <PreBlock text={req.responseBody} label={`Response Body (${req.responseBodySize ? formatSize(req.responseBodySize) : '0'})`} fillHeight />
          </div>
        )}
      </div>
    </aside>
  );
}

function KV({ label, value, copy }: { label: string; value: string; copy?: boolean }) {
  const [copied, setCopied] = useState(false);
  const doCopy = () => {
    navigator.clipboard.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); });
  };
  return (
    <div className="flex gap-2 group">
      <span className="text-gray-500 shrink-0 w-28 truncate" title={label}>{label}</span>
      <span className="text-gray-200 break-all">{value}</span>
      {copy && (
        <button
          onClick={doCopy}
          className="text-gray-600 hover:text-gray-300 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
          aria-label={copied ? 'Copied' : `Copy ${label}`}
        >
          {copied ? <span className="text-green-400 text-xs">OK</span> : <CopyIcon className="w-3 h-3" />}
        </button>
      )}
    </div>
  );
}

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); })}
      className="ml-1 text-gray-500 hover:text-gray-300 align-middle"
      aria-label={copied ? 'Copied' : 'Copy'}
    >
      {copied ? <span className="text-green-400 text-xs">OK</span> : <CopyIcon className="w-3 h-3 inline" />}
    </button>
  );
}
