import { useState } from 'react';
import { Heart, MapPin, ShieldCheck, FileCheck2 } from 'lucide-react';
import { formatArabicDate, formatPriceSDG, getAdTypeLabel } from '../lib/api';
import { CategoryIcon } from './CategoryIcon';
import type { Ad } from '../types';

interface AdCardProps {
  ad: Ad;
  onOpen: (adId: string) => void;
  onToggleFavorite?: (adId: string) => void;
}

export function AdCard({ ad, onOpen, onToggleFavorite }: AdCardProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const coverUrl = ad.images?.[0];

  return (
    <article className="group bg-white border border-stone-200 rounded-xl overflow-hidden flex flex-col transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
      {/* 4:3 Image Container with resilient fallback */}
      <div className="relative aspect-[4/3] bg-stone-100 overflow-hidden">
        <button
          type="button"
          onClick={() => onOpen(ad.id)}
          className="w-full h-full block text-right cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
          aria-label={ad.title}
        >
          {coverUrl && !imgFailed ? (
            <img
              src={coverUrl}
              alt={ad.title}
              referrerPolicy="no-referrer"
              onError={() => setImgFailed(true)}
              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-stone-100 to-stone-200 text-stone-500 p-4 text-center">
              <CategoryIcon name={undefined} className="w-8 h-8 mb-2 text-stone-400" />
              <span className="text-xs font-medium text-stone-500 line-clamp-1">
                {ad.category_name}
              </span>
            </div>
          )}
        </button>

        {/* Favorite Heart Trigger */}
        {onToggleFavorite && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite(ad.id);
            }}
            aria-label={ad.is_favorited ? 'إزالة من المفضلة' : 'إضافة إلى المفضلة'}
            className="absolute top-2.5 left-2.5 w-10 h-10 rounded-lg bg-white/90 backdrop-blur-sm border border-stone-200 flex items-center justify-center text-stone-700 hover:text-rose-600 transition-colors cursor-pointer"
          >
            <Heart
              className={`w-4 h-4 ${ad.is_favorited ? 'fill-rose-600 text-rose-600' : ''}`}
            />
          </button>
        )}
      </div>

      {/* Card Body — Clean Unboxed Metadata & Typographic Hierarchy */}
      <div className="p-4 flex-1 flex flex-col justify-between gap-3">
        <div>
          {/* Quiet 1-line kicker without pill clutter */}
          <div className="flex items-center gap-1.5 text-xs text-stone-500 mb-1.5 truncate">
            <span className="font-medium text-stone-600">{ad.category_name}</span>
            {ad.is_featured && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-semibold text-amber-700">مميز</span>
              </>
            )}
            {ad.ad_type !== 'offer' && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-semibold text-teal-800">{getAdTypeLabel(ad.ad_type)}</span>
              </>
            )}
            {ad.is_sample && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-stone-400">نموذج توضيحي</span>
              </>
            )}
          </div>

          <button
            type="button"
            onClick={() => onOpen(ad.id)}
            className="text-right w-full cursor-pointer"
          >
            <h3 className="text-[15px] font-bold text-stone-900 leading-snug line-clamp-2 group-hover:text-teal-800 transition-colors">
              {ad.title}
            </h3>
          </button>
        </div>

        <div className="pt-2 border-t border-stone-100 space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-base font-bold text-teal-800 tabular-nums">
              {formatPriceSDG(ad.price, ad.ad_type)}
            </span>
            {ad.is_negotiable && ad.price > 0 && (
              <span className="text-xs text-stone-500">قابل للتفاوض</span>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 text-xs text-stone-500">
            <span className="flex items-center gap-1 truncate">
              <MapPin className="w-3.5 h-3.5 shrink-0 text-stone-400" />
              <span className="truncate">{ad.location}</span>
            </span>
            <span className="shrink-0">{formatArabicDate(ad.created_at)}</span>
          </div>

          {(ad.owner_verified || ad.has_verified_docs) && (
            <div className="flex items-center gap-3 text-[11px] text-stone-600 pt-0.5">
              {ad.owner_verified && (
                <span className="flex items-center gap-1 text-teal-700 font-medium">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>حساب موثق</span>
                </span>
              )}
              {ad.has_verified_docs && (
                <span className="flex items-center gap-1 text-amber-800 font-medium">
                  <FileCheck2 className="w-3.5 h-3.5" />
                  <span>مستندات موثقة</span>
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
