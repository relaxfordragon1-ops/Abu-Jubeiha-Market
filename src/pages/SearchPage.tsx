import { useEffect, useState, useCallback } from 'react';
import { Search, SlidersHorizontal, RotateCcw, X } from 'lucide-react';
import { ABU_JUBEIHA_AREAS } from '../lib/api';
import { fetchAds } from '../lib/firestoreApi';
import { useAuth } from '../context/AuthContext';
import { AdCard } from '../components/AdCard';
import type { Ad, AppRoute, Category } from '../types';

interface SearchPageProps {
  categories: Category[];
  initialCategory?: string;
  initialSubcategory?: string;
  initialQuery?: string;
  initialAdType?: string;
  initialUserId?: string;
  initialSellerName?: string;
  onNavigate: (route: AppRoute) => void;
  onToggleFavorite: (adId: string) => void;
}

export function SearchPage({
  categories,
  initialCategory = '',
  initialSubcategory = '',
  initialQuery = '',
  initialAdType = '',
  initialUserId,
  initialSellerName,
  onNavigate,
  onToggleFavorite,
}: SearchPageProps) {
  const { user } = useAuth();
  const [q, setQ] = useState(initialQuery);
  const [category, setCategory] = useState(initialCategory);
  const [subcategory, setSubcategory] = useState(initialSubcategory);
  const [location, setLocation] = useState('');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [adType, setAdType] = useState(initialAdType);
  const [sort, setSort] = useState('latest');
  const [sellerFilterId, setSellerFilterId] = useState<string | undefined>(initialUserId);
  const [sellerFilterName, setSellerFilterName] = useState<string | undefined>(initialSellerName);

  const [results, setResults] = useState<Ad[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setQ(initialQuery);
    setCategory(initialCategory);
    setSubcategory(initialSubcategory);
    setAdType(initialAdType);
    setSellerFilterId(initialUserId);
    setSellerFilterName(initialSellerName);
  }, [
    initialQuery,
    initialCategory,
    initialSubcategory,
    initialAdType,
    initialUserId,
    initialSellerName,
  ]);

  const activeCategoryObj = categories.find(
    (c) => c.slug === category || String(c.id) === category
  );

  const runSearch = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const list = await fetchAds(
        {
          q: q.trim() || undefined,
          category: category || undefined,
          subcategory: subcategory || undefined,
          location: location.trim() || undefined,
          minPrice: minPrice.trim() || undefined,
          maxPrice: maxPrice.trim() || undefined,
          adType: adType || undefined,
          sort: sort || 'latest',
          userId: sellerFilterId || undefined,
        },
        user?.id
      );
      setResults(list);
    } catch (err: any) {
      setError(err.message || 'تعذر تحميل نتائج البحث');
    } finally {
      setLoading(false);
    }
  }, [
    q,
    category,
    subcategory,
    location,
    minPrice,
    maxPrice,
    adType,
    sort,
    sellerFilterId,
    user?.id,
  ]);

  useEffect(() => {
    runSearch();
  }, [runSearch]);

  const resetFilters = () => {
    setQ('');
    setCategory('');
    setSubcategory('');
    setLocation('');
    setMinPrice('');
    setMaxPrice('');
    setAdType('');
    setSort('latest');
    setSellerFilterId(undefined);
    setSellerFilterName(undefined);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-extrabold text-stone-900">
            {sellerFilterName ? `إعلانات: ${sellerFilterName}` : 'البحث وتصفية الإعلانات'}
          </h1>
          <p className="text-sm text-stone-500 mt-1">
            يدعم البحث الكلمات العربية والإنجليزية والأرقام بمختلف صيغ الكتابة
          </p>
        </div>
        <button
          type="button"
          onClick={resetFilters}
          className="self-start sm:self-auto px-3.5 py-2 text-xs font-semibold text-stone-700 bg-white border border-stone-200 hover:bg-stone-50 rounded-lg flex items-center gap-1.5 cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>إعادة ضبط الفلاتر</span>
        </button>
      </div>

      {/* Filter Control Bar */}
      <div className="bg-white border border-stone-200 rounded-xl p-4 sm:p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          {/* Keyword Search */}
          <div className="md:col-span-5 relative flex items-center">
            <Search className="w-4 h-4 text-stone-400 absolute right-3.5 pointer-events-none" />
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="ابحث بالاسم، الموديل، أو الوصف (مثال: ايفون، iPhone، 2020)..."
              className="w-full pr-10 pl-3 py-2.5 bg-stone-50 border border-stone-200 rounded-lg text-sm text-stone-900 focus:outline-none focus:border-teal-700"
            />
          </div>

          {/* Main Category */}
          <div className="md:col-span-4">
            <select
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setSubcategory('');
              }}
              aria-label="القسم الرئيسي"
              className="w-full px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-lg text-sm text-stone-900 focus:outline-none focus:border-teal-700"
            >
              <option value="">كل الأقسام الرئيسية</option>
              {categories.map((c) => (
                <option key={c.id} value={c.slug}>
                  {c.name_ar}
                </option>
              ))}
            </select>
          </div>

          {/* Subcategory */}
          <div className="md:col-span-3">
            <select
              value={subcategory}
              onChange={(e) => setSubcategory(e.target.value)}
              disabled={!activeCategoryObj || activeCategoryObj.subcategories.length === 0}
              aria-label="القسم الفرعي"
              className="w-full px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-lg text-sm text-stone-900 disabled:opacity-50 focus:outline-none focus:border-teal-700"
            >
              <option value="">كل الأقسام الفرعية</option>
              {activeCategoryObj?.subcategories.map((sub) => (
                <option key={sub.id} value={sub.slug}>
                  {sub.name_ar}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Interactive Subcategory Tabs when a Category is selected */}
        {activeCategoryObj && activeCategoryObj.subcategories.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-stone-100">
            <button
              type="button"
              onClick={() => setSubcategory('')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                subcategory === ''
                  ? 'bg-teal-700 text-white'
                  : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
              }`}
            >
              الكل في {activeCategoryObj.name_ar}
            </button>
            {activeCategoryObj.subcategories.map((sub) => (
              <button
                key={sub.id}
                type="button"
                onClick={() => setSubcategory(sub.slug)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  subcategory === sub.slug
                    ? 'bg-teal-700 text-white'
                    : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                }`}
              >
                {sub.name_ar}
              </button>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 pt-2 border-t border-stone-100">
          {/* Location */}
          <div>
            <select
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              aria-label="المنطقة أو الحي"
              className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm text-stone-900 focus:outline-none focus:border-teal-700"
            >
              <option value="">كل مناطق أبو جبيهة</option>
              {ABU_JUBEIHA_AREAS.map((area) => (
                <option key={area} value={area}>
                  {area}
                </option>
              ))}
            </select>
          </div>

          {/* Min Price */}
          <div>
            <input
              type="number"
              min={0}
              value={minPrice}
              onChange={(e) => setMinPrice(e.target.value)}
              placeholder="أقل سعر (ج.س)"
              className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm text-stone-900 tabular-nums focus:outline-none focus:border-teal-700"
            />
          </div>

          {/* Max Price */}
          <div>
            <input
              type="number"
              min={0}
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
              placeholder="أعلى سعر (ج.س)"
              className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm text-stone-900 tabular-nums focus:outline-none focus:border-teal-700"
            />
          </div>

          {/* Ad Type */}
          <div>
            <select
              value={adType}
              onChange={(e) => setAdType(e.target.value)}
              aria-label="نوع الإعلان"
              className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm text-stone-900 focus:outline-none focus:border-teal-700"
            >
              <option value="">كل أنواع الإعلانات</option>
              <option value="offer">عروض بيع / إيجار / خدمات</option>
              <option value="wanted">مطلوبات</option>
              <option value="job">وظائف وتوظيف</option>
              <option value="announcement">إعلانات المجتمع</option>
            </select>
          </div>

          {/* Sort */}
          <div>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              aria-label="الترتيب"
              className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm text-stone-900 focus:outline-none focus:border-teal-700"
            >
              <option value="latest">الأحدث نشراً</option>
              <option value="popular">الأكثر مشاهدة</option>
              <option value="price_asc">السعر: من الأقل للأعلى</option>
              <option value="price_desc">السعر: من الأعلى للأقل</option>
            </select>
          </div>
        </div>

        {sellerFilterId && (
          <div className="flex items-center justify-between pt-2 border-t border-stone-100 text-xs text-stone-600">
            <span>يتم عرض إعلانات المعلن: {sellerFilterName || `#${sellerFilterId}`}</span>
            <button
              type="button"
              onClick={() => {
                setSellerFilterId(undefined);
                setSellerFilterName(undefined);
              }}
              className="inline-flex items-center gap-1 text-rose-700 font-semibold hover:underline cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
              <span>إلغاء تصفية البائع</span>
            </button>
          </div>
        )}
      </div>

      {/* Results Header */}
      <div className="flex items-center justify-between text-sm text-stone-600">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="w-4 h-4 text-stone-400" />
          <span className="tabular-nums">
            تم العثور على <strong className="text-stone-900">{results.length}</strong> إعلان
          </span>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-800">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div
              key={i}
              className="bg-white border border-stone-200 rounded-xl overflow-hidden animate-pulse"
            >
              <div className="aspect-[4/3] bg-stone-200" />
              <div className="p-4 space-y-3">
                <div className="h-3 bg-stone-200 rounded w-1/2" />
                <div className="h-4 bg-stone-200 rounded w-3/4" />
                <div className="h-4 bg-stone-200 rounded w-1/3" />
              </div>
            </div>
          ))}
        </div>
      ) : results.length === 0 ? (
        <div className="bg-white border border-stone-200 rounded-xl p-12 text-center space-y-3">
          <p className="text-base font-bold text-stone-900">لا توجد إعلانات مطابقة لبحثك</p>
          <p className="text-sm text-stone-500">
            جرّب تغيير كلمات البحث أو إزالة بعض الفلاتر لعرض جميع الإعلانات المتاحة
          </p>
          <button
            type="button"
            onClick={resetFilters}
            className="px-5 py-2.5 bg-teal-700 text-white text-sm font-semibold rounded-lg cursor-pointer"
          >
            عرض جميع الإعلانات
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {results.map((ad) => (
            <AdCard
              key={ad.id}
              ad={ad}
              onOpen={(id) => onNavigate({ page: 'ad-detail', adId: id })}
              onToggleFavorite={onToggleFavorite}
            />
          ))}
        </div>
      )}
    </div>
  );
}
