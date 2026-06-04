import { useEffect, useState, useRef, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useRequestsStore, CapturedRequest } from '../store/requests';
import { MethodBadge, StatusBadge } from '../components/Badge';
import WaterfallBar from '../components/WaterfallBar';
import { toast } from '../components/Toast';
import { downloadJSON, toHAR } from '../../lib/export';
import { shortUrl } from '../../lib/utils';
import { CopyIcon, PlayIcon, PauseIcon, CloseIcon, GlobeIcon, DownloadIcon, ChevronDown, ChevronRight, SortAscIcon, SortDescIcon } from '../components/Icons';

type SortKey = 'method' | 'status' | 'time';

const ROW_HEIGHT = 28;

export default function Live() {
  const { items, total, failed, slow, avgDuration, paused, selectedId, setSelectedId, setPaused, clear, hydrated } = useRequestsStore();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [groupByDomain, setGroupByDomain] = useState(true);
  const [exportFormat, setExportFormat] = useState<'json' | 'har'>('json');
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (msg: any) => {
      if (msg.source !== 'eyehouser') return;
      if (msg.type === 'capture' || msg.type === 'webrequest') {
        if (msg.type === 'capture') {
          useRequestsStore.getState().add(msg.data);
        }
      }
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, []);

  const filtered = useMemo(() => {
    let result = items;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((r) =>
        r.url.toLowerCase().includes(q) ||
        r.method.toLowerCase().includes(q)
      );
    }
    if (statusFilter) {
      if (statusFilter === '4xx') result = result.filter((r) => r.status >= 400 && r.status < 500);
      else if (statusFilter === '5xx') result = result.filter((r) => r.status >= 500);
      else if (statusFilter === '3xx') result = result.filter((r) => r.status >= 300 && r.status < 400);
      else if (statusFilter === '2xx') result = result.filter((r) => r.status >= 200 && r.status < 300);
      else if (statusFilter === '0') result = result.filter((r) => r.status === 0);
    }
    if (sortKey) {
      result = [...result].sort((a, b) => {
        let cmp = 0;
        if (sortKey === 'method') cmp = a.method.localeCompare(b.method);
        else if (sortKey === 'status') cmp = a.status - b.status;
        else if (sortKey === 'time') cmp = (a.timing.duration || 0) - (b.timing.duration || 0);
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    return result;
  }, [items, search, statusFilter, sortKey, sortDir]);

  const grouped = useMemo(() => {
    if (!groupByDomain) return null;
    const groups: Record<string, CapturedRequest[]> = {};
    for (const r of filtered) {
      try {
        const domain = new URL(r.url).hostname;
        (groups[domain] ||= []).push(r);
      } catch {
        (groups['_unknown'] ||= []).push(r);
      }
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered, groupByDomain]);

  const displayList = useMemo(() => {
    if (groupByDomain) return [];
    return filtered;
  }, [filtered, groupByDomain]);

  const flatCount = displayList.length;

  const virtualizer = useVirtualizer({
    count: flatCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 15,
  });

  const firstIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!scrollRef.current || scrollRef.current.scrollTop !== 0) return;
    if (flatCount > 0 && displayList[0].id !== firstIdRef.current) {
      firstIdRef.current = displayList[0].id;
      virtualizer.scrollToIndex(0);
    }
  }, [displayList, flatCount, virtualizer]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const id = useRequestsStore.getState().selectedId;
      if (!id) return;

      const list = grouped
        ? grouped.flatMap(([, reqs]) => reqs)
        : displayList;

      const idx = list.findIndex((r) => r.id === id);
      if (idx === -1) return;
      const nextIdx = e.key === 'ArrowDown' ? idx + 1 : idx - 1;
      if (nextIdx < 0 || nextIdx >= list.length) return;
      const nextId = list[nextIdx].id;
      useRequestsStore.getState().setSelectedId(nextId);

      if (!grouped) {
        virtualizer.scrollToIndex(nextIdx, { align: 'auto' });
      }
    };
    el.addEventListener('keydown', onKey);
    el.tabIndex = 0;
    return () => el.removeEventListener('keydown', onKey);
  }, [grouped, displayList, virtualizer]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const handleExport = () => {
    const data = filtered;
    if (exportFormat === 'har') {
      downloadJSON(toHAR(data), `eyehouser-export-${Date.now()}.har`);
    } else {
      downloadJSON(data, `eyehouser-export-${Date.now()}.json`);
    }
    toast(`Exported ${data.length} requests`);
  };

  if (!hydrated) return null;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 p-2 border-b border-gray-800 shrink-0 flex-wrap">
        <button
          onClick={() => setPaused(!paused)}
          className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${paused ? 'bg-red-700 text-red-200' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
          aria-label={paused ? 'Resume capture' : 'Pause capture'}
        >
          {paused ? <PlayIcon className="w-3 h-3" /> : <PauseIcon className="w-3 h-3" />}
          {paused ? 'Resume' : 'Pause'}
        </button>
        <button
          onClick={clear}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800"
          aria-label="Clear all requests"
        >
          <CloseIcon className="w-3 h-3" />
          Clear
        </button>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search URL/method..."
          aria-label="Search requests"
          className="flex-1 min-w-[120px] bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 placeholder-gray-500 outline-none focus:border-blue-500"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filter by status"
          className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 outline-none focus:border-blue-500"
        >
          <option value="">All status</option>
          <option value="2xx">2xx</option>
          <option value="3xx">3xx</option>
          <option value="4xx">4xx</option>
          <option value="5xx">5xx</option>
          <option value="0">Aborted</option>
        </select>
        <button
          onClick={() => setGroupByDomain(!groupByDomain)}
          className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${groupByDomain ? 'bg-blue-700 text-blue-200' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
          aria-label={groupByDomain ? 'Disable domain grouping' : 'Enable domain grouping'}
        >
          <GlobeIcon className="w-3 h-3" />
          {groupByDomain ? 'Grouped' : 'Group'}
        </button>
        <select
          value={exportFormat}
          onChange={(e) => setExportFormat(e.target.value as 'json' | 'har')}
          aria-label="Export format"
          className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 outline-none focus:border-blue-500"
        >
          <option value="json">JSON</option>
          <option value="har">HAR</option>
        </select>
        <button
          onClick={handleExport}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800"
          aria-label="Export requests"
        >
          <DownloadIcon className="w-3 h-3" />
          Export
        </button>
      </div>

      <div className="flex items-center px-2 py-1 border-b border-gray-800 text-2xs text-gray-500 uppercase shrink-0">
        <span className="flex-1" />
        <button onClick={() => handleSort('time')} className="flex items-center gap-0.5 w-12 shrink-0 text-right hover:text-gray-300" aria-label="Sort by duration">
          Time {sortKey === 'time' && (sortDir === 'asc' ? <SortAscIcon /> : <SortDescIcon />)}
        </button>
        <span className="w-4 shrink-0" />
      </div>

      <div className="flex-1 overflow-auto" ref={scrollRef}>
        {grouped ? (
          grouped.map(([domain, reqs]) => (
            <DomainGroup key={domain} domain={domain} requests={reqs} selectedId={selectedId} onSelect={setSelectedId} />
          ))
        ) : (
          <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const r = displayList[virtualItem.index];
              return (
                <div
                  key={r.id}
                  data-index={virtualItem.index}
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${virtualItem.start}px)` }}
                >
                  <RequestRow req={r} selected={selectedId === r.id} onSelect={() => setSelectedId(r.id)} />
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 px-2 py-1 border-t border-gray-800 text-xs text-gray-500 shrink-0">
        <span>Total: <strong className="text-gray-300">{total}</strong></span>
        {failed > 0 && <span>Failed: <strong className="text-red-400">{failed}</strong></span>}
        {slow > 0 && <span>Slow: <strong className="text-orange-400">{slow}</strong></span>}
        <span>Avg: <strong className="text-gray-300">{Math.round(avgDuration)}ms</strong></span>
        {filtered.length > 0 && (
          <span className="text-gray-600">Filtered: <strong className="text-gray-400">{filtered.length}</strong></span>
        )}
      </div>
    </div>
  );
}

function DomainGroup({ domain, requests, selectedId, onSelect }: {
  domain: string; requests: CapturedRequest[]; selectedId: string | null; onSelect: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div>
      <div
        className="flex items-center gap-2 px-2 py-1 bg-gray-950 border-b border-gray-800 cursor-pointer hover:bg-gray-900 sticky top-0"
        onClick={() => setCollapsed(!collapsed)}
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        aria-label={`Domain: ${domain}, ${requests.length} requests`}
        onKeyDown={(e) => { if (e.key === 'Enter') setCollapsed(!collapsed); }}
      >
        <span className="text-gray-500 w-4" aria-hidden="true">
          {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </span>
        <span className="text-blue-400 font-medium">{domain}</span>
        <span className="text-gray-500">{requests.length} req</span>
      </div>
      {!collapsed && requests.map((r) => (
        <RequestRow key={r.id} req={r} selected={selectedId === r.id} onSelect={() => onSelect(r.id)} />
      ))}
    </div>
  );
}

function RequestRow({ req, selected, onSelect }: { req: CapturedRequest; selected: boolean; onSelect: () => void }) {
  const dur = req.timing.duration ?? 0;
  return (
    <div
      onClick={onSelect}
      role="button"
      tabIndex={0}
      aria-selected={selected}
      aria-label={`${req.method} ${req.status} ${shortUrl(req.url)}`}
      onKeyDown={(e) => { if (e.key === 'Enter') onSelect(); }}
      className={`flex items-center gap-1 px-2 py-0.5 border-b border-gray-900 hover:bg-gray-800 cursor-pointer ${selected ? 'bg-gray-800' : ''}`}
      title={req.url}
      style={{ height: ROW_HEIGHT }}
    >
      <div className="flex gap-1 shrink-0 items-center">
        <MethodBadge method={req.method} />
        <StatusBadge status={req.status} />
      </div>
      <WaterfallBar duration={dur} />
      <span className="text-gray-400 w-12 text-right shrink-0 text-xs">{Math.round(dur)}ms</span>
      <CopyBtn text={req.url} />
      <span className="text-gray-300 text-xs truncate min-w-0">{shortUrl(req.url)}</span>
    </div>
  );
}

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); })}
      className="text-gray-600 hover:text-gray-300 shrink-0"
      aria-label={copied ? 'Copied' : 'Copy URL'}
    >
      {copied ? <span className="text-green-400 text-xs">OK</span> : <CopyIcon className="w-3 h-3" />}
    </button>
  );
}
