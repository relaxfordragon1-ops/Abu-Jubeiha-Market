import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  User as UserIcon,
  ShieldCheck,
  LogOut,
  PlusCircle,
  Pencil,
  Trash2,
  CheckCircle2,
  Camera,
  Sparkles,
  X,
  Upload,
} from 'lucide-react';
import {
  uploadImages,
  formatPriceSDG,
  formatArabicDate,
  getAdStatusLabel,
  getRemainingDaysLabel,
  ABU_JUBEIHA_AREAS,
} from '../lib/api';
import {
  createHeroPromotionRequest,
  deleteAd,
  fetchAds,
  fetchMyHeroPromotions,
  updateAdStatus,
} from '../lib/firestoreApi';
import { useAuth } from '../context/AuthContext';
import type { Ad, AppRoute, HeroPromotion } from '../types';

function AvatarImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) {
    return <UserIcon className="w-7 h-7 text-stone-400" />;
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="w-full h-full object-cover"
    />
  );
}

interface AccountPageProps {
  initialTab?: 'profile' | 'my-ads';
  onNavigate: (route: AppRoute) => void;
  onAdsChanged: () => void;
}

export function AccountPage({
  initialTab = 'profile',
  onNavigate,
  onAdsChanged,
}: AccountPageProps) {
  const { user, loading: authLoading, logout, refreshMe, updateAccountProfile } = useAuth();
  const [tab, setTab] = useState<'profile' | 'my-ads'>(initialTab);
  const [editingProfile, setEditingProfile] = useState(false);

  // Profile form state
  const [name, setName] = useState(user?.name ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [location, setLocation] = useState(user?.location ?? ABU_JUBEIHA_AREAS[0]);
  const [avatarUrl, setAvatarUrl] = useState(user?.avatar_url ?? '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState('');
  const [profileErr, setProfileErr] = useState('');

  // My Ads & Paid Hero Promotions state
  const [myAds, setMyAds] = useState<Ad[]>([]);
  const [myPromotions, setMyPromotions] = useState<HeroPromotion[]>([]);
  const [loadingAds, setLoadingAds] = useState(true);

  const [promotingAd, setPromotingAd] = useState<Ad | null>(null);
  const [promoDays, setPromoDays] = useState<number>(7);
  const [promoPaymentMethod, setPromoPaymentMethod] = useState('بنكك');
  const [promoPaymentRef, setPromoPaymentRef] = useState('');
  const [promoReceiptUrl, setPromoReceiptUrl] = useState('');
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const [promoSubmitting, setPromoSubmitting] = useState(false);
  const [promoFeedback, setPromoFeedback] = useState('');

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (user) {
      setName(user.name);
      setPhone(user.phone);
      setLocation(user.location);
      setAvatarUrl(user.avatar_url);
    }
  }, [user]);

  const loadMyAds = async () => {
    if (!user) return;
    setLoadingAds(true);
    try {
      const [adsList, promosList] = await Promise.all([
        fetchAds({ mine: true }, user.id),
        fetchMyHeroPromotions(user.id),
      ]);
      setMyAds(adsList);
      setMyPromotions(promosList);
    } catch {
      // ignore
    } finally {
      setLoadingAds(false);
    }
  };

  useEffect(() => {
    loadMyAds();
  }, [user?.id]);

  if (authLoading && !user) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 text-center space-y-3">
        <div className="w-8 h-8 border-2 border-teal-700 border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-sm font-medium text-stone-600">جاري استعادة جلسة الدخول...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="max-w-md mx-auto px-4 py-12 text-center space-y-4">
        <p className="font-bold text-stone-900">يرجى تسجيل الدخول لعرض حسابك</p>
        <button
          type="button"
          onClick={() => onNavigate({ page: 'auth', mode: 'login' })}
          className="px-6 py-2.5 bg-teal-700 text-white text-sm font-semibold rounded-lg cursor-pointer"
        >
          تسجيل الدخول
        </button>
      </div>
    );
  }

  const handleAvatarUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    setProfileErr('');
    try {
      const urls = await uploadImages([e.target.files[0]], { aspect: 1, maxDim: 512, force: true });
      if (urls[0]) setAvatarUrl(urls[0]);
    } catch (err: any) {
      setProfileErr(err.message || 'تعذر رفع الصورة الشخصية');
    }
  };

  const handleSaveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setProfileErr('');
    setProfileMsg('');
    setSavingProfile(true);
    try {
      await updateAccountProfile({
        name,
        phone,
        location,
        avatar_url: avatarUrl,
        currentPassword: currentPassword || undefined,
        newPassword: newPassword || undefined,
      });
      setCurrentPassword('');
      setNewPassword('');
      setProfileMsg('تم تحديث بيانات الحساب بنجاح');
      setEditingProfile(false);
    } catch (err: any) {
      setProfileErr(err.message);
    } finally {
      setSavingProfile(false);
    }
  };

  const handleDeleteAd = async (adId: string) => {
    try {
      await deleteAd(adId);
      setMyAds((prev) => prev.filter((a) => a.id !== adId));
      await refreshMe();
      onAdsChanged();
    } catch (err: any) {
      setProfileErr(err.message);
    }
  };

  const handleMarkStatus = async (adId: string, status: 'sold' | 'pending') => {
    try {
      await updateAdStatus(adId, status);
      await loadMyAds();
      onAdsChanged();
    } catch (err: any) {
      setProfileErr(err.message);
    }
  };

  const handleReceiptUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    setProfileErr('');
    setUploadingReceipt(true);
    try {
      const urls = await uploadImages([e.target.files[0]]);
      if (urls[0]) setPromoReceiptUrl(urls[0]);
    } catch (err: any) {
      setProfileErr(err.message || 'تعذر رفع صورة الإيصال');
    } finally {
      setUploadingReceipt(false);
    }
  };

  const handleSubmitHeroPromotion = async (e: FormEvent) => {
    e.preventDefault();
    if (!promotingAd) return;
    setProfileErr('');
    setPromoFeedback('');
    setPromoSubmitting(true);
    try {
      const msg = await createHeroPromotionRequest(user, promotingAd, {
        package_days: promoDays,
        payment_method: promoPaymentMethod,
        payment_reference: promoPaymentRef.trim(),
        payment_receipt_url: promoReceiptUrl,
      });
      setPromoFeedback(msg);
      setPromotingAd(null);
      setPromoPaymentRef('');
      setPromoReceiptUrl('');
      await loadMyAds();
      onAdsChanged();
    } catch (err: any) {
      setProfileErr(err.message);
    } finally {
      setPromoSubmitting(false);
    }
  };

  const isStaff = user.role === 'admin' || user.role === 'moderator';

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      {/* Header Summary */}
      <div className="bg-white border border-stone-200 rounded-2xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4 sm:flex-1">
          <div className="w-16 h-16 rounded-full bg-stone-100 border border-stone-200 overflow-hidden flex items-center justify-center shrink-0">
            <AvatarImage src={user.avatar_url} alt={user.name} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <h1 className="font-display text-xl font-extrabold text-stone-900">{user.name}</h1>
                {Boolean(user.is_verified_account) && (
                  <span title="حساب موثق" className="inline-flex">
                    <ShieldCheck className="w-5 h-5 text-teal-700" />
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setTab('profile');
                  setProfileErr('');
                  setProfileMsg('');
                  setEditingProfile((prev) => (tab === 'profile' ? !prev : true));
                }}
                className="shrink-0 px-2.5 py-1 bg-stone-100 hover:bg-stone-200 text-stone-700 text-[11px] font-bold rounded-lg inline-flex items-center gap-1 cursor-pointer"
              >
                <Pencil className="w-3 h-3" />
                <span>تعديل</span>
              </button>
            </div>
            <p className="text-xs text-stone-500 mt-0.5" dir="ltr">
              {user.email}
            </p>
            <p className="text-xs text-stone-600 mt-1">
              {user.role === 'admin'
                ? 'صلاحية: المدير العام'
                : user.role === 'moderator'
                ? 'صلاحية: مشرف السوق'
                : Boolean(user.is_verified_account)
                ? 'حساب موثق الهوية'
                : 'عضو مسجل'}
              {' · '}
              <span>{user.location}</span>
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {isStaff && (
            <button
              type="button"
              onClick={() => onNavigate({ page: 'admin', tab: 'overview' })}
              className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white text-xs font-bold rounded-lg flex items-center gap-1.5 cursor-pointer"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>لوحة الإدارة</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              logout();
              onNavigate({ page: 'home' });
            }}
            className="px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 text-xs font-bold rounded-lg flex items-center gap-1.5 cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>تسجيل الخروج</span>
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 p-1 bg-stone-200/70 rounded-xl w-fit">
        <button
          type="button"
          onClick={() => setTab('profile')}
          className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors cursor-pointer ${
            tab === 'profile' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600'
          }`}
        >
          الملف الشخصي والإعدادات
        </button>
        <button
          type="button"
          onClick={() => setTab('my-ads')}
          className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors cursor-pointer ${
            tab === 'my-ads' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600'
          }`}
        >
          إعلاناتي ({myAds.length})
        </button>
      </div>

      {tab === 'profile' ? (
        !editingProfile ? (
          profileMsg ? (
            <div className="p-3 bg-teal-50 border border-teal-200 rounded-xl text-sm text-teal-900">
              {profileMsg}
            </div>
          ) : null
        ) : (
        <form
          onSubmit={handleSaveProfile}
          className="bg-white border border-stone-200 rounded-2xl p-6 space-y-5"
        >
          <h2 className="font-display text-lg font-bold text-stone-900">تعديل معلومات الحساب</h2>

          {profileErr && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-800">
              {profileErr}
            </div>
          )}
          {profileMsg && (
            <div className="p-3 bg-teal-50 border border-teal-200 rounded-xl text-sm text-teal-900">
              {profileMsg}
            </div>
          )}

          {/* Avatar Upload */}
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-stone-100 border border-stone-200 overflow-hidden flex items-center justify-center shrink-0">
              <AvatarImage src={avatarUrl} alt={name} />
            </div>
            <label className="px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-800 text-xs font-semibold rounded-lg inline-flex items-center gap-2 cursor-pointer">
              <Camera className="w-4 h-4" />
              <span>تغيير الصورة الشخصية</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleAvatarUpload}
                className="hidden"
              />
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1.5">
                الاسم الكامل
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1.5">
                رقم الهاتف
              </label>
              <input
                type="tel"
                dir="ltr"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm text-left"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1.5">
                المنطقة / الحي في أبو جبيهة
              </label>
              <select
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm"
              >
                {ABU_JUBEIHA_AREAS.map((area) => (
                  <option key={area} value={area}>
                    {area}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="pt-4 border-t border-stone-100 space-y-3">
            <h3 className="text-sm font-bold text-stone-900">تغيير كلمة المرور (اختياري)</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1.5">
                  كلمة المرور الحالية
                </label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1.5">
                  كلمة المرور الجديدة
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm"
                />
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={savingProfile}
            className="px-6 py-2.5 bg-teal-700 hover:bg-teal-800 text-white text-sm font-bold rounded-xl cursor-pointer disabled:opacity-60"
          >
            {savingProfile ? 'جاري الحفظ...' : 'حفظ التغييرات'}
          </button>
        </form>
        )
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-bold text-stone-900">إدارة إعلاناتي</h2>
            <button
              type="button"
              onClick={() => onNavigate({ page: 'ad-new' })}
              className="px-4 py-2 bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold rounded-lg flex items-center gap-1.5 cursor-pointer"
            >
              <PlusCircle className="w-4 h-4" />
              <span>إعلان جديد</span>
            </button>
          </div>

          {promoFeedback && (
            <div className="p-3.5 bg-teal-50 border border-teal-200 rounded-xl text-sm text-teal-900">
              {promoFeedback}
            </div>
          )}
          {profileErr && (
            <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-800">
              {profileErr}
            </div>
          )}

          {loadingAds ? (
            <div className="h-40 bg-white border border-stone-200 rounded-2xl animate-pulse" />
          ) : myAds.length === 0 ? (
            <div className="bg-white border border-stone-200 rounded-2xl p-10 text-center space-y-3">
              <p className="font-bold text-stone-900">لم تنشر أي إعلانات بعد</p>
              <button
                type="button"
                onClick={() => onNavigate({ page: 'ad-new' })}
                className="px-5 py-2.5 bg-teal-700 text-white text-sm font-semibold rounded-lg cursor-pointer"
              >
                انشر إعلانك الأول
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {myAds.map((ad) => (
                <div
                  key={ad.id}
                  className="bg-white border border-stone-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="w-20 h-16 rounded-lg bg-stone-100 overflow-hidden shrink-0">
                      {ad.images?.[0] ? (
                        <img
                          src={ad.images[0]}
                          alt={ad.title}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-xs text-stone-400">
                          بدون صورة
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 space-y-1">
                      <button
                        type="button"
                        onClick={() => onNavigate({ page: 'ad-detail', adId: ad.id })}
                        className="font-bold text-stone-900 hover:text-teal-800 text-right truncate block max-w-full cursor-pointer"
                      >
                        {ad.title}
                      </button>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
                        <span>{ad.category_name}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-semibold text-teal-800 tabular-nums">
                          {formatPriceSDG(ad.price, ad.ad_type)}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{formatArabicDate(ad.created_at)}</span>
                      </div>
                      <div className="text-xs">
                        <span
                          className={`font-bold ${
                            ad.status === 'approved'
                              ? 'text-teal-700'
                              : ad.status === 'pending'
                              ? 'text-amber-700'
                              : ad.status === 'rejected'
                              ? 'text-rose-700'
                              : 'text-stone-500'
                          }`}
                        >
                          الحالة: {getAdStatusLabel(ad.status)}
                        </span>
                        {ad.status === 'rejected' && ad.rejection_reason && (
                          <span className="text-rose-700 mr-2">({ad.rejection_reason})</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {ad.status === 'approved' && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setPromotingAd(ad);
                            setPromoFeedback('');
                            setProfileErr('');
                          }}
                          className="px-3 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-950 text-xs font-bold rounded-lg flex items-center gap-1 cursor-pointer"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>تمييز مدفوع بالواجهة</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMarkStatus(ad.id, 'sold')}
                          className="px-3 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-700 text-xs font-semibold rounded-lg flex items-center gap-1 cursor-pointer"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>تحديد كمباع</span>
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => onNavigate({ page: 'ad-edit', adId: ad.id })}
                      className="px-3 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-800 text-xs font-semibold rounded-lg flex items-center gap-1 cursor-pointer"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      <span>تعديل</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteAd(ad.id)}
                      className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-semibold rounded-lg flex items-center gap-1 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>حذف</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {myPromotions.length > 0 && (
            <div className="bg-white border border-stone-200 rounded-2xl p-5 space-y-3 mt-6">
              <h3 className="font-display text-base font-bold text-stone-900">
                طلبات الإعلان المميز المدفوع (بنر الواجهة)
              </h3>
              <div className="space-y-2">
                {myPromotions.map((p) => {
                  const remaining = p.expires_at ? getRemainingDaysLabel(p.expires_at) : '';
                  return (
                    <div
                      key={p.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 bg-stone-50 rounded-xl border border-stone-200 text-xs"
                    >
                      <div className="space-y-0.5">
                        <p className="font-bold text-stone-900">{p.title}</p>
                        <p className="text-stone-500 tabular-nums">
                          الباقة: {p.package_days} أيام · {formatPriceSDG(p.amount_sdg)} ·{' '}
                          {p.payment_method} ({p.payment_reference})
                        </p>
                        {p.expires_at && (
                          <p className="text-[11px] text-teal-800 font-semibold">
                            ينتهي في: {formatArabicDate(p.expires_at)}
                            {remaining ? ` · (${remaining})` : ''}
                          </p>
                        )}
                      </div>
                      <span
                        className={`font-bold px-2.5 py-1 rounded-lg w-fit ${
                          p.status === 'active'
                            ? 'bg-teal-100 text-teal-800'
                            : p.status === 'pending'
                            ? 'bg-amber-100 text-amber-900'
                            : 'bg-stone-200 text-stone-700'
                        }`}
                      >
                        {p.status === 'active'
                          ? 'نشط في الواجهة'
                          : p.status === 'pending'
                          ? 'قيد تأكيد الدفع'
                          : p.status === 'paused'
                          ? 'متوقف مؤقتاً'
                          : p.status === 'expired'
                          ? 'منتهي الصلاحية'
                          : 'مرفوض'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Paid Hero Promotion Modal */}
      {promotingAd && (
        <div className="fixed inset-0 z-50 bg-stone-950/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 border border-stone-200">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-extrabold text-stone-900">
                تمييز الإعلان في البنر الرئيسي المدفوع
              </h3>
              <button
                type="button"
                onClick={() => setPromotingAd(null)}
                className="text-stone-500 hover:text-stone-900 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-stone-600 leading-relaxed">
              يظهر إعلانك (<strong>{promotingAd.title}</strong>) في الواجهة الرئيسية بالتناوب
              التلقائي كل 5 ثوانٍ مع علامة «إعلان مميز مدفوع» لزيادة المشاهدات والاتصالات.
            </p>
            <form onSubmit={handleSubmitHeroPromotion} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1.5">
                  اختر الباقة
                </label>
                <select
                  value={promoDays}
                  onChange={(e) => setPromoDays(Number(e.target.value))}
                  className="w-full px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm"
                >
                  <option value={3}>3 أيام — 5,000 ج.س</option>
                  <option value={7}>7 أيام — 10,000 ج.س</option>
                  <option value={14}>14 يوم — 18,000 ج.س</option>
                  <option value={30}>30 يوم — 30,000 ج.س</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1.5">
                  طريقة الدفع
                </label>
                <select
                  value={promoPaymentMethod}
                  onChange={(e) => setPromoPaymentMethod(e.target.value)}
                  className="w-full px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm"
                >
                  <option value="بنكك">تطبيق بنكك (Bankak)</option>
                  <option value="فوري">فوري (Fawry)</option>
                  <option value="أوكاش">أوكاش (O-Cash)</option>
                  <option value="دفع مباشر للإدارة">دفع مباشر لإدارة السوق في أبو جبيهة</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1.5">
                  رقم إشعار الدفع أو المرجع
                </label>
                <input
                  type="text"
                  required
                  value={promoPaymentRef}
                  onChange={(e) => setPromoPaymentRef(e.target.value)}
                  placeholder="أدخل رقم العملية أو اسم المحول لتأكيد الطلب"
                  className="w-full px-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1.5">
                  صورة إيصال التحويل (اختياري — يُسرّع المراجعة)
                </label>
                <div className="flex items-center gap-3">
                  <label className="px-3.5 py-2 bg-stone-100 hover:bg-stone-200 text-stone-800 text-xs font-semibold rounded-xl inline-flex items-center gap-2 cursor-pointer">
                    <Upload className="w-4 h-4" />
                    <span>{uploadingReceipt ? 'جاري الرفع...' : 'إرفاق صورة الإيصال'}</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={handleReceiptUpload}
                      disabled={uploadingReceipt}
                      className="hidden"
                    />
                  </label>
                  {promoReceiptUrl && (
                    <img
                      src={promoReceiptUrl}
                      alt="إيصال التحويل"
                      referrerPolicy="no-referrer"
                      className="w-12 h-12 rounded-lg object-cover border border-stone-200"
                    />
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 pt-2">
                <button
                  type="submit"
                  disabled={promoSubmitting || uploadingReceipt}
                  className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 text-stone-950 text-sm font-extrabold rounded-xl cursor-pointer disabled:opacity-60"
                >
                  {promoSubmitting ? 'جاري الإرسال...' : 'إرسال طلب التفعيل المدفوع'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPromotingAd(null);
                    setPromoReceiptUrl('');
                  }}
                  className="px-4 py-2.5 bg-stone-100 text-stone-700 text-sm font-semibold rounded-xl cursor-pointer"
                >
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
