import { create } from 'zustand';
import { ConfigSchema } from '../../lib/validation/schemas';

interface Config {
  captureAll: boolean;
  captureFetch: boolean;
  captureXhr: boolean;
  captureBlob: boolean;
  captureDataUrls: boolean;
  useWebRequestBackup: boolean;
  maxBodySize: number;
  maxEntries: number;
  autoSaveToStorage: boolean;
  streamEndpoint: string;
  theme: 'dark' | 'light';
  overlayWidth: number;
}

interface ConfigStore {
  config: Config;
  update: (partial: Partial<Config>) => void;
  load: () => Promise<void>;
  save: () => Promise<void>;
}

const defaults: Config = {
  captureAll: true,
  captureFetch: true,
  captureXhr: true,
  captureBlob: false,
  captureDataUrls: false,
  useWebRequestBackup: true,
  maxBodySize: 1_000_000,
  maxEntries: 10_000,
  autoSaveToStorage: true,
  streamEndpoint: '',
  theme: 'dark',
  overlayWidth: 50,
};

export const useConfigStore = create<ConfigStore>((set, get) => ({
  config: defaults,

  update: (partial) => set((s) => ({ config: { ...s.config, ...partial } })),

  load: async () => {
    const res = await chrome.storage.local.get('eyehouser_config');
    if (res.eyehouser_config) {
      const parsed = ConfigSchema.safeParse(res.eyehouser_config);
      if (parsed.success) set({ config: { ...defaults, ...parsed.data } });
    }
  },

  save: async () => {
    const { config } = get();
    await chrome.storage.local.set({ eyehouser_config: config });
  }
}));
