import { useState, useEffect, useContext, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Upload as UploadIcon, X, Check, Trash2, Eye, Shirt, Loader2, Plus, CheckCircle2, ImageIcon, Camera, ShoppingBag, ChevronDown, ChevronUp, Sparkles } from 'lucide-react';
import { getWardrobe, deleteClothing, patchClothing, tryOnOutfit, uploadBatch, processWardrobe, analyseOutfit, getShoppingSuggestions } from '../api/client';
import ClothingCard from '../components/ClothingCard';
import { AppContext } from '../App';

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

function TryOnProgress({ startTime }) {
  const [elapsed, setElapsed] = useState(0);
  const estimatedTotal = useRef(getAvgTryOnTime());

  useEffect(() => {
    const timer = setInterval(() => setElapsed(Date.now() - startTime), 200);
    return () => clearInterval(timer);
  }, [startTime]);

  const progress = Math.min(elapsed / estimatedTotal.current, 0.95);
  const remaining = Math.max(estimatedTotal.current - elapsed, 0);
  const elapsedSec = Math.floor(elapsed / 1000);
  const timeLeft = remaining <= 0 ? 'Almost done...' : remaining < 60000 ? `~${Math.ceil(remaining / 1000)}s left` : `~${Math.ceil(remaining / 60000)}m left`;

  const steps = [
    { label: 'Preparing', threshold: 0.15 },
    { label: 'Analysing', threshold: 0.45 },
    { label: 'Generating', threshold: 0.80 },
    { label: 'Finishing', threshold: 1.0 },
  ];
  const currentStep = steps.findIndex((s) => progress < s.threshold);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[9px] text-gray-500">
        <span>{elapsedSec}s elapsed</span>
        <span>{timeLeft}</span>
      </div>
      <div className="relative h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 bg-gradient-to-r from-purple-500 via-pink-500 to-purple-600 rounded-full transition-all duration-500 ease-out"
          style={{ width: `${Math.max(progress * 100, 3)}%` }}
        />
      </div>
      <div className="flex justify-between gap-0.5">
        {steps.map((step, i) => (
          <div key={step.label} className="flex flex-col items-center flex-1">
            <div className={`w-1.5 h-1.5 rounded-full mb-0.5 transition-colors duration-300 ${
              i < currentStep ? 'bg-purple-600' : i === currentStep ? 'bg-pink-500 animate-pulse' : 'bg-gray-200'
            }`} />
            <span className={`text-[8px] font-medium leading-tight text-center ${
              i <= currentStep ? 'text-purple-700' : 'text-gray-400'
            }`}>{step.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const SECTIONS = [
  { key: 'upper', label: 'Upper Wear', icon: '👕', color: 'indigo', description: 'T-shirts, shirts, jackets, tops' },
  { key: 'lower', label: 'Lower Wear', icon: '👖', color: 'emerald', description: 'Jeans, trousers, shorts, skirts' },
  { key: 'footwear', label: 'Shoes', icon: '👟', color: 'amber', description: 'Sneakers, boots, sandals, formals' },
];

const SECTION_BORDER = {
  upper: 'border-indigo-400 ring-indigo-200',
  lower: 'border-emerald-400 ring-emerald-200',
  footwear: 'border-amber-400 ring-amber-200',
};

const SECTION_BG = {
  upper: 'bg-indigo-50',
  lower: 'bg-emerald-50',
  footwear: 'bg-amber-50',
};

const SECTION_HEADER_BG = {
  upper: 'bg-indigo-600',
  lower: 'bg-emerald-600',
  footwear: 'bg-amber-600',
};

function SkeletonCard() {
  return (
    <div className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-100 animate-pulse">
      <div className="aspect-square bg-gray-200" />
      <div className="p-3 space-y-2">
        <div className="h-3 bg-gray-200 rounded w-2/3" />
        <div className="h-3 bg-gray-200 rounded w-1/2" />
      </div>
    </div>
  );
}

const STEP_CONFIG = {
  uploading: { label: 'Uploading photos', pctRange: [0, 30], color: 'bg-blue-500', pulse: true },
  processing: { label: 'AI analysing clothes', pctRange: [30, 95], color: 'bg-indigo-500', pulse: true },
  done: { label: 'Done!', pctRange: [100, 100], color: 'bg-green-500', pulse: false },
  error: { label: 'Failed', pctRange: [100, 100], color: 'bg-red-500', pulse: false },
};

function SectionUploadProgress({ state, sectionColor }) {
  if (!state) return null;

  const config = STEP_CONFIG[state.step] || STEP_CONFIG.uploading;
  const { totalFiles, processedCount, startTime, step, error, done } = state;

  let pct;
  if (step === 'uploading') {
    pct = 15;
  } else if (step === 'processing') {
    const base = 30;
    const processPct = totalFiles > 0 ? Math.min((processedCount / totalFiles) * 65, 65) : 0;
    pct = Math.round(base + processPct);
  } else if (done) {
    pct = 100;
  } else {
    pct = 0;
  }

  const elapsed = (Date.now() - (startTime || Date.now())) / 1000;
  let eta = '';
  if (step === 'processing' && processedCount > 0 && processedCount < totalFiles) {
    const rate = processedCount / Math.max(elapsed - 2, 1);
    const remaining = (totalFiles - processedCount) / rate;
    eta = remaining < 60 ? `~${Math.ceil(remaining)}s left` : `~${Math.ceil(remaining / 60)}m left`;
  } else if (step === 'uploading') {
    eta = totalFiles > 3 ? '~5-10s' : '~2-3s';
  } else if (step === 'processing' && processedCount === 0) {
    const perItem = 8;
    eta = `~${Math.ceil(totalFiles * perItem)}s`;
  }

  const colorMap = {
    indigo: { bar: 'bg-indigo-400', bg: 'bg-indigo-200/50', text: 'text-indigo-700', badge: 'bg-indigo-100 text-indigo-700' },
    emerald: { bar: 'bg-emerald-400', bg: 'bg-emerald-200/50', text: 'text-emerald-700', badge: 'bg-emerald-100 text-emerald-700' },
    amber: { bar: 'bg-amber-400', bg: 'bg-amber-200/50', text: 'text-amber-700', badge: 'bg-amber-100 text-amber-700' },
  };
  const c = colorMap[sectionColor] || colorMap.indigo;

  return (
    <div className="px-4 pb-4">
      <div className="bg-white/80 backdrop-blur-sm rounded-xl border border-gray-200 p-4 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            {done ? (
              <CheckCircle2 className="w-4 h-4 text-green-500" />
            ) : error ? (
              <X className="w-4 h-4 text-red-500" />
            ) : (
              <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
            )}
            <span className={`text-sm font-medium ${done ? 'text-green-600' : error ? 'text-red-600' : 'text-gray-700'}`}>
              {error || config.label}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {eta && !done && !error && (
              <span className="text-[11px] text-gray-400">{eta}</span>
            )}
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${done ? 'bg-green-100 text-green-700' : c.badge}`}>
              {step === 'uploading' ? `${totalFiles} file${totalFiles !== 1 ? 's' : ''}` :
               step === 'processing' ? `${processedCount}/${totalFiles} analysed` :
               done ? `${totalFiles} added` : 'Error'}
            </span>
          </div>
        </div>

        <div className={`w-full h-2 rounded-full overflow-hidden ${c.bg}`}>
          <div
            className={`h-full rounded-full transition-all duration-700 ease-out ${
              done ? 'bg-green-500' : error ? 'bg-red-400' : c.bar
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>

        <div className="flex items-center justify-between mt-1.5">
          <div className="flex gap-3">
            {['uploading', 'processing', 'done'].map((s, i) => {
              const isActive = step === s;
              const isPast = (step === 'processing' && s === 'uploading') || (step === 'done' && s !== 'done');
              return (
                <div key={s} className="flex items-center gap-1">
                  <div className={`w-1.5 h-1.5 rounded-full ${
                    isPast ? 'bg-green-400' : isActive ? (done ? 'bg-green-400' : `${c.bar} animate-pulse`) : 'bg-gray-300'
                  }`} />
                  <span className={`text-[10px] ${isPast ? 'text-green-500' : isActive ? (done ? 'text-green-500' : c.text) : 'text-gray-400'}`}>
                    {s === 'uploading' ? 'Upload' : s === 'processing' ? 'Analyse' : 'Ready'}
                  </span>
                </div>
              );
            })}
          </div>
          <span className={`text-[11px] font-bold ${done ? 'text-green-600' : c.text}`}>{pct}%</span>
        </div>
      </div>
    </div>
  );
}

export default function Wardrobe() {
  const { userId } = useContext(AppContext);
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [colorSearch, setColorSearch] = useState('');

  const [selected, setSelected] = useState({ upper: null, lower: null, footwear: null });
  const [detailItem, setDetailItem] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [tryingOn, setTryingOn] = useState(false);
  const [tryOnStart, setTryOnStart] = useState(null);
  const [tryOnResult, setTryOnResult] = useState(null);

  // Outfit Analyser state
  const [oaOpen, setOaOpen] = useState(false);
  const [oaImage, setOaImage] = useState(null);
  const [oaPreview, setOaPreview] = useState(null);
  const [oaCats, setOaCats] = useState([]);
  const [oaLoading, setOaLoading] = useState(false);
  const [oaResult, setOaResult] = useState(null);
  const [oaExpanded, setOaExpanded] = useState({});
  const [oaCameraActive, setOaCameraActive] = useState(false);
  const oaVideoRef = useRef(null);
  const oaStreamRef = useRef(null);
  const oaFileRef = useRef(null);

  // Shopping Suggestions state
  const [ssOpen, setSsOpen] = useState(false);
  const [ssCats, setSsCats] = useState([]);
  const [ssLoading, setSsLoading] = useState(false);
  const [ssResult, setSsResult] = useState(null);
  const [ssExpanded, setSsExpanded] = useState({});

  const fileInputRefs = useRef({});
  const [sectionUploadState, setSectionUploadState] = useState({});

  const updateSectionUpload = useCallback((key, update) => {
    setSectionUploadState((prev) => ({
      ...prev,
      [key]: prev[key] ? { ...prev[key], ...update } : update,
    }));
  }, []);

  const clearSectionUpload = useCallback((key) => {
    setSectionUploadState((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const handleSectionUpload = async (sectionKey, fileList) => {
    const imageFiles = Array.from(fileList).filter((f) => f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;

    const totalFiles = imageFiles.length;
    const startTime = Date.now();

    updateSectionUpload(sectionKey, {
      step: 'uploading',
      totalFiles,
      processedCount: 0,
      startTime,
      error: null,
      done: false,
    });

    try {
      const positions = imageFiles.map(() => sectionKey === 'footwear' ? 'footwear' : sectionKey);
      await uploadBatch(userId, imageFiles, positions);

      updateSectionUpload(sectionKey, { step: 'processing', processedCount: 0 });

      await processWardrobe(userId, (data) => {
        if (data.status === 'complete' || data.message === 'nothing to process') {
          updateSectionUpload(sectionKey, { step: 'done', processedCount: totalFiles, done: true });
          return;
        }
        if (data.processed != null) {
          updateSectionUpload(sectionKey, { processedCount: data.processed });
        }
      });

      await loadWardrobe();

      updateSectionUpload(sectionKey, { step: 'done', done: true });
      setTimeout(() => clearSectionUpload(sectionKey), 2500);
    } catch (err) {
      console.error(err);
      updateSectionUpload(sectionKey, { step: 'error', error: err.message || 'Upload failed' });
      setTimeout(() => clearSectionUpload(sectionKey), 4000);
    }
  };

  useEffect(() => {
    loadWardrobe();
  }, [userId]);

  const loadWardrobe = async () => {
    setLoading(true);
    try {
      const data = await getWardrobe(userId);
      setItems(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (itemId) => {
    try {
      await deleteClothing(userId, itemId);
      setItems((prev) => prev.filter((i) => i.item_id !== itemId));
      setSelected((prev) => {
        const next = { ...prev };
        Object.keys(next).forEach((k) => {
          if (next[k]?.item_id === itemId) next[k] = null;
        });
        return next;
      });
    } catch (err) {
      console.error(err);
    }
  };

  const handleEdit = async (item) => {
    const newCategory = prompt(
      'Enter corrected category (tshirt, shirt, jeans, shorts, shoes, jacket, dress, other):',
      item.category || ''
    );
    if (newCategory && newCategory !== item.category) {
      await patchClothing(userId, item.item_id, { category: newCategory });
      loadWardrobe();
    }
  };

  const toggleSelect = (section, item) => {
    setSelected((prev) => ({
      ...prev,
      [section]: prev[section]?.item_id === item.item_id ? null : item,
    }));
  };

  const clearSelection = () => {
    setSelected({ upper: null, lower: null, footwear: null });
  };

  const handleTryOn = async () => {
    if (!selected.upper || !selected.lower || !selected.footwear) return;
    const start = Date.now();
    setTryingOn(true);
    setTryOnStart(start);
    try {
      const result = await tryOnOutfit(userId, selected.upper.item_id, selected.lower.item_id, selected.footwear.item_id);
      recordTryOnTime(Date.now() - start);
      setTryOnResult(result.tryon_url);
    } catch (err) {
      alert('Try-on failed: ' + err.message);
    } finally {
      setTryingOn(false);
      setTryOnStart(null);
    }
  };

  // --- Outfit Analyser handlers ---
  const oaToggleCat = (cat) =>
    setOaCats((prev) => (prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]));

  const oaStartCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      oaStreamRef.current = stream;
      setOaCameraActive(true);
      setTimeout(() => {
        if (oaVideoRef.current) oaVideoRef.current.srcObject = stream;
      }, 50);
    } catch {
      alert('Camera permission denied or not available');
    }
  };

  const oaCapturePhoto = () => {
    const video = oaVideoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      const file = new File([blob], 'capture.jpg', { type: 'image/jpeg' });
      setOaImage(file);
      setOaPreview(URL.createObjectURL(blob));
      oaStopCamera();
    }, 'image/jpeg', 0.85);
  };

  const oaStopCamera = () => {
    if (oaStreamRef.current) {
      oaStreamRef.current.getTracks().forEach((t) => t.stop());
      oaStreamRef.current = null;
    }
    setOaCameraActive(false);
  };

  const oaHandleUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setOaImage(file);
    setOaPreview(URL.createObjectURL(file));
    oaStopCamera();
  };

  const oaAnalyse = async () => {
    if (!oaImage || oaCats.length === 0) return;
    setOaLoading(true);
    setOaResult(null);
    setOaExpanded({});
    try {
      const data = await analyseOutfit(userId, oaImage, oaCats);
      setOaResult(data);
    } catch (err) {
      alert('Analysis failed: ' + err.message);
    } finally {
      setOaLoading(false);
    }
  };

  const oaReset = () => {
    setOaImage(null);
    setOaPreview(null);
    setOaResult(null);
    setOaExpanded({});
    oaStopCamera();
  };

  // --- Shopping Suggestions handlers ---
  const ssToggleCat = (cat) =>
    setSsCats((prev) => (prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]));

  const ssAnalyse = async () => {
    if (ssCats.length === 0) return;
    setSsLoading(true);
    setSsResult(null);
    setSsExpanded({});
    try {
      const data = await getShoppingSuggestions(userId, ssCats);
      setSsResult(data);
    } catch (err) {
      alert('Failed to get suggestions: ' + err.message);
    } finally {
      setSsLoading(false);
    }
  };

  const grouped = { upper: [], lower: [], footwear: [], other: [] };
  items.forEach((item) => {
    const pos = item.wear_position || 'other';
    if (grouped[pos]) {
      grouped[pos].push(item);
    } else {
      grouped.other.push(item);
    }
  });

  const applyColorFilter = (list) => {
    if (!colorSearch) return list;
    const q = colorSearch.toLowerCase();
    return list.filter(
      (i) =>
        (i.primary_color && i.primary_color.toLowerCase().includes(q)) ||
        (i.secondary_color && i.secondary_color.toLowerCase().includes(q)) ||
        (i.short_description && i.short_description.toLowerCase().includes(q)) ||
        (i.search_description && i.search_description.toLowerCase().includes(q)) ||
        (i.search_tags && i.search_tags.some((tag) => tag.toLowerCase().includes(q))) ||
        (i.sub_category && i.sub_category.toLowerCase().includes(q)) ||
        (i.fabric && i.fabric.toLowerCase().includes(q)) ||
        (i.pattern && i.pattern.toLowerCase().includes(q))
    );
  };

  const hasSelection = selected.upper || selected.lower || selected.footwear;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Wardrobe</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {items.length} item{items.length !== 1 ? 's' : ''} in your collection
            — click items to preview outfits
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          value={colorSearch}
          onChange={(e) => setColorSearch(e.target.value)}
          placeholder="Search by colour or description..."
          className="w-full text-sm border border-gray-200 rounded-lg pl-9 pr-3 py-2 bg-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
        />
      </div>

      {/* ── Outfit Analyser ── */}
      <div className="rounded-2xl border border-purple-200 bg-gradient-to-br from-purple-50 to-pink-50 overflow-hidden">
        <button
          onClick={() => { setOaOpen((p) => !p); if (oaCameraActive) oaStopCamera(); }}
          className="w-full px-5 py-3.5 flex items-center justify-between hover:bg-purple-100/40 transition-colors"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-purple-600 flex items-center justify-center">
              <Camera className="w-4 h-4 text-white" />
            </div>
            <div className="text-left">
              <h2 className="text-sm font-semibold text-gray-900">Outfit Analyser</h2>
              <p className="text-xs text-gray-500">Snap a photo — get clothing suggestions that complement your look & wardrobe</p>
            </div>
          </div>
          {oaOpen ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </button>

        {oaOpen && (
          <div className="px-5 pb-5 space-y-4">
            {/* Image capture / upload */}
            {!oaPreview && !oaCameraActive && (
              <div className="flex gap-3">
                <button
                  onClick={oaStartCamera}
                  className="flex-1 py-6 border-2 border-dashed border-purple-300 rounded-xl flex flex-col items-center gap-2 hover:border-purple-500 hover:bg-purple-50 transition-colors"
                >
                  <Camera className="w-6 h-6 text-purple-500" />
                  <span className="text-xs font-medium text-purple-700">Click Photo</span>
                </button>
                <button
                  onClick={() => oaFileRef.current?.click()}
                  className="flex-1 py-6 border-2 border-dashed border-purple-300 rounded-xl flex flex-col items-center gap-2 hover:border-purple-500 hover:bg-purple-50 transition-colors"
                >
                  <UploadIcon className="w-6 h-6 text-purple-500" />
                  <span className="text-xs font-medium text-purple-700">Upload Photo</span>
                </button>
                <input ref={oaFileRef} type="file" accept="image/*" className="hidden" onChange={oaHandleUpload} />
              </div>
            )}

            {oaCameraActive && (
              <div className="relative rounded-xl overflow-hidden bg-black">
                <video ref={oaVideoRef} autoPlay playsInline muted className="w-full max-h-64 object-cover" />
                <div className="absolute bottom-3 inset-x-0 flex justify-center gap-3">
                  <button onClick={oaCapturePhoto} className="px-4 py-2 bg-white rounded-full text-sm font-semibold shadow-lg hover:bg-gray-100">
                    Capture
                  </button>
                  <button onClick={oaStopCamera} className="px-4 py-2 bg-gray-800 text-white rounded-full text-sm font-semibold shadow-lg hover:bg-gray-700">
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {oaPreview && (
              <div className="flex items-start gap-4">
                <div className="relative w-28 h-28 rounded-xl overflow-hidden flex-shrink-0 border border-purple-200">
                  <img src={oaPreview} alt="Your photo" className="w-full h-full object-cover" />
                  <button
                    onClick={oaReset}
                    className="absolute top-1 right-1 p-0.5 bg-white/90 rounded-full shadow"
                  >
                    <X className="w-3 h-3 text-gray-600" />
                  </button>
                </div>
                <div className="flex-1 space-y-3">
                  <div>
                    <p className="text-xs font-medium text-gray-600 mb-1.5">Analyse combinations for:</p>
                    <div className="flex gap-2">
                      {['upper', 'lower', 'footwear'].map((cat) => (
                        <button
                          key={cat}
                          onClick={() => oaToggleCat(cat)}
                          className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                            oaCats.includes(cat)
                              ? 'bg-purple-600 text-white'
                              : 'bg-white text-gray-600 border border-gray-200 hover:border-purple-300'
                          }`}
                        >
                          {cat === 'footwear' ? 'Shoes' : cat.charAt(0).toUpperCase() + cat.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={oaAnalyse}
                    disabled={oaCats.length === 0 || oaLoading}
                    className="px-4 py-2 bg-purple-600 text-white text-xs font-semibold rounded-lg hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                  >
                    {oaLoading ? <><Loader2 className="w-3 h-3 animate-spin" />Analysing...</> : <><Sparkles className="w-3 h-3" />Analyse</>}
                  </button>
                </div>
              </div>
            )}

            {/* Results */}
            {oaResult && (oaResult.categories || oaResult.rating) && (
              <div className="space-y-4">
                {/* Rating + Critique */}
                {oaResult.rating > 0 && (
                  <div className="bg-white rounded-xl border border-purple-200 p-4 flex items-start gap-4">
                    <div className={`w-14 h-14 rounded-xl flex flex-col items-center justify-center flex-shrink-0 ${
                      oaResult.rating >= 8 ? 'bg-green-100 text-green-700' :
                      oaResult.rating >= 5 ? 'bg-amber-100 text-amber-700' :
                      'bg-red-100 text-red-700'
                    }`}>
                      <span className="text-xl font-extrabold leading-none">{oaResult.rating}</span>
                      <span className="text-[9px] font-semibold opacity-70">/10</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      {oaResult.detected_outfit && (
                        <p className="text-[11px] text-gray-400 mb-1">Wearing: {oaResult.detected_outfit}</p>
                      )}
                      <p className="text-xs text-gray-700 leading-relaxed">{oaResult.critique}</p>
                    </div>
                  </div>
                )}

                {/* Per-category suggestions */}
                {oaResult.categories && Object.entries(oaResult.categories).map(([cat, suggestions]) => {
                  const label = cat === 'footwear' ? 'Shoes' : cat.charAt(0).toUpperCase() + cat.slice(1);
                  const isExpanded = oaExpanded[cat];
                  const visible = (suggestions || []).slice(0, isExpanded ? 5 : 3);
                  const hasMore = (suggestions || []).length > 3 && !isExpanded;
                  return (
                    <div key={cat} className="space-y-2">
                      <h3 className="text-xs font-bold text-purple-800 uppercase tracking-wide">{label}</h3>
                      {visible.map((s, i) => (
                        <div key={i} className="bg-white rounded-xl border border-purple-100 p-3 flex items-start gap-3">
                          <div className="text-xs font-bold text-purple-500 bg-purple-50 w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0">
                            {s.rank || i + 1}
                          </div>
                          {s.colour?.hex && (
                            <div className="w-10 h-10 rounded-lg flex-shrink-0 border border-gray-200 shadow-sm" style={{ backgroundColor: s.colour.hex }} title={s.colour.name} />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-gray-800">{s.type}</p>
                            <div className="flex flex-wrap gap-1.5 mt-1">
                              {s.colour?.name && (
                                <span className="text-[10px] bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded">{s.colour.name}</span>
                              )}
                              {s.fabric && (
                                <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{s.fabric}</span>
                              )}
                            </div>
                            <p className="text-[11px] text-gray-600 mt-1 leading-relaxed">{s.reason}</p>
                          </div>
                        </div>
                      ))}
                      {hasMore && (
                        <button
                          onClick={() => setOaExpanded((p) => ({ ...p, [cat]: true }))}
                          className="text-xs font-medium text-purple-600 hover:text-purple-800 ml-1"
                        >
                          + Show 2 more {label.toLowerCase()}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Shopping Suggestions ── */}
      <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50 overflow-hidden">
        <button
          onClick={() => setSsOpen((p) => !p)}
          className="w-full px-5 py-3.5 flex items-center justify-between hover:bg-emerald-100/40 transition-colors"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center">
              <ShoppingBag className="w-4 h-4 text-white" />
            </div>
            <div className="text-left">
              <h2 className="text-sm font-semibold text-gray-900">Shopping Suggestions</h2>
              <p className="text-xs text-gray-500">Pick what to buy — get suggestions that suit your looks & build your collection</p>
            </div>
          </div>
          {ssOpen ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </button>

        {ssOpen && (
          <div className="px-5 pb-5 space-y-4">
            <div>
              <p className="text-xs font-medium text-gray-600 mb-2">What do you want to upgrade?</p>
              <div className="flex gap-2">
                {['upper', 'lower', 'footwear'].map((cat) => (
                  <button
                    key={cat}
                    onClick={() => ssToggleCat(cat)}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                      ssCats.includes(cat)
                        ? 'bg-emerald-600 text-white'
                        : 'bg-white text-gray-600 border border-gray-200 hover:border-emerald-300'
                    }`}
                  >
                    {cat === 'footwear' ? 'Shoes' : cat.charAt(0).toUpperCase() + cat.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <button
              onClick={ssAnalyse}
              disabled={ssCats.length === 0 || ssLoading}
              className="px-4 py-2 bg-emerald-600 text-white text-xs font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              {ssLoading ? <><Loader2 className="w-3 h-3 animate-spin" />Analysing wardrobe...</> : <><ShoppingBag className="w-3 h-3" />Get Suggestions</>}
            </button>

            {/* Results */}
            {ssResult && (ssResult.categories || ssResult.wardrobe_analysis) && (
              <div className="space-y-4">
                {ssResult.wardrobe_analysis && (
                  <p className="text-xs text-gray-500 italic bg-white/60 rounded-lg px-3 py-2">
                    {ssResult.wardrobe_analysis}
                  </p>
                )}

                {ssResult.categories && Object.entries(ssResult.categories).map(([cat, suggestions]) => {
                  const label = cat === 'footwear' ? 'Shoes' : cat.charAt(0).toUpperCase() + cat.slice(1);
                  const isExpanded = ssExpanded[cat];
                  const visible = (suggestions || []).slice(0, isExpanded ? 5 : 3);
                  const hasMore = (suggestions || []).length > 3 && !isExpanded;
                  return (
                    <div key={cat} className="space-y-2">
                      <h3 className="text-xs font-bold text-emerald-800 uppercase tracking-wide">{label}</h3>
                      {visible.map((s, i) => (
                        <div key={i} className="bg-white rounded-xl border border-emerald-100 p-3 flex items-start gap-3">
                          <div className="text-xs font-bold text-emerald-500 bg-emerald-50 w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0">
                            {s.rank || i + 1}
                          </div>
                          {s.colour?.hex && (
                            <div className="w-10 h-10 rounded-lg flex-shrink-0 border border-gray-200 shadow-sm" style={{ backgroundColor: s.colour.hex }} title={s.colour.name} />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-gray-800">{s.type}</p>
                            <div className="flex flex-wrap gap-1.5 mt-1">
                              {s.colour?.name && (
                                <span className="text-[10px] bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded">{s.colour.name}</span>
                              )}
                              {s.fabric && (
                                <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{s.fabric}</span>
                              )}
                              {s.occasion && (
                                <span className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">{s.occasion}</span>
                              )}
                            </div>
                            {s.description && (
                              <p className="text-[11px] text-gray-600 mt-1 leading-relaxed">{s.description}</p>
                            )}
                            <p className="text-[11px] text-emerald-700 mt-1 font-medium">{s.reason}</p>
                          </div>
                        </div>
                      ))}
                      {hasMore && (
                        <button
                          onClick={() => setSsExpanded((p) => ({ ...p, [cat]: true }))}
                          className="text-xs font-medium text-emerald-600 hover:text-emerald-800 ml-1"
                        >
                          + Show 2 more {label.toLowerCase()}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {loading ? (
        <div className="space-y-8">
          {SECTIONS.map((s) => (
            <div key={s.key}>
              <div className="h-6 bg-gray-200 rounded w-32 mb-3 animate-pulse" />
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <SkeletonCard key={i} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="space-y-6">
          <div className="text-center py-8">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <UploadIcon className="w-8 h-8 text-gray-300" />
            </div>
            <h3 className="text-lg font-medium text-gray-700">No clothes yet</h3>
            <p className="text-sm text-gray-400 mt-1">
              Upload items in each section below to get started
            </p>
          </div>
          {SECTIONS.map((section) => {
            const upState = sectionUploadState[section.key];
            const isBusy = upState && !upState.done && upState.step !== 'error';
            return (
              <div
                key={section.key}
                className={`rounded-2xl overflow-hidden border border-gray-200 ${SECTION_BG[section.key]}`}
              >
                <div className={`${SECTION_HEADER_BG[section.key]} px-5 py-3 flex items-center justify-between`}>
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{section.icon}</span>
                    <div>
                      <h2 className="text-white font-semibold text-sm">{section.label}</h2>
                      <p className="text-white/70 text-xs">{section.description}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="bg-white/20 text-white text-xs font-bold px-2.5 py-1 rounded-full">0</span>
                    <button
                      onClick={() => fileInputRefs.current[section.key]?.click()}
                      disabled={isBusy}
                      className="px-3 py-1.5 bg-white/20 hover:bg-white/30 text-white text-xs font-medium rounded-lg flex items-center gap-1.5 transition-colors disabled:opacity-50"
                    >
                      {isBusy ? (
                        <><Loader2 className="w-3 h-3 animate-spin" />In progress...</>
                      ) : (
                        <><Plus className="w-3 h-3" />Upload {section.label}</>
                      )}
                    </button>
                    <input
                      ref={(el) => (fileInputRefs.current[section.key] = el)}
                      type="file"
                      multiple
                      accept="image/jpeg,image/png,image/webp,image/avif"
                      className="hidden"
                      onChange={(e) => { handleSectionUpload(section.key, e.target.files); e.target.value = ''; }}
                    />
                  </div>
                </div>
                {upState ? (
                  <SectionUploadProgress state={upState} sectionColor={section.color} />
                ) : (
                  <div className="p-4">
                    <p className="text-center text-sm text-gray-400 py-6">
                      No {section.label.toLowerCase()} items yet — click Upload above
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex gap-6">
          {/* Left: clothing grid sections */}
          <div className={`space-y-6 min-w-0 ${hasSelection ? 'flex-1' : 'w-full'}`}>
            {SECTIONS.map((section) => {
              const sectionItems = applyColorFilter(grouped[section.key]);
              const upState = sectionUploadState[section.key];
              const isBusy = upState && !upState.done && upState.step !== 'error';
              return (
                <div
                  key={section.key}
                  className={`rounded-2xl overflow-hidden border border-gray-200 ${SECTION_BG[section.key]}`}
                >
                  <div className={`${SECTION_HEADER_BG[section.key]} px-5 py-3 flex items-center justify-between`}>
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{section.icon}</span>
                      <div>
                        <h2 className="text-white font-semibold text-sm">{section.label}</h2>
                        <p className="text-white/70 text-xs">{section.description}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="bg-white/20 text-white text-xs font-bold px-2.5 py-1 rounded-full">
                        {grouped[section.key].length}
                      </span>
                      <button
                        onClick={() => fileInputRefs.current[section.key]?.click()}
                        disabled={isBusy}
                        className="px-3 py-1.5 bg-white/20 hover:bg-white/30 text-white text-xs font-medium rounded-lg flex items-center gap-1.5 transition-colors disabled:opacity-50"
                      >
                        {isBusy ? (
                          <><Loader2 className="w-3 h-3 animate-spin" />In progress...</>
                        ) : (
                          <><Plus className="w-3 h-3" />Upload {section.label}</>
                        )}
                      </button>
                      <input
                        ref={(el) => (fileInputRefs.current[section.key] = el)}
                        type="file"
                        multiple
                        accept="image/jpeg,image/png,image/webp,image/avif"
                        className="hidden"
                        onChange={(e) => { handleSectionUpload(section.key, e.target.files); e.target.value = ''; }}
                      />
                    </div>
                  </div>

                  {upState && <SectionUploadProgress state={upState} sectionColor={section.color} />}

                  <div className="p-4">
                    {sectionItems.length === 0 ? (
                      <p className="text-center text-sm text-gray-400 py-6">
                        {colorSearch
                          ? 'No matches for this search'
                          : `No ${section.label.toLowerCase()} items yet`}
                      </p>
                    ) : (
                      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
                        {sectionItems.map((item) => {
                          const isSelected = selected[section.key]?.item_id === item.item_id;
                          return (
                            <div
                              key={item.item_id}
                              className={`group/card relative cursor-pointer rounded-xl overflow-hidden border-2 transition-all hover:scale-[1.03] ${
                                isSelected
                                  ? `${SECTION_BORDER[section.key]} ring-2`
                                  : 'border-white/80 hover:border-gray-300'
                              }`}
                            >
                              <div
                                className="aspect-square bg-white"
                                onClick={() => toggleSelect(section.key, item)}
                              >
                                <img
                                  src={item.segmented_url || item.image_url}
                                  alt={item.short_description || 'Clothing'}
                                  className="w-full h-full object-cover"
                                  loading="lazy"
                                />
                              </div>

                              {isSelected && (
                                <div className="absolute top-1.5 right-1.5 w-5 h-5 bg-white rounded-full shadow flex items-center justify-center">
                                  <Check className="w-3.5 h-3.5 text-green-600" />
                                </div>
                              )}

                              {item.category && (
                                <span className="absolute top-1.5 left-1.5 bg-black/60 text-white text-[9px] font-semibold px-1.5 py-0.5 rounded-full capitalize">
                                  {item.category}
                                </span>
                              )}

                              <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover/card:opacity-100 transition-opacity">
                                <button
                                  onClick={(e) => { e.stopPropagation(); setDetailItem(item); }}
                                  className="p-1 bg-white/90 rounded-md hover:bg-white shadow-sm"
                                  title="View details"
                                >
                                  <Eye className="w-3 h-3 text-gray-700" />
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); setDeleteConfirm(item); }}
                                  className="p-1 bg-white/90 rounded-md hover:bg-white shadow-sm"
                                  title="Delete"
                                >
                                  <Trash2 className="w-3 h-3 text-red-600" />
                                </button>
                              </div>

                              <div className="bg-white px-2 py-1.5">
                                {item.primary_color ? (
                                  <div className="flex items-center gap-1">
                                    <span
                                      className="w-2.5 h-2.5 rounded-full border border-gray-200 flex-shrink-0"
                                      style={{ backgroundColor: item.primary_color }}
                                    />
                                    <span className="text-[10px] text-gray-500 truncate">
                                      {item.short_description || item.primary_color}
                                    </span>
                                  </div>
                                ) : (
                                  <span className="text-[10px] text-gray-400">Processing...</span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {grouped.other.length > 0 && (
              <div className="rounded-2xl overflow-hidden border border-gray-200 bg-gray-50">
                <div className="bg-gray-600 px-5 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">📦</span>
                    <div>
                      <h2 className="text-white font-semibold text-sm">Uncategorized</h2>
                      <p className="text-white/70 text-xs">Items without a wear position</p>
                    </div>
                  </div>
                  <span className="bg-white/20 text-white text-xs font-bold px-2.5 py-1 rounded-full">
                    {grouped.other.length}
                  </span>
                </div>
                <div className="p-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {applyColorFilter(grouped.other).map((item) => (
                      <ClothingCard
                        key={item.item_id}
                        item={item}
                        onEdit={handleEdit}
                        onDelete={handleDelete}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right: Vertical outfit preview — stacked like wearing */}
          {hasSelection && (
            <div className="w-48 flex-shrink-0 sticky top-4 self-start">
              <div className="bg-white border border-gray-200 rounded-2xl shadow-lg overflow-hidden">
                {/* Header */}
                <div className="px-3 py-2.5 bg-gray-900 flex items-center justify-between">
                  <span className="text-xs font-semibold text-white">Outfit Preview</span>
                  <button
                    onClick={clearSelection}
                    className="text-gray-400 hover:text-white transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Stacked outfit — no gaps, like wearing */}
                <div className="flex flex-col">
                  {/* Upper */}
                  <div className="relative">
                    {selected.upper ? (
                      <img
                        src={selected.upper.segmented_url || selected.upper.image_url}
                        alt="Upper"
                        className="w-full aspect-[4/5] object-cover"
                      />
                    ) : (
                      <div className="w-full aspect-[4/5] bg-indigo-50 flex flex-col items-center justify-center">
                        <span className="text-3xl opacity-30">👕</span>
                        <span className="text-[9px] text-indigo-300 font-medium mt-1">Select top</span>
                      </div>
                    )}
                    <span className="absolute top-1 left-1 bg-indigo-600/80 text-white text-[8px] font-bold px-1.5 py-0.5 rounded-full uppercase">
                      Upper
                    </span>
                  </div>

                  {/* Divider line */}
                  <div className="h-px bg-gray-200" />

                  {/* Lower */}
                  <div className="relative">
                    {selected.lower ? (
                      <img
                        src={selected.lower.segmented_url || selected.lower.image_url}
                        alt="Lower"
                        className="w-full aspect-[4/5] object-cover"
                      />
                    ) : (
                      <div className="w-full aspect-[4/5] bg-emerald-50 flex flex-col items-center justify-center">
                        <span className="text-3xl opacity-30">👖</span>
                        <span className="text-[9px] text-emerald-300 font-medium mt-1">Select bottom</span>
                      </div>
                    )}
                    <span className="absolute top-1 left-1 bg-emerald-600/80 text-white text-[8px] font-bold px-1.5 py-0.5 rounded-full uppercase">
                      Lower
                    </span>
                  </div>

                  {/* Divider line */}
                  <div className="h-px bg-gray-200" />

                  {/* Shoes */}
                  <div className="relative">
                    {selected.footwear ? (
                      <img
                        src={selected.footwear.segmented_url || selected.footwear.image_url}
                        alt="Shoes"
                        className="w-full aspect-[4/4] object-cover"
                      />
                    ) : (
                      <div className="w-full aspect-[4/4] bg-amber-50 flex flex-col items-center justify-center">
                        <span className="text-3xl opacity-30">👟</span>
                        <span className="text-[9px] text-amber-300 font-medium mt-1">Select shoes</span>
                      </div>
                    )}
                    <span className="absolute top-1 left-1 bg-amber-600/80 text-white text-[8px] font-bold px-1.5 py-0.5 rounded-full uppercase">
                      Shoes
                    </span>
                  </div>
                </div>

                {/* Try On */}
                <div className="p-3 border-t border-gray-100">
                  {tryingOn && tryOnStart ? (
                    <div className="bg-gradient-to-br from-purple-50 to-pink-50 border border-purple-100 rounded-xl p-2.5 space-y-1.5">
                      <div className="flex items-center gap-1.5">
                        <Loader2 className="w-3.5 h-3.5 text-purple-600 animate-spin" />
                        <span className="text-[10px] font-semibold text-purple-700">Generating try-on...</span>
                      </div>
                      <TryOnProgress startTime={tryOnStart} />
                    </div>
                  ) : (
                    <>
                      <button
                        onClick={handleTryOn}
                        disabled={!selected.upper || !selected.lower || !selected.footwear}
                        className="w-full py-2.5 bg-gradient-to-r from-purple-600 to-pink-600 text-white text-xs font-semibold rounded-lg hover:from-purple-700 hover:to-pink-700 transition-all flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Shirt className="w-3.5 h-3.5" />
                        Try On This Outfit
                      </button>
                      {(!selected.upper || !selected.lower || !selected.footwear) && (
                        <p className="text-[9px] text-gray-400 text-center mt-1">
                          Select all 3 items to try on
                        </p>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setDeleteConfirm(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6" onClick={(e) => e.stopPropagation()}>
            <div className="text-center">
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <Trash2 className="w-6 h-6 text-red-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-1">Delete this item?</h3>
              <p className="text-sm text-gray-500 mb-4">
                {deleteConfirm.short_description || deleteConfirm.category || 'This clothing item'} will be permanently removed.
              </p>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={() => setDeleteConfirm(null)}
                  className="px-4 py-2 text-sm font-medium bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    await handleDelete(deleteConfirm.item_id);
                    setDeleteConfirm(null);
                  }}
                  className="px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {detailItem && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setDetailItem(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between rounded-t-2xl">
              <h3 className="text-lg font-semibold text-gray-900">
                {detailItem.sub_category || detailItem.category || 'Clothing Details'}
              </h3>
              <button
                onClick={() => setDetailItem(null)}
                className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <div className="p-6">
              <div className="flex flex-col md:flex-row gap-6">
                {/* Image */}
                <div className="w-full md:w-64 flex-shrink-0">
                  <img
                    src={detailItem.segmented_url || detailItem.image_url}
                    alt={detailItem.short_description || 'Clothing'}
                    className="w-full rounded-xl object-cover bg-gray-50"
                  />
                </div>

                {/* Details */}
                <div className="flex-1 space-y-4">
                  {/* Short description */}
                  {detailItem.short_description && (
                    <p className="text-sm text-gray-700 font-medium">{detailItem.short_description}</p>
                  )}

                  {/* Full search description */}
                  {detailItem.search_description && (
                    <div>
                      <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Description</h4>
                      <p className="text-sm text-gray-600 leading-relaxed">{detailItem.search_description}</p>
                    </div>
                  )}

                  {/* Properties grid */}
                  <div className="grid grid-cols-2 gap-3">
                    {detailItem.category && (
                      <div>
                        <span className="text-[10px] font-semibold text-gray-400 uppercase">Category</span>
                        <p className="text-sm text-gray-800 capitalize">{detailItem.category}</p>
                      </div>
                    )}
                    {detailItem.sub_category && (
                      <div>
                        <span className="text-[10px] font-semibold text-gray-400 uppercase">Type</span>
                        <p className="text-sm text-gray-800 capitalize">{detailItem.sub_category}</p>
                      </div>
                    )}
                    {detailItem.primary_color && (
                      <div>
                        <span className="text-[10px] font-semibold text-gray-400 uppercase">Color</span>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="w-3 h-3 rounded-full border border-gray-200" style={{ backgroundColor: detailItem.primary_color }} />
                          <span className="text-sm text-gray-800">{detailItem.primary_color}</span>
                          {detailItem.secondary_color && (
                            <>
                              <span className="w-3 h-3 rounded-full border border-gray-200" style={{ backgroundColor: detailItem.secondary_color }} />
                              <span className="text-sm text-gray-600">{detailItem.secondary_color}</span>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                    {detailItem.pattern && (
                      <div>
                        <span className="text-[10px] font-semibold text-gray-400 uppercase">Pattern</span>
                        <p className="text-sm text-gray-800 capitalize">{detailItem.pattern}</p>
                      </div>
                    )}
                    {detailItem.fabric && (
                      <div>
                        <span className="text-[10px] font-semibold text-gray-400 uppercase">Fabric</span>
                        <p className="text-sm text-gray-800 capitalize">{detailItem.fabric}</p>
                      </div>
                    )}
                    {detailItem.fabric_texture && (
                      <div>
                        <span className="text-[10px] font-semibold text-gray-400 uppercase">Texture</span>
                        <p className="text-sm text-gray-800 capitalize">{detailItem.fabric_texture}</p>
                      </div>
                    )}
                    {detailItem.fit_type && (
                      <div>
                        <span className="text-[10px] font-semibold text-gray-400 uppercase">Fit</span>
                        <p className="text-sm text-gray-800 capitalize">{detailItem.fit_type}</p>
                      </div>
                    )}
                    {detailItem.neckline && (
                      <div>
                        <span className="text-[10px] font-semibold text-gray-400 uppercase">Neckline</span>
                        <p className="text-sm text-gray-800 capitalize">{detailItem.neckline}</p>
                      </div>
                    )}
                    {detailItem.sleeve_length && (
                      <div>
                        <span className="text-[10px] font-semibold text-gray-400 uppercase">Sleeve</span>
                        <p className="text-sm text-gray-800 capitalize">{detailItem.sleeve_length}</p>
                      </div>
                    )}
                    {detailItem.garment_length && (
                      <div>
                        <span className="text-[10px] font-semibold text-gray-400 uppercase">Length</span>
                        <p className="text-sm text-gray-800 capitalize">{detailItem.garment_length}</p>
                      </div>
                    )}
                    {detailItem.closure_type && (
                      <div>
                        <span className="text-[10px] font-semibold text-gray-400 uppercase">Closure</span>
                        <p className="text-sm text-gray-800 capitalize">{detailItem.closure_type}</p>
                      </div>
                    )}
                    {detailItem.dominant_tone && (
                      <div>
                        <span className="text-[10px] font-semibold text-gray-400 uppercase">Tone</span>
                        <p className="text-sm text-gray-800 capitalize">{detailItem.dominant_tone}</p>
                      </div>
                    )}
                    {detailItem.layering_potential && (
                      <div>
                        <span className="text-[10px] font-semibold text-gray-400 uppercase">Layering</span>
                        <p className="text-sm text-gray-800 capitalize">{detailItem.layering_potential}</p>
                      </div>
                    )}
                    {detailItem.brand_style_cues && (
                      <div className="col-span-2">
                        <span className="text-[10px] font-semibold text-gray-400 uppercase">Style Cues</span>
                        <p className="text-sm text-gray-800">{detailItem.brand_style_cues}</p>
                      </div>
                    )}
                  </div>

                  {/* Pattern description */}
                  {detailItem.pattern_description && (
                    <div>
                      <span className="text-[10px] font-semibold text-gray-400 uppercase">Pattern Detail</span>
                      <p className="text-sm text-gray-600">{detailItem.pattern_description}</p>
                    </div>
                  )}

                  {/* Embellishments */}
                  {detailItem.embellishments && detailItem.embellishments.length > 0 && (
                    <div>
                      <span className="text-[10px] font-semibold text-gray-400 uppercase">Features</span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {detailItem.embellishments.map((tag) => (
                          <span key={tag} className="text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Occasion & Style tags */}
                  {detailItem.occasion_tags && detailItem.occasion_tags.length > 0 && (
                    <div>
                      <span className="text-[10px] font-semibold text-gray-400 uppercase">Occasions</span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {detailItem.occasion_tags.map((tag) => (
                          <span key={tag} className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {detailItem.style_tags && detailItem.style_tags.length > 0 && (
                    <div>
                      <span className="text-[10px] font-semibold text-gray-400 uppercase">Style</span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {detailItem.style_tags.map((tag) => (
                          <span key={tag} className="text-xs bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {detailItem.season && detailItem.season.length > 0 && (
                    <div>
                      <span className="text-[10px] font-semibold text-gray-400 uppercase">Season</span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {detailItem.season.map((tag) => (
                          <span key={tag} className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Search tags */}
                  {detailItem.search_tags && detailItem.search_tags.length > 0 && (
                    <div>
                      <span className="text-[10px] font-semibold text-gray-400 uppercase">Search Tags</span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {detailItem.search_tags.map((tag) => (
                          <span key={tag} className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded border border-gray-200">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Delete from detail modal */}
              <div className="mt-6 pt-4 border-t border-gray-100 flex justify-end">
                <button
                  onClick={async () => {
                    await handleDelete(detailItem.item_id);
                    setDetailItem(null);
                  }}
                  className="px-4 py-2 text-sm font-medium bg-red-50 text-red-700 rounded-lg hover:bg-red-100 flex items-center gap-1.5 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete Item
                </button>
              </div>
            </div>
          </div>
        </div>
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
