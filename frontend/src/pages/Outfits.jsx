import { useState, useEffect, useContext, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Sparkles, RefreshCw, Loader2, MapPin, X, Save, ChevronDown, ChevronUp, Plus, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  getOutfits,
  generateOutfits,
  getWardrobe,
  confirmOutfit,
  submitFeedback,
  getLocation,
  getWeekCalendar,
  tryOnOutfit,
  saveCalendarDay,
} from '../api/client';
import OutfitCard from '../components/OutfitCard';
import { AppContext } from '../App';

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

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function SkeletonOutfitCard() {
  return (
    <div className="w-[240px] shrink-0 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden animate-pulse">
      <div className="p-3 flex items-center gap-2 border-b border-gray-50">
        <div className="w-7 h-7 bg-gray-200 rounded-full" />
        <div className="h-4 bg-gray-200 rounded w-24" />
      </div>
      <div className="p-3 space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i}>
            <div className="h-3 bg-gray-200 rounded w-16 mb-1" />
            <div className="h-36 bg-gray-200 rounded-lg" />
          </div>
        ))}
      </div>
      <div className="p-3 border-t border-gray-100 space-y-2">
        <div className="h-6 bg-gray-200 rounded w-16" />
        <div className="h-2 bg-gray-200 rounded" />
        <div className="h-2 bg-gray-200 rounded" />
        <div className="h-10 bg-gray-200 rounded-lg" />
      </div>
    </div>
  );
}

function DayPill({ dateStr, isActive, weather, occasion, hasOutfits, isToday, onClick }) {
  const d = new Date(dateStr + 'T00:00:00');
  const weekday = d.toLocaleDateString('en-IN', { weekday: 'short' });
  const dayNum = d.getDate();
  const month = d.toLocaleDateString('en-IN', { month: 'short' });

  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-0.5 px-4 py-2.5 rounded-xl border transition-all shrink-0 min-w-[72px] ${
        isActive
          ? 'bg-indigo-600 text-white border-indigo-600 shadow-md'
          : 'bg-white text-gray-700 border-gray-200 hover:border-indigo-300 hover:bg-indigo-50'
      }`}
    >
      <span className={`text-[10px] font-medium ${isActive ? 'text-indigo-200' : 'text-gray-400'}`}>
        {isToday ? 'TODAY' : weekday}
      </span>
      <span className="text-lg font-bold leading-none">{dayNum}</span>
      <span className={`text-[10px] ${isActive ? 'text-indigo-200' : 'text-gray-400'}`}>{month}</span>
      <div className="flex items-center gap-1 mt-0.5">
        {weather && (
          <span className="text-sm leading-none">{weather.weather_emoji}</span>
        )}
        {hasOutfits && (
          <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-white' : 'bg-green-500'}`} />
        )}
        {occasion && !hasOutfits && (
          <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-indigo-300' : 'bg-amber-400'}`} />
        )}
      </div>
    </button>
  );
}

