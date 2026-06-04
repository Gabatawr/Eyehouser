interface Tab { key: string; label: string; }
interface Props { tabs: readonly Tab[]; active: string; onChange: (key: string) => void; }

export default function Tabs({ tabs, active, onChange }: Props) {
  return (
    <nav className="flex gap-1" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          role="tab"
          aria-selected={active === t.key}
          aria-label={t.label}
          className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
            active === t.key
              ? 'bg-blue-600 text-white'
              : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
          }`}
        >
          {t.label}
        </button>
      ))}
    </nav>
  );
}
