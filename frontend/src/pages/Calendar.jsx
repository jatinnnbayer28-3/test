import { useState, useEffect, useContext } from 'react';
import { ChevronRight, MapPin, Loader2, Save, Sparkles } from 'lucide-react';
import { getWeekCalendar, saveCalendarDay, setLocation, getLocation, generateWeekOutfits } from '../api/client';
import CalendarRow, { DEFAULT_OCCASION, DEFAULT_DRESS_CODE, DEFAULT_TIME } from '../components/CalendarRow';
import { AppContext } from '../App';

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function formatRange(start) {
  const s = new Date(start + 'T00:00:00');
  const e = new Date(start + 'T00:00:00');
  e.setDate(e.getDate() + 6);
  const fmt = { day: 'numeric', month: 'short' };
  return `${s.toLocaleDateString('en-IN', fmt)} – ${e.toLocaleDateString('en-IN', fmt)}`;
}

function SkeletonRow() {
  return (
    <div className="p-4 bg-white rounded-xl border border-gray-100 animate-pulse">
      <div className="flex gap-4 items-center">
        <div className="w-20">
          <div className="h-4 bg-gray-200 rounded w-16 mb-1" />
          <div className="h-3 bg-gray-200 rounded w-12" />
        </div>
        <div className="flex-1 grid grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-8 bg-gray-200 rounded" />
          ))}
        </div>
        <div className="h-8 w-20 bg-gray-200 rounded" />
      </div>
    </div>
  );
}