export default function Outfits() {
  const { date: paramDate } = useParams();
  const { userId } = useContext(AppContext);
  const navigate = useNavigate();
  const sliderRef = useRef(null);

  const today = new Date().toISOString().slice(0, 10);
  const [activeDate, setActiveDate] = useState(paramDate || today);
  const [weekOutfits, setWeekOutfits] = useState({});
  const [wardrobeMap, setWardrobeMap] = useState({});
  const [loadingDates, setLoadingDates] = useState({});
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [location, setLocationData] = useState(null);
  const [weatherMap, setWeatherMap] = useState({});
  const [calendarMap, setCalendarMap] = useState({});
  const [tryOnResult, setTryOnResult] = useState(null);
  const [showEditor, setShowEditor] = useState(false);
  const [editOccasion, setEditOccasion] = useState('');
  const [editDressCode, setEditDressCode] = useState('');
  const [editTime, setEditTime] = useState('');
  const [editNote, setEditNote] = useState('');
  const [savingDay, setSavingDay] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const INITIAL_COUNT = 3;

  // weekOffset: 0 = current week (today + 6), -1 = previous 7 days, +1 = next 7 days, etc.
  const [weekOffset, setWeekOffset] = useState(0);
  const [pastDatesWithOutfits, setPastDatesWithOutfits] = useState(new Set());
  const [loadingPast, setLoadingPast] = useState(false);

  const getVisibleDates = (offset) =>
    Array.from({ length: 7 }, (_, i) => addDays(today, offset * 7 + i));

  const visibleDates = getVisibleDates(weekOffset);

  const hasPastOutfits = pastDatesWithOutfits.size > 0;

  useEffect(() => {
    loadContext();
    probePastOutfits();
  }, [userId]);

  useEffect(() => {
    const cal = calendarMap[activeDate];
    const existingRec = weekOutfits[activeDate];
    setEditOccasion(cal?.occasion_tag || existingRec?.occasion_tag || 'College/Work/Office');
    setEditDressCode(cal?.dress_code || 'Let AI Decide');
    setEditTime(cal?.time_of_day || 'Full Day');
    setEditNote(cal?.personal_note || '');
  }, [activeDate, calendarMap]);

  const loadContext = async () => {
    try {
      const [wardrobeData, locData, calData] = await Promise.allSettled([
        getWardrobe(userId),
        getLocation(userId),
        getWeekCalendar(userId, today),
      ]);

      if (wardrobeData.status === 'fulfilled') {
        const map = {};
        wardrobeData.value.forEach((item) => (map[item.item_id] = item));
        setWardrobeMap(map);
      }

      if (locData.status === 'fulfilled' && locData.value.profile) {
        setLocationData(locData.value.profile);
        const forecast = locData.value.forecast || [];
        const wMap = {};
        forecast.forEach((f) => (wMap[f.date] = f));
        setWeatherMap(wMap);
      }

      if (calData.status === 'fulfilled') {
        const cMap = {};
        calData.value.forEach((d) => {
          if (d.occasion_tag) cMap[d.date] = d;
          if (d.weather) {
            setWeatherMap((prev) => ({ ...prev, [d.date]: d.weather }));
          }
        });
        setCalendarMap(cMap);
      }

      loadDatesOutfits(visibleDates);
    } catch (err) {
      console.error(err);
    }
  };

  const loadDatesOutfits = async (dates) => {
    const toFetch = dates.filter((d) => !weekOutfits[d]);
    if (toFetch.length === 0) return;

    const newLoadingDates = {};
    toFetch.forEach((d) => (newLoadingDates[d] = true));
    setLoadingDates((prev) => ({ ...prev, ...newLoadingDates }));

    const results = await Promise.allSettled(
      toFetch.map((d) => getOutfits(userId, d).then((data) => ({ date: d, data })))
    );

    const outfitsMap = {};
    results.forEach((r) => {
      if (r.status === 'fulfilled' && r.value.data) {
        outfitsMap[r.value.date] = r.value.data;
      }
    });
    setWeekOutfits((prev) => ({ ...prev, ...outfitsMap }));
    setLoadingDates((prev) => {
      const next = { ...prev };
      toFetch.forEach((d) => delete next[d]);
      return next;
    });
  };

  const probePastOutfits = async () => {
    setLoadingPast(true);
    try {
      const pastDates = Array.from({ length: 7 }, (_, i) => addDays(today, -(i + 1)));
      const results = await Promise.allSettled(
        pastDates.map((d) => getOutfits(userId, d).then((data) => ({ date: d, data })))
      );

      const found = new Set();
      const outfitsMap = {};
      results.forEach((r) => {
        if (r.status === 'fulfilled' && r.value.data?.recommendations?.length > 0) {
          found.add(r.value.date);
          outfitsMap[r.value.date] = r.value.data;
        }
      });
      setPastDatesWithOutfits(found);
      if (Object.keys(outfitsMap).length > 0) {
        setWeekOutfits((prev) => ({ ...prev, ...outfitsMap }));
      }
    } finally {
      setLoadingPast(false);
    }
  };

  useEffect(() => {
    loadDatesOutfits(visibleDates);
  }, [weekOffset]);

  const handleDateChange = (date) => {
    setActiveDate(date);
    setShowAll(false);
    navigate(`/outfits/${date}`, { replace: true });
  };

  const handleWeekNav = (dir) => {
    const newOffset = weekOffset + dir;
    if (newOffset < -1) return;
    if (newOffset < 0 && !hasPastOutfits) return;
    if (newOffset > 4) return;
    setWeekOffset(newOffset);
    const newDates = getVisibleDates(newOffset);
    const firstClickable = dir === -1 && newOffset < 0
      ? newDates.find((d) => pastDatesWithOutfits.has(d) || weekOutfits[d]?.recommendations?.length > 0) || newDates[0]
      : newDates[0];
    setActiveDate(firstClickable);
    setShowAll(false);
    navigate(`/outfits/${firstClickable}`, { replace: true });
  };

  const handleGenerate = async (force = false) => {
    setGenerating(true);
    setError('');
    try {
      const data = await generateOutfits(userId, activeDate, null, force);
      setWeekOutfits((prev) => ({ ...prev, [activeDate]: data }));
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  const handleWear = async (itemIds, rank) => {
    try {
      await confirmOutfit(userId, activeDate, itemIds, `rank-${rank}`);
    } catch (err) {
      console.error(err);
    }
  };

  const handleFeedback = async (type) => {
    try {
      await submitFeedback(userId, activeDate, type, []);
    } catch (err) {
      console.error(err);
    }
  };

  const handleTryOn = async (upperId, lowerId, shoesId) => {
    try {
      const result = await tryOnOutfit(userId, upperId, lowerId, shoesId);
      setTryOnResult(result.tryon_url);
    } catch (err) {
      alert('Try-on failed: ' + err.message);
    }
  };

  const handleSaveDay = async () => {
    if (!editOccasion) return;
    setSavingDay(true);
    try {
      await saveCalendarDay(userId, activeDate, {
        occasion_tag: editOccasion,
        dress_code: editDressCode || 'Let AI Decide',
        time_of_day: editTime || 'Full Day',
        personal_note: editNote || null,
      });
      setCalendarMap((prev) => ({
        ...prev,
        [activeDate]: {
          ...prev[activeDate],
          occasion_tag: editOccasion,
          dress_code: editDressCode,
          time_of_day: editTime,
          personal_note: editNote,
        },
      }));
    } finally {
      setSavingDay(false);
    }
  };

  const handleSaveAndRegenerate = async () => {
    await handleSaveDay();
    handleGenerate(true);
  };

  const dateObj = new Date(activeDate + 'T00:00:00');
  const dateLabel = dateObj.toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const currentWeather = weatherMap[activeDate];
  const activeRecs = weekOutfits[activeDate]?.recommendations || [];
  const isLoadingActive = loadingDates[activeDate];

  const visibleOutfitDays = visibleDates.filter((d) => weekOutfits[d]?.recommendations?.length > 0).length;
  const isPastWeek = weekOffset < 0;
  const isCurrentWeek = weekOffset === 0;
  const weekRangeLabel = (() => {
    const first = new Date(visibleDates[0] + 'T00:00:00');
    const last = new Date(visibleDates[6] + 'T00:00:00');
    const opts = { day: 'numeric', month: 'short' };
    return `${first.toLocaleDateString('en-IN', opts)} – ${last.toLocaleDateString('en-IN', opts)}`;
  })();

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">
            {isPastWeek ? 'Past Outfits' : isCurrentWeek ? 'This Week' : 'Upcoming Outfits'}
          </h1>
          <div className="flex flex-wrap items-center gap-2 mt-0.5">
            {location && (
              <span className="text-xs text-gray-500 flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                {location.city}{location.district && location.district !== location.city ? ', ' + location.district : ''}, {location.state}
              </span>
            )}
            {visibleOutfitDays > 0 && (
              <span className="text-xs text-green-600 font-medium">
                {visibleOutfitDays}/7 days have outfits
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Week Navigation + Day Slider */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <button
            onClick={() => handleWeekNav(-1)}
            disabled={(weekOffset === 0 && !hasPastOutfits) || weekOffset <= -1}
            className="p-2 rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            title="Previous week"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="text-center">
            <p className="text-sm font-semibold text-gray-700">{weekRangeLabel}</p>
            {isPastWeek && (
              <button
                onClick={() => { setWeekOffset(0); setActiveDate(today); navigate(`/outfits/${today}`, { replace: true }); }}
                className="text-xs text-indigo-600 hover:text-indigo-700 font-medium mt-0.5"
              >
                Back to this week
              </button>
            )}
            {weekOffset > 0 && (
              <button
                onClick={() => { setWeekOffset(0); setActiveDate(today); navigate(`/outfits/${today}`, { replace: true }); }}
                className="text-xs text-indigo-600 hover:text-indigo-700 font-medium mt-0.5"
              >
                Back to this week
              </button>
            )}
          </div>
          <button
            onClick={() => handleWeekNav(1)}
            disabled={weekOffset >= 4}
            className="p-2 rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            title="Next week"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        <div
          ref={sliderRef}
          className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide"
        >
          {visibleDates.map((d) => {
            const isPast = d < today;
            const hasPastData = pastDatesWithOutfits.has(d);
            if (isPast && !hasPastData && !weekOutfits[d]?.recommendations?.length) {
              return (
                <button
                  key={d}
                  disabled
                  className="flex flex-col items-center gap-0.5 px-4 py-2.5 rounded-xl border border-dashed border-gray-200 bg-gray-50/50 text-gray-400 shrink-0 min-w-[72px] opacity-50 cursor-not-allowed"
                >
                  <span className="text-[10px] font-medium">
                    {new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short' })}
                  </span>
                  <span className="text-lg font-bold leading-none">{new Date(d + 'T00:00:00').getDate()}</span>
                  <span className="text-[10px]">{new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { month: 'short' })}</span>
                </button>
              );
            }
            return (
              <DayPill
                key={d}
                dateStr={d}
                isActive={d === activeDate}
                isToday={d === today}
                weather={weatherMap[d]}
                occasion={calendarMap[d]?.occasion_tag}
                hasOutfits={weekOutfits[d]?.recommendations?.length > 0}
                onClick={() => handleDateChange(d)}
              />
            );
          })}
        </div>
      </div>

      {/* Active Day Info */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-lg font-semibold text-gray-900">{dateLabel}</p>
          <div className="flex items-center gap-2 mt-0.5">
            {(weekOutfits[activeDate]?.occasion_tag || calendarMap[activeDate]?.occasion_tag) && (
              <span className="text-xs bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full font-medium">
                {weekOutfits[activeDate]?.occasion_tag || calendarMap[activeDate]?.occasion_tag}
              </span>
            )}
            {currentWeather && (
              <span className="text-xs text-gray-500">
                {currentWeather.weather_emoji} {Math.round(currentWeather.temp_min_c)}°–{Math.round(currentWeather.temp_max_c)}°C
              </span>
            )}
          </div>
        </div>

        <div className="flex gap-2">
          {!weekOutfits[activeDate] && !generating && (
            <button
              onClick={() => handleGenerate(false)}
              disabled={generating}
              className="px-4 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-sm font-medium rounded-xl hover:from-indigo-700 hover:to-purple-700 flex items-center gap-2 transition-all"
            >
              <Sparkles className="w-4 h-4" />
              Generate
            </button>
          )}

          {weekOutfits[activeDate] && (
            <button
              onClick={() => handleGenerate(true)}
              disabled={generating}
              className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 flex items-center gap-1.5 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${generating ? 'animate-spin' : ''}`} />
              Regenerate
            </button>
          )}
        </div>
      </div>

      {/* Weather Banner */}
      {currentWeather && (
        <div className="bg-gradient-to-r from-sky-50 to-blue-50 border border-sky-200 rounded-xl px-4 py-3 flex items-center gap-4 flex-wrap">
          <span className="text-3xl">{currentWeather.weather_emoji}</span>
          <div>
            <p className="text-sm font-semibold text-gray-800">
              {currentWeather.weather_label} · {Math.round(currentWeather.temp_min_c)}°C – {Math.round(currentWeather.temp_max_c)}°C
            </p>
            <p className="text-xs text-gray-500">
              Feels like {Math.round(currentWeather.feels_like_max_c)}°C · Humidity {currentWeather.humidity_pct}% · Rain {currentWeather.rain_prob_pct}% · UV {currentWeather.uv_index}
            </p>
          </div>
          {currentWeather.outfit_hint && (
            <div className="ml-auto bg-white/70 rounded-lg px-3 py-1.5">
              <p className="text-xs text-indigo-700 font-medium">{currentWeather.outfit_hint}</p>
            </div>
          )}
        </div>
      )}

      {/* Occasion Editor */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <button
          onClick={() => setShowEditor(!showEditor)}
          className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700">
              {editOccasion || 'Set occasion'}
            </span>
            {editDressCode && editDressCode !== 'Let AI Decide' && (
              <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{editDressCode}</span>
            )}
            {editTime && editTime !== 'Full Day' && (
              <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{editTime}</span>
            )}
          </div>
          {showEditor ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </button>

        {showEditor && (
          <div className="px-4 pb-4 border-t border-gray-100 pt-3 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Occasion</label>
                <select
                  value={editOccasion}
                  onChange={(e) => setEditOccasion(e.target.value)}
                  className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-2 bg-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                >
                  <option value="">Select...</option>
                  {OCCASIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Dress Code</label>
                <select
                  value={editDressCode}
                  onChange={(e) => setEditDressCode(e.target.value)}
                  className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-2 bg-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                >
                  <option value="">Select...</option>
                  {DRESS_CODES.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Time of Day</label>
                <select
                  value={editTime}
                  onChange={(e) => setEditTime(e.target.value)}
                  className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-2 bg-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                >
                  <option value="">Select...</option>
                  {TIMES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Notes</label>
                <input
                  type="text"
                  value={editNote}
                  onChange={(e) => setEditNote(e.target.value.slice(0, 200))}
                  placeholder="e.g. outdoor venue..."
                  className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-2 bg-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                  maxLength={200}
                />
              </div>
            </div>

            <div className="flex gap-2 justify-end">
              <button
                onClick={handleSaveDay}
                disabled={savingDay || !editOccasion}
                className="px-4 py-2 text-sm font-medium bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 flex items-center gap-1.5 transition-colors disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                Save
              </button>
              <button
                onClick={handleSaveAndRegenerate}
                disabled={generating || savingDay || !editOccasion}
                className="px-4 py-2 text-sm font-medium bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg hover:from-indigo-700 hover:to-purple-700 flex items-center gap-1.5 transition-all disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${generating ? 'animate-spin' : ''}`} />
                Save & Regenerate
              </button>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
          {error}
        </div>
      )}

      {generating && (
        <div className="flex items-center gap-3 bg-indigo-50 border border-indigo-200 px-5 py-4 rounded-xl">
          <Loader2 className="w-5 h-5 text-indigo-600 animate-spin" />
          <span className="text-sm font-medium text-indigo-700">
            Generating outfit suggestions...
          </span>
        </div>
      )}

      {/* Outfit Cards for Active Day */}
      {isLoadingActive ? (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonOutfitCard key={i} />
          ))}
        </div>
      ) : activeRecs.length > 0 ? (
        <div className="space-y-4">
          <div className="flex gap-4 overflow-x-auto pb-4 -mx-4 px-4">
            {(showAll ? activeRecs : activeRecs.slice(0, INITIAL_COUNT)).map((rec) => (
              <OutfitCard
                key={rec.rank}
                recommendation={rec}
                wardrobeItems={wardrobeMap}
                onWear={handleWear}
                onFeedback={handleFeedback}
                onTryOn={handleTryOn}
              />
            ))}
          </div>

          {activeRecs.length > INITIAL_COUNT && (
            <div className="text-center">
              <button
                onClick={() => setShowAll(!showAll)}
                className="px-5 py-2.5 bg-white border border-gray-200 text-sm font-medium text-gray-700 rounded-xl hover:bg-gray-50 hover:border-gray-300 flex items-center gap-2 mx-auto transition-all shadow-sm"
              >
                {showAll ? (
                  <><ChevronUp className="w-4 h-4" />Show Less</>
                ) : (
                  <><Plus className="w-4 h-4" />Show More ({activeRecs.length - INITIAL_COUNT} more)</>
                )}
              </button>
            </div>
          )}
        </div>
      ) : (
        !generating && (
          <div className="text-center py-16">
            <Sparkles className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <h3 className="text-lg font-medium text-gray-600">
              No outfits for this day
            </h3>
            <p className="text-sm text-gray-400 mt-1">
              {calendarMap[activeDate]?.occasion_tag
                ? 'Hit Generate to get AI outfit recommendations'
                : 'Set an occasion first, then generate outfits'}
            </p>
          </div>
        )
      )}

      {/* Try-On Result Modal */}
      {tryOnResult && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setTryOnResult(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Virtual Try-On Result</h3>
              <button onClick={() => setTryOnResult(null)} className="p-1.5 hover:bg-gray-100 rounded-lg">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="p-5">
              <img
                src={tryOnResult}
                alt="Virtual try-on result"
                className="w-full rounded-xl shadow-md"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
