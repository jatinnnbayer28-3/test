import { useState, useEffect, useContext } from 'react';
import {
  ChevronDown,
  ThumbsUp,
  ThumbsDown,
  Minus,
  TrendingUp,
  Award,
  ArrowDown,
} from 'lucide-react';
import { getHistory, getWearStats } from '../api/client';
import { AppContext } from '../App';

const PERIOD_OPTIONS = [
  { label: 'Week', days: 7 },
  { label: '15 Days', days: 15 },
  { label: 'Month', days: 30 },
  { label: 'Lifetime', days: 36500 },
];

const POSITION_LABELS = {
  upper: { label: 'Upper Wear', emoji: '👕' },
  lower: { label: 'Lower Wear', emoji: '👖' },
  footwear: { label: 'Shoes', emoji: '👟' },
};

function SkeletonRow() {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 animate-pulse">
      <div className="flex items-center gap-4">
        <div className="h-4 bg-gray-200 rounded w-24" />
        <div className="h-4 bg-gray-200 rounded w-20" />
        <div className="flex gap-2 flex-1">
          {[1, 2, 3].map((i) => (
            <div key={i} className="w-12 h-12 bg-gray-200 rounded-lg" />
          ))}
        </div>
        <div className="h-6 w-16 bg-gray-200 rounded-full" />
      </div>
    </div>
  );
}

