function SkeletonBar({ className = '' }: { className?: string }) {
  return <div className={`h-3 bg-gray-800 rounded animate-pulse ${className}`} />;
}

export default function LoadingSkeleton() {
  return (
    <div className="p-3 space-y-2" role="status" aria-label="Loading data">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-3 h-3 border-2 border-gray-600 border-t-blue-400 rounded-full animate-spin" />
        <span className="text-xs text-gray-500">Loading...</span>
      </div>
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-2">
          <SkeletonBar className="w-12" />
          <SkeletonBar className="w-8" />
          <SkeletonBar className="flex-1" />
          <SkeletonBar className="w-10" />
        </div>
      ))}
    </div>
  );
}
