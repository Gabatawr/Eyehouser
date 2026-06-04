import { useState, useRef, useEffect } from 'react';
import { useRulesStore, Rule, Condition } from '../store/rules';
import { toast } from '../components/Toast';
import { PlusIcon, CloseIcon } from '../components/Icons';

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
function debouncedSave() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => useRulesStore.getState().save(), 600);
}

export default function Rules() {
  const { rules, add, update, remove, toggle } = useRulesStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const loaded = useRef(false);

  useEffect(() => {
    if (!loaded.current) {
      loaded.current = true;
      useRulesStore.getState().load();
    }
  }, []);

  const addRule = () => {
    const rule: Rule = {
      id: crypto.randomUUID(),
      name: `Rule ${rules.length + 1}`,
      enabled: true,
      conditions: [{ type: 'url', operator: 'contains', value: '/api/' }],
      logic: 'and',
      tags: [],
      capture: { requestBody: true, responseBody: true, headers: true, maxBodySize: 1_000_000 },
      created: Date.now(),
      updated: Date.now(),
    };
    add(rule);
    useRulesStore.getState().save();
    setEditingId(rule.id);
    toast('Rule created');
  };

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-gray-200">Collection Rules</h2>
        <button
          onClick={addRule}
          className="flex items-center gap-1 px-3 py-1.5 rounded text-xs font-medium bg-blue-600 text-white hover:bg-blue-500"
          aria-label="Add new rule"
        >
          <PlusIcon className="w-3 h-3" />
          Add Rule
        </button>
      </div>

      {rules.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <p className="text-sm">No rules yet</p>
          <p className="text-xs">Add rules to filter what data to collect</p>
        </div>
      )}

      {rules.map((rule) => (
        <RuleCard
          key={rule.id}
          rule={rule}
          editing={editingId === rule.id}
          onToggle={() => { toggle(rule.id); debouncedSave(); }}
          onEdit={() => setEditingId(editingId === rule.id ? null : rule.id)}
          onDelete={() => { remove(rule.id); useRulesStore.getState().save(); toast('Rule deleted'); }}
          onUpdate={(partial) => { update(rule.id, partial); debouncedSave(); }}
        />
      ))}
    </div>
  );
}

