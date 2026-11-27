import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { Upload, X, ArrowRight, CheckCircle2, Sparkles, Loader2 } from 'lucide-react';
import { uploadImages, ABU_JUBEIHA_AREAS } from '../lib/api';
import { auth } from '../lib/firebase';
import { createAd, createHeroPromotionRequest, fetchAdById, updateAd } from '../lib/firestoreApi';
import { useAuth } from '../context/AuthContext';
import type { Ad, AdType, AppRoute, Category } from '../types';

interface AdFormPageProps {
  categories: Category[];
  editAdId?: string;
  onNavigate: (route: AppRoute) => void;
  onSaved: () => void;
}

export function AdFormPage({
  categories,
  editAdId,
  onNavigate,
  onSaved,
}: AdFormPageProps) {
  const { user, loading: authLoading, refreshMe } = useAuth();
  const isEditing = Boolean(editAdId);

  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState<string>(categories[0]?.id ?? '');
  const [subcategoryId, setSubcategoryId] = useState<string>('');
  const [adType, setAdType] = useState<AdType>('offer');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [isNegotiable, setIsNegotiable] = useState(true);
  const [location, setLocation] = useState(user?.location || ABU_JUBEIHA_AREAS[0]);
  const [contactPhone, setContactPhone] = useState(user?.phone || '');
  const [contactWhatsapp, setContactWhatsapp] = useState(user?.phone || '');
  const [documentInfo, setDocumentInfo] = useState('');
  const [images, setImages] = useState<string[]>([]);

  const [loadingAd, setLoadingAd] = useState(isEditing);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Free / paid listing choice
  const [listingMode, setListingMode] = useState<'free' | 'paid'>('free');
  const [promoDays, setPromoDays] = useState<number>(7);
  const [promoPaymentMethod, setPromoPaymentMethod] = useState('بنكك');
  const [promoPaymentRef, setPromoPaymentRef] = useState('');
  const [promoReceiptUrl, setPromoReceiptUrl] = useState('');
  const [promoBannerUrl, setPromoBannerUrl] = useState('');
  const [uploadingPromo, setUploadingPromo] = useState(false);

  const [aiPrompt, setAiPrompt] = useState('');
  const [aiDrafting, setAiDrafting] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiSuccess, setAiSuccess] = useState('');

  useEffect(() => {
    if (!categoryId && categories.length > 0) {
      setCategoryId(categories[0].id);
    }
  }, [categories, categoryId]);

  useEffect(() => {
    if (!editAdId) return;
    setLoadingAd(true);
    fetchAdById(editAdId, user?.id)
      .then((ad) => {
        setTitle(ad.title);
        setCategoryId(ad.category_id);
        setSubcategoryId(ad.subcategory_id ? String(ad.subcategory_id) : '');
        setAdType(ad.ad_type);
        setDescription(ad.description);
        setPrice(ad.price ? String(ad.price) : '');
        setIsNegotiable(ad.is_negotiable);
        setLocation(ad.location);
        setContactPhone(ad.contact_phone);
        setContactWhatsapp(ad.contact_whatsapp);
        setDocumentInfo(ad.document_info || '');
        setImages(ad.images || []);
      })
      .catch((err) => setError(err.message || 'تعذر تحميل بيانات الإعلان'))
      .finally(() => setLoadingAd(false));
  }, [editAdId, user?.id]);

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
      <div className="max-w-lg mx-auto px-4 py-12 text-center space-y-4">
        <p className="font-bold text-stone-900">يرجى تسجيل الدخول لنشر أو تعديل الإعلانات</p>
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

  const activeCategory = categories.find((c) => c.id === categoryId);
  const showDocField =
    activeCategory &&
    ['land', 'properties-sale', 'properties-rent'].includes(activeCategory.slug);

  const handleImageUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    setError('');
    setUploading(true);
    try {
      const uploadedUrls = await uploadImages(e.target.files);
      setImages((prev) => [...prev, ...uploadedUrls].slice(0, 6));
    } catch (err: any) {
      setError(err.message || 'فشل رفع الصور');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handlePromoBannerUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    setError('');
    setUploadingPromo(true);
    try {
      // Banner is auto-cropped to a 4:3 frame so any image size/shape fits the home banner
      const urls = await uploadImages([e.target.files[0]], {
        aspect: 4 / 3,
        maxDim: 1280,
        force: true,
      });
      if (urls[0]) setPromoBannerUrl(urls[0]);
    } catch (err: any) {
      setError(err.message || 'تعذر رفع صورة البنر');
    } finally {
      setUploadingPromo(false);
      e.target.value = '';
    }
  };

  const handlePromoReceiptUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    setError('');
    setUploadingPromo(true);
    try {
      const urls = await uploadImages([e.target.files[0]]);
      if (urls[0]) setPromoReceiptUrl(urls[0]);
    } catch (err: any) {
      setError(err.message || 'تعذر رفع صورة الإيصال');
    } finally {
      setUploadingPromo(false);
      e.target.value = '';
    }
  };

  const removeImage = (idx: number) => {
    setImages((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleAiDraft = async () => {
    const prompt = aiPrompt.trim();
    if (prompt.length < 4) {
      setAiError('اكتب وصفاً مختصراً للسلعة أو الخدمة أولاً (مثل: موبايل سامسونج نظيف ب 300 ألف في حي المطار).');
      return;
    }
    setAiError('');
    setAiSuccess('');
    setAiDrafting(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) {
        throw new Error('يرجى تسجيل الدخول أولاً لاستخدام الصياغة الذكية.');
      }
      const resp = await fetch('/api/public/draft-ad', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          prompt,
          categories: categories.map((c) => ({
            slug: c.slug,
            name_ar: c.name_ar,
            subcategories: c.subcategories.map((s) => ({
              slug: s.slug,
              name_ar: s.name_ar,
            })),
          })),
        }),
      });
      const data = (await resp.json().catch(() => null)) as {
        draft?: {
          title?: string;
          description?: string;
          category_slug?: string;
          subcategory_slug?: string;
          ad_type?: AdType;
          price?: number;
          is_negotiable?: boolean;
          location?: string;
        };
        error?: string;
      } | null;

      if (!resp.ok || !data?.draft) {
        throw new Error(data?.error || 'تعذر توليد صياغة الإعلان حالياً، يرجى المحاولة بعد قليل.');
      }

      const d = data.draft;
      if (d.title) setTitle(d.title);
      if (d.description) setDescription(d.description);

      const matchedCat = categories.find((c) => c.slug === d.category_slug);
      if (matchedCat) {
        setCategoryId(matchedCat.id);
        const matchedSub = matchedCat.subcategories.find((s) => s.slug === d.subcategory_slug);
        setSubcategoryId(matchedSub ? matchedSub.id : '');
      }

      if (d.ad_type && ['offer', 'wanted', 'job', 'announcement'].includes(d.ad_type)) {
        setAdType(d.ad_type);
      }

      if (typeof d.price === 'number' && Number.isFinite(d.price)) {
        setPrice(d.price > 0 ? String(Math.round(d.price)) : '');
      }
      if (typeof d.is_negotiable === 'boolean') {
        setIsNegotiable(d.is_negotiable);
      }
      if (d.location && d.location.trim()) {
        setLocation(d.location.trim());
      }

      setAiSuccess('تمت صياغة الإعلان وتعبئة الحقول تلقائياً — يمكنك مراجعة التفاصيل وإضافة الصور قبل النشر.');
    } catch (err: unknown) {
      setAiError(err instanceof Error ? err.message : 'تعذر صياغة الإعلان حالياً.');
    } finally {
      setAiDrafting(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    if (!isEditing && listingMode === 'paid' && promoPaymentRef.trim().length < 3) {
      setError('يرجى إدخال رقم إشعار الدفع أو المرجع لإرسال طلب الإعلان المدفوع');
      return;
    }

    setSubmitting(true);

    try {
      const payload = {
        title: title.trim(),
        category_id: categoryId,
        subcategory_id: subcategoryId || null,
        ad_type: adType,
        description: description.trim(),
        price: price.trim() === '' ? 0 : Number(price),
        is_negotiable: isNegotiable,
        location: location.trim(),
        contact_phone: contactPhone.trim(),
        contact_whatsapp: (contactWhatsapp || contactPhone).trim(),
        document_info: documentInfo.trim(),
        images,
      };

      if (isEditing && editAdId) {
        const res = await updateAd(editAdId, user, categories, payload);
        setSuccessMsg(res.message);
      } else {
        const res = await createAd(user, categories, payload);
        if (listingMode === 'paid') {
          let promoNote = '';
          try {
            const adForPromo = {
              id: res.id,
              title: payload.title,
              price: payload.price,
              location: payload.location,
              images: payload.images,
            } as unknown as Ad;
            promoNote = await createHeroPromotionRequest(user, adForPromo, {
              package_days: promoDays,
              payment_method: promoPaymentMethod,
              payment_reference: promoPaymentRef.trim(),
              payment_receipt_url: promoReceiptUrl || undefined,
              banner_url: promoBannerUrl || undefined,
            });
          } catch (promoErr: any) {
            promoNote = `لكن تعذر إرسال طلب الإعلان المدفوع (${
              promoErr?.message || 'خطأ غير معروف'
            }). يمكنك إعادة المحاولة من صفحة "إعلاناتي".`;
          }
          setSuccessMsg(`${res.message}. ${promoNote}`);
        } else {
          setSuccessMsg(res.message);
        }
      }
      await refreshMe();
      onSaved();
    } catch (err: any) {
      setError(err.message || 'تعذر حفظ الإعلان');
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingAd) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10">
        <div className="h-96 bg-white border border-stone-200 rounded-2xl animate-pulse" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-extrabold text-stone-900">
            {isEditing ? 'تعديل الإعلان' : 'نشر إعلان جديد في سوق أبو جبيهة'}
          </h1>
          <p className="text-sm text-stone-500 mt-1">
            أدخل بيانات واضحة وصوراً حقيقية لزيادة فرص التواصل السريع
          </p>
        </div>
        <button
          type="button"
          onClick={() => onNavigate({ page: 'account', tab: 'my-ads' })}
          className="text-sm font-semibold text-stone-600 hover:text-stone-900 flex items-center gap-1 cursor-pointer"
        >
          <ArrowRight className="w-4 h-4" />
          <span>إعلاناتي</span>
        </button>
      </div>

      {successMsg ? (
        <div className="bg-white border border-teal-200 rounded-2xl p-8 text-center space-y-4">
          <CheckCircle2 className="w-12 h-12 text-teal-700 mx-auto" />
          <h2 className="font-display text-xl font-bold text-stone-900">{successMsg}</h2>
          <p className="text-sm text-stone-600">
            يمكنك متابعة حالة الإعلان أو تعديله في أي وقت من صفحة "إعلاناتي".
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <button
              type="button"
              onClick={() => onNavigate({ page: 'account', tab: 'my-ads' })}
              className="px-5 py-2.5 bg-teal-700 text-white text-sm font-semibold rounded-lg cursor-pointer"
            >
              إدارة إعلاناتي
            </button>
            <button
              type="button"
              onClick={() => onNavigate({ page: 'home' })}
              className="px-5 py-2.5 bg-stone-100 text-stone-800 text-sm font-semibold rounded-lg cursor-pointer"
            >
              العودة للرئيسية
            </button>
          </div>
        </div>
      ) : (
        <form
          onSubmit={handleSubmit}
          className="bg-white border border-stone-200 rounded-2xl p-6 sm:p-8 space-y-5"
        >
          {error && (
            <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-800">
              {error}
            </div>
          )}

          {!isEditing && (
            <div className="bg-teal-50/70 border border-teal-200 rounded-2xl p-4 sm:p-5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-teal-700 text-white flex items-center justify-center shrink-0">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-stone-900">
                      كتابة الإعلان بالذكاء الاصطناعي
                    </h2>
                    <p className="text-xs text-stone-600">
                      اكتب وصفاً مختصراً بلهجتك (السلعة، السعر، الحي، الحالة) وسيقوم المساعد بصياغة الإعلان وتحديد القسم تلقائياً
                    </p>
                  </div>
                </div>
              </div>

              <textarea
                rows={2}
                maxLength={1000}
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="مثال: عندي لابتوب ديل i5 رام 16 نظيف جداً في حي المطار ب 650 ألف قابل للتفاوض"
                className="w-full px-3.5 py-2.5 bg-white border border-teal-200 rounded-xl text-sm focus:outline-none focus:border-teal-700"
              />

              {aiError && (
                <p className="text-xs font-medium text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                  {aiError}
                </p>
              )}
              {aiSuccess && (
                <p className="text-xs font-medium text-teal-800 bg-white border border-teal-200 rounded-lg px-3 py-2">
                  {aiSuccess}
                </p>
              )}

              <div className="flex items-center justify-end">
                <button
                  type="button"
                  disabled={aiDrafting}
                  onClick={() => void handleAiDraft()}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white text-xs sm:text-sm font-bold rounded-lg transition-colors cursor-pointer"
                >
                  {aiDrafting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>جاري صياغة الإعلان...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      <span>صياغة الإعلان بالذكاء الاصطناعي</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Free / Paid listing choice */}
          {!isEditing && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setListingMode('free')}
                  className={`py-2.5 rounded-xl text-sm font-bold border transition-colors cursor-pointer ${
                    listingMode === 'free'
                      ? 'bg-teal-700 border-teal-700 text-white'
                      : 'bg-white border-stone-200 text-stone-700 hover:bg-stone-50'
                  }`}
                >
                  إضافة إعلان مجاني
                </button>
                <button
                  type="button"
                  onClick={() => setListingMode('paid')}
                  className={`py-2.5 rounded-xl text-sm font-bold border transition-colors cursor-pointer ${
                    listingMode === 'paid'
                      ? 'bg-amber-400 border-amber-400 text-stone-950'
                      : 'bg-white border-stone-200 text-stone-700 hover:bg-stone-50'
                  }`}
                >
                  إضافة إعلان مدفوع
                </button>
              </div>

              {listingMode === 'paid' && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 sm:p-5 space-y-4">
                  <p className="text-xs text-stone-700 leading-relaxed">
                    يظهر إعلانك في البنر الرئيسي بالتناوب التلقائي كل 5 ثوانٍ مع علامة «إعلان مميز مدفوع»،
                    ويُفعَّل بعد مراجعة الدفع.
                  </p>

                  <div>
                    <label className="block text-xs font-bold text-stone-800 mb-1.5">
                      اختر الباقة
                    </label>
                    <select
                      value={promoDays}
                      onChange={(e) => setPromoDays(Number(e.target.value))}
                      className="w-full px-3 py-2.5 bg-white border border-stone-200 rounded-xl text-sm"
                    >
                      <option value={3}>3 أيام — 5,000 ج.س</option>
                      <option value={7}>7 أيام — 10,000 ج.س</option>
                      <option value={14}>14 يوم — 18,000 ج.س</option>
                      <option value={30}>30 يوم — 30,000 ج.س</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-stone-800 mb-1.5">
                      طريقة الدفع
                    </label>
                    <select
                      value={promoPaymentMethod}
                      onChange={(e) => setPromoPaymentMethod(e.target.value)}
                      className="w-full px-3 py-2.5 bg-white border border-stone-200 rounded-xl text-sm"
                    >
                      <option value="بنكك">تطبيق بنكك (Bankak)</option>
                      <option value="فوري">فوري (Fawry)</option>
                      <option value="أوكاش">أوكاش (O-Cash)</option>
                      <option value="دفع مباشر للإدارة">دفع مباشر لإدارة السوق في أبو جبيهة</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-stone-800 mb-1.5">
                      رقم إشعار الدفع أو المرجع *
                    </label>
                    <input
                      type="text"
                      value={promoPaymentRef}
                      onChange={(e) => setPromoPaymentRef(e.target.value)}
                      placeholder="أدخل رقم العملية أو اسم المحول لتأكيد الطلب"
                      className="w-full px-3.5 py-2.5 bg-white border border-stone-200 rounded-xl text-sm focus:outline-none focus:border-teal-700"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-stone-800 mb-1.5">
                      صورة البنر (اختياري — تُقص تلقائياً لتناسب البنر)
                    </label>
                    <div className="flex items-center gap-3">
                      <label className="px-3.5 py-2 bg-white hover:bg-stone-100 border border-stone-200 text-stone-800 text-xs font-semibold rounded-xl inline-flex items-center gap-2 cursor-pointer">
                        <Upload className="w-4 h-4" />
                        <span>{uploadingPromo ? 'جاري الرفع...' : 'اختيار صورة البنر'}</span>
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          onChange={handlePromoBannerUpload}
                          disabled={uploadingPromo}
                          className="hidden"
                        />
                      </label>
                      {promoBannerUrl && (
                        <img
                          src={promoBannerUrl}
                          alt="صورة البنر"
                          referrerPolicy="no-referrer"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                          }}
                          className="w-16 h-12 rounded-lg object-cover border border-stone-200"
                        />
                      )}
                    </div>
                    <p className="text-[11px] text-stone-500 mt-1">
                      إن لم تختر صورة، تُستخدم أول صورة من صور الإعلان.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-stone-800 mb-1.5">
                      صورة إيصال التحويل (اختياري — يُسرّع المراجعة)
                    </label>
                    <div className="flex items-center gap-3">
                      <label className="px-3.5 py-2 bg-white hover:bg-stone-100 border border-stone-200 text-stone-800 text-xs font-semibold rounded-xl inline-flex items-center gap-2 cursor-pointer">
                        <Upload className="w-4 h-4" />
                        <span>{uploadingPromo ? 'جاري الرفع...' : 'إرفاق صورة الإيصال'}</span>
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          onChange={handlePromoReceiptUpload}
                          disabled={uploadingPromo}
                          className="hidden"
                        />
                      </label>
                      {promoReceiptUrl && (
                        <img
                          src={promoReceiptUrl}
                          alt="إيصال التحويل"
                          referrerPolicy="no-referrer"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                          }}
                          className="w-12 h-12 rounded-lg object-cover border border-stone-200"
                        />
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Title */}
          <div>
            <label className="block text-xs font-bold text-stone-800 mb-1.5">
              عنوان الإعلان *
            </label>
            <input
              type="text"
              required
              minLength={4}
              maxLength={140}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="مثال: هاتف سامسونج A54 نظيف، أو منزل للإيجار في حي المطار"
              className="w-full px-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:outline-none focus:border-teal-700"
            />
          </div>

          {/* Category & Subcategory */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-stone-800 mb-1.5">
                القسم الرئيسي *
              </label>
              <select
                required
                value={categoryId}
                onChange={(e) => {
                  const nextId = e.target.value;
                  setCategoryId(nextId);
                  setSubcategoryId('');
                  const cat = categories.find((c) => c.id === nextId);
                  if (cat?.slug === 'wanted') setAdType('wanted');
                  else if (cat?.slug === 'jobs') setAdType('job');
                  else if (cat?.slug === 'community') setAdType('announcement');
                  else setAdType('offer');
                }}
                className="w-full px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:outline-none focus:border-teal-700"
              >
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name_ar}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-stone-800 mb-1.5">
                القسم الفرعي
              </label>
              <select
                value={subcategoryId}
                onChange={(e) => setSubcategoryId(e.target.value)}
                disabled={!activeCategory || activeCategory.subcategories.length === 0}
                className="w-full px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm disabled:opacity-50 focus:outline-none focus:border-teal-700"
              >
                <option value="">اختياري — حدد القسم الفرعي</option>
                {activeCategory?.subcategories.map((sub) => (
                  <option key={sub.id} value={sub.id}>
                    {sub.name_ar}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-bold text-stone-800 mb-1.5">
              الوصف التفصيلي *
            </label>
            <textarea
              required
              minLength={10}
              maxLength={4000}
              rows={5}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="اكتب كافة التفاصيل المهمة: الحالة، المواصفات، المساحة، شروط العمل أو التوصيل..."
              className="w-full px-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:outline-none focus:border-teal-700"
            />
          </div>

          {/* Price & Negotiable */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
            <div>
              <label className="block text-xs font-bold text-stone-800 mb-1.5">
                السعر بالجنيه السوداني (SDG)
              </label>
              <input
                type="number"
                min={0}
                step="any"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="مثال: 450000 (اتركه 0 للوظائف أو الإعلانات العامة)"
                className="w-full px-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm tabular-nums focus:outline-none focus:border-teal-700"
              />
            </div>

            <label className="flex items-center gap-2.5 py-2.5 px-3.5 bg-stone-50 border border-stone-200 rounded-xl cursor-pointer">
              <input
                type="checkbox"
                checked={isNegotiable}
                onChange={(e) => setIsNegotiable(e.target.checked)}
                className="w-4 h-4 accent-teal-700"
              />
              <span className="text-sm font-medium text-stone-800">السعر قابل للتفاوض</span>
            </label>
          </div>

          {/* Document info for Land / Property */}
          {showDocField && (
            <div>
              <label className="block text-xs font-bold text-stone-800 mb-1.5">
                معلومات المستندات والمساحة (للعقارات والأراضي)
              </label>
              <input
                type="text"
                value={documentInfo}
                onChange={(e) => setDocumentInfo(e.target.value)}
                placeholder="مثال: شهادة بحث رسمية - مساحة 400 متر مربع - خالية من النزاعات"
                className="w-full px-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:outline-none focus:border-teal-700"
              />
            </div>
          )}

          {/* Location & Contact Info */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-bold text-stone-800 mb-1.5">
                المنطقة / الحي *
              </label>
              <input
                type="text"
                list="abu-jubeiha-areas"
                required
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="أبو جبيهة - حي المطار"
                className="w-full px-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:outline-none focus:border-teal-700"
              />
              <datalist id="abu-jubeiha-areas">
                {ABU_JUBEIHA_AREAS.map((area) => (
                  <option key={area} value={area} />
                ))}
              </datalist>
            </div>

            <div>
              <label className="block text-xs font-bold text-stone-800 mb-1.5">
                رقم الهاتف للاتصال *
              </label>
              <input
                type="tel"
                required
                dir="ltr"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                placeholder="+2499..."
                className="w-full px-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm text-left focus:outline-none focus:border-teal-700"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-stone-800 mb-1.5">
                رقم الواتساب (اختياري)
              </label>
              <input
                type="tel"
                dir="ltr"
                value={contactWhatsapp}
                onChange={(e) => setContactWhatsapp(e.target.value)}
                placeholder="+2499..."
                className="w-full px-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm text-left focus:outline-none focus:border-teal-700"
              />
            </div>
          </div>

          {/* Multiple Image Upload */}
          <div className="space-y-3">
            <label className="block text-xs font-bold text-stone-800">
              صور الإعلان (حتى 6 صور)
            </label>

            <label className="border-2 border-dashed border-stone-300 hover:border-teal-700 rounded-xl p-6 flex flex-col items-center justify-center text-center cursor-pointer transition-colors bg-stone-50">
              <Upload className="w-6 h-6 text-teal-700 mb-2" />
              <span className="text-sm font-semibold text-stone-800">
                {uploading ? 'جاري رفع الصور...' : 'اضغط لاختيار عدة صور من جهازك'}
              </span>
              <span className="text-xs text-stone-500 mt-1">
                JPG, PNG, WebP (بحد أقصى 5 ميجابايت للصورة)
              </span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                multiple
                disabled={uploading || images.length >= 6}
                onChange={handleImageUpload}
                className="hidden"
              />
            </label>

            {images.length > 0 && (
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
                {images.map((url, idx) => (
                  <div
                    key={url + idx}
                    className="relative aspect-square rounded-xl overflow-hidden border border-stone-200 bg-stone-100"
                  >
                    <img
                      src={url}
                      alt={`صورة ${idx + 1}`}
                      referrerPolicy="no-referrer"
                      onError={(e) => {
                        e.currentTarget.style.opacity = '0.2';
                      }}
                      className="w-full h-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removeImage(idx)}
                      aria-label="حذف الصورة"
                      className="absolute top-1 left-1 w-6 h-6 rounded-full bg-stone-900/80 text-white flex items-center justify-center hover:bg-rose-700 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="pt-2 flex items-center gap-3">
            <button
              type="submit"
              disabled={submitting || uploading || uploadingPromo}
              className="flex-1 py-3 bg-teal-700 hover:bg-teal-800 text-white text-sm font-bold rounded-xl transition-colors disabled:opacity-60 cursor-pointer"
            >
              {submitting
                ? 'جاري الحفظ...'
                : isEditing
                ? 'حفظ التعديلات'
                : listingMode === 'paid'
                ? 'نشر الإعلان وإرسال طلب التمييز'
                : 'نشر الإعلان الآن'}
            </button>
            <button
              type="button"
              onClick={() => onNavigate({ page: 'home' })}
              className="px-5 py-3 bg-stone-100 hover:bg-stone-200 text-stone-700 text-sm font-semibold rounded-xl cursor-pointer"
            >
              إلغاء
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
