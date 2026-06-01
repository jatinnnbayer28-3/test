import { useState, useCallback, useContext, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Upload as UploadIcon,
  X,
  Sparkles,
  ArrowRight,
  Shirt,
  User,
  Camera,
  Loader2,
  Check,
  RefreshCw,
} from 'lucide-react';
import { uploadBatch, processWardrobe, createAvatar, getAvatar } from '../api/client';
import UploadProgressBar from '../components/UploadProgressBar';
import { AppContext } from '../App';

const POSITION_OPTIONS = [
  { value: 'upper', label: 'Upper', icon: '👕', color: 'indigo' },
  { value: 'lower', label: 'Lower', icon: '👖', color: 'emerald' },
  { value: 'footwear', label: 'Shoes', icon: '👟', color: 'amber' },
];

function PositionPill({ value, selected, onClick }) {
  const opt = POSITION_OPTIONS.find((o) => o.value === value);
  const isActive = selected === value;
  const colorMap = {
    indigo: isActive
      ? 'bg-indigo-100 border-indigo-500 text-indigo-700'
      : 'bg-white border-gray-200 text-gray-500 hover:border-indigo-300',
    emerald: isActive
      ? 'bg-emerald-100 border-emerald-500 text-emerald-700'
      : 'bg-white border-gray-200 text-gray-500 hover:border-emerald-300',
    amber: isActive
      ? 'bg-amber-100 border-amber-500 text-amber-700'
      : 'bg-white border-gray-200 text-gray-500 hover:border-amber-300',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2 py-0.5 text-[10px] font-medium rounded-full border transition-all ${colorMap[opt.color]}`}
    >
      {opt.icon} {opt.label}
    </button>
  );
}

function ProfileBadge({ label, value }) {
  if (!value) return null;
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-gray-400 uppercase tracking-wide">{label}</span>
      <span className="text-xs font-medium text-gray-700 capitalize">{value}</span>
    </div>
  );
}

export default function Upload() {
  const { userId } = useContext(AppContext);
  const navigate = useNavigate();

  const [files, setFiles] = useState([]);
  const [previews, setPreviews] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [processItems, setProcessItems] = useState([]);
  const [processedCount, setProcessedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState('');

  // Avatar state
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState(null);
  const [avatarData, setAvatarData] = useState(null);
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [avatarError, setAvatarError] = useState('');

  useEffect(() => {
    loadExistingAvatar();
  }, [userId]);

  const loadExistingAvatar = async () => {
    try {
      const data = await getAvatar(userId);
      if (data && data.avatar_url) {
        setAvatarData(data);
      }
    } catch (err) {
      // no avatar yet
    }
  };

  const handleAvatarFile = (e) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
    setAvatarError('');
  };

  const handleAvatarUpload = async () => {
    if (!avatarFile) return;
    setAvatarLoading(true);
    setAvatarError('');
    try {
      const data = await createAvatar(userId, avatarFile);
      setAvatarData(data);
      setAvatarFile(null);
      if (avatarPreview) URL.revokeObjectURL(avatarPreview);
      setAvatarPreview(null);
    } catch (err) {
      setAvatarError(err.message || 'Avatar generation failed');
    } finally {
      setAvatarLoading(false);
    }
  };

  const handleFiles = useCallback((newFiles) => {
    const imageFiles = Array.from(newFiles).filter((f) =>
      f.type.startsWith('image/')
    );
    setFiles((prev) => [...prev, ...imageFiles]);
    const newPreviews = imageFiles.map((f) => ({
      name: f.name,
      url: URL.createObjectURL(f),
      wearPosition: '',
    }));
    setPreviews((prev) => [...prev, ...newPreviews]);
  }, []);

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  const setPosition = (index, pos) => {
    setPreviews((prev) =>
      prev.map((p, i) =>
        i === index ? { ...p, wearPosition: p.wearPosition === pos ? '' : pos } : p
      )
    );
  };

  const setAllPositions = (pos) => {
    setPreviews((prev) => prev.map((p) => ({ ...p, wearPosition: pos })));
  };

  const clearFiles = () => {
    previews.forEach((p) => URL.revokeObjectURL(p.url));
    setFiles([]);
    setPreviews([]);
  };

  const removeFile = (index) => {
    URL.revokeObjectURL(previews[index].url);
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setPreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const allHavePosition = previews.length > 0 && previews.every((p) => p.wearPosition);

  const handleUpload = async () => {
    if (files.length === 0) return;
    if (!allHavePosition) {
      setError('Please select a wear type (Upper / Lower / Shoes) for every item before uploading.');
      return;
    }
    setUploading(true);
    setError('');
    try {
      const positions = previews.map((p) => p.wearPosition);
      const result = await uploadBatch(userId, files, positions);
      setUploaded(result);
      setProcessItems(result.map((r) => ({ ...r, status: 'pending' })));
      setTotalCount(result.length);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleProcess = async () => {
    setProcessing(true);
    setProcessedCount(0);
    setError('');
    try {
      await processWardrobe(userId, (data) => {
        if (data.status === 'complete') {
          setComplete(true);
          setProcessing(false);
          return;
        }
        if (data.message === 'nothing to process') {
          setComplete(true);
          setProcessing(false);
          return;
        }
        if (data.processed) {
          setProcessedCount(data.processed);
        }
        setProcessItems((prev) =>
          prev.map((item) =>
            item.item_id === data.item_id
              ? { ...item, ...data, status: data.status === 'error' ? 'error' : 'ready' }
              : item
          )
        );
      });
    } catch (err) {
      setError(err.message);
      setProcessing(false);
    }
  };

  const bp = avatarData?.body_profile;

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Upload Your Wardrobe</h1>
        <p className="text-gray-500 mt-1">
          Create your avatar, then drop your clothing photos to let AI analyse them
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm mb-6">
          {error}
        </div>
      )}

      <div className="flex gap-6 items-start">
        {/* ─── LEFT: Avatar Section ─── */}
        <div className="w-72 shrink-0 space-y-4">
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
            <div className="bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-3 flex items-center gap-2">
              <User className="w-4 h-4 text-white" />
              <span className="text-sm font-semibold text-white">Your Avatar</span>
            </div>

            <div className="p-4 space-y-3">
              {avatarData?.avatar_url ? (
                <div className="space-y-3">
                  <div className="relative rounded-xl overflow-hidden bg-white border border-gray-100">
                    <img
                      src={avatarData.avatar_url}
                      alt="Your avatar"
                      className="w-full aspect-[3/4] object-contain bg-white"
                    />
                    <span className="absolute top-2 right-2 bg-green-500 text-white text-[9px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                      <Check className="w-2.5 h-2.5" /> Ready
                    </span>
                    <span className="absolute bottom-2 left-2 bg-black/60 text-white text-[9px] px-2 py-0.5 rounded-full">
                      🍌 Nano Banana · Vertex AI
                    </span>
                  </div>

                  <button
                    onClick={() => {
                      setAvatarData(null);
                      setAvatarFile(null);
                      setAvatarPreview(null);
                    }}
                    className="w-full text-xs text-gray-500 hover:text-indigo-600 flex items-center justify-center gap-1 py-1.5 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <RefreshCw className="w-3 h-3" /> Re-create Avatar
                  </button>
                </div>
              ) : avatarPreview ? (
                <div className="space-y-3">
                  <div className="relative rounded-xl overflow-hidden border border-gray-200">
                    <img
                      src={avatarPreview}
                      alt="Preview"
                      className="w-full aspect-[3/4] object-cover"
                    />
                    <button
                      onClick={() => {
                        URL.revokeObjectURL(avatarPreview);
                        setAvatarFile(null);
                        setAvatarPreview(null);
                      }}
                      className="absolute top-2 right-2 w-6 h-6 bg-black/60 rounded-full flex items-center justify-center text-white hover:bg-black/80"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {avatarError && (
                    <p className="text-xs text-red-500 bg-red-50 rounded-lg px-2 py-1.5">{avatarError}</p>
                  )}

                  <button
                    onClick={handleAvatarUpload}
                    disabled={avatarLoading}
                    className="w-full py-2.5 bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-sm font-semibold rounded-xl hover:from-violet-700 hover:to-indigo-700 disabled:opacity-60 flex items-center justify-center gap-2 transition-all"
                  >
                    {avatarLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        Create Studio Avatar
                      </>
                    )}
                  </button>
                </div>
              ) : (
                <div
                  onClick={() => document.getElementById('avatar-input').click()}
                  className="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center hover:border-violet-400 hover:bg-violet-50/30 transition-colors cursor-pointer"
                >
                  <Camera className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                  <p className="text-sm font-medium text-gray-600">Upload Full-Body Photo</p>
                  <p className="text-[10px] text-gray-400 mt-1">
                    High-quality photo for best results
                  </p>
                  <input
                    id="avatar-input"
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/avif"
                    className="hidden"
                    onChange={handleAvatarFile}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Body Profile Card */}
          {bp && (
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
              <div className="bg-gray-800 px-4 py-2.5">
                <span className="text-xs font-semibold text-white">Body Profile</span>
              </div>
              <div className="p-3 space-y-2">
                <ProfileBadge label="Gender" value={bp.gender} />
                <ProfileBadge label="Age" value={bp.estimated_age_range} />
                <ProfileBadge label="Skin" value={bp.skin_tone} />
                <ProfileBadge label="Undertone" value={bp.skin_undertone} />
                <ProfileBadge label="Build" value={bp.build} />
                <ProfileBadge label="Body Type" value={bp.body_type} />
                <ProfileBadge label="Height" value={bp.estimated_height_category} />
                <ProfileBadge label="Shoulders" value={bp.shoulder_width} />
                <ProfileBadge label="Hair" value={bp.hair_color} />

                {bp.best_colors && bp.best_colors.length > 0 && (
                  <div className="pt-1">
                    <span className="text-[10px] text-gray-400 uppercase tracking-wide">Best Colors</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {bp.best_colors.map((c, i) => (
                        <span key={i} className="text-[10px] bg-green-50 text-green-700 px-1.5 py-0.5 rounded capitalize">
                          {c}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {bp.colors_to_avoid && bp.colors_to_avoid.length > 0 && (
                  <div>
                    <span className="text-[10px] text-gray-400 uppercase tracking-wide">Avoid</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {bp.colors_to_avoid.map((c, i) => (
                        <span key={i} className="text-[10px] bg-red-50 text-red-600 px-1.5 py-0.5 rounded capitalize">
                          {c}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {bp.fashion_notes && (
                  <p className="text-[10px] text-gray-500 leading-relaxed border-t border-gray-100 pt-2 mt-2">
                    {bp.fashion_notes}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ─── RIGHT: Clothing Upload Section ─── */}
        <div className="flex-1 min-w-0 space-y-6">
          {!uploaded && (
            <>
              <div
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                className="border-2 border-dashed border-gray-300 rounded-2xl p-12 text-center hover:border-indigo-400 hover:bg-indigo-50/30 transition-colors cursor-pointer"
                onClick={() => document.getElementById('file-input').click()}
              >
                <UploadIcon className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <p className="text-lg font-medium text-gray-700">
                  Drop clothing photos here
                </p>
                <p className="text-sm text-gray-400 mt-1">
                  or click to browse — JPEG, PNG, WebP, AVIF
                </p>
                <input
                  id="file-input"
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/webp,image/avif"
                  className="hidden"
                  onChange={(e) => handleFiles(e.target.files)}
                />
              </div>

              {previews.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-700">
                      {previews.length} file{previews.length > 1 ? 's' : ''} selected
                    </span>
                    <button
                      onClick={clearFiles}
                      className="text-sm text-red-500 hover:text-red-700 flex items-center gap-1"
                    >
                      <X className="w-3.5 h-3.5" /> Clear All
                    </button>
                  </div>

                  <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-4 py-2.5">
                    <span className="text-xs font-medium text-gray-500 mr-1">Assign all as:</span>
                    {POSITION_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setAllPositions(opt.value)}
                        className="px-3 py-1 text-xs font-medium rounded-full border border-gray-200 bg-white text-gray-600 hover:bg-gray-100 transition-colors"
                      >
                        {opt.icon} {opt.label}
                      </button>
                    ))}
                  </div>

                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
                    {previews.map((p, i) => (
                      <div
                        key={i}
                        className={`relative rounded-xl overflow-hidden border-2 transition-all ${
                          p.wearPosition
                            ? p.wearPosition === 'upper'
                              ? 'border-indigo-400 shadow-indigo-100 shadow-md'
                              : p.wearPosition === 'lower'
                              ? 'border-emerald-400 shadow-emerald-100 shadow-md'
                              : 'border-amber-400 shadow-amber-100 shadow-md'
                            : 'border-gray-200'
                        }`}
                      >
                        <div className="aspect-square bg-gray-100">
                          <img
                            src={p.url}
                            alt={p.name}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <button
                          onClick={() => removeFile(i)}
                          className="absolute top-1 right-1 w-5 h-5 bg-black/60 rounded-full flex items-center justify-center text-white hover:bg-black/80 transition-colors"
                        >
                          <X className="w-3 h-3" />
                        </button>
                        <div className="flex gap-1 p-1.5 bg-white justify-center">
                          {POSITION_OPTIONS.map((opt) => (
                            <PositionPill
                              key={opt.value}
                              value={opt.value}
                              selected={p.wearPosition}
                              onClick={() => setPosition(i, opt.value)}
                            />
                          ))}
                        </div>
                        {!p.wearPosition && (
                          <div className="absolute top-1 left-1">
                            <span className="bg-red-500 text-white text-[8px] px-1.5 py-0.5 rounded-full font-bold">
                              !
                            </span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {!allHavePosition && (
                    <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
                      Tag every item as Upper / Lower / Shoes before uploading. Items without a tag are marked with a red badge.
                    </p>
                  )}

                  <div className="flex gap-3 mt-2">
                    <button
                      onClick={handleUpload}
                      disabled={uploading || !allHavePosition}
                      className="px-6 py-2.5 bg-indigo-600 text-white font-medium rounded-xl hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
                    >
                      {uploading ? (
                        <>
                          <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          Uploading...
                        </>
                      ) : (
                        <>
                          <UploadIcon className="w-4 h-4" />
                          Upload All
                        </>
                      )}
                    </button>
                    <button
                      onClick={clearFiles}
                      className="px-6 py-2.5 bg-gray-100 text-gray-700 font-medium rounded-xl hover:bg-gray-200 transition-colors"
                    >
                      Clear
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {uploaded && !complete && (
            <div className="space-y-6">
              <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-xl text-sm">
                {uploaded.length} photo{uploaded.length > 1 ? 's' : ''} uploaded.
                Ready to process.
              </div>

              <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
                {processItems.map((item) => (
                  <div
                    key={item.item_id}
                    className="relative aspect-square rounded-lg overflow-hidden bg-gray-100"
                  >
                    <img
                      src={item.image_url}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                    {item.status === 'pending' && (
                      <div className="absolute inset-0 bg-gray-500/50" />
                    )}
                    {item.status === 'ready' && item.category && (
                      <span className="absolute bottom-1 left-1 bg-indigo-600 text-white text-[10px] px-1.5 py-0.5 rounded-full capitalize">
                        {item.category}
                      </span>
                    )}
                    {item.status === 'error' && (
                      <div className="absolute inset-0 bg-red-500/40 flex items-center justify-center">
                        <span className="text-white text-xs font-medium">Error</span>
                      </div>
                    )}
                    {item.wear_position && (
                      <span className="absolute top-1 left-1 text-[10px] bg-black/50 text-white px-1.5 py-0.5 rounded-full capitalize">
                        {item.wear_position === 'footwear' ? 'Shoes' : item.wear_position}
                      </span>
                    )}
                  </div>
                ))}
              </div>

              {!processing ? (
                <button
                  onClick={handleProcess}
                  className="w-full py-3 bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-semibold rounded-xl hover:from-indigo-700 hover:to-purple-700 flex items-center justify-center gap-2 text-lg transition-all"
                >
                  <Sparkles className="w-5 h-5" />
                  Analyse Wardrobe with AI
                </button>
              ) : (
                <UploadProgressBar
                  total={totalCount}
                  processed={processedCount}
                  items={processItems}
                />
              )}
            </div>
          )}

          {complete && (
            <div className="bg-green-50 border border-green-200 rounded-2xl p-8 text-center space-y-4">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                <Sparkles className="w-8 h-8 text-green-600" />
              </div>
              <h2 className="text-xl font-bold text-green-800">
                Wardrobe analysis complete!
              </h2>
              <p className="text-green-600">
                {totalCount} items ready.
              </p>
              <button
                onClick={() => navigate('/wardrobe')}
                className="px-6 py-2.5 bg-green-600 text-white font-medium rounded-xl hover:bg-green-700 inline-flex items-center gap-2 transition-colors"
              >
                Go to Wardrobe
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
