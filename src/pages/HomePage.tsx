import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Search,
  PlusCircle,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  MapPin,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { AdCard } from '../components/AdCard';
import { CategoryIcon } from '../components/CategoryIcon';
import { useAuth } from '../context/AuthContext';
import { formatPriceSDG } from '../lib/api';
import type { Ad, AppRoute, Category, HeroPromotion } from '../types';

interface HomePageProps {
  categories: Category[];
  ads: Ad[];
  heroPromotions: HeroPromotion[];
  loading: boolean;
  onNavigate: (route: AppRoute) => void;
  onToggleFavorite: (adId: string) => void;
}

const HERO_INTERVAL_MS = 5000;

export function HomePage({
  categories,
  ads,
  heroPromotions,
  loading,
  onNavigate,
  onToggleFavorite,
}: HomePageProps) {
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeHeroIdx, setActiveHeroIdx] = useState(0);
  const [isHeroPaused, setIsHeroPaused] = useState(false);

  const heroSlides = useMemo(() => {
    if (heroPromotions.length > 0) {
      return heroPromotions.map((p) => ({
        key: `promo-${p.id}`,
        adId: p.ad_id,
        title: p.title,
        subtitle: p.subtitle || 'إعلان مميز مدفوع في واجهة سوق أبو جبيهة',
        imageUrl: p.image_url,
        priceLabel: p.price_label,
        locationLabel: p.location_label,
        isPaidPromo: true,
      }));
    }
    // The banner is reserved for paid promotions only (no free/featured fallback)
    return [];
  }, [heroPromotions]);

  useEffect(() => {
    setActiveHeroIdx(0);
  }, [heroSlides.length]);

  useEffect(() => {
    if (heroSlides.length <= 1 || isHeroPaused) return;
    const timer = window.setInterval(() => {
      setActiveHeroIdx((prev) => (prev + 1) % heroSlides.length);
    }, HERO_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [heroSlides.length, isHeroPaused]);

  const currentSlide =
    heroSlides.length > 0 ? heroSlides[activeHeroIdx % heroSlides.length] : null;

  const handleSearch = (e: FormEvent) => {
    e.preventDefault();
    onNavigate({ page: 'search', q: searchQuery.trim() });
  };

  const featuredAds = ads.filter((a) => a.is_featured).slice(0, 4);
  const latestAds = ads.slice(0, 8);
  const propertyAds = ads
    .filter((a) =>
      ['properties-rent', 'properties-sale', 'land'].includes(a.category_slug)
    )
    .slice(0, 4);
  const electronicsAds = ads
    .filter((a) => a.category_slug === 'phones-electronics')
    .slice(0, 4);

  return (
    <div className="space-y-12">
      {/* Hero Banner & Search Focal Point */}
      <section className="bg-white border-b border-stone-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 lg:py-12 grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
          {/* Right Column (RTL): Headline, Search Bar, Primary CTA */}
          <div className="lg:col-span-7 flex flex-col justify-center space-y-6">
            <div className="space-y-3">
              <p className="text-xs sm:text-sm font-semibold text-teal-800">
                أبو جبيهة وما حولها · جنوب كردفان
              </p>
              <h1 className="font-display text-3xl sm:text-4xl lg:text-[42px] font-extrabold text-stone-900 leading-tight [text-wrap:balance]">
                سوق أبو جبيهة الإلكتروني للبيع والشراء والخدمات
              </h1>
              <p className="text-base text-stone-600 max-w-2xl leading-relaxed">
                منصة محلية موثوقة تجمع المشترين والبائعين وأصحاب العقارات والأراضي والحرفيين
                وأصحاب العمل في أبو جبيهة في مكان واحد.
              </p>
            </div>

            {/* Search Bar (Arabic, English, Numbers) */}
            <form
              onSubmit={handleSearch}
              className="flex flex-col sm:flex-row gap-2.5 bg-stone-50 p-2 border border-stone-200 rounded-xl"
            >
              <div className="relative flex-1 flex items-center">
                <Search className="w-5 h-5 text-stone-400 mr-3 shrink-0" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="ابحث عن هاتف، منزل، أرض، سيارة، أو خدمة (عربي أو English)..."
                  className="w-full bg-transparent px-3 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none"
                />
              </div>
              <button
                type="submit"
                className="px-6 py-2.5 bg-stone-900 hover:bg-stone-800 text-white text-sm font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                ابحث الآن
              </button>
            </form>

            {/* Primary Publish Ad CTA + Browse Link */}
            <div className="flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={() =>
                  onNavigate(user ? { page: 'ad-new' } : { page: 'auth', mode: 'login' })
                }
                className="px-5 py-3 bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap cursor-pointer"
              >
                <PlusCircle className="w-4 h-4" />
                <span>انشر إعلانك مجاناً</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate({ page: 'search', category: 'wanted' })}
                className="px-4 py-3 bg-stone-100 hover:bg-stone-200 text-stone-800 text-sm font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer"
              >
                تصفح قسم المطلوبات
              </button>
            </div>
          </div>

          {/* Left Column (RTL): Paid Featured Hero Carousel (5s Auto-Loop) */}
          <div
            className="lg:col-span-5 relative rounded-2xl overflow-hidden bg-stone-900 min-h-[270px] lg:min-h-[350px] border border-stone-200 shadow-sm group"
            onMouseEnter={() => setIsHeroPaused(true)}
            onMouseLeave={() => setIsHeroPaused(false)}
          >
            {currentSlide ? (
              <>
                <AnimatePresence mode="wait">
                  <motion.div
                    key={currentSlide.key}
                    initial={{ opacity: 0.25, scale: 1.02 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0.25 }}
                    transition={{ duration: 0.45, ease: 'easeOut' }}
                    onClick={() =>
                      currentSlide.adId &&
                      onNavigate({ page: 'ad-detail', adId: currentSlide.adId })
                    }
                    className={`absolute inset-0 ${currentSlide.adId ? 'cursor-pointer' : ''}`}
                  >
                    <img
                      src={currentSlide.imageUrl}
                      alt={currentSlide.title}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-stone-950/90 via-stone-950/35 to-stone-950/20" />
                  </motion.div>
                </AnimatePresence>

                <button
                  type="button"
                  onClick={() =>
                    onNavigate(
                      user ? { page: 'account', tab: 'my-ads' } : { page: 'auth', mode: 'login' }
                    )
                  }
                  className="absolute top-3 left-3 z-30 px-3 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-stone-950 text-xs font-extrabold shadow cursor-pointer"
                >
                  ميّز إعلانك
                </button>

                {/* 5-second progress bar */}
                {heroSlides.length > 1 && (
                  <div className="absolute top-0 inset-x-0 h-1 bg-white/20 z-20">
                    <motion.div
                      key={`${currentSlide.key}-${isHeroPaused ? 'paused' : 'run'}`}
                      initial={{ width: '0%' }}
                      animate={{ width: isHeroPaused ? '0%' : '100%' }}
                      transition={{
                        duration: isHeroPaused ? 0 : HERO_INTERVAL_MS / 1000,
                        ease: 'linear',
                      }}
                      className="h-full bg-amber-400"
                    />
                  </div>
                )}

                {/* Top Overlay Header */}
                <div className="absolute top-3.5 inset-x-3.5 z-20 flex items-center justify-between gap-2">
                  <span className="px-2.5 py-1 rounded-md bg-amber-400 text-stone-950 text-[11px] font-extrabold inline-flex items-center gap-1 shadow-sm">
                    <Sparkles className="w-3 h-3" />
                    <span>إعلان مميز مدفوع</span>
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onNavigate(
                        user
                          ? { page: 'account', tab: 'my-ads' }
                          : { page: 'auth', mode: 'login' }
                      );
                    }}
                    className="px-2.5 py-1 rounded-md bg-stone-950/70 hover:bg-stone-950 text-white text-[11px] font-semibold backdrop-blur-sm transition-colors cursor-pointer"
                  >
                    ميّز إعلانك هنا
                  </button>
                </div>

                {/* Prev / Next Carousel Buttons */}
                {heroSlides.length > 1 && (
                  <>
                    <button
                      type="button"
                      aria-label="الإعلان السابق"
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveHeroIdx(
                          (prev) => (prev - 1 + heroSlides.length) % heroSlides.length
                        );
                      }}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 z-20 w-8 h-8 rounded-full bg-stone-950/60 hover:bg-stone-950/85 text-white flex items-center justify-center transition-colors cursor-pointer"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      aria-label="الإعلان التالي"
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveHeroIdx((prev) => (prev + 1) % heroSlides.length);
                      }}
                      className="absolute left-2.5 top-1/2 -translate-y-1/2 z-20 w-8 h-8 rounded-full bg-stone-950/60 hover:bg-stone-950/85 text-white flex items-center justify-center transition-colors cursor-pointer"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                  </>
                )}

                {/* Bottom Ad Info + Navigation Dots */}
                <div className="absolute bottom-0 inset-x-0 z-20 p-4 sm:p-5 text-white space-y-2.5">
                  <div
                    onClick={() =>
                      currentSlide.adId &&
                      onNavigate({ page: 'ad-detail', adId: currentSlide.adId })
                    }
                    className={currentSlide.adId ? 'cursor-pointer' : ''}
                  >
                    {currentSlide.priceLabel && (
                      <p className="text-sm sm:text-base font-extrabold text-amber-300 tabular-nums">
                        {currentSlide.priceLabel}
                      </p>
                    )}
                    <h2 className="font-display text-base sm:text-lg font-extrabold leading-snug line-clamp-2">
                      {currentSlide.title}
                    </h2>
                    <div className="flex flex-wrap items-center justify-between gap-2 mt-1.5">
                      <span className="text-xs text-stone-200 inline-flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5 text-amber-300" />
                        <span>{currentSlide.locationLabel || 'أبو جبيهة'}</span>
                      </span>
                      {currentSlide.adId && (
                        <span className="text-xs font-bold text-white bg-teal-700 hover:bg-teal-600 px-3 py-1 rounded-lg inline-flex items-center gap-1">
                          <span>عرض الإعلان</span>
                          <ArrowLeft className="w-3.5 h-3.5" />
                        </span>
                      )}
                    </div>
                  </div>

                  {heroSlides.length > 1 && (
                    <div className="flex items-center justify-between pt-1 border-t border-white/15">
                      <div className="flex items-center gap-1.5">
                        {heroSlides.map((slide, idx) => (
                          <button
                            key={slide.key}
                            type="button"
                            aria-label={`عرض الإعلان رقم ${idx + 1}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveHeroIdx(idx);
                            }}
                            className={`h-1.5 rounded-full transition-all cursor-pointer ${
                              idx === activeHeroIdx % heroSlides.length
                                ? 'w-6 bg-amber-400'
                                : 'w-2 bg-white/45 hover:bg-white/75'
                            }`}
                          />
                        ))}
                      </div>
                      <span className="text-[11px] text-stone-300 tabular-nums">
                        {(activeHeroIdx % heroSlides.length) + 1} / {heroSlides.length}
                      </span>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <img
                  src="/src/assets/images/hero_abu_jubeiha_1795626053117.jpg"
                  alt="سوق أبو جبيهة المحلي في جنوب كردفان"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover lg:absolute lg:inset-0"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-stone-950/75 via-stone-950/20 to-transparent flex items-end justify-between gap-3 p-5">
                  <div className="text-white">
                    <p className="text-xs font-medium text-amber-300">مساحة إعلانية مميزة</p>
                    <p className="text-sm font-bold mt-0.5">
                      أعلن عن منتجاتك وعقاراتك في واجهة سوق أبو جبيهة
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      onNavigate(
                        user
                          ? { page: 'account', tab: 'my-ads' }
                          : { page: 'auth', mode: 'login' }
                      )
                    }
                    className="px-3 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-stone-950 text-xs font-extrabold whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    ميّز إعلانك
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 space-y-14">
        {/* 12 Main Categories Navigation */}
        <section>
          <div className="flex items-center justify-between gap-4 mb-5">
            <div>
              <h2 className="font-display text-xl sm:text-2xl font-bold text-stone-900">
                الأقسام الرئيسية
              </h2>
              <p className="text-sm text-stone-500 mt-0.5">
                اختر القسم المناسب لتصفح الإعلانات أو تصفية النتائج
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate({ page: 'search' })}
              className="text-sm font-semibold text-teal-800 hover:text-teal-900 flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <span>كل الإعلانات</span>
              <ArrowLeft className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {categories.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => onNavigate({ page: 'search', category: cat.slug })}
                className="group bg-white border border-stone-200 hover:border-teal-700 rounded-xl p-4 text-right flex flex-col justify-between gap-3 transition-colors cursor-pointer"
              >
                <div className="w-10 h-10 rounded-lg bg-stone-100 group-hover:bg-teal-50 text-stone-700 group-hover:text-teal-800 flex items-center justify-center transition-colors">
                  <CategoryIcon name={cat.icon} className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-sm font-bold text-stone-900 leading-snug group-hover:text-teal-800">
                    {cat.name_ar}
                  </div>
                  <div className="text-xs text-stone-500 mt-1 tabular-nums">
                    {cat.ads_count ?? 0} إعلان
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* Featured Advertisements */}
        {featuredAds.length > 0 && (
          <section>
            <div className="flex items-center justify-between gap-4 mb-5">
              <div>
                <h2 className="font-display text-xl sm:text-2xl font-bold text-stone-900">
                  إعلانات مميزة
                </h2>
                <p className="text-sm text-stone-500 mt-0.5">
                  عروض مختارة تحظى باهتمام مرتفع في أبو جبيهة
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {featuredAds.map((ad) => (
                <AdCard
                  key={ad.id}
                  ad={ad}
                  onOpen={(id) => onNavigate({ page: 'ad-detail', adId: id })}
                  onToggleFavorite={onToggleFavorite}
                />
              ))}
            </div>
          </section>
        )}

        {/* Latest Advertisements */}
        <section>
          <div className="flex items-center justify-between gap-4 mb-5">
            <div>
              <h2 className="font-display text-xl sm:text-2xl font-bold text-stone-900">
                أحدث الإعلانات
              </h2>
              <p className="text-sm text-stone-500 mt-0.5">
                آخر ما تم نشره واعتماده في السوق
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate({ page: 'search' })}
              className="text-sm font-semibold text-teal-800 hover:text-teal-900 flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <span>عرض المزيد</span>
              <ArrowLeft className="w-4 h-4" />
            </button>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {[1, 2, 3, 4].map((n) => (
                <div
                  key={n}
                  className="bg-white border border-stone-200 rounded-xl overflow-hidden animate-pulse"
                >
                  <div className="aspect-[4/3] bg-stone-200" />
                  <div className="p-4 space-y-3">
                    <div className="h-3 bg-stone-200 rounded w-1/2" />
                    <div className="h-4 bg-stone-200 rounded w-5/6" />
                    <div className="h-4 bg-stone-200 rounded w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          ) : latestAds.length === 0 ? (
            <div className="bg-white border border-stone-200 rounded-xl p-10 text-center space-y-3">
              <p className="text-stone-700 font-semibold">لا توجد إعلانات منشورة حالياً</p>
              <button
                type="button"
                onClick={() =>
                  onNavigate(user ? { page: 'ad-new' } : { page: 'auth', mode: 'login' })
                }
                className="px-5 py-2.5 bg-teal-700 text-white text-sm font-semibold rounded-lg cursor-pointer"
              >
                كن أول من ينشر إعلاناً
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {latestAds.map((ad) => (
                <AdCard
                  key={ad.id}
                  ad={ad}
                  onOpen={(id) => onNavigate({ page: 'ad-detail', adId: id })}
                  onToggleFavorite={onToggleFavorite}
                />
              ))}
            </div>
          )}
        </section>

        {/* Property & Land Listings */}
        {propertyAds.length > 0 && (
          <section>
            <div className="flex items-center justify-between gap-4 mb-5">
              <div>
                <h2 className="font-display text-xl sm:text-2xl font-bold text-stone-900">
                  العقارات والأراضي
                </h2>
                <p className="text-sm text-stone-500 mt-0.5">
                  منازل للإيجار والبيع، محلات تجارية، وقطع أراضي موثقة في أبو جبيهة
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate({ page: 'search', category: 'properties-sale' })}
                className="text-sm font-semibold text-teal-800 hover:text-teal-900 flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <span>تصفح العقارات</span>
                <ArrowLeft className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {propertyAds.map((ad) => (
                <AdCard
                  key={ad.id}
                  ad={ad}
                  onOpen={(id) => onNavigate({ page: 'ad-detail', adId: id })}
                  onToggleFavorite={onToggleFavorite}
                />
              ))}
            </div>
          </section>
        )}

        {/* Phones & Electronics Listings */}
        {electronicsAds.length > 0 && (
          <section>
            <div className="flex items-center justify-between gap-4 mb-5">
              <div>
                <h2 className="font-display text-xl sm:text-2xl font-bold text-stone-900">
                  الهواتف والإلكترونيات
                </h2>
                <p className="text-sm text-stone-500 mt-0.5">
                  هواتف ذكية، أجهزة كمبيوتر، شاشات وإكسسوارات
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate({ page: 'search', category: 'phones-electronics' })}
                className="text-sm font-semibold text-teal-800 hover:text-teal-900 flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <span>عرض القسم</span>
                <ArrowLeft className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {electronicsAds.map((ad) => (
                <AdCard
                  key={ad.id}
                  ad={ad}
                  onOpen={(id) => onNavigate({ page: 'ad-detail', adId: id })}
                  onToggleFavorite={onToggleFavorite}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
