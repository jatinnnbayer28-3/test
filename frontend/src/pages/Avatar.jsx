import { useState, useEffect, useContext, useRef } from 'react';
import {
  Camera,
  Upload,
  Loader2,
  User,
  Palette,
  Ruler,
  RefreshCw,
  Gem,
} from 'lucide-react';
import { createAvatar, getAvatar } from '../api/client';
import { AppContext } from '../App';

const PROFILE_FIELDS = [
  { key: 'gender', label: 'Gender', icon: '👤' },
  { key: 'estimated_age_range', label: 'Age Range', icon: '🎂' },
  { key: 'face_shape', label: 'Face Shape', icon: '🪞' },
  { key: 'eye_color', label: 'Eye Color', icon: '👁️' },
  { key: 'hair_color', label: 'Hair Color', icon: '💇' },
  { key: 'hair_texture', label: 'Hair Texture', icon: '✨' },
  { key: 'hair_length', label: 'Hair Length', icon: '📏' },
  { key: 'facial_hair', label: 'Facial Hair', icon: '🧔' },
  { key: 'body_type', label: 'Body Type', icon: '🏋️' },
  { key: 'build', label: 'Build', icon: '💪' },
  { key: 'estimated_height_category', label: 'Height', icon: '📐' },
  { key: 'shoulder_width', label: 'Shoulders', icon: '↔️' },
  { key: 'contrast_level', label: 'Contrast', icon: '🎭' },
  { key: 'style_personality', label: 'Style', icon: '👔' },
];

function ProfileTag({ icon, label, value }) {
  if (!value || value === 'null') return null;
  return (
    <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
      <span className="text-sm">{icon}</span>
      <div className="min-w-0">
        <p className="text-[10px] text-gray-400 uppercase tracking-wider">{label}</p>
        <p className="text-sm font-medium text-gray-800 capitalize truncate">{value}</p>
      </div>
    </div>
  );
}

function ColorSwatch({ color, size = 'md' }) {
  const hex = color?.hex || '#ccc';
  const name = color?.name || 'Unknown';
  const why = color?.why || '';
  const sizeClasses = size === 'lg' ? 'w-14 h-14' : 'w-10 h-10';

  return (
    <div className="flex flex-col items-center gap-1 group relative" title={why}>
      <div
        className={`${sizeClasses} rounded-xl border-2 border-white shadow-md transition-transform group-hover:scale-110`}
        style={{ backgroundColor: hex }}
      />
      <p className="text-[10px] text-gray-600 font-medium text-center leading-tight max-w-[72px] truncate">
        {name}
      </p>
      <p className="text-[8px] text-gray-400 font-mono">{hex}</p>
      {why && (
        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-[10px] px-2.5 py-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 w-48 text-center leading-tight shadow-lg">
          {why}
        </div>
      )}
    </div>
  );
}

function SkinToneDisplay({ tone, undertone, hex }) {
  return (
    <div className="flex items-center gap-3 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-100 rounded-xl p-3">
      <div
        className="w-14 h-14 rounded-xl border-2 border-white shadow-lg shrink-0"
        style={{ backgroundColor: hex || '#C68642' }}
      />
      <div>
        <p className="text-sm font-semibold text-gray-800 capitalize">{tone}</p>
        <p className="text-xs text-gray-500 capitalize">{undertone} undertone</p>
        {hex && <p className="text-[10px] text-gray-400 font-mono mt-0.5">{hex}</p>}
      </div>
    </div>
  );
}

function ColorCategory({ title, colors, size = 'lg', bgClass = '', borderClass = '' }) {
  if (!colors || colors.length === 0) return null;
  return (
    <div className={`rounded-xl p-4 ${bgClass || 'bg-gray-50'} ${borderClass ? `border ${borderClass}` : ''}`}>
      <p className="text-xs text-gray-500 uppercase tracking-wider mb-3 font-semibold">
        {title}
      </p>
      <div className="flex flex-wrap gap-4">
        {colors.map((c, i) => (
          <ColorSwatch key={i} color={c} size={size} />
        ))}
      </div>
    </div>
  );
}

