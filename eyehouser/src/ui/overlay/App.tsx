import { useState, useEffect } from 'react';
import { useRequestsStore } from '../store/requests';
import { useConfigStore } from '../store/config';
import Live from '../tabs/Live';
import Detail from '../tabs/Detail';
import Rules from '../tabs/Rules';
import Settings from '../tabs/Settings';
import Tabs from '../components/Tabs';
import ToastContainer from '../components/Toast';
import LoadingSkeleton from '../components/LoadingSkeleton';

type Tab = 'live' | 'rules' | 'settings';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('live');
  const selectedId = useRequestsStore((s) => s.selectedId);
  const setSelectedId = useRequestsStore((s) => s.setSelectedId);
  const loadFromStorage = useRequestsStore((s) => s.loadFromStorage);
  const hydrated = useRequestsStore((s) => s.hydrated);
  const config = useConfigStore((s) => s.config);
  const loadConfig = useConfigStore((s) => s.load);

  useEffect(() => { loadFromStorage(); loadConfig(); }, []);

  const tabs = [
    { key: 'live', label: 'Live' },
    { key: 'rules', label: 'Rules' },
    { key: 'settings', label: 'Settings' },
  ] as const;

  const detailPct = config.overlayWidth;

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-gray-100 text-sm">
      <header className="flex items-center justify-between px-3 py-1.5 bg-gray-900 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-2">
          <span className="font-bold text-blue-400 text-base">Eyehouser</span>
          <span className="text-gray-500 text-xs">v0.1</span>
        </div>
        <Tabs tabs={tabs} active={activeTab} onChange={(k) => { setActiveTab(k as Tab); setSelectedId(null); }} />
      </header>

      <div className="flex-1 flex overflow-hidden">
        <div className="overflow-hidden" style={{ flex: selectedId ? `${100 - detailPct}` : '1' }}>
          {!hydrated ? <LoadingSkeleton /> : (
            <div className="h-full">
              {(['live', 'rules', 'settings'] as Tab[]).map((tab) => (
                <div key={tab} className="h-full overflow-auto" style={{ display: activeTab === tab ? '' : 'none' }}>
                  {tab === 'live' && <Live />}
                  {tab === 'rules' && <Rules />}
                  {tab === 'settings' && <Settings />}
                </div>
              ))}
            </div>
          )}
        </div>

        {selectedId && <Detail />}
      </div>

      <ToastContainer />
    </div>
  );
}
