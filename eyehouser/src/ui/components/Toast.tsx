import { useEffect, useRef, useState } from 'react';

let showToastFn: (msg: string) => void = () => {};

export function toast(msg: string) { showToastFn(msg); }

export default function ToastContainer() {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    showToastFn = (m: string) => {
      setMsg(m);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setMsg(null), 2500);
    };
  }, []);

  if (!msg) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-blue-600 text-white px-4 py-2 rounded shadow-lg text-sm z-50 transition-opacity" role="status" aria-live="polite">
      {msg}
    </div>
  );
}
