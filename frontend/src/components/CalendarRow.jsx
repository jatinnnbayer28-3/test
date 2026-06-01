import { useState, useEffect } from 'react';
import { Check, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const OCCASIONS = [
  'College/Work/Office',
  'Work/Office',
  'Client Meeting',
  'Casual Day',
  'Date Night',
  'Party/Night Out',
  'Wedding/Formal Event',
  'Gym/Sport',
  'Travel',
  'Outdoor/Hiking',
  'Work From Home',
  'Rest Day',
];

const DRESS_CODES = [
  'Business Formal',
  'Business Casual',
  'Smart Casual',
  'Casual',
  'Streetwear',
  'Athleisure',
  'Black Tie',
  'Let AI Decide',
];

const TIMES = [
  'Morning (6am–12pm)',
  'Afternoon (12pm–5pm)',
  'Evening (5pm–9pm)',
  'Night (9pm+)',
  'Full Day',
];

const TIME_TO_SLOT = {
  'Morning (6am–12pm)': 'morning',
  'Morning (6am-12pm)': 'morning',
  'Afternoon (12pm–5pm)': 'afternoon',
  'Afternoon (12pm-5pm)': 'afternoon',
  'Evening (5pm–9pm)': 'evening',
  'Evening (5pm-9pm)': 'evening',
  'Night (9pm+)': 'night',
  'Full Day': 'full_day',
};

const SLOT_LABELS = {
  full_day: { label: 'Full Day', icon: '🌤️' },
  morning: { label: 'Morning', icon: '🌅' },
  afternoon: { label: 'Afternoon', icon: '☀️' },
  evening: { label: 'Evening', icon: '🌇' },
  night: { label: 'Night', icon: '🌙' },
};

const SLOT_ORDER = ['full_day', 'morning', 'afternoon', 'evening', 'night'];

function SlotRow({ slotKey, data }) {
  const meta = SLOT_LABELS[slotKey];
  if (!meta || !data) return null;
  return (
    <div className="flex items-center gap-2 py-1 px-2 rounded-md hover:bg-sky-100/50 transition-colors">
      <span className="text-sm w-5 text-center shrink-0">{data.weather_emoji || meta.icon}</span>
      <span className="text-[11px] font-medium text-gray-700 w-16 shrink-0">{meta.label}</span>
      <span className="text-[11px] text-gray-800 font-semibold w-10 shrink-0">{data.avg_temp_c}°C</span>
      <span className="text-[10px] text-gray-500 w-14 shrink-0">{data.weather_label}</span>
      <span className="text-[10px] text-gray-400">💧{data.rain_prob_pct}%</span>
      <span className="text-[10px] text-gray-400">💨{data.avg_humidity_pct}%</span>
      {data.uv_index > 0 && (
        <span className="text-[10px] text-gray-400">UV {data.uv_index}</span>
      )}
    </div>
  );
}

function WeatherBadge({ weather, timeOfDay }) {
  if (!weather) return null;

  const slots = weather.time_slots || {};
  const activeSlot = timeOfDay ? TIME_TO_SLOT[timeOfDay] : null;
  const hasSlots = Object.keys(slots).length > 0;

  return (
    <div className="bg-sky-50/80 border border-sky-100 rounded-lg px-3 py-2 w-full">
      {/* Full day summary header */}
      <div className="flex items-center gap-2 mb-1">
        <span className="text-lg">{weather.weather_emoji}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-xs font-semibold text-gray-800">
              {Math.round(weather.temp_min_c)}° – {Math.round(weather.temp_max_c)}°C
            </p>
            <p className="text-[10px] text-gray-500">{weather.weather_label}</p>
          </div>
        </div>
        {weather.outfit_hint && (
          <p className="text-[9px] text-indigo-500 leading-tight truncate max-w-[200px]" title={weather.outfit_hint}>
            💡 {weather.outfit_hint}
          </p>
        )}
      </div>

      {/* All time-slot rows */}
      {hasSlots && (
        <div className="border-t border-sky-100 mt-1 pt-1 space-y-0.5">
          {SLOT_ORDER.map((slotKey) => {
            if (!slots[slotKey]) return null;
            const isActive = activeSlot === slotKey;
            return (
              <div
                key={slotKey}
                className={isActive ? 'bg-indigo-50 rounded-md ring-1 ring-indigo-200' : ''}
              >
                <SlotRow slotKey={slotKey} data={slots[slotKey]} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export const DEFAULT_OCCASION = 'College/Work/Office';
export const DEFAULT_DRESS_CODE = 'Let AI Decide';
export const DEFAULT_TIME = 'Full Day';

export default function CalendarRow({ day, weather, isToday, onSave }) {
  const navigate = useNavigate();
  const dateObj = new Date(day.date + 'T00:00:00');
  const dayName = dateObj.toLocaleDateString('en-IN', { weekday: 'long' });
  const dateLabel = dateObj.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
  });

  const [occasion, setOccasion] = useState(day.occasion_tag || DEFAULT_OCCASION);
  const [dressCode, setDressCode] = useState(day.dress_code || DEFAULT_DRESS_CODE);
  const [timeOfDay, setTimeOfDay] = useState(day.time_of_day || DEFAULT_TIME);
  const [note, setNote] = useState(day.personal_note || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(!!day.occasion_tag);

  useEffect(() => {
    setOccasion(day.occasion_tag || DEFAULT_OCCASION);
    setDressCode(day.dress_code || DEFAULT_DRESS_CODE);
    setTimeOfDay(day.time_of_day || DEFAULT_TIME);
    setNote(day.personal_note || '');
    setSaved(!!day.occasion_tag);
  }, [day]);

  const handleSave = async () => {
    if (!occasion) return;
    setSaving(true);
    try {
      await onSave(day.date, {
        occasion_tag: occasion,
        dress_code: dressCode || 'Let AI Decide',
        time_of_day: timeOfDay || 'Full Day',
        personal_note: note || null,
      });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  const selectClass =
    'w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none';

  const borderClass = isToday
    ? 'border-l-4 border-l-indigo-500 bg-indigo-50/30 border-indigo-100'
    : saved
      ? 'border-l-4 border-l-green-500 border-gray-100'
      : 'border-gray-100';

  return (
    <div className={`flex flex-col gap-3 p-4 bg-white rounded-xl border ${borderClass}`}>
      <div className="flex flex-col lg:flex-row gap-3 lg:items-start">
        <div className="w-20 shrink-0">
          <p className="font-semibold text-gray-900 text-sm">
            {dayName}
            {isToday && (
              <span className="ml-1.5 text-[10px] bg-indigo-600 text-white px-1.5 py-0.5 rounded-full font-medium align-middle">
                TODAY
              </span>
            )}
          </p>
          <p className="text-xs text-gray-500">{dateLabel}</p>
          {saved && !isToday && (
            <span className="inline-block w-2 h-2 rounded-full bg-green-500 mt-1" />
          )}
        </div>

        <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          <div>
            <label className="text-xs font-medium text-gray-500 mb-0.5 block">
              Occasion
            </label>
            <select
              value={occasion}
              onChange={(e) => setOccasion(e.target.value)}
              className={selectClass}
            >
              <option value="">Select...</option>
              {OCCASIONS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-500 mb-0.5 block">
              Dress Code
            </label>
            <select
              value={dressCode}
              onChange={(e) => setDressCode(e.target.value)}
              className={selectClass}
            >
              <option value="">Select...</option>
              {DRESS_CODES.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-500 mb-0.5 block">
              Time
            </label>
            <select
              value={timeOfDay}
              onChange={(e) => setTimeOfDay(e.target.value)}
              className={selectClass}
            >
              <option value="">Select...</option>
              {TIMES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-500 mb-0.5 block">
              Notes
            </label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 200))}
              placeholder="e.g. outdoor venue..."
              className={selectClass}
              maxLength={200}
            />
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleSave}
            disabled={saving || !occasion}
            className="px-4 py-1.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 transition-colors"
          >
            {saving ? (
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <Check className="w-3.5 h-3.5" />
            )}
            Save
          </button>

          {saved && (
            <button
              onClick={() => navigate(`/outfits/${day.date}`)}
              className="px-3 py-1.5 text-sm text-indigo-600 hover:bg-indigo-50 rounded-lg font-medium flex items-center gap-1 transition-colors"
            >
              Outfits
              <ExternalLink className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {weather && (
        <WeatherBadge weather={weather} timeOfDay={timeOfDay} />
      )}
    </div>
  );
}
