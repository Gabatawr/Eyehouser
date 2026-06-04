
const methodColors: Record<string, string> = {
  GET: 'bg-green-700 text-green-200',
  POST: 'bg-blue-700 text-blue-200',
  PUT: 'bg-yellow-700 text-yellow-200',
  PATCH: 'bg-orange-700 text-orange-200',
  DELETE: 'bg-red-700 text-red-200',
  HEAD: 'bg-gray-600 text-gray-200',
  OPTIONS: 'bg-purple-700 text-purple-200',
  CONNECT: 'bg-cyan-700 text-cyan-200',
  TRACE: 'bg-pink-700 text-pink-200',
};

const statusBg = (s: number) => {
  if (s >= 500) return 'bg-red-600';
  if (s >= 400) return 'bg-orange-600';
  if (s >= 300) return 'bg-yellow-600';
  if (s >= 200) return 'bg-green-600';
  return 'bg-gray-600';
};

export function MethodBadge({ method }: { method: string }) {
  return (
    <span
      className={`inline-block px-1.5 py-0.5 rounded text-xs font-bold ${methodColors[method] || 'bg-gray-700 text-gray-200'}`}
      aria-label={`Method: ${method}`}
    >
      {method}
    </span>
  );
}

export function StatusBadge({ status }: { status: number }) {
  return (
    <span
      className={`inline-block px-1.5 py-0.5 rounded text-xs font-bold text-white ${statusBg(status)}`}
      aria-label={`Status: ${status || 'error'}`}
    >
      {status || 'ERR'}
    </span>
  );
}