export default function Avatar() {
  const { userId } = useContext(AppContext);
  const fileRef = useRef(null);
  const [avatar, setAvatar] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    loadAvatar();
  }, [userId]);

  const loadAvatar = async () => {
    setLoading(true);
    try {
      const data = await getAvatar(userId);
      if (data && data.avatar_url) {
        setAvatar(data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPreview(URL.createObjectURL(file));
    handleUpload(file);
  };

  const handleUpload = async (file) => {
    setUploading(true);
    setError('');
    try {
      const data = await createAvatar(userId, file);
      setAvatar(data);
      setPreview(null);
    } catch (err) {
      setError(err.message || 'Failed to generate avatar');
    } finally {
      setUploading(false);
    }
  };

  const bp = avatar?.body_profile || {};
  const ca = bp.colour_analysis || {};

  const bestColors = ca.best_colors || [];
  const neutralColors = ca.neutral_colors || [];
  const worstColors = ca.worst_colors || ca.colors_to_avoid || [];

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Your Avatar</h1>
          <p className="text-sm text-gray-500 mt-0.5">AI-powered body & colour analysis</p>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="bg-white rounded-2xl border border-gray-100 p-6 animate-pulse">
            <div className="aspect-[3/4] bg-gray-200 rounded-xl" />
          </div>
          <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 p-6 animate-pulse space-y-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-10 bg-gray-200 rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Your Avatar</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            AI-powered body & colour analysis from your photo
          </p>
        </div>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="px-4 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-sm font-medium rounded-xl hover:from-indigo-700 hover:to-purple-700 flex items-center gap-2 transition-all disabled:opacity-50"
        >
          {uploading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : avatar ? (
            <RefreshCw className="w-4 h-4" />
          ) : (
            <Upload className="w-4 h-4" />
          )}
          {avatar ? 'Re-analyse Photo' : 'Upload Photo'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
          {error}
        </div>
      )}

      {uploading && (
        <div className="flex items-center gap-3 bg-indigo-50 border border-indigo-200 px-5 py-4 rounded-xl">
          <Loader2 className="w-5 h-5 text-indigo-600 animate-spin" />
          <div>
            <p className="text-sm font-medium text-indigo-700">
              Analysing your photo & generating avatar...
            </p>
            <p className="text-xs text-indigo-500 mt-0.5">
              This takes 15-30 seconds
            </p>
          </div>
        </div>
      )}

      {!avatar && !uploading && (
        <div
          onClick={() => fileRef.current?.click()}
          className="border-2 border-dashed border-gray-300 rounded-2xl p-16 text-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/30 transition-all"
        >
          <Camera className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-600">Upload a full-body photo</h3>
          <p className="text-sm text-gray-400 mt-2 max-w-md mx-auto">
            The AI will analyse your body shape, skin tone, and colouring from the photo
            to give you personalized colour and fit recommendations.
          </p>
          <p className="text-xs text-gray-400 mt-3">JPEG, PNG, or WebP</p>
        </div>
      )}

      {(avatar || preview) && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Avatar Image */}
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
              <div className="p-3 border-b border-gray-50 flex items-center gap-2">
                <User className="w-4 h-4 text-indigo-600" />
                <span className="text-sm font-semibold text-gray-800">Studio Avatar</span>
              </div>
              <div className="p-4">
                <img
                  src={uploading && preview ? preview : avatar?.avatar_url}
                  alt="Avatar"
                  className={`w-full rounded-xl object-cover ${uploading ? 'opacity-40 blur-sm' : ''}`}
                />
              </div>
            </div>

            {avatar?.original_url && (
              <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
                <div className="p-3 border-b border-gray-50">
                  <span className="text-sm font-semibold text-gray-800">Original Photo</span>
                </div>
                <div className="p-4">
                  <img
                    src={avatar.original_url}
                    alt="Original"
                    className="w-full rounded-xl object-cover"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Body Profile & Colour Analysis */}
          <div className="lg:col-span-2 space-y-4">

            {/* Body & Face Analysis */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="p-4 border-b border-gray-50 flex items-center gap-2">
                <Ruler className="w-4 h-4 text-indigo-600" />
                <span className="text-sm font-semibold text-gray-800">Body & Face Analysis</span>
              </div>
              <div className="p-4">
                {bp.skin_tone && (
                  <div className="mb-4">
                    <SkinToneDisplay
                      tone={bp.skin_tone}
                      undertone={bp.skin_undertone}
                      hex={bp.skin_tone_hex}
                    />
                  </div>
                )}

                <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2">
                  {PROFILE_FIELDS.map(({ key, label, icon }) => (
                    <ProfileTag key={key} icon={icon} label={label} value={bp[key]} />
                  ))}
                </div>
              </div>
            </div>

            {/* Colour Analysis */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="p-4 border-b border-gray-50 flex items-center gap-2">
                <Palette className="w-4 h-4 text-indigo-600" />
                <span className="text-sm font-semibold text-gray-800">Colour Analysis</span>
              </div>
              <div className="p-4 space-y-4">

                {/* Colour Season */}
                {ca.colour_season && (
                  <div className="bg-gradient-to-r from-purple-50 to-pink-50 border border-purple-100 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Gem className="w-4 h-4 text-purple-600" />
                      <h4 className="text-sm font-semibold text-purple-800">
                        {ca.colour_season}
                        {ca.season_subtype && (
                          <span className="ml-2 text-xs font-normal text-purple-500">
                            ({ca.season_subtype})
                          </span>
                        )}
                      </h4>
                    </div>
                    {ca.season_description && (
                      <p className="text-xs text-gray-600 leading-relaxed">{ca.season_description}</p>
                    )}
                  </div>
                )}

                {/* Best Colors */}
                {bestColors.length > 0 && (
                  <ColorCategory
                    title="Best Colors"
                    colors={bestColors}
                    size="lg"
                    bgClass="bg-green-50/50"
                    borderClass="border-green-100"
                  />
                )}

                {/* Neutral Colors */}
                {neutralColors.length > 0 && (
                  <ColorCategory
                    title="Neutral Colors"
                    colors={neutralColors}
                    size="lg"
                    bgClass="bg-stone-50"
                    borderClass="border-stone-200"
                  />
                )}

                {/* Worst Colors */}
                {worstColors.length > 0 && (
                  <ColorCategory
                    title="Worst Colors"
                    colors={worstColors}
                    size="lg"
                    bgClass="bg-red-50/50"
                    borderClass="border-red-100"
                  />
                )}

                {/* Legacy fallback: old string arrays */}
                {bestColors.length === 0 && bp.best_colors?.length > 0 && typeof bp.best_colors[0] === 'string' && (
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Best Colors</p>
                    <div className="flex flex-wrap gap-1.5">
                      {bp.best_colors.map((c, i) => (
                        <span key={i} className="inline-flex items-center gap-1.5 bg-white border border-gray-200 rounded-full px-2.5 py-1 text-xs font-medium text-gray-700 capitalize">
                          {c}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {worstColors.length === 0 && bp.colors_to_avoid?.length > 0 && typeof bp.colors_to_avoid[0] === 'string' && (
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Colors to Avoid</p>
                    <div className="flex flex-wrap gap-1.5">
                      {bp.colors_to_avoid.map((c, i) => (
                        <span key={i} className="inline-flex items-center gap-1.5 bg-red-50 border border-red-100 rounded-full px-2.5 py-1 text-xs font-medium text-red-700 capitalize">{c}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Fabric & Metal Tones */}
                <div className="flex flex-wrap gap-3">
                  {ca.best_fabric_tones && (
                    <div className="bg-gray-50 rounded-lg px-3 py-2">
                      <p className="text-[10px] text-gray-400 uppercase tracking-wider">Best Fabric Tones</p>
                      <p className="text-xs font-medium text-gray-700 capitalize mt-0.5">{ca.best_fabric_tones}</p>
                    </div>
                  )}
                  {ca.metal_tone && (
                    <div className="bg-gray-50 rounded-lg px-3 py-2">
                      <p className="text-[10px] text-gray-400 uppercase tracking-wider">Jewellery Metal</p>
                      <p className="text-xs font-medium text-gray-700 capitalize mt-0.5">{ca.metal_tone}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Fit & Pattern Recommendations */}
            {(bp.recommended_fits?.length > 0 || bp.necklines_that_suit?.length > 0 || bp.patterns_that_suit?.length > 0) && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="p-4 border-b border-gray-50 flex items-center gap-2">
                  <Ruler className="w-4 h-4 text-indigo-600" />
                  <span className="text-sm font-semibold text-gray-800">Fit & Pattern Guide</span>
                </div>
                <div className="p-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {bp.recommended_fits?.length > 0 && (
                      <div>
                        <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Best Fits</p>
                        <div className="flex flex-wrap gap-1.5">
                          {bp.recommended_fits.map((f, i) => (
                            <span key={i} className="bg-green-50 text-green-700 border border-green-100 text-xs px-2.5 py-1 rounded-full font-medium capitalize">{f}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {bp.necklines_that_suit?.length > 0 && (
                      <div>
                        <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Best Necklines</p>
                        <div className="flex flex-wrap gap-1.5">
                          {bp.necklines_that_suit.map((n, i) => (
                            <span key={i} className="bg-blue-50 text-blue-700 border border-blue-100 text-xs px-2.5 py-1 rounded-full font-medium capitalize">{n}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {bp.patterns_that_suit?.length > 0 && (
                      <div>
                        <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Patterns That Suit</p>
                        <div className="flex flex-wrap gap-1.5">
                          {bp.patterns_that_suit.map((p, i) => (
                            <span key={i} className="bg-purple-50 text-purple-700 border border-purple-100 text-xs px-2.5 py-1 rounded-full font-medium capitalize">{p}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {bp.patterns_to_avoid?.length > 0 && (
                      <div>
                        <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Patterns to Avoid</p>
                        <div className="flex flex-wrap gap-1.5">
                          {bp.patterns_to_avoid.map((p, i) => (
                            <span key={i} className="bg-red-50 text-red-700 border border-red-100 text-xs px-2.5 py-1 rounded-full font-medium capitalize">{p}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
