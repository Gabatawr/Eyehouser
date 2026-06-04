
export default function WaterfallBar({ duration, maxDuration = 5000 }: { duration: number; maxDuration?: number }) {
  const pct = Math.min((duration / maxDuration) * 100, 100);
  const color = duration > 2000 ? 'bg-red-500' : duration > 500 ? 'bg-orange-400' : 'bg-blue-500';
  return (
    <div className="h-3 bg-gray-900 rounded-sm overflow-hidden flex-1 min-w-[40px] max-w-[120px]">
      <div className={`h-full rounded-sm ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}
