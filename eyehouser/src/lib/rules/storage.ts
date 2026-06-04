import { CaptureRule } from './matchers';

const KEY = 'eyehouser_rules';

export async function loadRules(): Promise<CaptureRule[]> {
  const res = await chrome.storage.local.get(KEY);
  return res[KEY] || [];
}

export async function saveRules(rules: CaptureRule[]) {
  await chrome.storage.local.set({ [KEY]: rules });
}

export async function addRule(rule: CaptureRule) {
  const rules = await loadRules();
  rules.push(rule);
  await saveRules(rules);
}

export async function updateRule(id: string, partial: Partial<CaptureRule>) {
  const rules = await loadRules();
  const idx = rules.findIndex((r) => r.id === id);
  if (idx !== -1) {
    rules[idx] = { ...rules[idx], ...partial, updated: Date.now() };
    await saveRules(rules);
  }
}

export async function removeRule(id: string) {
  const rules = await loadRules();
  await saveRules(rules.filter((r) => r.id !== id));
}
