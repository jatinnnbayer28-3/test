import { useEffect, useState } from 'react';

export default function RatingBar({ label, score }) {
  const [width, setWidth] = useState(0);
  const pct = Math.min(Math.max(score, 0), 10) * 10;

  useEffect(() => {
    const timer = setTimeout(() => setWidth(pct), 100);
    return () => clearTimeout(timer);
  }, [pct]);

  let color = 'bg-red-500';
  if (score >= 8) color = 'bg-green-500';
  else if (score >= 6) color = 'bg-yellow-500';

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500 w-28 shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ease-out ${color}`}
          style={{ width: `${width}%` }}
        />
      </div>
      <span className="text-xs font-semibold text-gray-700 w-8 text-right">
        {score.toFixed(1)}
      </span>
    </div>
  );
}
