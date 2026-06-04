import { create } from 'zustand';
import { z } from 'zod';
import { CaptureRuleSchema } from '../../lib/validation/schemas';

export interface Condition {
  type: 'url' | 'method' | 'status' | 'domain' | 'resource-type' | 'content-type';
  operator: string;
  value: string;
  min?: number;
  max?: number;
}

export interface Rule {
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

interface RulesStore {
  rules: Rule[];
  add: (rule: Rule) => void;
  update: (id: string, rule: Partial<Rule>) => void;
  remove: (id: string) => void;
  toggle: (id: string) => void;
  load: () => Promise<void>;
  save: () => Promise<void>;
}

export const useRulesStore = create<RulesStore>((set, get) => ({
  rules: [],

  add: (rule) => set((s) => ({ rules: [...s.rules, rule] })),
  update: (id, partial) => set((s) => ({
    rules: s.rules.map((r) => r.id === id ? { ...r, ...partial, updated: Date.now() } : r)
  })),
  remove: (id) => set((s) => ({ rules: s.rules.filter((r) => r.id !== id) })),
  toggle: (id) => set((s) => ({
    rules: s.rules.map((r) => r.id === id ? { ...r, enabled: !r.enabled } : r)
  })),

  load: async () => {
    const res = await chrome.storage.local.get('eyehouser_rules');
    if (res.eyehouser_rules) {
      const parsed = z.array(CaptureRuleSchema).safeParse(res.eyehouser_rules);
      if (parsed.success) set({ rules: parsed.data });
    }
  },

  save: async () => {
    const { rules } = get();
    await chrome.storage.local.set({ eyehouser_rules: rules });
  }
}));
