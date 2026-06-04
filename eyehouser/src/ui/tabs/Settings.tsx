import React, { useEffect, useState } from 'react';
import { useConfigStore } from '../store/config';
import { useRequestsStore } from '../store/requests';
import { toast } from '../components/Toast';
import ConfirmDialog from '../components/ConfirmDialog';

const DEFAULT_STREAM = 'http://localhost:3001/api/capture';

export default function Settings() {
  const { config, update, save } = useConfigStore();
  const clearAll = useRequestsStore((s) => s.clear);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [streamStatus, setStreamStatus] = useState<'idle' | 'testing' | 'connected' | 'error'>('idle');

  useEffect(() => { useConfigStore.getState().load(); }, []);

  const effectiveEndpoint = config.streamEndpoint || DEFAULT_STREAM;

  const testStream = async () => {
    setStreamStatus('testing');
    try {
      const res = await fetch(effectiveEndpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ batch: [] }),
      });
      setStreamStatus(res.ok || res.status === 0 ? 'connected' : 'error');
    } catch { setStreamStatus('error'); }
  };

  const toggleRow = (label: string, key: keyof typeof config) => (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-xs text-gray-300">{label}</span>
      <button
        onClick={() => { update({ [key]: !config[key] }); save(); toast('Saved'); }}
        className={`w-8 h-4 rounded-full transition-colors ${config[key] ? 'bg-blue-600' : 'bg-gray-700'}`}
        role="switch"
        aria-checked={!!config[key]}
        aria-label={label}
      >
        <div className={`w-3 h-3 rounded-full bg-white transition-transform ${config[key] ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </button>
    </div>
  );

  return (
    <div className="p-3 max-w-lg space-y-4">
      <h2 className="text-sm font-bold text-gray-200">Settings</h2>

      <Section title="Interception">
        {toggleRow('Capture fetch requests', 'captureFetch')}
        {toggleRow('Capture XHR requests', 'captureXhr')}
        {toggleRow('Capture blob: URLs', 'captureBlob')}
        {toggleRow('Capture data: URLs', 'captureDataUrls')}
        {toggleRow('webRequest backup (gap-free)', 'useWebRequestBackup')}
        {toggleRow('Capture all (no rules needed)', 'captureAll')}

        <div className="flex items-center justify-between py-1.5">
          <span className="text-xs text-gray-300">Max body size (KB)</span>
          <input
            type="number"
            value={config.maxBodySize / 1024}
            onChange={(e) => { update({ maxBodySize: Number(e.target.value) * 1024 }); save(); }}
            aria-label="Max body size in KB"
            className="w-20 bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-xs text-gray-200 text-right"
          />
        </div>
      </Section>

      <Section title="Storage">
        {toggleRow('Auto-save to chrome.storage', 'autoSaveToStorage')}

        <div className="flex items-center justify-between py-1.5">
          <span className="text-xs text-gray-300">Max stored entries</span>
          <input
            type="number" min={100} max={100000}
            value={config.maxEntries}
            onChange={(e) => { update({ maxEntries: Number(e.target.value) }); save(); }}
            aria-label="Max stored entries"
            className="w-20 bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-xs text-gray-200 text-right"
          />
        </div>

        <div className="flex items-center justify-between py-1.5">
          <span className="text-xs text-gray-300">Stream endpoint</span>
          <div className="flex items-center gap-1.5 flex-1 ml-3">
            <input
              value={config.streamEndpoint}
              onChange={(e) => { update({ streamEndpoint: e.target.value }); setStreamStatus('idle'); }}
              onBlur={() => save()}
              placeholder={DEFAULT_STREAM}
              aria-label="Stream endpoint URL"
              className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-xs text-gray-200 placeholder-gray-600"
            />
            {streamStatus === 'testing' ? <span className="text-xs text-yellow-400 shrink-0">⋯</span>
              : streamStatus === 'connected' ? <span className="text-xs text-green-400 shrink-0" title="Connected">✔</span>
              : streamStatus === 'error' ? <span className="text-xs text-red-400 shrink-0" title="Connection failed">✘</span>
              : <button onClick={testStream} className="text-xs text-blue-400 hover:text-blue-300 shrink-0">Test</button>
            }
          </div>
        </div>
      </Section>

      <Section title="Display">
        <div className="flex items-center justify-between py-1.5">
          <span className="text-xs text-gray-300">Overlay width (%)</span>
          <input
            type="number" min={20} max={80}
            value={config.overlayWidth}
            onChange={(e) => { update({ overlayWidth: Number(e.target.value) }); save(); }}
            aria-label="Overlay width percentage"
            className="w-16 bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-xs text-gray-200 text-right"
          />
        </div>
      </Section>

      <Section title="Actions">
        <button
          onClick={() => setConfirmOpen(true)}
          className="px-3 py-1.5 rounded text-xs font-medium bg-red-700 text-red-200 hover:bg-red-600"
        >
          Clear All Data
        </button>
      </Section>

      <ConfirmDialog
        open={confirmOpen}
        title="Clear All Data?"
        message="This will permanently delete all captured requests. This action cannot be undone."
        confirmLabel="Clear"
        cancelLabel="Cancel"
        destructive
        onConfirm={() => { clearAll(); setConfirmOpen(false); toast('All data cleared'); }}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded p-3">
      <h3 className="text-xs font-bold text-gray-400 uppercase mb-2">{title}</h3>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}
