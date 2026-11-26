import { useEffect, useState, useCallback, type ChangeEvent, type FormEvent } from 'react';
import {
  LayoutDashboard,
  ClipboardList,
  Users,
  Flag,
  FolderTree,
  Check,
  X,
  Star,
  Trash2,
  ShieldCheck,
  Ban,
  FileCheck2,
  Plus,
  Sparkles,
  Pause,
  Play,
  Upload,
  Receipt,
} from 'lucide-react';
import {
  uploadImages,
  formatArabicDate,
  formatPriceSDG,
  getAdStatusLabel,
  getRemainingDaysLabel,
} from '../lib/api';
import {
  adminAddStaff,
  adminAddSubcategory,
  adminChangeUserRole,
  adminClearSampleAds,
  adminCreateCategory,
  adminCreateHeroPromotion,
  adminDeleteHeroPromotion,
  adminFetchHeroPromotions,
  adminFetchOverview,
  adminFetchReports,
  adminFetchStaff,
  adminFetchUsers,
  adminModerateAd,
  adminRemoveStaff,
  adminToggleBlockUser,
  adminToggleSubcategory,
  adminToggleVerifyUser,
  adminUpdateCategory,
  adminUpdateHeroPromotion,
  adminUpdateReport,
  deleteAd as deleteFirestoreAd,
  fetchAds,
  fetchCategories,
  seedSampleListingsInFirestore,
} from '../lib/firestoreApi';
import { useAuth } from '../context/AuthContext';
import type {
  Ad,
  AdminOverview,
  AppRoute,
  Category,
  HeroPromotion,
  ReportItem,
  User,
} from '../types';

interface AdminDashboardPageProps {
  initialTab?: 'overview' | 'ads' | 'hero-ads' | 'users' | 'reports' | 'categories';
  onNavigate: (route: AppRoute) => void;
  onDataMutated: () => void;
}

