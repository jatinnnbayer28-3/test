import { useState } from 'react';
import { Pencil, Trash2, Loader2, AlertCircle } from 'lucide-react';

const CATEGORY_COLORS = {
  tshirt: 'bg-blue-500',
  shirt: 'bg-sky-500',
  jeans: 'bg-indigo-600',
  shorts: 'bg-amber-500',
  shoes: 'bg-rose-500',
  jacket: 'bg-emerald-600',
  dress: 'bg-purple-500',
  other: 'bg-gray-500',
};

export default function ClothingCard({ item, onEdit, onDelete }) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [showTags, setShowTags] = useState(false);
  const isPending = item.status === 'pending';
  const isError = item.status === 'error';
  const catColor = CATEGORY_COLORS[item.category] || CATEGORY_COLORS.other;

  const displayImage = item.segmented_url || item.image_url;

  return (
    <div className="group relative bg-white rounded-xl shadow-sm overflow-hidden border border-gray-100 hover:shadow-md transition-shadow">
      <div className="relative aspect-square">
        <img
          src={displayImage}
          alt={item.short_description || 'Clothing item'}
          className="w-full h-full object-cover"
          loading="lazy"
        />

        {item.category && (
          <span
            className={`absolute top-2 left-2 ${catColor} text-white text-xs font-semibold px-2 py-0.5 rounded-full capitalize`}
          >
            {item.category}
          </span>
        )}

        {isPending && (
          <div className="absolute inset-0 bg-gray-900/50 flex items-center justify-center">
            <Loader2 className="w-8 h-8 text-white animate-spin" />
          </div>
        )}

        {isError && (
          <div className="absolute inset-0 bg-red-900/40 flex items-center justify-center">
            <AlertCircle className="w-8 h-8 text-white" />
          </div>
        )}

        <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {onEdit && (
            <button
              onClick={() => onEdit(item)}
              className="p-1.5 bg-white/90 rounded-lg hover:bg-white shadow-sm"
            >
              <Pencil className="w-3.5 h-3.5 text-gray-700" />
            </button>
          )}
          {onDelete && (
            <button
              onClick={() => setShowConfirm(true)}
              className="p-1.5 bg-white/90 rounded-lg hover:bg-white shadow-sm"
            >
              <Trash2 className="w-3.5 h-3.5 text-red-600" />
            </button>
          )}
        </div>
      </div>

      {item.status === 'ready' && (
        <div className="p-3 space-y-1.5">
          <div className="flex items-center gap-2">
            {item.primary_color && (
              <span className="flex items-center gap-1 text-xs text-gray-600">
                <span
                  className="w-3 h-3 rounded-full border border-gray-200"
                  style={{ backgroundColor: item.primary_color }}
                />
                {item.primary_color}
              </span>
            )}
            {item.pattern && (
              <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                {item.pattern}
              </span>
            )}
          </div>

          {item.occasion_tags && item.occasion_tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {item.occasion_tags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className="text-xs bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {item.short_description && (
            <p className="text-xs text-gray-500 truncate">
              {item.short_description}
            </p>
          )}

          {item.search_tags && item.search_tags.length > 0 && (
            <div>
              <button
                onClick={() => setShowTags(!showTags)}
                className="text-xs text-indigo-500 hover:text-indigo-700 font-medium"
              >
                {showTags ? 'Hide tags' : `+${item.search_tags.length} tags`}
              </button>
              {showTags && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {item.search_tags.map((tag) => (
                    <span
                      key={tag}
                      className="text-[10px] bg-gray-50 text-gray-500 px-1.5 py-0.5 rounded border border-gray-200"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {showConfirm && (
        <div className="absolute inset-0 bg-white/95 flex flex-col items-center justify-center gap-3 p-4">
          <p className="text-sm font-medium text-gray-800 text-center">
            Delete this item?
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setShowConfirm(false)}
              className="px-3 py-1.5 text-xs bg-gray-100 rounded-lg hover:bg-gray-200"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                onDelete(item.item_id);
                setShowConfirm(false);
              }}
              className="px-3 py-1.5 text-xs bg-red-600 text-white rounded-lg hover:bg-red-700"
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