function StatItem({ item, badge, badgeColor }) {
  if (!item) return <p className="text-xs text-gray-400">No data</p>;
  return (
    <div className="flex items-center gap-2">
      {item.image_url ? (
        <img
          src={item.image_url}
          alt={item.category || ''}
          className="w-12 h-12 object-cover rounded-lg border border-gray-100 shrink-0"
          onError={(e) => {
            e.target.style.display = 'none';
          }}
        />
      ) : (
        <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center text-xl text-gray-300 shrink-0">
          👕
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-800 truncate">
          {item.category || item.short_description || 'Item'}
        </p>
        <span
          className={`inline-flex items-center text-xs px-1.5 py-0.5 rounded-full font-medium ${badgeColor}`}
        >
          {badge} · {item.count}x worn
        </span>
      </div>
    </div>
  );
}

function WearStatsPanel({ stats, loading }) {
  const [period, setPeriod] = useState(36500);
  const [statsData, setStatsData] = useState(stats);
  const { userId } = useContext(AppContext);
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    if (stats) setStatsData(stats);
  }, [stats]);

  const handlePeriodChange = async (days) => {
    setPeriod(days);
    setFetching(true);
    try {
      const data = await getWearStats(userId, days);
      setStatsData(data);
    } catch (err) {
      console.error(err);
    } finally {
      setFetching(false);
    }
  };

  const s = statsData?.stats || {};
  const isLoading = loading || fetching;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="p-4 border-b border-gray-50 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-indigo-600" />
          <span className="text-sm font-semibold text-gray-800">
            Wear Statistics
          </span>
          {statsData?.total_outfits != null && (
            <span className="text-xs text-gray-400">
              ({statsData.total_outfits} outfits)
            </span>
          )}
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
          {PERIOD_OPTIONS.map((opt) => (
            <button
              key={opt.days}
              onClick={() => handlePeriodChange(opt.days)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                period === opt.days
                  ? 'bg-white text-indigo-700 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse space-y-3">
              <div className="h-4 bg-gray-200 rounded w-20" />
              {[1, 2, 3].map((j) => (
                <div key={j} className="flex gap-2">
                  <div className="w-12 h-12 bg-gray-200 rounded-lg" />
                  <div className="flex-1 space-y-1">
                    <div className="h-3 bg-gray-200 rounded w-24" />
                    <div className="h-3 bg-gray-200 rounded w-16" />
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-6">
          {Object.entries(POSITION_LABELS).map(([pos, { label, emoji }]) => (
            <div key={pos}>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                {emoji} {label}
              </p>
              <div className="space-y-3">
                <StatItem
                  item={s[pos]?.most_worn?.[0]}
                  badge="Most Worn"
                  badgeColor="bg-yellow-50 text-yellow-700"
                />
                <StatItem
                  item={s[pos]?.second_most_worn?.[0]}
                  badge="2nd Most"
                  badgeColor="bg-gray-50 text-gray-600"
                />
                <StatItem
                  item={s[pos]?.least_worn?.[0]}
                  badge="Least Worn"
                  badgeColor="bg-blue-50 text-blue-600"
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function History() {
  const { userId } = useContext(AppContext);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);
  const [wearStats, setWearStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);

  useEffect(() => {
    loadHistory();
    loadStats();
  }, [userId]);

  const loadHistory = async () => {
    setLoading(true);
    try {
      const data = await getHistory(userId, 30);
      setEntries(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    setStatsLoading(true);
    try {
      const data = await getWearStats(userId, 36500);
      setWearStats(data);
    } catch (err) {
      console.error(err);
    } finally {
      setStatsLoading(false);
    }
  };

  const totalOutfits = entries.length;
  const likedCount = entries.filter((e) => e.feedback === 'liked').length;

  const occasionCounts = entries.reduce((acc, e) => {
    const tag = e.occasion_tag || 'Unknown';
    acc[tag] = (acc[tag] || 0) + 1;
    return acc;
  }, {});
  const topOccasion = Object.entries(occasionCounts).sort(
    (a, b) => b[1] - a[1]
  )[0];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Outfit History</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Your past outfit choices, feedback, and wear statistics
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-sm text-gray-500">Total Outfits</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">{totalOutfits}</p>
          <p className="text-xs text-gray-400 mt-0.5">{likedCount} liked</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-sm text-gray-500">Top Occasion</p>
          {topOccasion ? (
            <>
              <p className="text-lg font-semibold text-gray-800 mt-1">
                {topOccasion[0]}
              </p>
              <p className="text-xs text-gray-400">{topOccasion[1]} times</p>
            </>
          ) : (
            <p className="text-sm text-gray-400 mt-2">No data yet</p>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-sm text-gray-500">Liked Rate</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">
            {totalOutfits > 0
              ? Math.round((likedCount / totalOutfits) * 100)
              : 0}
            %
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            of outfits were liked
          </p>
        </div>
      </div>

      <WearStatsPanel stats={wearStats} loading={statsLoading} />

      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-800">Recent History</h2>
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
        ) : entries.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-lg font-medium text-gray-600">No history yet</p>
            <p className="text-sm text-gray-400 mt-1">
              Confirm outfits from the Outfits page to build your history
            </p>
          </div>
        ) : (
          entries.map((entry, idx) => {
            const dateObj = entry.date
              ? new Date(entry.date + 'T00:00:00')
              : null;
            const dateLabel = dateObj
              ? dateObj.toLocaleDateString('en-IN', {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                })
              : 'Unknown';
            const isExpanded = expanded === idx;
            const ws = entry.weather_snapshot;

            return (
              <div
                key={idx}
                className="bg-white rounded-xl border border-gray-100 overflow-hidden"
              >
                <div
                  className="flex items-center gap-3 p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => setExpanded(isExpanded ? null : idx)}
                >
                  <span className="text-sm font-medium text-gray-800 w-28 shrink-0">
                    {dateLabel}
                  </span>

                  <div className="flex items-center gap-2 shrink-0">
                    {entry.occasion_tag && (
                      <span className="text-xs bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full">
                        {entry.occasion_tag}
                      </span>
                    )}
                    {ws && ws.weather_emoji && (
                      <span
                        className="text-xs bg-sky-50 text-sky-600 px-2 py-0.5 rounded-full flex items-center gap-1"
                        title={ws.weather_label}
                      >
                        {ws.weather_emoji} {Math.round(ws.temp_max_c || 0)}°
                      </span>
                    )}
                  </div>

                  <div className="flex gap-1.5 flex-1 overflow-hidden">
                    {(entry.worn_items || []).slice(0, 4).map((item, i) =>
                      item?.image_url ? (
                        <img
                          key={i}
                          src={item.image_url}
                          alt={item.category || ''}
                          className="w-12 h-12 object-cover rounded-lg shrink-0 border border-gray-100"
                          onError={(e) => {
                            e.target.style.display = 'none';
                          }}
                        />
                      ) : (
                        <div
                          key={i}
                          className="w-12 h-12 bg-gray-100 rounded-lg shrink-0 flex items-center justify-center text-gray-300 text-sm"
                        >
                          👕
                        </div>
                      )
                    )}
                  </div>

                  <div className="shrink-0">
                    {entry.feedback === 'liked' ? (
                      <span className="flex items-center gap-1 text-xs text-green-600 bg-green-50 px-2 py-1 rounded-full">
                        <ThumbsUp className="w-3 h-3" /> Liked
                      </span>
                    ) : entry.feedback === 'disliked' ? (
                      <span className="flex items-center gap-1 text-xs text-red-600 bg-red-50 px-2 py-1 rounded-full">
                        <ThumbsDown className="w-3 h-3" /> Disliked
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-gray-400">
                        <Minus className="w-3 h-3" /> No feedback
                      </span>
                    )}
                  </div>

                  <ChevronDown
                    className={`w-4 h-4 text-gray-400 transition-transform ${
                      isExpanded ? 'rotate-180' : ''
                    }`}
                  />
                </div>

                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-gray-50 pt-3 space-y-3">
                    {ws && (
                      <div className="flex items-center gap-3 bg-sky-50 rounded-lg px-3 py-2">
                        <span className="text-xl">{ws.weather_emoji}</span>
                        <div>
                          <p className="text-xs font-medium text-gray-700">
                            {ws.weather_label} · {Math.round(ws.temp_min_c || 0)}
                            ° – {Math.round(ws.temp_max_c || 0)}°C
                          </p>
                          <p className="text-[10px] text-gray-500">
                            Humidity {ws.humidity_pct || 0}% · Rain{' '}
                            {ws.rain_prob_pct || 0}%
                            {ws.outfit_hint ? ` · 💡 ${ws.outfit_hint}` : ''}
                          </p>
                        </div>
                      </div>
                    )}

                    <div className="flex gap-3 overflow-x-auto pb-2">
                      {(entry.worn_items || []).map((item, i) => (
                        <div key={i} className="shrink-0">
                          {item?.image_url ? (
                            <img
                              src={item.image_url}
                              alt={item.category || ''}
                              className="w-28 h-28 object-cover rounded-xl border border-gray-100"
                              onError={(e) => {
                                e.target.src = '';
                                e.target.className =
                                  'w-28 h-28 bg-gray-100 rounded-xl flex items-center justify-center';
                              }}
                            />
                          ) : (
                            <div className="w-28 h-28 bg-gray-100 rounded-xl flex items-center justify-center text-3xl text-gray-300">
                              👕
                            </div>
                          )}
                          <p className="text-xs text-gray-500 mt-1 text-center capitalize truncate w-28">
                            {item?.category ||
                              item?.short_description ||
                              'Item'}
                          </p>
                          {item?.wear_position && (
                            <p className="text-[10px] text-gray-400 text-center capitalize">
                              {item.wear_position}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