export function AdminDashboardPage({
  initialTab = 'overview',
  onNavigate,
  onDataMutated,
}: AdminDashboardPageProps) {
  const { user, loading: authLoading } = useAuth();
  const [tab, setTab] = useState<
    'overview' | 'ads' | 'hero-ads' | 'users' | 'reports' | 'categories'
  >(initialTab);

  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [ads, setAds] = useState<Ad[]>([]);
  const [adsFilter, setAdsFilter] = useState<'pending' | 'approved' | 'rejected' | ''>('pending');
  const [usersList, setUsersList] = useState<User[]>([]);
  const [staffList, setStaffList] = useState<
    Array<{
      email: string;
      role: 'admin' | 'moderator';
      registered: boolean;
      user_name?: string;
      user_blocked?: boolean;
    }>
  >([]);
  const [newStaffEmail, setNewStaffEmail] = useState('');
  const [newStaffRole, setNewStaffRole] = useState<'admin' | 'moderator'>('admin');
  const [staffMsg, setStaffMsg] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);

  // Category creation & rename state
  const [newCatName, setNewCatName] = useState('');
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editingCatName, setEditingCatName] = useState('');
  const [newSubCatId, setNewSubCatId] = useState<string>('');
  const [newSubName, setNewSubName] = useState('');

  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState('');
  const [rejectingAdId, setRejectingAdId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // Paid Hero Banners state
  const [heroPromos, setHeroPromos] = useState<HeroPromotion[]>([]);
  const [approvedAdsForHero, setApprovedAdsForHero] = useState<Ad[]>([]);
  const [heroAdId, setHeroAdId] = useState<string>('');
  const [heroTitle, setHeroTitle] = useState('');
  const [heroPriceLabel, setHeroPriceLabel] = useState('');
  const [heroLocationLabel, setHeroLocationLabel] = useState('أبو جبيهة');
  const [heroImageUrl, setHeroImageUrl] = useState('');
  const [heroDays, setHeroDays] = useState(7);
  const [heroAmount, setHeroAmount] = useState(10000);
  const [heroSortOrder, setHeroSortOrder] = useState(1);
  const [receiptPreviewUrl, setReceiptPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  const isStaff = user?.role === 'admin' || user?.role === 'moderator';
  const isSuperAdmin = user?.role === 'admin';

  const loadTabData = useCallback(async () => {
    if (!isStaff || !user) return;
    setLoading(true);
    setActionError('');
    try {
      if (tab === 'overview') {
        const data = await adminFetchOverview();
        setOverview(data);
      } else if (tab === 'ads') {
        const list = await fetchAds(
          { includeAll: true, status: adsFilter || undefined },
          user.id
        );
        setAds(list);
      } else if (tab === 'hero-ads') {
        const [promosList, adsList] = await Promise.all([
          adminFetchHeroPromotions(),
          fetchAds({ status: 'approved' }, user.id),
        ]);
        setHeroPromos(promosList);
        setApprovedAdsForHero(adsList);
      } else if (tab === 'users') {
        const [usersData, staffData] = await Promise.all([
          adminFetchUsers(userSearch.trim()),
          isSuperAdmin ? adminFetchStaff() : Promise.resolve([]),
        ]);
        setUsersList(usersData);
        setStaffList(staffData);
      } else if (tab === 'reports') {
        const list = await adminFetchReports();
        setReports(list);
      } else if (tab === 'categories') {
        const cats = await fetchCategories(true);
        setCategories(cats);
        if (!newSubCatId && cats[0]) {
          setNewSubCatId(cats[0].id);
        }
      }
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setLoading(false);
    }
  }, [isStaff, isSuperAdmin, user?.id, tab, adsFilter, userSearch, newSubCatId]);

  useEffect(() => {
    loadTabData();
  }, [loadTabData]);

  if (authLoading && !isStaff) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 text-center space-y-3">
        <div className="w-8 h-8 border-2 border-teal-700 border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-sm font-medium text-stone-600">جاري استعادة جلسة الدخول...</p>
      </div>
    );
  }

  if (!isStaff) {
    return (
      <div className="max-w-lg mx-auto px-4 py-14 text-center space-y-4">
        <p className="font-display text-xl font-bold text-stone-900">
          هذه المنطقة مخصصة لإدارة ومشرفي سوق أبو جبيهة فقط
        </p>
        <button
          type="button"
          onClick={() => onNavigate({ page: 'home' })}
          className="px-6 py-2.5 bg-teal-700 text-white text-sm font-semibold rounded-lg cursor-pointer"
        >
          العودة للرئيسية
        </button>
      </div>
    );
  }

  const moderateAd = async (
    adId: string,
    payload: {
      status?: string;
      rejection_reason?: string;
      is_featured?: boolean;
      has_verified_docs?: boolean;
    }
  ) => {
    if (!user) return;
    setActionError('');
    try {
      await adminModerateAd(user, adId, payload);
      setRejectingAdId(null);
      setRejectReason('');
      await loadTabData();
      onDataMutated();
    } catch (err: any) {
      setActionError(err.message);
    }
  };

  const deleteAd = async (adId: string) => {
    try {
      await deleteFirestoreAd(adId);
      await loadTabData();
      onDataMutated();
    } catch (err: any) {
      setActionError(err.message);
    }
  };

  const toggleBlockUser = async (targetUser: User) => {
    if (!user) return;
    try {
      await adminToggleBlockUser(user, targetUser);
      await loadTabData();
    } catch (err: any) {
      setActionError(err.message);
    }
  };

  const toggleVerifyUser = async (targetUser: User) => {
    if (!user) return;
    try {
      await adminToggleVerifyUser(user, targetUser);
      await loadTabData();
    } catch (err: any) {
      setActionError(err.message);
    }
  };

  const changeUserRole = async (targetUser: User, role: 'user' | 'moderator' | 'admin') => {
    if (!user) return;
    try {
      await adminChangeUserRole(user, targetUser, role);
      await loadTabData();
    } catch (err: any) {
      setActionError(err.message);
    }
  };

  const handleReportStatus = async (
    reportId: string,
    status: 'reviewed' | 'dismissed'
  ) => {
    if (!user) return;
    try {
      await adminUpdateReport(user, reportId, status);
      await loadTabData();
    } catch (err: any) {
      setActionError(err.message);
    }
  };

  const handleAddCategory = async (e: FormEvent) => {
    e.preventDefault();
    if (!user || !newCatName.trim()) return;
    try {
      await adminCreateCategory(user, newCatName.trim());
      setNewCatName('');
      await loadTabData();
      onDataMutated();
    } catch (err: any) {
      setActionError(err.message);
    }
  };

  const handleToggleCategory = async (cat: Category) => {
    if (!user) return;
    try {
      await adminUpdateCategory(user, cat, { name_ar: cat.name_ar, is_active: !cat.is_active });
      await loadTabData();
      onDataMutated();
    } catch (err: any) {
      setActionError(err.message);
    }
  };

  const handleAddSubcategory = async (e: FormEvent) => {
    e.preventDefault();
    if (!user || !newSubCatId || !newSubName.trim()) return;
    try {
      await adminAddSubcategory(user, newSubCatId, newSubName.trim());
      setNewSubName('');
      await loadTabData();
      onDataMutated();
    } catch (err: any) {
      setActionError(err.message);
    }
  };

  const handleToggleSubcategory = async (categoryId: string, subId: string) => {
    if (!user) return;
    try {
      await adminToggleSubcategory(user, categoryId, subId);
      await loadTabData();
      onDataMutated();
    } catch (err: any) {
      setActionError(err.message);
    }
  };

  const handleRenameCategory = async (cat: Category) => {
    if (!user || !editingCatName.trim()) return;
    try {
      await adminUpdateCategory(user, cat, { name_ar: editingCatName.trim(), is_active: cat.is_active });
      setEditingCatId(null);
      setEditingCatName('');
      await loadTabData();
      onDataMutated();
    } catch (err: any) {
      setActionError(err.message);
    }
  };

  const handleAddStaff = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setActionError('');
    setStaffMsg('');
    try {
      const msg = await adminAddStaff(user, newStaffEmail.trim(), newStaffRole);
      setStaffMsg(msg);
      setNewStaffEmail('');
      await loadTabData();
    } catch (err: any) {
      setActionError(err.message);
    }
  };

  const handleRemoveStaff = async (email: string) => {
    if (!user) return;
    setActionError('');
    try {
      await adminRemoveStaff(user, email);
      await loadTabData();
    } catch (err: any) {
      setActionError(err.message);
    }
  };

  const handleClearSampleAds = async () => {
    if (!user) return;
    setActionError('');
    try {
      await adminClearSampleAds(user);
      await loadTabData();
      onDataMutated();
    } catch (err: any) {
      setActionError(err.message);
    }
  };

  const handleSeedSampleAds = async () => {
    if (!user) return;
    setActionError('');
    try {
      await seedSampleListingsInFirestore(user.id, user.name);
      await loadTabData();
      onDataMutated();
    } catch (err: any) {
      setActionError(err.message);
    }
  };

  const handleHeroBannerImageUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    setActionError('');
    try {
      const urls = await uploadImages([e.target.files[0]]);
      if (urls[0]) setHeroImageUrl(urls[0]);
    } catch (err: any) {
      setActionError(err.message);
    }
  };

  const handleCreateHeroPromo = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setActionError('');
    try {
      await adminCreateHeroPromotion(user, {
        ad_id: heroAdId || undefined,
        title: heroTitle.trim() || undefined,
        price_label: heroPriceLabel.trim() || undefined,
        location_label: heroLocationLabel.trim() || undefined,
        image_url: heroImageUrl || undefined,
        package_days: heroDays,
        amount_sdg: heroAmount,
        sort_order: heroSortOrder,
      });
      setHeroAdId('');
      setHeroTitle('');
      setHeroPriceLabel('');
      setHeroImageUrl('');
      await loadTabData();
      onDataMutated();
    } catch (err: any) {
      setActionError(err.message);
    }
  };

  const handleHeroPromoStatus = async (
    promoId: string,
    status: 'active' | 'paused' | 'rejected'
  ) => {
    if (!user) return;
    setActionError('');
    try {
      await adminUpdateHeroPromotion(user, promoId, status);
      await loadTabData();
      onDataMutated();
    } catch (err: any) {
      setActionError(err.message);
    }
  };

  const handleDeleteHeroPromo = async (promoId: string) => {
    if (!user) return;
    setActionError('');
    try {
      await adminDeleteHeroPromotion(user, promoId);
      await loadTabData();
      onDataMutated();
    } catch (err: any) {
      setActionError(err.message);
    }
  };

  const navItems: Array<{
    id: 'overview' | 'ads' | 'hero-ads' | 'users' | 'reports' | 'categories';
    label: string;
    icon: any;
    adminOnly?: boolean;
  }> = [
    { id: 'overview', label: 'النشاط والإحصائيات', icon: LayoutDashboard },
    { id: 'ads', label: 'مراجعة الإعلانات', icon: ClipboardList },
    { id: 'hero-ads', label: 'البنر المدفوع (الواجهة)', icon: Sparkles },
    { id: 'users', label: 'المستخدمون والمشرفون', icon: Users },
    { id: 'reports', label: 'البلاغات والرقابة', icon: Flag },
    { id: 'categories', label: 'إدارة الأقسام', icon: FolderTree, adminOnly: true },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-extrabold text-stone-900">
            لوحة إدارة سوق أبو جبيهة
          </h1>
          <p className="text-sm text-stone-500 mt-0.5">
            {isSuperAdmin ? 'صلاحية المدير العام' : 'صلاحية مشرف مراجعة'} · {user?.name}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Admin Sidebar */}
        <aside className="lg:col-span-3 bg-white border border-stone-200 rounded-2xl p-2 space-y-1">
          {navItems
            .filter((item) => !item.adminOnly || isSuperAdmin)
            .map((item) => {
              const Icon = item.icon;
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={`w-full px-3.5 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2.5 transition-colors cursor-pointer ${
                    active
                      ? 'bg-stone-900 text-white'
                      : 'text-stone-700 hover:bg-stone-100'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
        </aside>

        {/* Main Workspace */}
        <section className="lg:col-span-9 space-y-5">
          {actionError && (
            <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-800">
              {actionError}
            </div>
          )}

          {/* OVERVIEW TAB */}
          {tab === 'overview' && overview && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-white border border-stone-200 rounded-xl p-4">
                  <p className="text-xs text-stone-500">إعلانات بانتظار المراجعة</p>
                  <p className="text-2xl font-extrabold text-amber-700 tabular-nums mt-1">
                    {overview.stats.pendingAds}
                  </p>
                </div>
                <div className="bg-white border border-stone-200 rounded-xl p-4">
                  <p className="text-xs text-stone-500">إعلانات منشورة</p>
                  <p className="text-2xl font-extrabold text-teal-800 tabular-nums mt-1">
                    {overview.stats.approvedAds}
                  </p>
                </div>
                <div className="bg-white border border-stone-200 rounded-xl p-4">
                  <p className="text-xs text-stone-500">المستخدمون المسجلون</p>
                  <p className="text-2xl font-extrabold text-stone-900 tabular-nums mt-1">
                    {overview.stats.totalUsers}
                  </p>
                </div>
                <div className="bg-white border border-stone-200 rounded-xl p-4">
                  <p className="text-xs text-stone-500">بلاغات مفتوحة</p>
                  <p className="text-2xl font-extrabold text-rose-700 tabular-nums mt-1">
                    {overview.stats.openReports}
                  </p>
                </div>
              </div>

              <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden">
                <div className="p-4 border-b border-stone-100 flex items-center justify-between">
                  <h2 className="font-display text-base font-bold text-stone-900">
                    سجل نشاط الإدارة والرقابة
                  </h2>
                  <span className="text-xs text-stone-500 tabular-nums">
                    إجمالي الرسائل المتبادلة: {overview.stats.totalMessages}
                  </span>
                </div>
                <div className="divide-y divide-stone-100">
                  {overview.logs.length === 0 ? (
                    <p className="p-6 text-sm text-stone-500 text-center">
                      لا توجد إجراءات إدارية مسجلة بعد
                    </p>
                  ) : (
                    overview.logs.map((log) => (
                      <div
                        key={log.id}
                        className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-sm"
                      >
                        <div>
                          <span className="font-bold text-stone-900">{log.action}</span>
                          {log.target_info && (
                            <span className="text-stone-600 mr-2">— {log.target_info}</span>
                          )}
                        </div>
                        <div className="text-xs text-stone-500 shrink-0">
                          {log.actor_name || 'النظام'} · {formatArabicDate(log.created_at)}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {isSuperAdmin && (
                <div className="bg-white border border-stone-200 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-bold text-stone-900">
                      إدارة الإعلانات النموذجية التوضيحية
                    </h3>
                    <p className="text-xs text-stone-500 mt-1">
                      يمكنك إضافة نماذج توضيحية أولية أو حذفها بضغطة واحدة عند امتلاء السوق
                      بإعلانات المستخدمين الحقيقية.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {overview.stats.approvedAds === 0 && (
                      <button
                        type="button"
                        onClick={handleSeedSampleAds}
                        className="px-4 py-2 bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold rounded-lg cursor-pointer"
                      >
                        إضافة إعلانات نموذجية
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleClearSampleAds}
                      className="px-4 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold rounded-lg cursor-pointer"
                    >
                      حذف الإعلانات النموذجية
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ADS MODERATION TAB */}
          {tab === 'ads' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2 p-1 bg-stone-200/70 rounded-xl w-fit">
                {(
                  [
                    ['pending', 'قيد المراجعة'],
                    ['approved', 'المنشورة'],
                    ['rejected', 'المرفوضة'],
                    ['', 'الكل'],
                  ] as const
                ).map(([val, label]) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setAdsFilter(val)}
                    className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg cursor-pointer ${
                      adsFilter === val ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {loading ? (
                <div className="h-48 bg-white border border-stone-200 rounded-2xl animate-pulse" />
              ) : ads.length === 0 ? (
                <div className="bg-white border border-stone-200 rounded-2xl p-10 text-center text-sm text-stone-500">
                  لا توجد إعلانات في هذا التصنيف حالياً
                </div>
              ) : (
                <div className="space-y-3">
                  {ads.map((ad) => (
                    <div
                      key={ad.id}
                      className="bg-white border border-stone-200 rounded-xl p-4 space-y-3"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap text-xs text-stone-500">
                            <span className="font-bold text-stone-800">{ad.category_name}</span>
                            <span>·</span>
                            <span>المعلن: {ad.owner_name}</span>
                            <span>·</span>
                            <span className="font-bold text-teal-800 tabular-nums">
                              {formatPriceSDG(ad.price, ad.ad_type)}
                            </span>
                            <span>·</span>
                            <span>الحالة: {getAdStatusLabel(ad.status)}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => onNavigate({ page: 'ad-detail', adId: ad.id })}
                            className="font-bold text-base text-stone-900 hover:text-teal-800 text-right cursor-pointer"
                          >
                            {ad.title}
                          </button>
                          <p className="text-xs text-stone-600 line-clamp-2">{ad.description}</p>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                          {ad.status !== 'approved' && (
                            <button
                              type="button"
                              onClick={() => moderateAd(ad.id, { status: 'approved' })}
                              className="px-3 py-1.5 bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold rounded-lg flex items-center gap-1 cursor-pointer"
                            >
                              <Check className="w-3.5 h-3.5" />
                              <span>اعتماد ونشر</span>
                            </button>
                          )}

                          {ad.status !== 'rejected' && (
                            <button
                              type="button"
                              onClick={() => {
                                setRejectingAdId(ad.id);
                                setRejectReason('مخالف لشروط النشر أو البيانات غير مكتملة');
                              }}
                              className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 text-xs font-bold rounded-lg flex items-center gap-1 cursor-pointer"
                            >
                              <X className="w-3.5 h-3.5" />
                              <span>رفض</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() =>
                              moderateAd(ad.id, { is_featured: !ad.is_featured })
                            }
                            className={`px-3 py-1.5 border text-xs font-bold rounded-lg flex items-center gap-1 cursor-pointer ${
                              ad.is_featured
                                ? 'bg-amber-700 text-white border-amber-700'
                                : 'bg-white text-stone-700 border-stone-200 hover:bg-stone-50'
                            }`}
                          >
                            <Star className="w-3.5 h-3.5" />
                            <span>{ad.is_featured ? 'إلغاء التمييز' : 'تمييز'}</span>
                          </button>

                          {['land', 'properties-sale', 'properties-rent'].includes(
                            ad.category_slug
                          ) && (
                            <button
                              type="button"
                              onClick={() =>
                                moderateAd(ad.id, {
                                  has_verified_docs: !ad.has_verified_docs,
                                })
                              }
                              className={`px-3 py-1.5 border text-xs font-bold rounded-lg flex items-center gap-1 cursor-pointer ${
                                ad.has_verified_docs
                                  ? 'bg-teal-800 text-white border-teal-800'
                                  : 'bg-white text-stone-700 border-stone-200 hover:bg-stone-50'
                              }`}
                            >
                              <FileCheck2 className="w-3.5 h-3.5" />
                              <span>
                                {ad.has_verified_docs ? 'مستند موثق' : 'توثيق المستند'}
                              </span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => deleteAd(ad.id)}
                            className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold rounded-lg flex items-center gap-1 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>حذف</span>
                          </button>
                        </div>
                      </div>

                      {rejectingAdId === ad.id && (
                        <div className="pt-3 border-t border-stone-100 flex flex-col sm:flex-row gap-2">
                          <input
                            type="text"
                            value={rejectReason}
                            onChange={(e) => setRejectReason(e.target.value)}
                            placeholder="اكتب سبب الرفض ليظهر للمعلن..."
                            className="flex-1 px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-xs"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              moderateAd(ad.id, {
                                status: 'rejected',
                                rejection_reason: rejectReason,
                              })
                            }
                            className="px-4 py-2 bg-rose-700 text-white text-xs font-bold rounded-lg cursor-pointer"
                          >
                            تأكيد الرفض
                          </button>
                          <button
                            type="button"
                            onClick={() => setRejectingAdId(null)}
                            className="px-3 py-2 bg-stone-100 text-stone-700 text-xs font-semibold rounded-lg cursor-pointer"
                          >
                            إلغاء
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* PAID HERO BANNERS TAB */}
          {tab === 'hero-ads' && (
            <div className="space-y-6">
              <form
                onSubmit={handleCreateHeroPromo}
                className="bg-white border border-stone-200 rounded-2xl p-5 space-y-4"
              >
                <div>
                  <h2 className="font-display text-base font-bold text-stone-900">
                    نشر إعلان مميز مدفوع في البنر المتحرك بالواجهة (كل 5 ثوانٍ)
                  </h2>
                  <p className="text-xs text-stone-500 mt-0.5">
                    يمكنك ربط إعلان منشور جاهز، أو رفع صورة مخصصة وعنوان لإعلان تجاري مدفوع.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-stone-700 mb-1">
                      ربط بإعلان منشور (اختياري)
                    </label>
                    <select
                      value={heroAdId}
                      onChange={(e) => setHeroAdId(e.target.value)}
                      className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm"
                    >
                      <option value="">— إعلان بنر مستقل / مخصص —</option>
                      {approvedAdsForHero.map((ad) => (
                        <option key={ad.id} value={ad.id}>
                          {ad.title} ({formatPriceSDG(ad.price, ad.ad_type)})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-stone-700 mb-1">
                      عنوان البنر {heroAdId ? '(يؤخذ تلقائياً إذا تُرك فارغاً)' : ''}
                    </label>
                    <input
                      type="text"
                      value={heroTitle}
                      onChange={(e) => setHeroTitle(e.target.value)}
                      placeholder="مثال: عروض متجر النيل للهواتف"
                      className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-stone-700 mb-1">
                      نص السعر / العرض
                    </label>
                    <input
                      type="text"
                      value={heroPriceLabel}
                      onChange={(e) => setHeroPriceLabel(e.target.value)}
                      placeholder="مثال: 450,000 ج.س أو خصم 20%"
                      className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-stone-700 mb-1">
                      الموقع / الحي
                    </label>
                    <input
                      type="text"
                      value={heroLocationLabel}
                      onChange={(e) => setHeroLocationLabel(e.target.value)}
                      className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm"
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-xs font-semibold text-stone-700 mb-1">
                        المدة (أيام)
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={365}
                        value={heroDays}
                        onChange={(e) => setHeroDays(Number(e.target.value))}
                        className="w-full px-2.5 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-stone-700 mb-1">
                        الرسوم (ج.س)
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={heroAmount}
                        onChange={(e) => setHeroAmount(Number(e.target.value))}
                        className="w-full px-2.5 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-stone-700 mb-1">
                        الترتيب
                      </label>
                      <input
                        type="number"
                        min={1}
                        value={heroSortOrder}
                        onChange={(e) => setHeroSortOrder(Number(e.target.value))}
                        className="w-full px-2.5 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm"
                      />
                    </div>
                  </div>

                  <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
                    <label className="px-3.5 py-2 bg-stone-100 hover:bg-stone-200 text-stone-800 text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 cursor-pointer">
                      <Upload className="w-4 h-4" />
                      <span>{heroImageUrl ? 'تغيير صورة البنر' : 'رفع صورة للبنر'}</span>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={handleHeroBannerImageUpload}
                        className="hidden"
                      />
                    </label>
                    {heroImageUrl && (
                      <img
                        src={heroImageUrl}
                        alt="معاينة البنر"
                        className="w-16 h-11 rounded-lg object-cover border border-stone-200"
                      />
                    )}
                    <button
                      type="submit"
                      className="mr-auto px-5 py-2 bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold rounded-lg cursor-pointer"
                    >
                      نشر وتفعيل بالواجهة فوراً
                    </button>
                  </div>
                </div>
              </form>

              <div className="space-y-3">
                <h3 className="font-display text-base font-bold text-stone-900">
                  الإعلانات المميزة وطلبات التفعيل المدفوع ({heroPromos.length})
                </h3>
                {loading ? (
                  <div className="h-32 bg-white border border-stone-200 rounded-xl animate-pulse" />
                ) : heroPromos.length === 0 ? (
                  <div className="bg-white border border-stone-200 rounded-xl p-8 text-center text-sm text-stone-500">
                    لا توجد إعلانات بنر مدفوعة حالياً
                  </div>
                ) : (
                  heroPromos.map((promo) => (
                    <div
                      key={promo.id}
                      className="bg-white border border-stone-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div className="flex items-center gap-3.5 min-w-0">
                        <img
                          src={promo.image_url}
                          alt={promo.title}
                          referrerPolicy="no-referrer"
                          className="w-20 h-16 rounded-lg object-cover bg-stone-100 shrink-0"
                        />
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-bold text-sm text-stone-900 truncate">
                              {promo.title}
                            </span>
                            <span
                              className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${
                                promo.status === 'active'
                                  ? 'bg-teal-50 text-teal-800'
                                  : promo.status === 'pending'
                                  ? 'bg-amber-50 text-amber-800'
                                  : 'bg-stone-100 text-stone-600'
                              }`}
                            >
                              {promo.status === 'active'
                                ? 'نشط بالواجهة'
                                : promo.status === 'pending'
                                ? 'بانتظار الاعتماد'
                                : promo.status === 'paused'
                                ? 'متوقف مؤقتاً'
                                : promo.status === 'expired'
                                ? 'منتهي'
                                : 'مرفوض'}
                            </span>
                          </div>
                          <p className="text-xs text-stone-500 tabular-nums">
                            {promo.owner_name} · الباقة: {promo.package_days} أيام (
                            {formatPriceSDG(promo.amount_sdg)}) · الدفع: {promo.payment_method} (
                            {promo.payment_reference})
                          </p>
                          {promo.expires_at && (
                            <p className="text-[11px] text-teal-800 font-medium">
                              ينتهي في: {formatArabicDate(promo.expires_at)} (
                              {getRemainingDaysLabel(promo.expires_at)})
                            </p>
                          )}
                          {promo.payment_receipt_url && (
                            <button
                              type="button"
                              onClick={() => setReceiptPreviewUrl(promo.payment_receipt_url || null)}
                              className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-800 hover:underline cursor-pointer"
                            >
                              <Receipt className="w-3.5 h-3.5" />
                              <span>معاينة صورة إيصال الدفع</span>
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        {promo.status !== 'active' && (
                          <button
                            type="button"
                            onClick={() => handleHeroPromoStatus(promo.id, 'active')}
                            className="px-3 py-1.5 bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold rounded-lg flex items-center gap-1 cursor-pointer"
                          >
                            <Play className="w-3.5 h-3.5" />
                            <span>تفعيل</span>
                          </button>
                        )}
                        {promo.status === 'active' && (
                          <button
                            type="button"
                            onClick={() => handleHeroPromoStatus(promo.id, 'paused')}
                            className="px-3 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-700 text-xs font-semibold rounded-lg flex items-center gap-1 cursor-pointer"
                          >
                            <Pause className="w-3.5 h-3.5" />
                            <span>إيقاف مؤقت</span>
                          </button>
                        )}
                        {promo.status === 'pending' && (
                          <button
                            type="button"
                            onClick={() => handleHeroPromoStatus(promo.id, 'rejected')}
                            className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold rounded-lg cursor-pointer"
                          >
                            رفض
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDeleteHeroPromo(promo.id)}
                          className="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-semibold rounded-lg cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {receiptPreviewUrl && (
                <div
                  className="fixed inset-0 z-50 bg-stone-950/80 flex items-center justify-center p-4"
                  onClick={() => setReceiptPreviewUrl(null)}
                >
                  <div
                    className="bg-white rounded-2xl max-w-lg w-full p-4 space-y-3"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center justify-between">
                      <h4 className="font-bold text-sm text-stone-900">صورة إيصال التحويل</h4>
                      <button
                        type="button"
                        onClick={() => setReceiptPreviewUrl(null)}
                        className="text-stone-500 hover:text-stone-900 cursor-pointer"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                    <img
                      src={receiptPreviewUrl}
                      alt="إيصال التحويل"
                      referrerPolicy="no-referrer"
                      className="w-full max-h-[75vh] object-contain rounded-xl bg-stone-100"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* USERS & MODERATORS TAB */}
          {tab === 'users' && (
            <div className="space-y-5">
              {isSuperAdmin && (
                <div className="bg-white border border-stone-200 rounded-2xl p-5 space-y-4">
                  <div>
                    <h2 className="font-display text-base font-bold text-stone-900">
                      تعيين مدير عام أو مشرف جديد بالبريد الإلكتروني
                    </h2>
                    <p className="text-xs text-stone-500 mt-0.5">
                      يمكنك إضافة أي بريد إلكتروني؛ يتم تفعيل الصلاحية فوراً للحسابات المسجلة أو
                      تلقائياً عند أول تسجيل للحسابات الجديدة.
                    </p>
                  </div>

                  {staffMsg && (
                    <div className="p-3 bg-teal-50 border border-teal-200 rounded-xl text-xs text-teal-900 font-medium">
                      {staffMsg}
                    </div>
                  )}

                  <form onSubmit={handleAddStaff} className="flex flex-col sm:flex-row gap-2.5">
                    <input
                      type="email"
                      required
                      dir="ltr"
                      value={newStaffEmail}
                      onChange={(e) => setNewStaffEmail(e.target.value)}
                      placeholder="name@gmail.com"
                      className="flex-1 px-3.5 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm text-left"
                    />
                    <select
                      value={newStaffRole}
                      onChange={(e) =>
                        setNewStaffRole(e.target.value as 'admin' | 'moderator')
                      }
                      className="px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-xs font-semibold"
                    >
                      <option value="admin">مدير عام</option>
                      <option value="moderator">مشرف مراجعة</option>
                    </select>
                    <button
                      type="submit"
                      className="px-4 py-2 bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold rounded-lg cursor-pointer shrink-0"
                    >
                      إضافة للصلاحيات
                    </button>
                  </form>

                  {staffList.length > 0 && (
                    <div className="pt-3 border-t border-stone-100 space-y-2">
                      <p className="text-xs font-bold text-stone-700">
                        قائمة الإدارة والمشرفين المعتمدين:
                      </p>
                      <div className="divide-y divide-stone-100 border border-stone-200 rounded-xl overflow-hidden">
                        {staffList.map((st) => (
                          <div
                            key={st.email}
                            className="px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs bg-stone-50/50"
                          >
                            <div className="flex items-center gap-2">
                              <span className="font-mono-num font-semibold text-stone-900" dir="ltr">
                                {st.email}
                              </span>
                              <span className="text-stone-400">·</span>
                              <span className="font-bold text-teal-800">
                                {st.role === 'admin' ? 'مدير عام' : 'مشرف'}
                              </span>
                              <span className="text-stone-400">·</span>
                              <span
                                className={
                                  st.registered ? 'text-teal-700 font-medium' : 'text-amber-700'
                                }
                              >
                                {st.registered
                                  ? `مفعّل (${st.user_name})`
                                  : 'بانتظار التسجيل لأول مرة'}
                              </span>
                            </div>
                            {st.email.toLowerCase() !== user?.email?.toLowerCase() && (
                              <button
                                type="button"
                                onClick={() => handleRemoveStaff(st.email)}
                                className="text-rose-700 hover:underline font-semibold cursor-pointer"
                              >
                                إزالة
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="bg-white border border-stone-200 rounded-xl p-3">
                <input
                  type="text"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="ابحث عن مستخدم بالاسم أو البريد أو رقم الهاتف..."
                  className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm"
                />
              </div>

              <div className="bg-white border border-stone-200 rounded-2xl overflow-x-auto">
                <table className="w-full text-right text-sm">
                  <thead className="bg-stone-50 border-b border-stone-200 text-xs text-stone-600">
                    <tr>
                      <th className="py-3 px-4">الاسم والبريد</th>
                      <th className="py-3 px-4">الدور</th>
                      <th className="py-3 px-4">الإعلانات</th>
                      <th className="py-3 px-4">الحالة</th>
                      <th className="py-3 px-4">الإجراءات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {usersList.map((u) => (
                      <tr key={u.id} className="hover:bg-stone-50/70">
                        <td className="py-3 px-4">
                          <div className="font-bold text-stone-900">{u.name}</div>
                          <div className="text-xs text-stone-500" dir="ltr">
                            {u.email}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          {isSuperAdmin && !u.is_sample && u.id !== user?.id ? (
                            <select
                              value={u.role}
                              onChange={(e) =>
                                changeUserRole(
                                  u,
                                  e.target.value as 'user' | 'moderator' | 'admin'
                                )
                              }
                              className="px-2 py-1 bg-stone-50 border border-stone-200 rounded-lg text-xs font-semibold"
                            >
                              <option value="user">عضو عادي</option>
                              <option value="moderator">مشرف</option>
                              <option value="admin">مدير عام</option>
                            </select>
                          ) : (
                            <span className="text-xs font-semibold text-stone-700">
                              {u.role === 'admin'
                                ? 'مدير عام'
                                : u.role === 'moderator'
                                ? 'مشرف'
                                : 'عضو'}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 tabular-nums">{u.ads_count ?? 0}</td>
                        <td className="py-3 px-4 text-xs">
                          {u.is_blocked ? (
                            <span className="font-bold text-rose-700">محظور</span>
                          ) : u.is_verified_account ? (
                            <span className="font-bold text-teal-700">موثق</span>
                          ) : (
                            <span className="text-stone-500">نشط</span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => toggleVerifyUser(u)}
                              className="px-2.5 py-1 bg-stone-100 hover:bg-stone-200 text-stone-800 text-xs font-semibold rounded-lg flex items-center gap-1 cursor-pointer"
                            >
                              <ShieldCheck className="w-3.5 h-3.5" />
                              <span>{u.is_verified_account ? 'إلغاء التوثيق' : 'توثيق'}</span>
                            </button>
                            {u.id !== user?.id && (
                              <button
                                type="button"
                                onClick={() => toggleBlockUser(u)}
                                className={`px-2.5 py-1 text-xs font-semibold rounded-lg flex items-center gap-1 cursor-pointer ${
                                  u.is_blocked
                                    ? 'bg-teal-50 text-teal-800 hover:bg-teal-100'
                                    : 'bg-rose-50 text-rose-700 hover:bg-rose-100'
                                }`}
                              >
                                <Ban className="w-3.5 h-3.5" />
                                <span>{u.is_blocked ? 'فك الحظر' : 'حظر'}</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* REPORTS TAB */}
          {tab === 'reports' && (
            <div className="space-y-3">
              {reports.length === 0 ? (
                <div className="bg-white border border-stone-200 rounded-2xl p-10 text-center text-sm text-stone-500">
                  لا توجد بلاغات مسجلة حتى الآن
                </div>
              ) : (
                reports.map((rep) => (
                  <div
                    key={rep.id}
                    className="bg-white border border-stone-200 rounded-xl p-4 space-y-3"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="text-xs text-stone-500">
                        <span className="font-bold text-rose-700">
                          {rep.target_type === 'ad' ? 'بلاغ عن إعلان' : 'بلاغ عن حساب'}
                        </span>
                        <span> · المبلّغ: {rep.reporter_name}</span>
                        <span> · {formatArabicDate(rep.created_at)}</span>
                      </div>
                      <span
                        className={`text-xs font-bold ${
                          rep.status === 'open'
                            ? 'text-amber-700'
                            : rep.status === 'reviewed'
                            ? 'text-teal-700'
                            : 'text-stone-500'
                        }`}
                      >
                        {rep.status === 'open'
                          ? 'مفتوح للمراجعة'
                          : rep.status === 'reviewed'
                          ? 'تمت المعالجة'
                          : 'مرفوض / مستبعد'}
                      </span>
                    </div>

                    <div>
                      <p className="font-bold text-sm text-stone-900">السبب: {rep.reason}</p>
                      {rep.target_ad_title && (
                        <button
                          type="button"
                          onClick={() =>
                            rep.target_ad_id &&
                            onNavigate({ page: 'ad-detail', adId: rep.target_ad_id })
                          }
                          className="text-xs text-teal-800 font-semibold hover:underline mt-1 cursor-pointer"
                        >
                          الإعلان المعني: {rep.target_ad_title}
                        </button>
                      )}
                      {rep.target_user_name && (
                        <p className="text-xs text-stone-600 mt-0.5">
                          صاحب الحساب المعني: {rep.target_user_name}
                        </p>
                      )}
                      {rep.details && (
                        <p className="text-xs text-stone-600 mt-1.5 bg-stone-50 p-2.5 rounded-lg">
                          {rep.details}
                        </p>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      {rep.status === 'open' && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleReportStatus(rep.id, 'reviewed')}
                            className="px-3 py-1.5 bg-teal-700 text-white text-xs font-bold rounded-lg cursor-pointer"
                          >
                            اعتماد الإجراء وإغلاق البلاغ
                          </button>
                          <button
                            type="button"
                            onClick={() => handleReportStatus(rep.id, 'dismissed')}
                            className="px-3 py-1.5 bg-stone-100 text-stone-700 text-xs font-semibold rounded-lg cursor-pointer"
                          >
                            تجاهل البلاغ
                          </button>
                        </>
                      )}
                      {rep.target_ad_id && (
                        <button
                          type="button"
                          onClick={async () => {
                            await deleteAd(rep.target_ad_id!);
                            await handleReportStatus(rep.id, 'reviewed');
                          }}
                          className="px-3 py-1.5 bg-rose-50 text-rose-700 text-xs font-bold rounded-lg cursor-pointer"
                        >
                          حذف الإعلان المخالف
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* CATEGORIES MANAGER TAB (SUPER ADMIN ONLY) */}
          {tab === 'categories' && isSuperAdmin && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <form
                  onSubmit={handleAddCategory}
                  className="bg-white border border-stone-200 rounded-xl p-4 space-y-3"
                >
                  <h3 className="text-sm font-bold text-stone-900">إضافة قسم رئيسي جديد</h3>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      required
                      value={newCatName}
                      onChange={(e) => setNewCatName(e.target.value)}
                      placeholder="اسم القسم الجديد"
                      className="flex-1 px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm"
                    />
                    <button
                      type="submit"
                      className="px-4 py-2 bg-teal-700 text-white text-xs font-bold rounded-lg flex items-center gap-1 cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                      <span>إضافة</span>
                    </button>
                  </div>
                </form>

                <form
                  onSubmit={handleAddSubcategory}
                  className="bg-white border border-stone-200 rounded-xl p-4 space-y-3"
                >
                  <h3 className="text-sm font-bold text-stone-900">إضافة قسم فرعي</h3>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <select
                      value={newSubCatId}
                      onChange={(e) => setNewSubCatId(e.target.value)}
                      className="px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-xs"
                    >
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name_ar}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      required
                      value={newSubName}
                      onChange={(e) => setNewSubName(e.target.value)}
                      placeholder="اسم القسم الفرعي"
                      className="flex-1 px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm"
                    />
                    <button
                      type="submit"
                      className="px-4 py-2 bg-stone-900 text-white text-xs font-bold rounded-lg cursor-pointer"
                    >
                      إضافة
                    </button>
                  </div>
                </form>
              </div>

              <div className="space-y-3">
                {categories.map((cat) => (
                  <div
                    key={cat.id}
                    className="bg-white border border-stone-200 rounded-xl p-4 space-y-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      {editingCatId === cat.id ? (
                        <div className="flex items-center gap-2 flex-1">
                          <input
                            type="text"
                            value={editingCatName}
                            onChange={(e) => setEditingCatName(e.target.value)}
                            className="px-3 py-1.5 bg-stone-50 border border-stone-200 rounded-lg text-sm flex-1"
                          />
                          <button
                            type="button"
                            onClick={() => handleRenameCategory(cat)}
                            className="px-3 py-1.5 bg-teal-700 text-white text-xs font-bold rounded-lg cursor-pointer"
                          >
                            حفظ
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingCatId(null)}
                            className="px-3 py-1.5 bg-stone-100 text-stone-700 text-xs font-semibold rounded-lg cursor-pointer"
                          >
                            إلغاء
                          </button>
                        </div>
                      ) : (
                        <div>
                          <span className="font-bold text-stone-900">{cat.name_ar}</span>
                          <span className="text-xs text-stone-500 mr-2 tabular-nums">
                            ({cat.ads_count ?? 0} إعلان)
                          </span>
                        </div>
                      )}

                      <div className="flex items-center gap-2">
                        {editingCatId !== cat.id && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingCatId(cat.id);
                              setEditingCatName(cat.name_ar);
                            }}
                            className="px-2.5 py-1 bg-stone-100 hover:bg-stone-200 text-stone-700 text-xs font-semibold rounded-lg cursor-pointer"
                          >
                            تعديل الاسم
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleToggleCategory(cat)}
                          className={`px-3 py-1 text-xs font-bold rounded-lg cursor-pointer ${
                            cat.is_active
                              ? 'bg-teal-50 text-teal-800'
                              : 'bg-stone-100 text-stone-500'
                          }`}
                        >
                          {cat.is_active ? 'مفعّل (اضغط للتعطيل)' : 'معطّل (اضغط للتفعيل)'}
                        </button>
                      </div>
                    </div>

                    {cat.subcategories.length > 0 && (
                      <div className="flex flex-wrap gap-2 pt-2 border-t border-stone-100">
                        {cat.subcategories.map((sub) => (
                          <button
                            key={sub.id}
                            type="button"
                            onClick={() =>
                              handleToggleSubcategory(cat.id, sub.id)
                            }
                            className={`px-3 py-1 rounded-lg border text-xs font-medium cursor-pointer ${
                              sub.is_active
                                ? 'bg-stone-50 border-stone-200 text-stone-800'
                                : 'bg-stone-100 border-stone-200 text-stone-400 line-through'
                            }`}
                          >
                            {sub.name_ar}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
