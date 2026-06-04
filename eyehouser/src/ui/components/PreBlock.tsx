import { useState } from 'react';

export default function PreBlock({ text, label, fillHeight }: { text?: string; label?: string; fillHeight?: boolean }) {
  const [expanded, setExpanded] = useState(false);

  if (!text) return <span className="text-gray-500 italic">—</span>;

  const formatted = tryFormat(text);
  const truncated = !expanded && formatted.length > 2000;
  const html = highlightJSON(truncated ? formatted.slice(0, 2000) + '\n…' : formatted);

  return (
    <div className={`relative flex flex-col ${fillHeight ? 'flex-1 min-h-0' : ''}`}>
      {label && <span className="text-gray-400 text-xs mb-1 block shrink-0">{label}</span>}
      <pre
        className={`bg-gray-900 rounded p-2 text-xs font-mono overflow-auto ${fillHeight ? 'flex-1 min-h-0' : 'max-h-48'}`}
        aria-label={label || 'Code block'}
      >
        <code dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
      {formatted.length > 2000 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-blue-400 hover:text-blue-300 mt-1 shrink-0"
          aria-expanded={expanded}
        >
          {expanded ? 'Collapse' : 'Show all'}
        </button>
      )}
    </div>
  );
}

function tryFormat(text: string): string {
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch {}
  return text;
}

function highlightJSON(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return escaped
    .replace(/(,\s*)?("[^"\\]*")\s*:/g, '$1<span class="text-cyan-400">$2</span>:')
    .replace(/:\s*("[^"\\]*")/g, ': <span class="text-green-400">$1</span>')
    .replace(/:\s*(true|false)/g, ': <span class="text-purple-400">$1</span>')
    .replace(/:\s*(null)/g, ': <span class="text-yellow-400">$1</span>')
    .replace(/:\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g, ': <span class="text-orange-400">$1</span>');
}
