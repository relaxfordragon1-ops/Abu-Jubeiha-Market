import { useEffect, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  Phone,
  MessageCircle,
  MessageSquare,
  Heart,
  Flag,
  MapPin,
  Calendar,
  Eye,
  ShieldCheck,
  FileCheck2,
  AlertTriangle,
  User as UserIcon,
  X,
  Share2,
  Check,
  Maximize2,
} from 'lucide-react';
import {
  buildWhatsAppHref,
  formatArabicDate,
  formatPriceSDG,
  getAdStatusLabel,
  getAdTypeLabel,
} from '../lib/api';
import { fetchAdById, submitReport as submitFirestoreReport, toggleFavorite } from '../lib/firestoreApi';
import { useAuth } from '../context/AuthContext';
import { CategoryIcon } from '../components/CategoryIcon';
import type { Ad, AppRoute } from '../types';

interface AdDetailPageProps {
  adId: string;
  onNavigate: (route: AppRoute) => void;
  onFavoriteChanged: () => void;
}

export function AdDetailPage({ adId, onNavigate, onFavoriteChanged }: AdDetailPageProps) {
  const { user, refreshMe } = useAuth();
  const [ad, setAd] = useState<Ad | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeImgIdx, setActiveImgIdx] = useState(0);
  const [favLoading, setFavLoading] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [copiedShare, setCopiedShare] = useState(false);

  // Report modal state
  const [reportOpen, setReportOpen] = useState(false);
  const [reportTarget, setReportTarget] = useState<'ad' | 'user'>('ad');
  const [reportReason, setReportReason] = useState('إعلان مضلل أو احتيالي');
  const [reportDetails, setReportDetails] = useState('');
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportSuccess, setReportSuccess] = useState('');
  const [reportError, setReportError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    setActiveImgIdx(0);
    fetchAdById(adId, user?.id)
      .then((loadedAd) => setAd(loadedAd))
      .catch((err) => setError(err.message || 'تعذر تحميل تفاصيل الإعلان'))
      .finally(() => setLoading(false));
  }, [adId, user?.id]);

  const handleFavorite = async () => {
    if (!user) {
      onNavigate({ page: 'auth', mode: 'login' });
      return;
    }
    if (!ad) return;
    setFavLoading(true);
    try {
      const favorited = await toggleFavorite(user.id, ad.id);
      setAd({ ...ad, is_favorited: favorited });
      await refreshMe();
      onFavoriteChanged();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setFavLoading(false);
    }
  };

  const handleOpenChat = () => {
    if (!user) {
      onNavigate({ page: 'auth', mode: 'login' });
      return;
    }
    if (!ad) return;
    onNavigate({ page: 'messages', withUserId: ad.user_id, adId: ad.id });
  };

  const submitReport = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) {
      onNavigate({ page: 'auth', mode: 'login' });
      return;
    }
    if (!ad) return;
    setReportSubmitting(true);
    setReportError('');
    try {
      const msg = await submitFirestoreReport(user, {
        target_type: reportTarget,
        target_ad_id: reportTarget === 'ad' ? ad.id : undefined,
        target_ad_title: reportTarget === 'ad' ? ad.title : undefined,
        target_user_id: reportTarget === 'user' ? ad.user_id : undefined,
        target_user_name: reportTarget === 'user' ? ad.owner_name : undefined,
        reason: reportReason,
        details: reportDetails,
      });
      setReportSuccess(msg);
      setReportDetails('');
    } catch (err: any) {
      setReportError(err.message || 'تعذر إرسال البلاغ');
    } finally {
      setReportSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 animate-pulse space-y-6">
        <div className="h-6 bg-stone-200 rounded w-48" />
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-7 aspect-[4/3] bg-stone-200 rounded-2xl" />
          <div className="lg:col-span-5 h-80 bg-stone-200 rounded-2xl" />
        </div>
      </div>
    );
  }

  if (error || !ad) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
        <div className="bg-white border border-stone-200 rounded-2xl p-8 text-center space-y-4">
          <p className="text-lg font-bold text-stone-900">{error || 'الإعلان غير موجود'}</p>
          <button
            type="button"
            onClick={() => onNavigate({ page: 'home' })}
            className="px-5 py-2.5 bg-teal-700 text-white text-sm font-semibold rounded-lg cursor-pointer"
          >
            العودة إلى الرئيسية
          </button>
        </div>
      </div>
    );
  }

  const isPropertyOrLand = ['properties-rent', 'properties-sale', 'land'].includes(
    ad.category_slug
  );
  const images = ad.images ?? [];
  const activeImage = images[activeImgIdx];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
      {/* Breadcrumb & Back */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-stone-500">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => onNavigate({ page: 'search' })}
            className="inline-flex items-center gap-1.5 text-stone-700 hover:text-teal-800 font-medium cursor-pointer"
          >
            <ArrowRight className="w-4 h-4" />
            <span>العودة للإعلانات</span>
          </button>
          <span aria-hidden="true">/</span>
          <button
            type="button"
            onClick={() => onNavigate({ page: 'search', category: ad.category_slug })}
            className="hover:text-teal-800 cursor-pointer"
          >
            {ad.category_name}
          </button>
          {ad.subcategory_name && (
            <>
              <span aria-hidden="true">/</span>
              <span>{ad.subcategory_name}</span>
            </>
          )}
        </div>

        {ad.status !== 'approved' && (
          <span className="text-xs font-bold text-amber-800 bg-amber-50 border border-amber-200 px-3 py-1 rounded-lg">
            حالة الإعلان: {getAdStatusLabel(ad.status)}
          </span>
        )}
      </div>

      {/* Main Two-Column Contiguous Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Right Column (RTL): Image Gallery + Description + Trust Separation */}
        <div className="lg:col-span-7 space-y-6">
          {/* Gallery */}
          <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden">
            <div className="aspect-[4/3] bg-stone-100 relative group">
              {activeImage ? (
                <>
                  <img
                    src={activeImage}
                    alt={ad.title}
                    referrerPolicy="no-referrer"
                    onClick={() => setLightboxOpen(true)}
                    className="w-full h-full object-cover cursor-zoom-in"
                  />
                  <button
                    type="button"
                    onClick={() => setLightboxOpen(true)}
                    aria-label="تكبير الصورة"
                    className="absolute bottom-3 left-3 px-2.5 py-1.5 rounded-lg bg-stone-900/75 text-white text-xs font-semibold flex items-center gap-1.5 opacity-90 hover:opacity-100 cursor-pointer"
                  >
                    <Maximize2 className="w-3.5 h-3.5" />
                    <span>تكبير</span>
                  </button>
                </>
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-stone-400 p-8 text-center">
                  <CategoryIcon name={undefined} className="w-12 h-12 mb-3" />
                  <p className="text-sm font-medium text-stone-500">
                    لم يرفق المعلن صوراً لهذا الإعلان
                  </p>
                </div>
              )}
            </div>

            {images.length > 1 && (
              <div className="p-3 border-t border-stone-100 flex items-center gap-2.5 overflow-x-auto">
                {images.map((img, idx) => (
                  <button
                    key={img + idx}
                    type="button"
                    onClick={() => setActiveImgIdx(idx)}
                    className={`w-20 h-16 rounded-lg overflow-hidden border-2 shrink-0 cursor-pointer transition-all ${
                      idx === activeImgIdx ? 'border-teal-700' : 'border-transparent opacity-75 hover:opacity-100'
                    }`}
                  >
                    <img
                      src={img}
                      alt={`${ad.title} ${idx + 1}`}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Description & Specs */}
          <div className="bg-white border border-stone-200 rounded-2xl p-6 space-y-5">
            <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
              <span>{ad.category_name}</span>
              {ad.subcategory_name && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{ad.subcategory_name}</span>
                </>
              )}
              <span aria-hidden="true">·</span>
              <span>{getAdTypeLabel(ad.ad_type)}</span>
              {ad.is_sample && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-stone-400">نموذج توضيحي للعرض</span>
                </>
              )}
            </div>

            <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-stone-900 leading-snug">
              {ad.title}
            </h1>

            <div className="flex flex-wrap items-center gap-6 text-sm text-stone-600 pb-4 border-b border-stone-100">
              <span className="flex items-center gap-1.5">
                <MapPin className="w-4 h-4 text-teal-700" />
                <span>{ad.location}</span>
              </span>
              <span className="flex items-center gap-1.5">
                <Calendar className="w-4 h-4 text-stone-400" />
                <span>نُشر في {formatArabicDate(ad.created_at)}</span>
              </span>
              <span className="flex items-center gap-1.5 tabular-nums">
                <Eye className="w-4 h-4 text-stone-400" />
                <span>{ad.views_count} مشاهدة</span>
              </span>
            </div>

            <div className="space-y-2">
              <h2 className="text-base font-bold text-stone-900">التفاصيل والوصف</h2>
              <p className="text-stone-700 text-[15px] leading-relaxed whitespace-pre-line">
                {ad.description}
              </p>
            </div>

            {/* Land / Property Document Info & Explicit Trust Distinction */}
            {(isPropertyOrLand || ad.document_info) && (
              <div className="pt-4 border-t border-stone-100 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-base font-bold text-stone-900">معلومات المستندات والملكية</h2>
                  {ad.has_verified_docs ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-800">
                      <FileCheck2 className="w-4 h-4" />
                      <span>تمت مراجعة مستند الملكية</span>
                    </span>
                  ) : (
                    <span className="text-xs text-stone-500">لم تُفحص المستندات بعد</span>
                  )}
                </div>
                <p className="text-sm text-stone-700 bg-stone-50 border border-stone-200 rounded-xl p-3.5">
                  {ad.document_info || 'لم يضف المعلن تفاصيل حول شهادة البحث أو مستند الحيازة.'}
                </p>
                <p className="text-xs text-stone-500 leading-relaxed flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                  <span>
                    تنبيه أمان مهم: توثيق حساب المعلن يؤكد هويته فقط ولا يُعتبر إثباتاً لملكية
                    العقار أو الأرض. يرجى دائماً معاينة الأصل ومراجعة سجل الأراضي والمحلية المختصة
                    قبل إتمام أي دفع مالي.
                  </span>
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Left Column (RTL): Sticky Price, Owner Card, Communication & Reporting */}
        <aside className="lg:col-span-5 lg:sticky lg:top-22 space-y-5">
          {/* Price & Direct Contact Card */}
          <div className="bg-white border border-stone-200 rounded-2xl p-6 space-y-5">
            <div className="pb-4 border-b border-stone-100">
              <p className="text-xs font-medium text-stone-500 mb-1">السعر المطلوب</p>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-2xl sm:text-3xl font-extrabold text-teal-800 tabular-nums">
                  {formatPriceSDG(ad.price, ad.ad_type)}
                </span>
                {ad.is_negotiable && ad.price > 0 && (
                  <span className="text-sm font-medium text-stone-600">قابل للتفاوض</span>
                )}
              </div>
            </div>

            {/* Owner Info */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-12 h-12 rounded-full bg-stone-100 border border-stone-200 overflow-hidden flex items-center justify-center shrink-0">
                  {ad.owner_avatar ? (
                    <img
                      src={ad.owner_avatar}
                      alt={ad.owner_name}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <UserIcon className="w-5 h-5 text-stone-500" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="font-bold text-stone-900 truncate">{ad.owner_name}</p>
                    {ad.owner_verified && (
                      <span title="حساب موثق" className="inline-flex shrink-0">
                        <ShieldCheck className="w-4 h-4 text-teal-700" />
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-stone-500 mt-0.5">
                    {ad.owner_verified
                      ? 'حساب موثق الهوية'
                      : 'حساب عادي (غير موثق بعد)'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  onNavigate({
                    page: 'search',
                    userId: ad.user_id,
                    sellerName: ad.owner_name,
                  })
                }
                className="text-xs font-semibold text-teal-800 hover:underline shrink-0 cursor-pointer"
              >
                كل إعلاناته
              </button>
            </div>

            {/* 3 Communication Channels */}
            <div className="space-y-2.5 pt-2">
              <a
                href={`tel:${ad.contact_phone}`}
                className="w-full py-3 px-4 bg-teal-700 hover:bg-teal-800 text-white text-sm font-bold rounded-xl flex items-center justify-center gap-2 transition-colors"
              >
                <Phone className="w-4 h-4" />
                <span className="font-mono-num" dir="ltr">
                  {ad.contact_phone}
                </span>
                <span>— اتصال هاتفي</span>
              </a>

              <a
                href={buildWhatsAppHref(ad.contact_whatsapp || ad.contact_phone, ad.title)}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-3 px-4 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-bold rounded-xl flex items-center justify-center gap-2 transition-colors"
              >
                <MessageCircle className="w-4 h-4" />
                <span>تواصل عبر واتساب</span>
              </a>

              {(!user || user.id !== ad.user_id) && (
                <button
                  type="button"
                  onClick={handleOpenChat}
                  className="w-full py-3 px-4 bg-stone-900 hover:bg-stone-800 text-white text-sm font-bold rounded-xl flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <MessageSquare className="w-4 h-4" />
                  <span>مراسلة داخل التطبيق</span>
                </button>
              )}
            </div>

            {/* Favorite, Share & Report Row */}
            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-stone-100">
              <button
                type="button"
                disabled={favLoading}
                onClick={handleFavorite}
                className={`py-2.5 px-2 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                  ad.is_favorited
                    ? 'bg-rose-50 border-rose-200 text-rose-700'
                    : 'bg-white border-stone-200 text-stone-700 hover:bg-stone-50'
                }`}
              >
                <Heart className={`w-4 h-4 ${ad.is_favorited ? 'fill-rose-600' : ''}`} />
                <span>{ad.is_favorited ? 'محفوظ' : 'المفضلة'}</span>
              </button>

              <button
                type="button"
                onClick={async () => {
                  const shareText = `${ad.title} — ${formatPriceSDG(ad.price, ad.ad_type)} | سوق أبو جبيهة`;
                  try {
                    if (navigator.share) {
                      await navigator.share({ title: ad.title, text: shareText, url: window.location.href });
                    } else if (navigator.clipboard) {
                      await navigator.clipboard.writeText(`${shareText}\n${window.location.href}`);
                    }
                    setCopiedShare(true);
                    setTimeout(() => setCopiedShare(false), 2200);
                  } catch {
                    // ignore cancelled share
                  }
                }}
                className="py-2.5 px-2 rounded-xl border border-stone-200 bg-white hover:bg-stone-50 text-stone-700 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                {copiedShare ? (
                  <>
                    <Check className="w-4 h-4 text-teal-700" />
                    <span className="text-teal-700">تم النسخ</span>
                  </>
                ) : (
                  <>
                    <Share2 className="w-4 h-4" />
                    <span>مشاركة</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  if (!user) {
                    onNavigate({ page: 'auth', mode: 'login' });
                    return;
                  }
                  setReportSuccess('');
                  setReportError('');
                  setReportTarget('ad');
                  setReportOpen(true);
                }}
                className="py-2.5 px-2 rounded-xl border border-stone-200 bg-white hover:bg-stone-50 text-stone-700 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <Flag className="w-4 h-4 text-rose-600" />
                <span>بلاغ</span>
              </button>
            </div>
          </div>

          {/* Safety Tips Card */}
          <div className="bg-stone-100 border border-stone-200 rounded-2xl p-5 space-y-2 text-xs text-stone-600 leading-relaxed">
            <h3 className="text-sm font-bold text-stone-900">إرشادات التعامل الآمن في السوق</h3>
            <ul className="space-y-1.5 list-disc list-inside">
              <li>قابل البائع في مكان عام ومعروف داخل أبو جبيهة أثناء النهار.</li>
              <li>لا ترسل أي مبالغ مالية مسبقاً قبل المعاينة الفعلية للمنتج أو العقار.</li>
              <li>تأكد من صحة الأوراق الرسمية عند شراء الأراضي والعقارات والمركبات.</li>
            </ul>
          </div>
        </aside>
      </div>

      {/* Report Modal */}
      {reportOpen && (
        <div
          className="fixed inset-0 z-50 bg-stone-950/50 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white border border-stone-200 rounded-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-bold text-stone-900">
                تقديم بلاغ للرقابة والأمان
              </h2>
              <button
                type="button"
                onClick={() => setReportOpen(false)}
                className="w-9 h-9 rounded-lg hover:bg-stone-100 flex items-center justify-center text-stone-500 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {reportSuccess ? (
              <div className="space-y-4">
                <p className="p-4 bg-teal-50 border border-teal-200 rounded-xl text-sm text-teal-900">
                  {reportSuccess}
                </p>
                <button
                  type="button"
                  onClick={() => setReportOpen(false)}
                  className="w-full py-2.5 bg-stone-900 text-white text-sm font-semibold rounded-lg cursor-pointer"
                >
                  إغلاق
                </button>
              </div>
            ) : (
              <form onSubmit={submitReport} className="space-y-4">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setReportTarget('ad')}
                    className={`py-2 px-3 rounded-lg border text-xs font-semibold cursor-pointer ${
                      reportTarget === 'ad'
                        ? 'bg-stone-900 text-white border-stone-900'
                        : 'bg-white text-stone-700 border-stone-200'
                    }`}
                  >
                    بلاغ عن الإعلان
                  </button>
                  <button
                    type="button"
                    onClick={() => setReportTarget('user')}
                    className={`py-2 px-3 rounded-lg border text-xs font-semibold cursor-pointer ${
                      reportTarget === 'user'
                        ? 'bg-stone-900 text-white border-stone-900'
                        : 'bg-white text-stone-700 border-stone-200'
                    }`}
                  >
                    بلاغ عن الحساب
                  </button>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1.5">
                    سبب البلاغ
                  </label>
                  <select
                    value={reportReason}
                    onChange={(e) => setReportReason(e.target.value)}
                    className="w-full px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-lg text-sm"
                  >
                    <option value="إعلان مضلل أو احتيالي">إعلان مضلل أو احتيالي</option>
                    <option value="منتج أو خدمة محظورة">منتج أو خدمة محظورة</option>
                    <option value="سعر وهمي أو غير حقيقي">سعر وهمي أو غير حقيقي</option>
                    <option value="انتحال هوية أو حساب مشبوه">انتحال هوية أو حساب مشبوه</option>
                    <option value="محتوى غير لائق أو مسيء">محتوى غير لائق أو مسيء</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1.5">
                    تفاصيل إضافية
                  </label>
                  <textarea
                    rows={3}
                    value={reportDetails}
                    onChange={(e) => setReportDetails(e.target.value)}
                    placeholder="اشرح سبب البلاغ لمساعدة فريق الإدارة..."
                    className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm"
                  />
                </div>

                {reportError && (
                  <p className="text-xs text-rose-700 font-medium">{reportError}</p>
                )}

                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="submit"
                    disabled={reportSubmitting}
                    className="flex-1 py-2.5 bg-rose-700 hover:bg-rose-800 text-white text-sm font-semibold rounded-lg disabled:opacity-60 cursor-pointer"
                  >
                    {reportSubmitting ? 'جاري الإرسال...' : 'إرسال البلاغ'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setReportOpen(false)}
                    className="px-4 py-2.5 bg-stone-100 text-stone-700 text-sm font-semibold rounded-lg cursor-pointer"
                  >
                    إلغاء
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Fullscreen Image Lightbox */}
      {lightboxOpen && activeImage && (
        <div
          className="fixed inset-0 z-50 bg-stone-950/90 flex items-center justify-center p-4"
          onClick={() => setLightboxOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            onClick={() => setLightboxOpen(false)}
            aria-label="إغلاق"
            className="absolute top-4 left-4 w-10 h-10 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
          <img
            src={activeImage}
            alt={ad.title}
            referrerPolicy="no-referrer"
            onClick={(e) => e.stopPropagation()}
            className="max-h-[90vh] max-w-[95vw] object-contain rounded-xl"
          />
        </div>
      )}
    </div>
  );
}