export default function Calendar() {
  const { userId, userLocation, setUserLocation } = useContext(AppContext);
  const today = new Date().toISOString().slice(0, 10);
  const [weekStart, setWeekStart] = useState(today);
  const [days, setDays] = useState([]);
  const [weatherMap, setWeatherMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [locLoading, setLocLoading] = useState(false);
  const [savingAll, setSavingAll] = useState(false);
  const [generatingAll, setGeneratingAll] = useState(false);
  const [genResult, setGenResult] = useState(null);

  useEffect(() => {
    loadWeek();
  }, [weekStart, userId]);

  useEffect(() => {
    loadLocation();
  }, [userId]);

  const loadLocation = async () => {
    try {
      const data = await getLocation(userId);
      if (data.profile) {
        setUserLocation({
          lat: data.profile.lat,
          lng: data.profile.lng,
          city: data.profile.city,
          district: data.profile.district,
          state: data.profile.state,
          pin_code: data.profile.pin_code,
        });
        if (data.forecast) {
          const map = {};
          data.forecast.forEach((f) => (map[f.date] = f));
          setWeatherMap(map);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const loadWeek = async () => {
    setLoading(true);
    try {
      const data = await getWeekCalendar(userId, weekStart);
      setDays(data);
      data.forEach((d) => {
        if (d.weather) {
          setWeatherMap((prev) => ({ ...prev, [d.date]: d.weather }));
        }
      });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSetLocation = () => {
    if (!navigator.geolocation) return;
    setLocLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const data = await setLocation(userId, pos.coords.latitude, pos.coords.longitude);
          setUserLocation({
            lat: data.profile.lat,
            lng: data.profile.lng,
            city: data.profile.city,
            district: data.profile.district,
            state: data.profile.state,
            pin_code: data.profile.pin_code,
          });
          if (data.forecast) {
            const map = {};
            data.forecast.forEach((f) => (map[f.date] = f));
            setWeatherMap(map);
          }
        } finally {
          setLocLoading(false);
        }
      },
      () => setLocLoading(false)
    );
  };

  const handleSave = async (date, data) => {
    const lat = userLocation?.lat;
    const lng = userLocation?.lng;
    await saveCalendarDay(userId, date, data, lat, lng);
    await loadWeek();
  };

  const handleSaveAll = async () => {
    setSavingAll(true);
    const lat = userLocation?.lat;
    const lng = userLocation?.lng;
    try {
      const unsaved = days.filter((d) => !d.occasion_tag);
      await Promise.all(
        unsaved.map((d) =>
          saveCalendarDay(userId, d.date, {
            occasion_tag: DEFAULT_OCCASION,
            dress_code: DEFAULT_DRESS_CODE,
            time_of_day: DEFAULT_TIME,
            personal_note: null,
          }, lat, lng)
        )
      );
      await loadWeek();
    } finally {
      setSavingAll(false);
    }
  };

  const handleSaveAndGenerateAll = async () => {
    setGeneratingAll(true);
    setGenResult(null);
    const lat = userLocation?.lat;
    const lng = userLocation?.lng;
    try {
      const unsaved = days.filter((d) => !d.occasion_tag);
      if (unsaved.length > 0) {
        await Promise.all(
          unsaved.map((d) =>
            saveCalendarDay(userId, d.date, {
              occasion_tag: DEFAULT_OCCASION,
              dress_code: DEFAULT_DRESS_CODE,
              time_of_day: DEFAULT_TIME,
              personal_note: null,
            }, lat, lng)
          )
        );
        await loadWeek();
      }
      const result = await generateWeekOutfits(userId, weekStart, false);
      setGenResult(result);
    } catch (err) {
      setGenResult({ error: err.message });
    } finally {
      setGeneratingAll(false);
    }
  };

  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const isAtToday = weekStart === today;
  const unsavedCount = days.filter((d) => !d.occasion_tag).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Weekly Planner</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Plan your upcoming days and get AI outfit recommendations
          </p>
        </div>

        <div className="flex items-center gap-2">
          {unsavedCount > 0 && (
            <button
              onClick={handleSaveAll}
              disabled={savingAll}
              className="px-3 py-1.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1.5 transition-colors"
            >
              {savingAll ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              Save All ({unsavedCount})
            </button>
          )}

          <button
            onClick={handleSaveAndGenerateAll}
            disabled={generatingAll || savingAll}
            className="px-3 py-1.5 bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-sm font-medium rounded-lg hover:from-indigo-700 hover:to-purple-700 disabled:opacity-50 flex items-center gap-1.5 transition-all"
          >
            {generatingAll ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" />Generating...</>
            ) : (
              <><Sparkles className="w-3.5 h-3.5" />Save & Generate All</>
            )}
          </button>

          <button
            onClick={handleSetLocation}
            disabled={locLoading}
            className="px-3 py-1.5 bg-gray-100 text-sm text-gray-700 rounded-lg hover:bg-gray-200 flex items-center gap-1.5 transition-colors"
          >
            {locLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <MapPin className="w-3.5 h-3.5" />
            )}
            {userLocation?.city
              ? `${userLocation.city}${userLocation.district && userLocation.district !== userLocation.city ? ', ' + userLocation.district : ''}, ${userLocation.state}${userLocation.pin_code ? ' - ' + userLocation.pin_code : ''}`
              : 'Set Location'}
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between bg-white rounded-xl border border-gray-100 p-3">
        {!isAtToday ? (
          <button
            onClick={() => setWeekStart(today)}
            className="px-3 py-1 text-sm text-indigo-600 hover:bg-indigo-50 rounded-lg font-medium transition-colors"
          >
            Back to Today
          </button>
        ) : (
          <div />
        )}
        <span className="font-semibold text-gray-800">
          {isAtToday ? 'Next 7 Days' : formatRange(weekStart)}
        </span>
        <button
          onClick={() => setWeekStart(addDays(weekStart, 7))}
          className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <ChevronRight className="w-5 h-5 text-gray-600" />
        </button>
      </div>

      {genResult && !genResult.error && (
        <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3">
          <p className="text-sm font-medium text-green-700">
            Outfits generated for {genResult.generated?.length || 0} day{(genResult.generated?.length || 0) !== 1 ? 's' : ''}
            {genResult.skipped?.length > 0 && (
              <span className="text-green-500 font-normal"> ({genResult.skipped.length} skipped — no occasion set)</span>
            )}
          </p>
          <p className="text-xs text-green-600 mt-1">
            Each day has 3 unique suggestions. No outfit combination repeats more than twice across the week.
          </p>
        </div>
      )}

      {genResult?.error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
          {genResult.error}
        </div>
      )}

      {generatingAll && (
        <div className="flex items-center gap-3 bg-indigo-50 border border-indigo-200 px-5 py-4 rounded-xl">
          <Loader2 className="w-5 h-5 text-indigo-600 animate-spin" />
          <div>
            <span className="text-sm font-medium text-indigo-700">
              Generating outfits for all 7 days...
            </span>
            <p className="text-xs text-indigo-500 mt-0.5">
              This may take a minute. Each day gets 3 unique suggestions with no duplicate combos.
            </p>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {loading ? (
          Array.from({ length: 7 }).map((_, i) => <SkeletonRow key={i} />)
        ) : (
          days.map((day) => (
            <CalendarRow
              key={day.date}
              day={day}
              weather={weatherMap[day.date]}
              isToday={day.date === today}
              onSave={handleSave}
            />
          ))
        )}
      </div>
    </div>
  );
}
