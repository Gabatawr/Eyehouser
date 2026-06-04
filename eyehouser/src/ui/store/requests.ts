import { create } from 'zustand';
import { useConfigStore } from './config';

const STORAGE_KEY = 'eyehouser_requests';

export interface CapturedRequest {
  id: string;
  type: 'fetch' | 'xhr' | 'blob' | 'data-url';
  url: string;
  method: string;
  status: number;
  responseBody?: string;
  responseBodySize?: number;
  contentType?: string;
  timing: { startTime: number; duration?: number };
  matchedRule?: string;
  capturedAt: number;
  tabId?: number;
  initiator?: string;
  requestBody?: string;
  requestBodySize?: number;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  tags?: string[];
}

interface RequestsStore {
  items: CapturedRequest[];
  total: number;
  failed: number;
  slow: number;
  avgDuration: number;
  selectedId: string | null;
  paused: boolean;
  hydrated: boolean;

  add: (req: CapturedRequest) => void;
  setSelectedId: (id: string | null) => void;
  setPaused: (paused: boolean) => void;
  clear: () => void;
  loadFromStorage: () => Promise<void>;
  saveToStorage: () => Promise<void>;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function debouncedSave(fn: () => void, ms: number) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(fn, ms);
}

export const useRequestsStore = create<RequestsStore>((set, get) => {
  const items: CapturedRequest[] = [];

  function recalc(items: CapturedRequest[]) {
    const total = items.length;
    let failed = 0, slow = 0, totalDuration = 0;
    for (const r of items) {
      if (r.status >= 400) failed++;
      if ((r.timing.duration || 0) > 3000) slow++;
      totalDuration += r.timing.duration || 0;
    }
    return { total, failed, slow, avgDuration: total > 0 ? totalDuration / total : 0 };
  }

  const saveToStorage = async () => {
    const { items } = get();
    await chrome.storage.local.set({ [STORAGE_KEY]: items.slice(0, 500) });
  };

  return {
    items,
    total: 0, failed: 0, slow: 0, avgDuration: 0,
    selectedId: null, paused: false, hydrated: false,

    add: (req) => {
      const s = get();
      if (s.paused) return;
      const cfg = useConfigStore.getState().config;
      const limit = cfg.maxEntries || 10000;
      const newItems = [req, ...s.items].slice(0, limit);
      set({ items: newItems, ...recalc(newItems) });

      if (cfg.autoSaveToStorage) debouncedSave(saveToStorage, 2000);
    },

    loadFromStorage: async () => {
      try {
        const res = await chrome.storage.local.get(STORAGE_KEY);
        const stored: CapturedRequest[] = res[STORAGE_KEY] || [];
        const limit = useConfigStore.getState().config.maxEntries || 10000;
        if (stored.length > 0) {
          const s = get();
          const existingIds = new Set(s.items.map((r) => r.id));
          const newItems = [...stored.filter((r) => !existingIds.has(r.id)), ...s.items].slice(0, limit);
          set({ items: newItems, ...recalc(newItems), hydrated: true });
        } else {
          set({ hydrated: true });
        }
      } catch {
        set({ hydrated: true });
      }
    },

    saveToStorage,

    setSelectedId: (id) => set({ selectedId: id }),
    setPaused: (paused) => set({ paused }),
    clear: () => {
      set({ items: [], total: 0, failed: 0, slow: 0, avgDuration: 0, selectedId: null });
      chrome.storage.local.remove(STORAGE_KEY).catch(() => {});
      chrome.runtime.sendMessage({ source: 'eyehouser', type: 'clear' }).catch(() => {});
    },
  };
});
