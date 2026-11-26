import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { Upload, X, ArrowRight, CheckCircle2 } from 'lucide-react';
import { uploadImages, ABU_JUBEIHA_AREAS } from '../lib/api';
import { createAd, fetchAdById, updateAd } from '../lib/firestoreApi';
import { useAuth } from '../context/AuthContext';
import type { AdType, AppRoute, Category } from '../types';

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

  const removeImage = (idx: number) => {
    setImages((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
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
        setSuccessMsg(res.message);
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
              disabled={submitting || uploading}
              className="flex-1 py-3 bg-teal-700 hover:bg-teal-800 text-white text-sm font-bold rounded-xl transition-colors disabled:opacity-60 cursor-pointer"
            >
              {submitting
                ? 'جاري الحفظ...'
                : isEditing
                ? 'حفظ التعديلات'
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
