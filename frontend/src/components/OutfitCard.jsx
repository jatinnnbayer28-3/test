import { useState, useEffect, useRef } from 'react';
import RatingBar from './RatingBar';
import { Check, ThumbsUp, ThumbsDown, Shirt, Loader2 } from 'lucide-react';

const TRYON_AVG_KEY = 'wardrobeai_tryon_avg_ms';
const TRYON_DEFAULT_MS = 45000;

function getAvgTryOnTime() {
  try {
    const stored = JSON.parse(localStorage.getItem(TRYON_AVG_KEY) || '{}');
    if (stored.avg && stored.count) return stored.avg;
  } catch {}
  return TRYON_DEFAULT_MS;
}

function recordTryOnTime(elapsed) {
  try {
    const stored = JSON.parse(localStorage.getItem(TRYON_AVG_KEY) || '{}');
    const count = (stored.count || 0) + 1;
    const prevAvg = stored.avg || TRYON_DEFAULT_MS;
    const newAvg = Math.round(prevAvg + (elapsed - prevAvg) / count);
    localStorage.setItem(TRYON_AVG_KEY, JSON.stringify({ avg: newAvg, count }));
  } catch {}
}

function formatTimeLeft(ms) {
  if (ms <= 0) return 'Almost done...';
  const s = Math.ceil(ms / 1000);
  if (s >= 60) return `~${Math.ceil(s / 60)}m left`;
  return `~${s}s left`;
}