function RuleCard({
  rule, editing, onToggle, onEdit, onDelete, onUpdate
}: {
  rule: Rule;
  editing: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onUpdate: (partial: Partial<Rule>) => void;
}) {
  const operatorOptions = (type: string) => {
    switch (type) {
      case 'url': return ['contains', 'equals', 'regex', 'wildcard'];
      case 'method': return ['equals', 'in'];
      case 'status': return ['equals', 'range'];
      case 'domain': return ['equals', 'contains'];
      case 'resource-type': return ['equals'];
      case 'content-type': return ['contains', 'regex'];
      default: return ['equals'];
    }
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <button
            onClick={onToggle}
            className={`w-8 h-4 rounded-full transition-colors ${rule.enabled ? 'bg-blue-600' : 'bg-gray-700'}`}
            aria-label={rule.enabled ? 'Disable rule' : 'Enable rule'}
            role="switch"
            aria-checked={rule.enabled}
          >
            <div className={`w-3 h-3 rounded-full bg-white transition-transform ${rule.enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </button>
          {editing ? (
            <input
              value={rule.name}
              onChange={(e) => onUpdate({ name: e.target.value })}
              aria-label="Rule name"
              className="bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-xs text-gray-200 outline-none focus:border-blue-500"
            />
          ) : (
            <span className="text-sm text-gray-200 font-medium">{rule.name}</span>
          )}
          {editing && (
            <select value={rule.logic} onChange={(e) => onUpdate({ logic: e.target.value as 'and' | 'or' })}
              aria-label="Condition logic"
              className="bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-xs text-gray-300">
              <option value="and">AND</option>
              <option value="or">OR</option>
            </select>
          )}
        </div>
        <div className="flex gap-1">
          <button onClick={onEdit} className="px-2 py-0.5 rounded text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800" aria-label={editing ? 'Done editing' : 'Edit rule'}>
            {editing ? 'Done' : 'Edit'}
          </button>
          <button onClick={onDelete} className="px-2 py-0.5 rounded text-xs text-gray-400 hover:text-red-400 hover:bg-gray-800" aria-label="Delete rule">
            <CloseIcon className="w-3 h-3" />
          </button>
        </div>
      </div>

      {editing && (
        <div className="space-y-2 pl-10">
          {rule.conditions.map((c, i) => (
            <div key={i} className="flex items-center gap-1 text-xs">
              {i > 0 && <span className="text-gray-500 uppercase text-2xs">{rule.logic}</span>}
              <select value={c.type} onChange={(e) => {
                const newConds = [...rule.conditions];
                newConds[i] = { ...c, type: e.target.value as Condition['type'], operator: operatorOptions(e.target.value)[0], value: '' };
                onUpdate({ conditions: newConds });
              }} aria-label="Condition type" className="bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-xs text-gray-300">
                {['url', 'method', 'status', 'domain', 'resource-type', 'content-type'].map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <select value={c.operator} onChange={(e) => {
                const newConds = [...rule.conditions];
                newConds[i] = { ...c, operator: e.target.value };
                onUpdate({ conditions: newConds });
              }} aria-label="Operator" className="bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-xs text-gray-300">
                {operatorOptions(c.type).map(o => <option key={o} value={o}>{o}</option>)}
              </select>
              {c.type === 'status' && c.operator === 'range' ? (
                <>
                  <input value={c.min ?? 200} onChange={(e) => {
                    const newConds = [...rule.conditions];
                    newConds[i] = { ...c, min: Number(e.target.value) };
                    onUpdate({ conditions: newConds });
                  }} className="w-14 bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-xs text-gray-200" placeholder="min" aria-label="Min status" />
                  <span className="text-gray-500">—</span>
                  <input value={c.max ?? 299} onChange={(e) => {
                    const newConds = [...rule.conditions];
                    newConds[i] = { ...c, max: Number(e.target.value) };
                    onUpdate({ conditions: newConds });
                  }} className="w-14 bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-xs text-gray-200" placeholder="max" aria-label="Max status" />
                </>
              ) : (
                <input value={c.value} onChange={(e) => {
                  const newConds = [...rule.conditions];
                  newConds[i] = { ...c, value: e.target.value };
                  onUpdate({ conditions: newConds });
                }} className="flex-1 bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-xs text-gray-200" placeholder="value" aria-label="Condition value" />
              )}
              <button onClick={() => {
                onUpdate({ conditions: rule.conditions.filter((_, j) => j !== i) });
              }} className="text-gray-500 hover:text-red-400" aria-label="Remove condition">
                <CloseIcon className="w-3 h-3" />
              </button>
            </div>
          ))}
          <button onClick={() => {
            onUpdate({ conditions: [...rule.conditions, { type: 'url', operator: 'contains', value: '' }] });
          }} className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300">
            <PlusIcon className="w-3 h-3" />
            Add condition
          </button>

          <div className="flex items-center gap-3 mt-2 pt-2 border-t border-gray-800">
            <label className="flex items-center gap-1 text-xs text-gray-400">
              <input type="checkbox" checked={rule.capture.requestBody} onChange={(e) => onUpdate({ capture: { ...rule.capture, requestBody: e.target.checked } })}
                className="accent-blue-600" /> Req Body
            </label>
            <label className="flex items-center gap-1 text-xs text-gray-400">
              <input type="checkbox" checked={rule.capture.responseBody} onChange={(e) => onUpdate({ capture: { ...rule.capture, responseBody: e.target.checked } })}
                className="accent-blue-600" /> Res Body
            </label>
            <label className="flex items-center gap-1 text-xs text-gray-400">
              <input type="checkbox" checked={rule.capture.headers} onChange={(e) => onUpdate({ capture: { ...rule.capture, headers: e.target.checked } })}
                className="accent-blue-600" /> Headers
            </label>
            <label className="flex items-center gap-1 text-xs text-gray-400">
              Max
              <input type="number" value={rule.capture.maxBodySize / 1024} onChange={(e) => onUpdate({ capture: { ...rule.capture, maxBodySize: Number(e.target.value) * 1024 } })}
                className="w-14 bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-xs text-gray-200" aria-label="Max body size in KB" /> KB
            </label>
          </div>

          <div className="flex items-center gap-2 mt-1 pt-2 border-t border-gray-800">
            <span className="text-xs text-gray-400">Tags:</span>
            <input value={(rule.tags || []).join(', ')} onChange={(e) => {
              const tags = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
              onUpdate({ tags });
            }} placeholder="api, prices, auth" aria-label="Rule tags (comma separated)" className="flex-1 bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-xs text-gray-200 placeholder-gray-600" />
          </div>
        </div>
      )}
    </div>
  );
}
