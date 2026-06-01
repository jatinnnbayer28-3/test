import { useEffect, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';

export default function UploadProgressBar({ total, processed, items }) {
  const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
  const isComplete = processed >= total && total > 0;
  const [startTime] = useState(Date.now());
  const [eta, setEta] = useState('');

  useEffect(() => {
    if (processed > 0 && processed < total) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = processed / elapsed;
      const remaining = (total - processed) / rate;
      if (remaining < 60) {
        setEta(`~${Math.ceil(remaining)}s remaining`);
      } else {
        setEta(`~${Math.ceil(remaining / 60)}m remaining`);
      }
    } else if (isComplete) {
      setEta('');
    }
  }, [processed, total, startTime, isComplete]);

  const currentItem = items?.find(
    (i) => i.status === 'processing' || i.status === 'pending'
  );

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-700">
          {isComplete ? (
            <span className="flex items-center gap-1.5 text-green-600">
              <CheckCircle2 className="w-4 h-4" />
              Analysis complete!
            </span>
          ) : (
            `${processed} / ${total} items analysed`
          )}
        </span>
        {eta && (
          <span className="text-xs text-gray-400">{eta}</span>
        )}
      </div>

      <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ease-out ${
            isComplete ? 'bg-green-500' : 'bg-indigo-600'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="flex justify-between mt-1.5">
        <span className="text-xs text-gray-400">
          {currentItem
            ? `Processing: ${currentItem.filename || currentItem.item_id || '...'}`
            : isComplete
            ? 'All items processed'
            : 'Starting...'}
        </span>
        <span className="text-xs font-medium text-gray-500">{pct}%</span>
      </div>
    </div>
  );
}