function TryOnProgress({ startTime }) {
  const [elapsed, setElapsed] = useState(0);
  const estimatedTotal = useRef(getAvgTryOnTime());

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsed(Date.now() - startTime);
    }, 200);
    return () => clearInterval(timer);
  }, [startTime]);

  const progress = Math.min(elapsed / estimatedTotal.current, 0.95);
  const remaining = Math.max(estimatedTotal.current - elapsed, 0);
  const elapsedSec = Math.floor(elapsed / 1000);

  const steps = [
    { label: 'Preparing', threshold: 0.15 },
    { label: 'Analysing', threshold: 0.45 },
    { label: 'Generating', threshold: 0.80 },
    { label: 'Finishing', threshold: 1.0 },
  ];
  const currentStep = steps.findIndex((s) => progress < s.threshold);

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between text-[10px] text-gray-500">
        <span>{elapsedSec}s elapsed</span>
        <span>{formatTimeLeft(remaining)}</span>
      </div>

      <div className="relative h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 bg-gradient-to-r from-purple-500 via-pink-500 to-purple-600 rounded-full transition-all duration-500 ease-out"
          style={{ width: `${Math.max(progress * 100, 3)}%` }}
        />
        <div
          className="absolute inset-y-0 left-0 bg-white/30 rounded-full animate-pulse"
          style={{ width: `${Math.max(progress * 100, 3)}%` }}
        />
      </div>

      <div className="flex justify-between gap-1">
        {steps.map((step, i) => (
          <div key={step.label} className="flex flex-col items-center flex-1">
            <div className={`w-2 h-2 rounded-full mb-1 transition-colors duration-300 ${
              i < currentStep ? 'bg-purple-600' :
              i === currentStep ? 'bg-pink-500 animate-pulse' :
              'bg-gray-200'
            }`} />
            <span className={`text-[9px] font-medium leading-tight text-center transition-colors ${
              i <= currentStep ? 'text-purple-700' : 'text-gray-400'
            }`}>
              {step.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const RANK_STYLES = {
  1: 'bg-yellow-400 text-yellow-900',
  2: 'bg-gray-300 text-gray-700',
  3: 'bg-amber-600 text-white',
};

function ClothingBlock({ label, emoji, itemData, reason }) {
  const [showReason, setShowReason] = useState(false);

  const displayUrl = itemData?.segmented_url || itemData?.image_url;

  return (
    <div className="relative">
      <p className="text-xs font-medium text-gray-500 mb-1">
        {emoji} {label}
      </p>
      <div
        className="relative min-h-[140px] rounded-lg overflow-hidden bg-gray-50 cursor-pointer"
        onMouseEnter={() => setShowReason(true)}
        onMouseLeave={() => setShowReason(false)}
      >
        {displayUrl ? (
          <img
            src={displayUrl}
            alt={itemData.short_description || label}
            className="w-full h-36 object-cover rounded-lg"
          />
        ) : (
          <div className="w-full h-36 flex items-center justify-center text-gray-300 text-3xl">
            {emoji}
          </div>
        )}

        {showReason && reason && (
          <div className="absolute inset-0 bg-black/70 flex items-center p-3 rounded-lg">
            <p className="text-xs text-white leading-relaxed">{reason}</p>
          </div>
        )}
      </div>
      {itemData?.short_description && (
        <p className="text-xs text-gray-500 mt-1 truncate">
          {itemData.short_description}
        </p>
      )}
    </div>
  );
}

export default function OutfitCard({
  recommendation,
  wardrobeItems,
  onWear,
  onFeedback,
  onTryOn,
}) {
  const [worn, setWorn] = useState(false);
  const [feedbackGiven, setFeedbackGiven] = useState(null);
  const [tryingOn, setTryingOn] = useState(false);
  const [tryOnStart, setTryOnStart] = useState(null);

  const rec = recommendation;
  const rankStyle = RANK_STYLES[rec.rank] || 'bg-gray-200 text-gray-600';

  const getItem = (id) => wardrobeItems?.[id] || null;

  const handleWear = () => {
    const ids = [rec.upper.item_id, rec.lower.item_id, rec.shoes.item_id];
    onWear?.(ids, rec.rank);
    setWorn(true);
  };

  const handleFeedback = (type) => {
    onFeedback?.(type);
    setFeedbackGiven(type);
  };

  const handleTryOn = async () => {
    if (!onTryOn) return;
    const start = Date.now();
    setTryingOn(true);
    setTryOnStart(start);
    try {
      await onTryOn(rec.upper.item_id, rec.lower.item_id, rec.shoes.item_id);
      recordTryOnTime(Date.now() - start);
    } finally {
      setTryingOn(false);
      setTryOnStart(null);
    }
  };

  return (
    <div className="w-[240px] shrink-0 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden flex flex-col">
      <div className="p-3 flex items-center gap-2 border-b border-gray-50">
        <span
          className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${rankStyle}`}
        >
          {rec.rank}
        </span>
        <h3 className="text-sm font-semibold text-gray-800 truncate">
          {rec.outfit_name}
        </h3>
      </div>

      <div className="p-3 space-y-3 flex-1">
        <ClothingBlock
          label="Upper"
          emoji="👕"
          itemData={getItem(rec.upper.item_id)}
          reason={rec.upper.reason_for_pick}
        />

        <div className="border-t border-gray-100" />

        <ClothingBlock
          label="Lower"
          emoji="👖"
          itemData={getItem(rec.lower.item_id)}
          reason={rec.lower.reason_for_pick}
        />

        <div className="border-t border-gray-100" />

        <ClothingBlock
          label="Shoes"
          emoji="👟"
          itemData={getItem(rec.shoes.item_id)}
          reason={rec.shoes.reason_for_pick}
        />
      </div>

      <div className="p-3 border-t border-gray-100 space-y-3">
        <div className="flex items-baseline gap-1">
          <span className="text-2xl font-bold text-gray-900">
            {rec.rating.toFixed(1)}
          </span>
          <span className="text-sm text-gray-400">/10</span>
        </div>

        <div className="space-y-1.5">
          <RatingBar
            label="Colour Harmony"
            score={rec.rating_breakdown.colour_harmony}
          />
          <RatingBar
            label="Occasion Fit"
            score={rec.rating_breakdown.occasion_fit}
          />
          <RatingBar
            label="Style Match"
            score={rec.rating_breakdown.style_coherence}
          />
        </div>

        <div className="bg-gray-50 rounded-lg p-2.5">
          <p className="text-xs text-gray-600 leading-relaxed">
            {rec.overall_reason}
          </p>
        </div>

        {/* Try On */}
        {tryingOn && tryOnStart ? (
          <div className="bg-gradient-to-br from-purple-50 to-pink-50 border border-purple-100 rounded-xl p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 text-purple-600 animate-spin" />
              <span className="text-xs font-semibold text-purple-700">Generating try-on...</span>
            </div>
            <TryOnProgress startTime={tryOnStart} />
          </div>
        ) : (
          <button
            onClick={handleTryOn}
            className="w-full py-2 bg-gradient-to-r from-purple-600 to-pink-600 text-white text-sm font-medium rounded-lg hover:from-purple-700 hover:to-pink-700 transition-all flex items-center justify-center gap-1.5"
          >
            <Shirt className="w-4 h-4" />
            Try On This Outfit
          </button>
        )}

        {!worn ? (
          <button
            onClick={handleWear}
            className="w-full py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors flex items-center justify-center gap-1.5"
          >
            <Check className="w-4 h-4" />
            Wear This Today
          </button>
        ) : feedbackGiven ? (
          <div className="text-center text-sm text-gray-500">
            {feedbackGiven === 'liked' ? '👍 Liked!' : '👎 Noted'}
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={() => handleFeedback('liked')}
              className="flex-1 py-2 bg-green-50 text-green-700 text-sm font-medium rounded-lg hover:bg-green-100 flex items-center justify-center gap-1"
            >
              <ThumbsUp className="w-3.5 h-3.5" />
              Like
            </button>
            <button
              onClick={() => handleFeedback('disliked')}
              className="flex-1 py-2 bg-red-50 text-red-700 text-sm font-medium rounded-lg hover:bg-red-100 flex items-center justify-center gap-1"
            >
              <ThumbsDown className="w-3.5 h-3.5" />
              Dislike
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
