import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type QuerySnapshot,
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from './firebase';
import {
  BOOTSTRAP_ADMIN_EMAILS,
  checkProhibitedContent,
  DEFAULT_CATEGORIES_SEED,
  matchesSearchTokens,
  normalizeSearchText,
} from './marketplaceSearch';
import type {
  Ad,
  AdminOverview,
  AdStatus,
  AdType,
  AppNotification,
  Category,
  ChatMessage,
  Conversation,
  HeroPromotion,
  NewAdAlert,
  NotificationType,
  ReportItem,
  User,
  UserRole,
} from '../types';

const HERO_PACKAGES: Record<number, number> = {
  3: 5000,
  7: 10000,
  14: 18000,
  30: 30000,
};

function clampStr(val: unknown, maxLen: number): string {
  return String(val ?? '').trim().slice(0, maxLen);
}

function toIsoString(val: unknown): string {
  if (!val) return '';
  if (val instanceof Timestamp) return val.toDate().toISOString();
  if (typeof val === 'object' && val !== null && 'toDate' in val && typeof (val as any).toDate === 'function') {
    return (val as any).toDate().toISOString();
  }
  return String(val);
}

function generateId(prefix = ''): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '')
      : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  return prefix ? `${prefix}_${rand}` : rand;
}

function slugifyId(input: string): string {
  const ascii = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return ascii || `cat_${Date.now()}`;
}

export async function logAuditAction(
  actorId: string,
  actorName: string,
  action: string,
  targetInfo = ''
): Promise<void> {
  const id = generateId('log');
  const path = `auditLogs/${id}`;
  try {
    await setDoc(doc(db, 'auditLogs', id), {
      actorId: clampStr(actorId, 128),
      actorName: clampStr(actorName || 'الإدارة', 80),
      action: clampStr(action, 160),
      targetInfo: clampStr(targetInfo, 300),
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

function mapCategoryDoc(id: string, data: any, adsCount = 0): Category {
  const subs = Array.isArray(data.subcategories) ? data.subcategories : [];
  return {
    id,
    slug: String(data.slug || id),
    name_ar: String(data.nameAr || ''),
    icon: String(data.icon || 'Package'),
    sort_order: Number(data.sortOrder ?? 0),
    is_active: Boolean(data.isActive ?? true),
    ads_count: adsCount,
    subcategories: subs.map((s: any, idx: number) => ({
      id: String(s.id || s.slug || `sub_${idx}`),
      category_id: id,
      slug: String(s.slug || s.id || ''),
      name_ar: String(s.nameAr || ''),
      sort_order: Number(s.sortOrder ?? idx + 1),
      is_active: Boolean(s.isActive ?? true),
    })),
  };
}

function mapAdDoc(id: string, data: any, favSet?: Set<string>): Ad {
  const images = Array.isArray(data.images) ? data.images.map(String) : [];
  return {
    id,
    user_id: String(data.ownerId || ''),
    category_id: String(data.categoryId || ''),
    subcategory_id: data.subcategorySlug ? String(data.subcategorySlug) : null,
    category_name: String(data.categoryName || ''),
    category_slug: String(data.categorySlug || ''),
    subcategory_name: data.subcategoryName ? String(data.subcategoryName) : null,
    subcategory_slug: data.subcategorySlug ? String(data.subcategorySlug) : null,
    title: String(data.title || ''),
    description: String(data.description || ''),
    price: Number(data.price ?? 0),
    is_negotiable: Boolean(data.isNegotiable),
    ad_type: (data.adType || 'offer') as AdType,
    location: String(data.location || ''),
    contact_phone: String(data.contactPhone || ''),
    contact_whatsapp: String(data.contactWhatsapp || ''),
    document_info: String(data.documentInfo || ''),
    has_verified_docs: Boolean(data.hasVerifiedDocs),
    status: (data.status || 'pending') as AdStatus,
    rejection_reason: String(data.rejectionReason || ''),
    is_featured: Boolean(data.isFeatured),
    is_sample: Boolean(data.isSample),
    views_count: Number(data.viewsCount ?? 0),
    created_at: toIsoString(data.createdAt),
    updated_at: toIsoString(data.updatedAt),
    owner_name: String(data.ownerName || 'معلن'),
    owner_avatar: String(data.ownerAvatar || ''),
    owner_verified: Boolean(data.ownerVerified),
    images,
    is_favorited: favSet ? favSet.has(id) : false,
  };
}

function mapHeroDoc(id: string, data: any): HeroPromotion {
  return {
    id,
    ad_id: data.adId ? String(data.adId) : null,
    user_id: String(data.userId || ''),
    title: String(data.title || ''),
    subtitle: String(data.subtitle || ''),
    image_url: String(data.imageUrl || ''),
    price_label: String(data.priceLabel || ''),
    location_label: String(data.locationLabel || ''),
    package_days: Number(data.packageDays ?? 7),
    amount_sdg: Number(data.amountSdg ?? 0),
    payment_method: String(data.paymentMethod || ''),
    payment_reference: String(data.paymentReference || ''),
    payment_receipt_url: String(data.paymentReceiptUrl || ''),
    status: data.status || 'pending',
    sort_order: Number(data.sortOrder ?? 1),
    is_sample: Boolean(data.isSample),
    starts_at: String(data.startsAt || ''),
    expires_at: String(data.expiresAt || ''),
    admin_note: String(data.adminNote || ''),
    created_at: toIsoString(data.createdAt),
    owner_name: String(data.ownerName || ''),
  };
}

// ==================== INITIALIZATION / CATEGORIES ====================

export async function seedDefaultCategoriesIfEmpty(): Promise<void> {
  try {
    const snap = await getDocs(collection(db, 'categories'));
    if (!snap.empty) return;
    const batch = writeBatch(db);
    for (const cat of DEFAULT_CATEGORIES_SEED) {
      batch.set(doc(db, 'categories', cat.id), {
        slug: cat.slug,
        nameAr: cat.nameAr,
        icon: cat.icon,
        sortOrder: cat.sortOrder,
        isActive: true,
        subcategories: cat.subcategories.map((s, idx) => ({
          id: s.id,
          slug: s.slug,
          nameAr: s.nameAr,
          sortOrder: idx + 1,
          isActive: true,
        })),
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'categories');
  }
}

export async function seedSampleListingsInFirestore(
  adminUid: string,
  adminName: string
): Promise<number> {
  invalidateApprovedAdsCache();
  try {
    await seedDefaultCategoriesIfEmpty();
    const existingAds = await getDocs(collection(db, 'ads'));
    if (!existingAds.empty) return 0;

    const batch = writeBatch(db);
    const sampleAds = [
      {
        id: 'sample_ad_1',
        categoryId: 'phones-electronics',
        categorySlug: 'phones-electronics',
        categoryName: 'الهواتف والإلكترونيات',
        subcategorySlug: 'mobile-phones',
        subcategoryName: 'هواتف محمولة',
        title: 'سامسونج جلاكسي S23 بحالة ممتازة - 256 جيجا',
        description:
          'هاتف Samsung Galaxy S23 نظيف جداً، استخدام خفيف في أبو جبيهة، الذاكرة 256 جيجا، البطارية تدوم طوال اليوم، مع الشاحن الأصلي والعلبة.',
        price: 1150000,
        isNegotiable: true,
        adType: 'offer',
        location: 'أبو جبيهة - السوق الكبير',
        contactPhone: '+249912345601',
        contactWhatsapp: '+249912345601',
        documentInfo: '',
        hasVerifiedDocs: false,
        isFeatured: true,
        images: ['/src/assets/images/sample_smartphone_1795626052495.jpg'],
      },
      {
        id: 'sample_ad_2',
        categoryId: 'properties-sale',
        categorySlug: 'properties-sale',
        categoryName: 'عقارات للبيع',
        subcategorySlug: 'houses-sale',
        subcategoryName: 'منازل',
        title: 'منزل سكني حديث في حي المطار مساحة 400 متر',
        description:
          'منزل مشيد بالطوب الأحمر والأسمنت، يتكون من 3 غرف نوم وصالة كبيرة ومطبخ وحمامين وفناء واسع به شجرة نيم وظل. قريب من الطريق الرئيسي والخدمات.',
        price: 48000000,
        isNegotiable: true,
        adType: 'offer',
        location: 'أبو جبيهة - حي المطار',
        contactPhone: '+249912345602',
        contactWhatsapp: '+249912345602',
        documentInfo: 'شهادة بحث رسمية - درجة ثالثة - خالية من النزاعات',
        hasVerifiedDocs: true,
        isFeatured: true,
        images: ['/src/assets/images/sample_house_1795626053999.jpg'],
      },
      {
        id: 'sample_ad_3',
        categoryId: 'cars-transport',
        categorySlug: 'cars-transport',
        categoryName: 'السيارات والمواصلات',
        subcategorySlug: 'cars',
        subcategoryName: 'سيارات',
        title: 'تويوتا هايلوكس دبل كاب موديل 2020 نظيفة',
        description:
          'عربة Toyota Hilux دبل كاب جاز بحالة ميكانيكية ممتازة، تكييف ثلاجة، إطارات جديدة، جاهزة للسفر والعمل داخل وخارج أبو جبيهة.',
        price: 36500000,
        isNegotiable: true,
        adType: 'offer',
        location: 'أبو جبيهة - موقف السيارات',
        contactPhone: '+249912345601',
        contactWhatsapp: '+249912345601',
        documentInfo: '',
        hasVerifiedDocs: false,
        isFeatured: true,
        images: ['/src/assets/images/sample_vehicle_1795626053840.jpg'],
      },
      {
        id: 'sample_ad_4',
        categoryId: 'agriculture-livestock',
        categorySlug: 'agriculture-livestock',
        categoryName: 'الزراعة والثروة الحيوانية',
        subcategorySlug: 'agricultural-crops',
        subcategoryName: 'محاصيل زراعية',
        title: 'سمسم أبيض وذرة فتريتة إنتاج الموسم الجديد',
        description:
          'متوفر 50 جوال سمسم أبيض نقي ومغربل + 80 جوال ذرة فتريتة درجة أولى من مزارع جنوب كردفان، السعر للجوال الواحد مع إمكانية التوصيل داخل أبو جبيهة.',
        price: 145000,
        isNegotiable: true,
        adType: 'offer',
        location: 'أبو جبيهة - سوق المحاصيل',
        contactPhone: '+249912345603',
        contactWhatsapp: '+249912345603',
        documentInfo: '',
        hasVerifiedDocs: false,
        isFeatured: true,
        images: ['/src/assets/images/sample_crops_1795626054031.jpg'],
      },
      {
        id: 'sample_ad_5',
        categoryId: 'furniture-home',
        categorySlug: 'furniture-home',
        categoryName: 'الأثاث ومستلزمات المنزل',
        subcategorySlug: 'new-used-furniture',
        subcategoryName: 'أثاث جديد ومستعمل',
        title: 'طقم جلوس خشب مهوقني طبيعي 7 مقاعد مع طربيزة',
        description:
          'طقم صالون متين مصنوع من خشب المهوقني عالي الجودة مع تنجيد كتان مريح وطربيزة وسط محفورة. بحالة شبه جديدة.',
        price: 1250000,
        isNegotiable: true,
        adType: 'offer',
        location: 'أبو جبيهة - حي السلام',
        contactPhone: '+249912345602',
        contactWhatsapp: '+249912345602',
        documentInfo: '',
        hasVerifiedDocs: false,
        isFeatured: false,
        images: ['/src/assets/images/sample_furniture_1795626054149.jpg'],
      },
    ];

    for (const item of sampleAds) {
      batch.set(doc(db, 'ads', item.id), {
        ownerId: adminUid,
        ownerName: adminName || 'إدارة سوق أبو جبيهة',
        ownerAvatar: '',
        ownerVerified: true,
        categoryId: item.categoryId,
        categorySlug: item.categorySlug,
        categoryName: item.categoryName,
        subcategorySlug: item.subcategorySlug,
        subcategoryName: item.subcategoryName,
        title: item.title,
        description: item.description,
        price: item.price,
        isNegotiable: item.isNegotiable,
        adType: item.adType,
        location: item.location,
        contactPhone: item.contactPhone,
        contactWhatsapp: item.contactWhatsapp,
        documentInfo: item.documentInfo,
        hasVerifiedDocs: item.hasVerifiedDocs,
        status: 'approved',
        rejectionReason: '',
        isFeatured: item.isFeatured,
        isSample: true,
        viewsCount: 25,
        images: item.images,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    sampleAds
      .filter((s) => s.isFeatured)
      .forEach((s, idx) => {
        batch.set(doc(db, 'heroPromotions', `sample_hero_${idx + 1}`), {
          adId: s.id,
          userId: adminUid,
          ownerName: adminName || 'إدارة سوق أبو جبيهة',
          title: s.title,
          subtitle: 'إعلان مميز في واجهة سوق أبو جبيهة',
          imageUrl: s.images[0],
          priceLabel: `${new Intl.NumberFormat('en-US').format(s.price)} ج.س`,
          locationLabel: s.location,
          packageDays: 30,
          amountSdg: 30000,
          paymentMethod: 'بنكك',
          paymentReference: 'DEMO-HERO',
          status: 'active',
          sortOrder: idx + 1,
          isSample: true,
          startsAt: new Date().toISOString(),
          expiresAt,
          adminNote: '',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });

    await batch.commit();
    return sampleAds.length;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'ads');
  }
}

// Short-lived shared cache of the approved-ads snapshot so that fetchCategories and
// fetchAds (called together on every load) do not each re-read every approved ad.
const APPROVED_ADS_TTL_MS = 15_000;
let approvedAdsCache: {
  at: number;
  promise: Promise<QuerySnapshot<DocumentData>>;
} | null = null;

export function invalidateApprovedAdsCache(): void {
  approvedAdsCache = null;
}

function getApprovedAdsSnapshot(): Promise<QuerySnapshot<DocumentData>> {
  const now = Date.now();
  if (approvedAdsCache && now - approvedAdsCache.at < APPROVED_ADS_TTL_MS) {
    return approvedAdsCache.promise;
  }
  const promise = getDocs(query(collection(db, 'ads'), where('status', '==', 'approved')));
  const entry = { at: now, promise };
  approvedAdsCache = entry;
  promise.catch(() => {
    if (approvedAdsCache === entry) approvedAdsCache = null;
  });
  return promise;
}

export async function fetchCategories(includeInactive = false): Promise<Category[]> {
  try {
    const q = includeInactive
      ? collection(db, 'categories')
      : query(collection(db, 'categories'), where('isActive', '==', true));
    const [catSnap, adsSnap] = await Promise.all([
      getDocs(q),
      getApprovedAdsSnapshot(),
    ]);

    const counts = new Map<string, number>();
    adsSnap.forEach((d) => {
      const catId = String(d.data().categoryId || '');
      counts.set(catId, (counts.get(catId) ?? 0) + 1);
    });

    if (catSnap.empty) {
      return DEFAULT_CATEGORIES_SEED.map((c) => ({
        id: c.id,
        slug: c.slug,
        name_ar: c.nameAr,
        icon: c.icon,
        sort_order: c.sortOrder,
        is_active: true,
        ads_count: counts.get(c.id) ?? 0,
        subcategories: c.subcategories.map((s, idx) => ({
          id: s.id,
          category_id: c.id,
          slug: s.slug,
          name_ar: s.nameAr,
          sort_order: idx + 1,
          is_active: true,
        })),
      }));
    }

    const categories: Category[] = [];
    catSnap.forEach((docSnap) => {
      const cat = mapCategoryDoc(docSnap.id, docSnap.data(), counts.get(docSnap.id) ?? 0);
      if (!includeInactive) {
        cat.subcategories = cat.subcategories.filter((s) => s.is_active);
      }
      categories.push(cat);
    });
    return categories.sort((a, b) => a.sort_order - b.sort_order);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'categories');
  }
}

// ==================== ADS QUERIES & MUTATIONS ====================

export async function fetchFavoriteIds(uid: string): Promise<Set<string>> {
  if (!uid) return new Set();
  try {
    const snap = await getDocs(query(collection(db, 'favorites'), where('userId', '==', uid)));
    const set = new Set<string>();
    snap.forEach((d) => {
      const adId = d.data().adId;
      if (adId) set.add(String(adId));
    });
    return set;
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'favorites');
  }
}

export async function fetchAds(
  filters: {
    q?: string;
    category?: string;
    subcategory?: string;
    location?: string;
    minPrice?: string;
    maxPrice?: string;
    adType?: string;
    sort?: string;
    userId?: string;
    mine?: boolean;
    includeAll?: boolean;
    status?: string;
  } = {},
  currentUid?: string
): Promise<Ad[]> {
  try {
    let adsQuery;
    if (filters.mine && currentUid) {
      adsQuery = query(collection(db, 'ads'), where('ownerId', '==', currentUid));
    } else if (filters.includeAll) {
      adsQuery = collection(db, 'ads');
    } else {
      adsQuery = query(collection(db, 'ads'), where('status', '==', 'approved'));
    }

    const useApprovedCache = !(filters.mine && currentUid) && !filters.includeAll;
    const [snap, favSet] = await Promise.all([
      useApprovedCache ? getApprovedAdsSnapshot() : getDocs(adsQuery),
      currentUid ? fetchFavoriteIds(currentUid) : Promise.resolve(new Set<string>()),
    ]);

    let list: Ad[] = [];
    snap.forEach((d) => {
      list.push(mapAdDoc(d.id, d.data(), favSet));
    });

    if (filters.status) {
      list = list.filter((a) => a.status === filters.status);
    }
    if (filters.userId) {
      list = list.filter((a) => a.user_id === filters.userId);
    }
    if (filters.category) {
      list = list.filter(
        (a) => a.category_slug === filters.category || a.category_id === filters.category
      );
    }
    if (filters.subcategory) {
      list = list.filter(
        (a) =>
          a.subcategory_slug === filters.subcategory ||
          a.subcategory_id === filters.subcategory
      );
    }
    if (filters.adType) {
      list = list.filter((a) => a.ad_type === filters.adType);
    }
    if (filters.location) {
      const normLoc = normalizeSearchText(filters.location);
      list = list.filter((a) => normalizeSearchText(a.location).includes(normLoc));
    }
    if (filters.minPrice) {
      const min = Number(filters.minPrice);
      if (!Number.isNaN(min)) list = list.filter((a) => a.price >= min);
    }
    if (filters.maxPrice) {
      const max = Number(filters.maxPrice);
      if (!Number.isNaN(max)) list = list.filter((a) => a.price <= max);
    }
    if (filters.q) {
      list = list.filter((a) =>
        matchesSearchTokens(
          [
            a.title,
            a.description,
            a.location,
            a.category_name,
            a.subcategory_name || '',
            a.document_info || '',
          ],
          filters.q!
        )
      );
    }

    const sortMode = filters.sort || 'latest';
    list.sort((a, b) => {
      if (sortMode === 'price_asc') return a.price - b.price;
      if (sortMode === 'price_desc') return b.price - a.price;
      if (sortMode === 'popular') return b.views_count - a.views_count;
      return b.created_at.localeCompare(a.created_at);
    });

    return list;
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'ads');
  }
}

export async function fetchAdById(adId: string, currentUid?: string): Promise<Ad> {
  const path = `ads/${adId}`;
  try {
    const [snap, favSet] = await Promise.all([
      getDoc(doc(db, 'ads', adId)),
      currentUid ? fetchFavoriteIds(currentUid) : Promise.resolve(new Set<string>()),
    ]);
    if (!snap.exists()) {
      throw new Error('الإعلان غير موجود أو تم حذفه');
    }
    return mapAdDoc(snap.id, snap.data(), favSet);
  } catch (err) {
    if (err instanceof Error && err.message === 'الإعلان غير موجود أو تم حذفه') throw err;
    handleFirestoreError(err, OperationType.GET, path);
  }
}

async function notifySanadWebhook(payload: {
  event: "new_ad" | "new_hero" | "new_report";
  id?: string;
  title?: string;
  category?: string;
  price?: number;
  owner_name?: string;
  ad_type?: string;
  reason?: string;
  image_url?: string;
  receipt_url?: string;
  contact?: string;
  message?: string;
}): Promise<void> {
  try {
    const token = await auth.currentUser?.getIdToken().catch(() => null);
    if (!token) return;
    await fetch("/api/sanad/notify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    // non-blocking webhook notification
  }
}

export async function createAd(
  user: User,
  categories: Category[],
  payload: {
    title: string;
    category_id: string;
    subcategory_id: string | null;
    ad_type: AdType;
    description: string;
    price: number;
    is_negotiable: boolean;
    location: string;
    contact_phone: string;
    contact_whatsapp: string;
    document_info: string;
    images: string[];
  }
): Promise<{ id: string; message: string }> {
  invalidateApprovedAdsCache();
  const prohibited = checkProhibitedContent(`${payload.title} ${payload.description}`);
  if (prohibited) {
    throw new Error(`يحتوي الإعلان على مصطلح غير مسموح به (${prohibited})`);
  }

  if (user.role === 'admin') {
    await seedDefaultCategoriesIfEmpty();
  }
  const cat = categories.find((c) => c.id === payload.category_id);
  if (!cat) {
    throw new Error('يرجى اختيار قسم رئيسي صحيح');
  }
  const sub = cat.subcategories.find(
    (s) => s.id === payload.subcategory_id || s.slug === payload.subcategory_id
  );

  const id = generateId('ad');
  const path = `ads/${id}`;
  const isStaff = user.role === 'admin' || user.role === 'moderator';
  try {
    await setDoc(doc(db, 'ads', id), {
      ownerId: clampStr(user.id, 128),
      ownerName: clampStr(user.name, 80),
      ownerAvatar: clampStr(user.avatar_url, 500),
      ownerVerified: Boolean(user.is_verified_account),
      categoryId: clampStr(cat.id, 128),
      categorySlug: clampStr(cat.slug, 80),
      categoryName: clampStr(cat.name_ar, 100),
      subcategorySlug: clampStr(sub?.slug || '', 80),
      subcategoryName: clampStr(sub?.name_ar || '', 100),
      title: clampStr(payload.title, 160),
      description: clampStr(payload.description, 4000),
      price: Math.max(0, Number(payload.price) || 0),
      isNegotiable: Boolean(payload.is_negotiable),
      adType: payload.ad_type,
      location: clampStr(payload.location, 120),
      contactPhone: clampStr(payload.contact_phone, 40),
      contactWhatsapp: clampStr(payload.contact_whatsapp || payload.contact_phone, 40),
      documentInfo: clampStr(payload.document_info, 500),
      hasVerifiedDocs: false,
      status: isStaff ? 'approved' : 'pending',
      rejectionReason: '',
      isFeatured: false,
      isSample: false,
      viewsCount: 0,
      images: (payload.images || []).slice(0, 6).map((u) => clampStr(u, 500)).filter(Boolean),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    if (isStaff) {
      void createNewAdAlert({
        adId: id,
        title: clampStr(payload.title, 160),
        categoryName: clampStr(cat.name_ar, 100),
        categorySlug: clampStr(cat.slug, 80),
        price: Math.max(0, Number(payload.price) || 0),
        adType: payload.ad_type,
        location: clampStr(payload.location, 120),
        imageUrl: clampStr((payload.images || [])[0] || '', 500),
        ownerId: user.id,
        ownerName: clampStr(user.name, 80) || 'معلن',
      });
    } else {
      void notifySanadWebhook({
        event: "new_ad",
        id,
        title: clampStr(payload.title, 160),
        category: clampStr(cat.name_ar, 100),
        price: Math.max(0, Number(payload.price) || 0),
        owner_name: clampStr(user.name, 80),
        ad_type: payload.ad_type,
        image_url: (payload.images || [])[0] || undefined,
        contact: clampStr(payload.contact_phone, 40) || undefined,
      });
    }
    return {
      id,
      message: isStaff
        ? 'تم نشر الإعلان واعتماده مباشرة'
        : 'تم إرسال إعلانك بنجاح وهو الآن قيد مراجعة الإدارة قبل النشر',
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updateAd(
  adId: string,
  user: User,
  categories: Category[],
  payload: {
    title: string;
    category_id: string;
    subcategory_id: string | null;
    ad_type: AdType;
    description: string;
    price: number;
    is_negotiable: boolean;
    location: string;
    contact_phone: string;
    contact_whatsapp: string;
    document_info: string;
    images: string[];
  }
): Promise<{ message: string }> {
  invalidateApprovedAdsCache();
  const prohibited = checkProhibitedContent(`${payload.title} ${payload.description}`);
  if (prohibited) {
    throw new Error(`يحتوي الإعلان على مصطلح غير مسموح به (${prohibited})`);
  }

  const cat = categories.find((c) => c.id === payload.category_id);
  if (!cat) throw new Error('يرجى اختيار قسم صحيح');
  const sub = cat.subcategories.find(
    (s) => s.id === payload.subcategory_id || s.slug === payload.subcategory_id
  );

  const path = `ads/${adId}`;
  const isStaff = user.role === 'admin' || user.role === 'moderator';
  try {
    await updateDoc(doc(db, 'ads', adId), {
      categoryId: clampStr(cat.id, 128),
      categorySlug: clampStr(cat.slug, 80),
      categoryName: clampStr(cat.name_ar, 100),
      subcategorySlug: clampStr(sub?.slug || '', 80),
      subcategoryName: clampStr(sub?.name_ar || '', 100),
      title: clampStr(payload.title, 160),
      description: clampStr(payload.description, 4000),
      price: Math.max(0, Number(payload.price) || 0),
      isNegotiable: Boolean(payload.is_negotiable),
      adType: payload.ad_type,
      location: clampStr(payload.location, 120),
      contactPhone: clampStr(payload.contact_phone, 40),
      contactWhatsapp: clampStr(payload.contact_whatsapp || payload.contact_phone, 40),
      documentInfo: clampStr(payload.document_info, 500),
      images: (payload.images || []).slice(0, 6).map((u) => clampStr(u, 500)).filter(Boolean),
      status: isStaff ? 'approved' : 'pending',
      updatedAt: serverTimestamp(),
    });
    if (!isStaff) {
      void notifySanadWebhook({
        event: "new_ad",
        id: adId,
        title: clampStr(payload.title, 160),
        category: clampStr(cat.name_ar, 100),
        price: Math.max(0, Number(payload.price) || 0),
        owner_name: clampStr(user.name, 80),
        ad_type: payload.ad_type,
        image_url: (payload.images || [])[0] || undefined,
        contact: clampStr(payload.contact_phone, 40) || undefined,
      });
    }
    return {
      message: isStaff
        ? 'تم حفظ تعديلات الإعلان'
        : 'تم حفظ التعديلات وإرسال الإعلان للمراجعة',
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function updateAdStatus(adId: string, status: 'sold' | 'pending'): Promise<void> {
  invalidateApprovedAdsCache();
  const path = `ads/${adId}`;
  try {
    await updateDoc(doc(db, 'ads', adId), {
      status,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteAd(adId: string): Promise<void> {
  invalidateApprovedAdsCache();
  const path = `ads/${adId}`;
  try {
    await deleteDoc(doc(db, 'ads', adId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

// ==================== PAID HERO PROMOTIONS ====================

export async function fetchActiveHeroPromotions(): Promise<HeroPromotion[]> {
  try {
    const snap = await getDocs(
      query(collection(db, 'heroPromotions'), where('status', '==', 'active'))
    );
    const now = Date.now();
    const list: HeroPromotion[] = [];
    snap.forEach((d) => {
      const promo = mapHeroDoc(d.id, d.data());
      if (promo.expires_at) {
        const exp = Date.parse(promo.expires_at);
        if (!Number.isNaN(exp) && exp <= now) return;
      }
      list.push(promo);
    });
    return list.sort((a, b) => a.sort_order - b.sort_order || b.created_at.localeCompare(a.created_at));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'heroPromotions');
  }
}

export async function fetchMyHeroPromotions(uid: string): Promise<HeroPromotion[]> {
  try {
    const snap = await getDocs(
      query(collection(db, 'heroPromotions'), where('userId', '==', uid))
    );
    const list: HeroPromotion[] = [];
    snap.forEach((d) => list.push(mapHeroDoc(d.id, d.data())));
    return list.sort((a, b) => b.created_at.localeCompare(a.created_at));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'heroPromotions');
  }
}

export async function createHeroPromotionRequest(
  user: User,
  ad: Ad,
  payload: {
    package_days: number;
    payment_method: string;
    payment_reference: string;
    payment_receipt_url?: string;
    banner_url?: string;
  }
): Promise<string> {
  const amount = HERO_PACKAGES[payload.package_days] ?? 10000;
  if (!payload.payment_reference.trim() || payload.payment_reference.trim().length < 3) {
    throw new Error('يرجى إدخال رقم إشعار الدفع أو المرجع لتأكيد الطلب');
  }

  const id = generateId('hero');
  const path = `heroPromotions/${id}`;
  const priceLabel =
    ad.price > 0 ? `${new Intl.NumberFormat('en-US').format(ad.price)} ج.س` : 'عرض مميز';
  const imageUrl =
    payload.banner_url || ad.images?.[0] || '/src/assets/images/hero_abu_jubeiha_1795626053117.jpg';

  try {
    await setDoc(doc(db, 'heroPromotions', id), {
      adId: clampStr(ad.id, 128),
      userId: clampStr(user.id, 128),
      ownerName: clampStr(user.name, 80),
      title: clampStr(ad.title, 160),
      subtitle: 'إعلان مميز في واجهة سوق أبو جبيهة',
      imageUrl: clampStr(imageUrl, 500),
      priceLabel: clampStr(priceLabel, 80),
      locationLabel: clampStr(ad.location, 120),
      packageDays: payload.package_days,
      amountSdg: amount,
      paymentMethod: clampStr(payload.payment_method, 60),
      paymentReference: clampStr(payload.payment_reference, 120),
      paymentReceiptUrl: clampStr(payload.payment_receipt_url || '', 500),
      status: 'pending',
      sortOrder: 10,
      isSample: false,
      startsAt: '',
      expiresAt: '',
      adminNote: '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    void notifySanadWebhook({
      event: "new_hero",
      id,
      title: clampStr(ad.title, 160),
      price: amount,
      owner_name: clampStr(user.name, 80),
      image_url: imageUrl,
      receipt_url: payload.payment_receipt_url || undefined,
      contact: payload.payment_method,
      message: `الباقة: ${payload.package_days} يوم | المرجع: ${payload.payment_reference}`,
    });
    return 'تم إرسال طلب الإعلان المميز المدفوع بنجاح، وسيتم تفعيله في الواجهة فور مراجعة الدفع';
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

// ==================== FAVORITES ====================

export async function toggleFavorite(uid: string, adId: string): Promise<boolean> {
  const favId = `${uid}_${adId}`;
  const path = `favorites/${favId}`;
  try {
    const ref = doc(db, 'favorites', favId);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      await deleteDoc(ref);
      return false;
    }
    await setDoc(ref, {
      userId: clampStr(uid, 128),
      adId: clampStr(adId, 128),
      createdAt: serverTimestamp(),
    });
    return true;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function fetchFavoriteAds(uid: string): Promise<Ad[]> {
  try {
    const favIds = await fetchFavoriteIds(uid);
    if (favIds.size === 0) return [];
    const approvedAds = await fetchAds({}, uid);
    return approvedAds.filter((a) => favIds.has(a.id));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'favorites');
  }
}

// ==================== INTERNAL MESSAGING ====================

export async function fetchUnreadMessagesCount(uid: string): Promise<number> {
  if (!uid) return 0;
  try {
    const snap = await getDocs(
      query(collection(db, 'messages'), where('participants', 'array-contains', uid))
    );
    let unread = 0;
    snap.forEach((d) => {
      const data = d.data();
      if (data.receiverId === uid && !data.isRead) unread++;
    });
    return unread;
  } catch {
    return 0;
  }
}

export async function fetchConversations(uid: string): Promise<Conversation[]> {
  try {
    const snap = await getDocs(
      query(collection(db, 'messages'), where('participants', 'array-contains', uid))
    );
    const map = new Map<string, Conversation>();
    const rows: Array<{ id: string; data: any }> = [];
    snap.forEach((d) => rows.push({ id: d.id, data: d.data() }));
    rows.sort((a, b) => toIsoString(b.data.createdAt).localeCompare(toIsoString(a.data.createdAt)));

    for (const { data } of rows) {
      const isSender = data.senderId === uid;
      const otherId = isSender ? String(data.receiverId) : String(data.senderId);
      const otherName = isSender ? String(data.receiverName || 'مستخدم') : String(data.senderName || 'مستخدم');
      const otherAvatar = isSender ? String(data.receiverAvatar || '') : String(data.senderAvatar || '');
      const adId = data.adId ? String(data.adId) : null;
      const key = `${otherId}__${adId ?? 'general'}`;
      const existing = map.get(key);
      const unreadAdd = !isSender && !data.isRead ? 1 : 0;

      if (!existing) {
        map.set(key, {
          other_user_id: otherId,
          other_user_name: otherName,
          other_user_avatar: otherAvatar,
          other_user_verified: false,
          ad_id: adId,
          ad_title: String(data.adTitle || 'محادثة عامة'),
          last_message: String(data.body || ''),
          last_at: toIsoString(data.createdAt),
          unread_count: unreadAdd,
        });
      } else {
        existing.unread_count += unreadAdd;
      }
    }
    return Array.from(map.values());
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'messages');
  }
}

export async function fetchMessageThread(
  uid: string,
  otherUserId: string,
  adId: string | null
): Promise<{
  otherUser: { id: string; name: string; avatar_url: string; is_verified_account: boolean };
  messages: ChatMessage[];
}> {
  try {
    const [otherSnap, msgSnap] = await Promise.all([
      getDoc(doc(db, 'users', otherUserId)),
      getDocs(query(collection(db, 'messages'), where('participants', 'array-contains', uid))),
    ]);

    const otherData = otherSnap.exists() ? otherSnap.data() : {};
    const otherUser = {
      id: otherUserId,
      name: String(otherData.name || 'مستخدم السوق'),
      avatar_url: String(otherData.avatarUrl || ''),
      is_verified_account: Boolean(otherData.isVerifiedAccount),
    };

    const thread: ChatMessage[] = [];
    const unreadIds: string[] = [];

    msgSnap.forEach((d) => {
      const data = d.data();
      const matchesOther =
        (data.senderId === uid && data.receiverId === otherUserId) ||
        (data.senderId === otherUserId && data.receiverId === uid);
      if (!matchesOther) return;
      const msgAdId = data.adId ? String(data.adId) : null;
      if ((adId ?? null) !== msgAdId) return;

      if (data.receiverId === uid && !data.isRead) {
        unreadIds.push(d.id);
      }

      thread.push({
        id: d.id,
        ad_id: msgAdId,
        sender_id: String(data.senderId),
        receiver_id: String(data.receiverId),
        sender_name: String(data.senderName || ''),
        body: String(data.body || ''),
        is_read: Boolean(data.isRead),
        created_at: toIsoString(data.createdAt),
      });
    });

    thread.sort((a, b) => a.created_at.localeCompare(b.created_at));

    if (unreadIds.length > 0) {
      const batch = writeBatch(db);
      unreadIds.forEach((mId) => batch.update(doc(db, 'messages', mId), { isRead: true }));
      await batch.commit();
    }

    return { otherUser, messages: thread };
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'messages');
  }
}

export async function sendMessage(
  sender: User,
  receiverId: string,
  adId: string | null,
  body: string
): Promise<ChatMessage> {
  const cleanBody = clampStr(body, 2000);
  if (!cleanBody) throw new Error('يرجى كتابة نص الرسالة');
  if (sender.id === receiverId) throw new Error('لا يمكنك مراسلة نفسك');

  const id = generateId('msg');
  const path = `messages/${id}`;
  try {
    const [recvSnap, adSnap] = await Promise.all([
      getDoc(doc(db, 'users', receiverId)),
      adId ? getDoc(doc(db, 'ads', adId)) : Promise.resolve(null),
    ]);
    const recvData = recvSnap.exists() ? recvSnap.data() : {};
    const adTitle = adSnap && adSnap.exists() ? String(adSnap.data().title || '') : '';

    await setDoc(doc(db, 'messages', id), {
      adId: clampStr(adId || '', 128),
      adTitle: clampStr(adTitle, 160),
      senderId: clampStr(sender.id, 128),
      senderName: clampStr(sender.name, 80),
      senderAvatar: clampStr(sender.avatar_url, 500),
      receiverId: clampStr(receiverId, 128),
      receiverName: clampStr(recvData.name || 'مستخدم السوق', 80),
      receiverAvatar: clampStr(recvData.avatarUrl || '', 500),
      participants: [sender.id, receiverId],
      body: cleanBody,
      isRead: false,
      createdAt: serverTimestamp(),
    });

    // Fire-and-forget notification for recipient
    void createNotification({
      userId: receiverId,
      title: `رسالة جديدة من ${sender.name}`,
      body: cleanBody.slice(0, 140),
      type: 'message',
      linkAdId: adId || '',
      linkUserId: sender.id,
      linkPage: 'messages',
    }).catch(() => {});

    return {
      id,
      ad_id: adId,
      sender_id: sender.id,
      receiver_id: receiverId,
      sender_name: sender.name,
      body: cleanBody,
      is_read: false,
      created_at: new Date().toISOString(),
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export function subscribeToUserMessages(
  uid: string,
  onUpdate: (payload: { conversations: Conversation[]; unreadCount: number; rawDocs: Array<{ id: string; data: any }> }) => void
): () => void {
  const q = query(collection(db, 'messages'), where('participants', 'array-contains', uid));
  return onSnapshot(
    q,
    (snap) => {
      const map = new Map<string, Conversation>();
      const rows: Array<{ id: string; data: any }> = [];
      let unreadCount = 0;

      snap.forEach((d) => {
        const data = d.data();
        rows.push({ id: d.id, data });
        if (data.receiverId === uid && !data.isRead) {
          unreadCount++;
        }
      });

      rows.sort((a, b) =>
        toIsoString(b.data.createdAt).localeCompare(toIsoString(a.data.createdAt))
      );

      for (const { data } of rows) {
        const isSender = data.senderId === uid;
        const otherId = isSender ? String(data.receiverId) : String(data.senderId);
        const otherName = isSender
          ? String(data.receiverName || 'مستخدم')
          : String(data.senderName || 'مستخدم');
        const otherAvatar = isSender
          ? String(data.receiverAvatar || '')
          : String(data.senderAvatar || '');
        const adId = data.adId ? String(data.adId) : null;
        const key = `${otherId}__${adId ?? 'general'}`;
        const existing = map.get(key);
        const unreadAdd = !isSender && !data.isRead ? 1 : 0;

        if (!existing) {
          map.set(key, {
            other_user_id: otherId,
            other_user_name: otherName,
            other_user_avatar: otherAvatar,
            other_user_verified: false,
            ad_id: adId,
            ad_title: String(data.adTitle || 'محادثة عامة'),
            last_message: String(data.body || ''),
            last_at: toIsoString(data.createdAt),
            unread_count: unreadAdd,
          });
        } else {
          existing.unread_count += unreadAdd;
        }
      }

      onUpdate({
        conversations: Array.from(map.values()),
        unreadCount,
        rawDocs: rows,
      });
    },
    (err) => {
      handleFirestoreError(err, OperationType.GET, 'messages');
    }
  );
}

// ==================== NOTIFICATIONS ====================

export async function createNotification(payload: {
  userId: string;
  title: string;
  body: string;
  type: NotificationType;
  linkAdId?: string;
  linkUserId?: string;
  linkPage?: string;
}): Promise<void> {
  if (!payload.userId) return;
  const id = generateId('notif');
  const path = `notifications/${id}`;
  try {
    await setDoc(doc(db, 'notifications', id), {
      userId: clampStr(payload.userId, 128),
      title: clampStr(payload.title, 160),
      body: clampStr(payload.body, 500),
      type: payload.type,
      linkAdId: clampStr(payload.linkAdId || '', 128),
      linkUserId: clampStr(payload.linkUserId || '', 128),
      linkPage: clampStr(payload.linkPage || '', 60),
      isRead: false,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export function subscribeToNotifications(
  uid: string,
  onUpdate: (notifications: AppNotification[]) => void
): () => void {
  const q = query(collection(db, 'notifications'), where('userId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const list: AppNotification[] = [];
      snap.forEach((d) => {
        const data = d.data();
        list.push({
          id: d.id,
          user_id: String(data.userId || ''),
          title: String(data.title || ''),
          body: String(data.body || ''),
          type: (data.type || 'system') as NotificationType,
          link_ad_id: String(data.linkAdId || ''),
          link_user_id: String(data.linkUserId || ''),
          link_page: String(data.linkPage || ''),
          is_read: Boolean(data.isRead),
          created_at: toIsoString(data.createdAt),
        });
      });
      list.sort((a, b) => b.created_at.localeCompare(a.created_at));
      onUpdate(list.slice(0, 30));
    },
    (err) => {
      handleFirestoreError(err, OperationType.GET, 'notifications');
    }
  );
}

export async function markNotificationRead(notifId: string): Promise<void> {
  const path = `notifications/${notifId}`;
  try {
    await updateDoc(doc(db, 'notifications', notifId), { isRead: true });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function markAllNotificationsRead(notifications: AppNotification[]): Promise<void> {
  const unread = notifications.filter((n) => !n.is_read);
  if (unread.length === 0) return;
  try {
    const batch = writeBatch(db);
    unread.slice(0, 100).forEach((n) => batch.update(doc(db, 'notifications', n.id), { isRead: true }));
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, 'notifications');
  }
}

export async function createNewAdAlert(payload: {
  adId: string;
  title: string;
  categoryName: string;
  categorySlug: string;
  price: number;
  adType: AdType;
  location: string;
  imageUrl: string;
  ownerId: string;
  ownerName: string;
}): Promise<void> {
  const cleanAdId = clampStr(payload.adId, 110);
  if (!cleanAdId || !payload.ownerId) return;
  const alertId = `alert_${cleanAdId}`;
  try {
    await setDoc(doc(db, 'newAdAlerts', alertId), {
      adId: cleanAdId,
      title: clampStr(payload.title, 160) || 'إعلان جديد',
      categoryName: clampStr(payload.categoryName, 100) || 'سوق أبو جبيهة',
      categorySlug: clampStr(payload.categorySlug, 80),
      price: Math.max(0, Number(payload.price) || 0),
      adType: ['offer', 'wanted', 'job', 'announcement'].includes(payload.adType)
        ? payload.adType
        : 'offer',
      location: clampStr(payload.location, 120),
      imageUrl: clampStr(payload.imageUrl, 500),
      ownerId: clampStr(payload.ownerId, 128),
      ownerName: clampStr(payload.ownerName, 80) || 'معلن',
      createdAt: serverTimestamp(),
    });
  } catch {
    // Non-fatal if rules have not yet been deployed to Firebase Console
  }
}

export function subscribeToNewAdAlerts(onUpdate: (alerts: NewAdAlert[]) => void): () => void {
  let fallbackUnsub: (() => void) | null = null;

  const startFallback = () => {
    if (fallbackUnsub) return;
    const adsQ = query(collection(db, 'ads'), where('status', '==', 'approved'));
    fallbackUnsub = onSnapshot(
      adsQ,
      (snap) => {
        const list: NewAdAlert[] = [];
        snap.forEach((d) => {
          const data = d.data();
          const images = Array.isArray(data.images) ? data.images : [];
          const adTypeRaw = String(data.adType || 'offer');
          const adType: AdType =
            adTypeRaw === 'wanted' || adTypeRaw === 'job' || adTypeRaw === 'announcement'
              ? adTypeRaw
              : 'offer';
          list.push({
            id: `alert_${d.id}`,
            ad_id: d.id,
            title: String(data.title || ''),
            category_name: String(data.categoryName || 'سوق أبو جبيهة'),
            category_slug: String(data.categorySlug || ''),
            price: Number(data.price || 0),
            ad_type: adType,
            location: String(data.location || ''),
            image_url: String(images[0] || ''),
            owner_id: String(data.ownerId || ''),
            owner_name: String(data.ownerName || 'معلن'),
            created_at: toIsoString(data.createdAt),
          });
        });
        list.sort((a, b) => b.created_at.localeCompare(a.created_at));
        onUpdate(list.slice(0, 40));
      },
      () => {
        onUpdate([]);
      }
    );
  };

  const alertsUnsub = onSnapshot(
    collection(db, 'newAdAlerts'),
    (snap) => {
      if (snap.empty) {
        startFallback();
        return;
      }
      if (fallbackUnsub) {
        fallbackUnsub();
        fallbackUnsub = null;
      }
      const list: NewAdAlert[] = [];
      snap.forEach((d) => {
        const data = d.data();
        const adTypeRaw = String(data.adType || 'offer');
        const adType: AdType =
          adTypeRaw === 'wanted' || adTypeRaw === 'job' || adTypeRaw === 'announcement'
            ? adTypeRaw
            : 'offer';
        list.push({
          id: d.id,
          ad_id: String(data.adId || d.id),
          title: String(data.title || ''),
          category_name: String(data.categoryName || 'سوق أبو جبيهة'),
          category_slug: String(data.categorySlug || ''),
          price: Number(data.price || 0),
          ad_type: adType,
          location: String(data.location || ''),
          image_url: String(data.imageUrl || ''),
          owner_id: String(data.ownerId || ''),
          owner_name: String(data.ownerName || 'معلن'),
          created_at: toIsoString(data.createdAt),
        });
      });
      list.sort((a, b) => b.created_at.localeCompare(a.created_at));
      onUpdate(list.slice(0, 40));
    },
    () => {
      startFallback();
    }
  );

  return () => {
    alertsUnsub();
    if (fallbackUnsub) {
      fallbackUnsub();
      fallbackUnsub = null;
    }
  };
}

// ==================== REPORTS ====================

export async function submitReport(
  reporter: User,
  payload: {
    target_type: 'ad' | 'user';
    target_ad_id?: string;
    target_ad_title?: string;
    target_user_id?: string;
    target_user_name?: string;
    reason: string;
    details: string;
  }
): Promise<string> {
  const id = generateId('rep');
  const path = `reports/${id}`;
  try {
    await setDoc(doc(db, 'reports', id), {
      reporterId: clampStr(reporter.id, 128),
      reporterName: clampStr(reporter.name, 80),
      targetType: payload.target_type,
      targetAdId: clampStr(payload.target_ad_id || '', 128),
      targetAdTitle: clampStr(payload.target_ad_title || '', 160),
      targetUserId: clampStr(payload.target_user_id || '', 128),
      targetUserName: clampStr(payload.target_user_name || '', 80),
      reason: clampStr(payload.reason, 160),
      details: clampStr(payload.details, 1000),
      status: 'open',
      adminNote: '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    void notifySanadWebhook({
      event: "new_report",
      id,
      title: clampStr(payload.target_ad_title || payload.target_user_name || "بلاغ جديد", 160),
      owner_name: clampStr(reporter.name, 80),
      reason: clampStr(payload.reason, 160),
      message: clampStr(payload.details, 500),
    });
    return 'تم استلام بلاغك وسيقوم فريق الرقابة بمراجعته قريباً';
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

// ==================== ADMIN & MODERATION ====================

export async function adminFetchOverview(): Promise<AdminOverview> {
  try {
    const [usersSnap, adsSnap, reportsSnap, msgsSnap, logsSnap] = await Promise.all([
      getDocs(collection(db, 'users')),
      getDocs(collection(db, 'ads')),
      getDocs(collection(db, 'reports')),
      getDocs(collection(db, 'messages')),
      getDocs(collection(db, 'auditLogs')),
    ]);

    let totalUsers = 0;
    let blockedUsers = 0;
    usersSnap.forEach((d) => {
      const data = d.data();
      if (!data.isSample) {
        totalUsers++;
        if (data.isBlocked) blockedUsers++;
      }
    });

    let pendingAds = 0;
    let approvedAds = 0;
    let rejectedAds = 0;
    adsSnap.forEach((d) => {
      const st = d.data().status;
      if (st === 'pending') pendingAds++;
      else if (st === 'approved') approvedAds++;
      else if (st === 'rejected') rejectedAds++;
    });

    let openReports = 0;
    reportsSnap.forEach((d) => {
      if (d.data().status === 'open') openReports++;
    });

    const logs: AdminOverview['logs'] = [];
    logsSnap.forEach((d) => {
      const data = d.data();
      logs.push({
        id: d.id,
        actor_id: data.actorId || null,
        actor_name: data.actorName || null,
        action: String(data.action || ''),
        target_info: String(data.targetInfo || ''),
        created_at: toIsoString(data.createdAt),
      });
    });
    logs.sort((a, b) => b.created_at.localeCompare(a.created_at));

    return {
      stats: {
        totalUsers,
        blockedUsers,
        pendingAds,
        approvedAds,
        rejectedAds,
        openReports,
        totalMessages: msgsSnap.size,
      },
      logs: logs.slice(0, 30),
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, 'admin/overview');
  }
}

export async function adminModerateAd(
  actor: User,
  adId: string,
  payload: {
    status?: string;
    rejection_reason?: string;
    is_featured?: boolean;
    has_verified_docs?: boolean;
  }
): Promise<void> {
  invalidateApprovedAdsCache();
  const path = `ads/${adId}`;
  try {
    const snap = await getDoc(doc(db, 'ads', adId));
    if (!snap.exists()) throw new Error('الإعلان غير موجود');
    const existing = snap.data();

    await updateDoc(doc(db, 'ads', adId), {
      status: payload.status ?? existing.status,
      rejectionReason: clampStr(
        payload.rejection_reason !== undefined ? payload.rejection_reason : existing.rejectionReason,
        500
      ),
      isFeatured: payload.is_featured !== undefined ? Boolean(payload.is_featured) : Boolean(existing.isFeatured),
      hasVerifiedDocs:
        payload.has_verified_docs !== undefined
          ? Boolean(payload.has_verified_docs)
          : Boolean(existing.hasVerifiedDocs),
      updatedAt: serverTimestamp(),
    });

    await logAuditAction(
      actor.id,
      actor.name,
      `مراجعة إعلان (${payload.status ?? existing.status})`,
      String(existing.title || adId)
    );

    const ownerId = String(existing.ownerId || '');
    if (ownerId && ownerId !== actor.id && (payload.status === 'approved' || payload.status === 'rejected')) {
      void createNotification({
        userId: ownerId,
        title: payload.status === 'approved' ? 'تمت الموافقة على إعلانك' : 'لم يتم اعتماد إعلانك',
        body:
          payload.status === 'approved'
            ? `أصبح إعلانك "${String(existing.title || '')}" منشوراً ومتاحاً لجميع المتصفحين.`
            : `إعلانك "${String(existing.title || '')}" بحاجة لتعديل: ${payload.rejection_reason || 'راجع شروط النشر'}`,
        type: payload.status === 'approved' ? 'ad_approved' : 'ad_rejected',
        linkAdId: adId,
        linkPage: payload.status === 'approved' ? 'ad-detail' : 'account',
      }).catch(() => {});
    }

    if (payload.status === 'approved') {
      const images = Array.isArray(existing.images) ? existing.images : [];
      const adTypeRaw = String(existing.adType || 'offer');
      const adType: AdType =
        adTypeRaw === 'wanted' || adTypeRaw === 'job' || adTypeRaw === 'announcement'
          ? adTypeRaw
          : 'offer';
      void createNewAdAlert({
        adId,
        title: String(existing.title || ''),
        categoryName: String(existing.categoryName || 'سوق أبو جبيهة'),
        categorySlug: String(existing.categorySlug || ''),
        price: Number(existing.price || 0),
        adType,
        location: String(existing.location || ''),
        imageUrl: String(images[0] || ''),
        ownerId: ownerId || actor.id,
        ownerName: String(existing.ownerName || 'معلن'),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function adminFetchHeroPromotions(): Promise<HeroPromotion[]> {
  try {
    const snap = await getDocs(collection(db, 'heroPromotions'));
    const list: HeroPromotion[] = [];
    snap.forEach((d) => list.push(mapHeroDoc(d.id, d.data())));

    // Expire finished paid promotions and remove the featured mark from their ads
    const nowMs = Date.now();
    const isLive = (p: HeroPromotion) => {
      if (p.status !== 'active') return false;
      const exp = Date.parse(p.expires_at);
      return Number.isNaN(exp) || exp > nowMs;
    };
    for (const p of list) {
      if (p.status !== 'active' || !p.expires_at) continue;
      const exp = Date.parse(p.expires_at);
      if (Number.isNaN(exp) || exp > nowMs) continue;
      try {
        await updateDoc(doc(db, 'heroPromotions', p.id), {
          status: 'expired',
          updatedAt: serverTimestamp(),
        });
        p.status = 'expired';
        const stillLive = p.ad_id
          ? list.some((o) => o.id !== p.id && o.ad_id === p.ad_id && isLive(o))
          : false;
        if (p.ad_id && !stillLive) {
          await updateDoc(doc(db, 'ads', p.ad_id), {
            isFeatured: false,
            updatedAt: serverTimestamp(),
          });
        }
      } catch {
        // best effort; will be retried on next load
      }
    }

    return list.sort((a, b) => a.sort_order - b.sort_order || b.created_at.localeCompare(a.created_at));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'heroPromotions');
  }
}

export async function adminCreateHeroPromotion(
  actor: User,
  payload: {
    ad_id?: string;
    title?: string;
    price_label?: string;
    location_label?: string;
    image_url?: string;
    package_days: number;
    amount_sdg: number;
    sort_order: number;
  }
): Promise<void> {
  invalidateApprovedAdsCache();
  let linkedAd: Ad | null = null;
  if (payload.ad_id) {
    linkedAd = await fetchAdById(payload.ad_id, actor.id);
    await updateDoc(doc(db, 'ads', linkedAd.id), {
      isFeatured: true,
      updatedAt: serverTimestamp(),
    });
  }

  const title = clampStr(payload.title || linkedAd?.title || '', 160);
  const imageUrl = clampStr(
    payload.image_url || linkedAd?.images?.[0] || '/src/assets/images/hero_abu_jubeiha_1795626053117.jpg',
    500
  );
  if (!title || !imageUrl) {
    throw new Error('يرجى إدخال عنوان البنر وإرفاق صورة أو اختيار إعلان');
  }

  const days = Math.max(1, Math.min(365, Number(payload.package_days) || 7));
  const now = new Date();
  const exp = new Date(now.getTime() + days * 24 * 3600 * 1000);
  const id = generateId('hero');
  const path = `heroPromotions/${id}`;

  try {
    await setDoc(doc(db, 'heroPromotions', id), {
      adId: clampStr(linkedAd?.id || '', 128),
      userId: clampStr(linkedAd?.user_id || actor.id, 128),
      ownerName: clampStr(linkedAd?.owner_name || actor.name, 80),
      title,
      subtitle: 'إعلان مميز مدفوع في واجهة سوق أبو جبيهة',
      imageUrl,
      priceLabel: clampStr(
        payload.price_label ||
          (linkedAd && linkedAd.price > 0
            ? `${new Intl.NumberFormat('en-US').format(linkedAd.price)} ج.س`
            : ''),
        80
      ),
      locationLabel: clampStr(payload.location_label || linkedAd?.location || 'أبو جبيهة', 120),
      packageDays: days,
      amountSdg: Math.max(0, Number(payload.amount_sdg) || 0),
      paymentMethod: 'دفع مباشر للإدارة',
      paymentReference: 'ADMIN-DIRECT',
      paymentReceiptUrl: '',
      status: 'active',
      sortOrder: Number(payload.sort_order) || 1,
      isSample: false,
      startsAt: now.toISOString(),
      expiresAt: exp.toISOString(),
      adminNote: '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await logAuditAction(actor.id, actor.name, 'نشر إعلان بنر مدفوع في الواجهة', title);
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function adminUpdateHeroPromotion(
  actor: User,
  promoId: string,
  status: 'active' | 'paused' | 'rejected'
): Promise<void> {
  invalidateApprovedAdsCache();
  const path = `heroPromotions/${promoId}`;
  try {
    const snap = await getDoc(doc(db, 'heroPromotions', promoId));
    if (!snap.exists()) throw new Error('الإعلان المدفوع غير موجود');
    const existing = snap.data();

    let startsAt = String(existing.startsAt || '');
    let expiresAt = String(existing.expiresAt || '');
    if (status === 'active') {
      const days = Number(existing.packageDays || 7);
      if (!startsAt) startsAt = new Date().toISOString();
      if (!expiresAt || Date.parse(expiresAt) <= Date.now()) {
        expiresAt = new Date(Date.now() + days * 24 * 3600 * 1000).toISOString();
      }
      if (existing.adId) {
        const promoAdId = String(existing.adId);
        const adSnap = await getDoc(doc(db, 'ads', promoAdId));
        if (adSnap.exists()) {
          const adData = adSnap.data();
          const wasPending = adData.status === 'pending';
          // Activating a paid banner also approves the ad itself if it is still pending
          await updateDoc(doc(db, 'ads', promoAdId), {
            isFeatured: true,
            ...(wasPending ? { status: 'approved', rejectionReason: '' } : {}),
            updatedAt: serverTimestamp(),
          });
          if (wasPending) {
            const adImages = Array.isArray(adData.images) ? adData.images : [];
            const adTypeRaw = String(adData.adType || 'offer');
            const promoAdType: AdType =
              adTypeRaw === 'wanted' || adTypeRaw === 'job' || adTypeRaw === 'announcement'
                ? adTypeRaw
                : 'offer';
            const adOwnerId = String(adData.ownerId || '');
            void createNewAdAlert({
              adId: promoAdId,
              title: String(adData.title || ''),
              categoryName: String(adData.categoryName || 'سوق أبو جبيهة'),
              categorySlug: String(adData.categorySlug || ''),
              price: Number(adData.price || 0),
              adType: promoAdType,
              location: String(adData.location || ''),
              imageUrl: String(adImages[0] || ''),
              ownerId: adOwnerId || actor.id,
              ownerName: String(adData.ownerName || 'معلن'),
            });
            if (adOwnerId && adOwnerId !== actor.id) {
              void createNotification({
                userId: adOwnerId,
                title: 'تمت الموافقة على إعلانك',
                body: `أصبح إعلانك "${String(adData.title || '')}" منشوراً ومتاحاً لجميع المتصفحين.`,
                type: 'ad_approved',
                linkAdId: promoAdId,
                linkPage: 'ad-detail',
              }).catch(() => {});
            }
          }
        }
      }
    } else if (existing.adId) {
      // Paused / rejected: remove the featured mark from the ad
      try {
        await updateDoc(doc(db, 'ads', String(existing.adId)), {
          isFeatured: false,
          updatedAt: serverTimestamp(),
        });
      } catch {
        // ad may have been deleted; ignore
      }
    }

    await updateDoc(doc(db, 'heroPromotions', promoId), {
      status,
      startsAt,
      expiresAt,
      updatedAt: serverTimestamp(),
    });
    await logAuditAction(
      actor.id,
      actor.name,
      `تحديث حالة البنر المدفوع (${status})`,
      String(existing.title || promoId)
    );

    const promoOwner = String(existing.userId || '');
    if (promoOwner && promoOwner !== actor.id && (status === 'active' || status === 'rejected')) {
      void createNotification({
        userId: promoOwner,
        title: status === 'active' ? 'تم تفعيل إعلانك المدفوع' : 'تم رفض طلب الترويج المدفوع',
        body:
          status === 'active'
            ? `إعلانك "${String(existing.title || '')}" يظهر الآن في بنر الواجهة الرئيسية.`
            : `تعذر تفعيل بنر "${String(existing.title || '')}". يرجى مراجعة بيانات الدفع والتواصل مع الإدارة.`,
        type: status === 'active' ? 'hero_active' : 'hero_rejected',
        linkAdId: String(existing.adId || ''),
        linkPage: 'account',
      }).catch(() => {});
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function adminDeleteHeroPromotion(actor: User, promoId: string): Promise<void> {
  invalidateApprovedAdsCache();
  const path = `heroPromotions/${promoId}`;
  try {
    await deleteDoc(doc(db, 'heroPromotions', promoId));
    await logAuditAction(actor.id, actor.name, 'حذف إعلان بنر مدفوع', promoId);
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function adminFetchUsers(q = ''): Promise<User[]> {
  try {
    const [usersSnap, adsSnap] = await Promise.all([
      getDocs(collection(db, 'users')),
      getDocs(collection(db, 'ads')),
    ]);
    const adCounts = new Map<string, number>();
    adsSnap.forEach((d) => {
      const ownerId = String(d.data().ownerId || '');
      adCounts.set(ownerId, (adCounts.get(ownerId) ?? 0) + 1);
    });

    const users: User[] = [];
    for (const d of usersSnap.docs) {
      const pub = d.data();
      if (pub.isSample) continue;
      let email = '';
      let phone = '';
      try {
        const privSnap = await getDoc(doc(db, 'users', d.id, 'private', 'info'));
        if (privSnap.exists()) {
          email = String(privSnap.data().email || '');
          phone = String(privSnap.data().phone || '');
        }
      } catch {
        // ignore
      }
      users.push({
        id: d.id,
        name: String(pub.name || ''),
        email,
        phone,
        location: String(pub.location || ''),
        avatar_url: String(pub.avatarUrl || ''),
        role: (pub.role || 'user') as UserRole,
        is_blocked: Boolean(pub.isBlocked),
        is_verified_account: Boolean(pub.isVerifiedAccount),
        ads_count: adCounts.get(d.id) ?? 0,
        created_at: toIsoString(pub.createdAt),
      });
    }

    const cleanQ = normalizeSearchText(q);
    const filtered = cleanQ
      ? users.filter((u) =>
          normalizeSearchText(`${u.name} ${u.email} ${u.phone}`).includes(cleanQ)
        )
      : users;
    return filtered.sort((a, b) => b.created_at.localeCompare(a.created_at));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'users');
  }
}

export async function adminToggleBlockUser(actor: User, target: User): Promise<void> {
  const path = `users/${target.id}`;
  try {
    await updateDoc(doc(db, 'users', target.id), {
      isBlocked: !target.is_blocked,
      updatedAt: serverTimestamp(),
    });
    await logAuditAction(
      actor.id,
      actor.name,
      target.is_blocked ? 'فك حظر حساب' : 'حظر حساب',
      target.email || target.name
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function adminToggleVerifyUser(actor: User, target: User): Promise<void> {
  const path = `users/${target.id}`;
  try {
    await updateDoc(doc(db, 'users', target.id), {
      isVerifiedAccount: !target.is_verified_account,
      updatedAt: serverTimestamp(),
    });
    await logAuditAction(
      actor.id,
      actor.name,
      target.is_verified_account ? 'إلغاء توثيق حساب' : 'توثيق حساب',
      target.email || target.name
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function adminChangeUserRole(
  actor: User,
  target: User,
  role: UserRole
): Promise<void> {
  const path = `users/${target.id}`;
  try {
    await updateDoc(doc(db, 'users', target.id), {
      role,
      isVerifiedAccount: role !== 'user' ? true : target.is_verified_account,
      updatedAt: serverTimestamp(),
    });
    if (role === 'admin') {
      await setDoc(doc(db, 'admins', target.id), {
        uid: target.id,
        email: clampStr(target.email || `${target.id}@local`, 160),
        createdAt: serverTimestamp(),
      });
      await deleteDoc(doc(db, 'moderators', target.id)).catch(() => {});
    } else if (role === 'moderator') {
      await setDoc(doc(db, 'moderators', target.id), {
        uid: target.id,
        email: clampStr(target.email || `${target.id}@local`, 160),
        createdAt: serverTimestamp(),
      });
      await deleteDoc(doc(db, 'admins', target.id)).catch(() => {});
    } else {
      await deleteDoc(doc(db, 'admins', target.id)).catch(() => {});
      await deleteDoc(doc(db, 'moderators', target.id)).catch(() => {});
    }
    await logAuditAction(actor.id, actor.name, `تعديل صلاحية إلى (${role})`, target.email || target.name);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function adminFetchStaff(): Promise<
  Array<{ email: string; role: 'admin' | 'moderator'; registered: boolean; user_name?: string }>
> {
  try {
    const [staffSnap, usersList] = await Promise.all([
      getDocs(collection(db, 'designatedStaff')),
      adminFetchUsers(),
    ]);

    const userByEmail = new Map(
      usersList.filter((u) => u.email).map((u) => [u.email.toLowerCase(), u])
    );

    const map = new Map<
      string,
      { email: string; role: 'admin' | 'moderator'; registered: boolean; user_name?: string }
    >();

    for (const email of BOOTSTRAP_ADMIN_EMAILS) {
      const matched = userByEmail.get(email);
      map.set(email, {
        email,
        role: 'admin',
        registered: Boolean(matched),
        user_name: matched?.name,
      });
    }

    staffSnap.forEach((d) => {
      const data = d.data();
      const email = String(data.email || d.id).toLowerCase();
      const matched = userByEmail.get(email);
      map.set(email, {
        email,
        role: data.role === 'moderator' ? 'moderator' : 'admin',
        registered: Boolean(matched),
        user_name: matched?.name,
      });
    });

    return Array.from(map.values());
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'designatedStaff');
  }
}

export async function adminAddStaff(
  actor: User,
  email: string,
  role: 'admin' | 'moderator'
): Promise<string> {
  const cleanEmail = clampStr(email.toLowerCase(), 160);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    throw new Error('يرجى إدخال بريد إلكتروني صحيح');
  }
  const path = `designatedStaff/${cleanEmail}`;
  try {
    await setDoc(doc(db, 'designatedStaff', cleanEmail), {
      email: cleanEmail,
      role,
      addedByUid: actor.id,
      createdAt: serverTimestamp(),
    });

    const usersList = await adminFetchUsers();
    const existingUser = usersList.find((u) => u.email.toLowerCase() === cleanEmail);
    if (existingUser) {
      await adminChangeUserRole(actor, existingUser, role);
      return `تمت ترقية الحساب (${existingUser.name}) إلى ${role === 'admin' ? 'مدير عام' : 'مشرف'} بنجاح`;
    }

    await logAuditAction(actor.id, actor.name, `إضافة ${role === 'admin' ? 'مدير عام' : 'مشرف'}`, cleanEmail);
    return `تمت إضافة البريد ${cleanEmail} لقائمة ${role === 'admin' ? 'المديرين' : 'المشرفين'} وسيتم تفعيل الصلاحية تلقائياً عند أول تسجيل دخول`;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function adminRemoveStaff(actor: User, email: string): Promise<void> {
  const cleanEmail = email.trim().toLowerCase();
  if (cleanEmail === actor.email.toLowerCase()) {
    throw new Error('لا يمكنك إزالة بريدك الشخصي من الإدارة');
  }
  if (BOOTSTRAP_ADMIN_EMAILS.includes(cleanEmail)) {
    throw new Error('هذا البريد ضمن قائمة الإدارة الأساسية');
  }
  const path = `designatedStaff/${cleanEmail}`;
  try {
    await deleteDoc(doc(db, 'designatedStaff', cleanEmail));
    await logAuditAction(actor.id, actor.name, 'إزالة بريد من قائمة الإدارة', cleanEmail);
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function adminFetchReports(): Promise<ReportItem[]> {
  try {
    const snap = await getDocs(collection(db, 'reports'));
    const list: ReportItem[] = [];
    snap.forEach((d) => {
      const data = d.data();
      list.push({
        id: d.id,
        reporter_id: String(data.reporterId || ''),
        reporter_name: String(data.reporterName || ''),
        target_type: data.targetType === 'user' ? 'user' : 'ad',
        target_ad_id: data.targetAdId ? String(data.targetAdId) : null,
        target_ad_title: data.targetAdTitle ? String(data.targetAdTitle) : null,
        target_user_id: data.targetUserId ? String(data.targetUserId) : null,
        target_user_name: data.targetUserName ? String(data.targetUserName) : null,
        reason: String(data.reason || ''),
        details: String(data.details || ''),
        status: data.status || 'open',
        admin_note: String(data.adminNote || ''),
        created_at: toIsoString(data.createdAt),
      });
    });
    return list.sort((a, b) => b.created_at.localeCompare(a.created_at));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'reports');
  }
}

export async function adminUpdateReport(
  actor: User,
  reportId: string,
  status: 'reviewed' | 'dismissed'
): Promise<void> {
  const path = `reports/${reportId}`;
  try {
    await updateDoc(doc(db, 'reports', reportId), {
      status,
      adminNote: '',
      updatedAt: serverTimestamp(),
    });
    await logAuditAction(actor.id, actor.name, `معالجة بلاغ (${status})`, reportId);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function adminCreateCategory(actor: User, nameAr: string): Promise<void> {
  await seedDefaultCategoriesIfEmpty();
  const id = slugifyId(nameAr) + '_' + Date.now().toString().slice(-4);
  const path = `categories/${id}`;
  try {
    const existing = await fetchCategories(true);
    const maxSort = existing.reduce((m, c) => Math.max(m, c.sort_order), 0);
    await setDoc(doc(db, 'categories', id), {
      slug: id,
      nameAr: clampStr(nameAr, 100),
      icon: 'Package',
      sortOrder: maxSort + 1,
      isActive: true,
      subcategories: [],
      updatedAt: serverTimestamp(),
    });
    await logAuditAction(actor.id, actor.name, 'إضافة قسم رئيسي', nameAr);
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function adminUpdateCategory(
  actor: User,
  cat: Category,
  updates: { name_ar?: string; is_active?: boolean }
): Promise<void> {
  await seedDefaultCategoriesIfEmpty();
  const path = `categories/${cat.id}`;
  try {
    await updateDoc(doc(db, 'categories', cat.id), {
      nameAr: clampStr(updates.name_ar ?? cat.name_ar, 100),
      isActive: updates.is_active !== undefined ? Boolean(updates.is_active) : cat.is_active,
      updatedAt: serverTimestamp(),
    });
    await logAuditAction(actor.id, actor.name, 'تحديث قسم رئيسي', updates.name_ar ?? cat.name_ar);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function adminAddSubcategory(
  actor: User,
  categoryId: string,
  nameAr: string
): Promise<void> {
  await seedDefaultCategoriesIfEmpty();
  const path = `categories/${categoryId}`;
  try {
    const snap = await getDoc(doc(db, 'categories', categoryId));
    if (!snap.exists()) throw new Error('القسم الرئيسي غير موجود');
    const subs = Array.isArray(snap.data().subcategories) ? [...snap.data().subcategories] : [];
    const subId = `sub_${Date.now().toString(36)}`;
    subs.push({
      id: subId,
      slug: subId,
      nameAr: clampStr(nameAr, 100),
      sortOrder: subs.length + 1,
      isActive: true,
    });
    await updateDoc(doc(db, 'categories', categoryId), {
      subcategories: subs.slice(0, 40),
      updatedAt: serverTimestamp(),
    });
    await logAuditAction(actor.id, actor.name, 'إضافة قسم فرعي', nameAr);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function adminToggleSubcategory(
  actor: User,
  categoryId: string,
  subId: string
): Promise<void> {
  await seedDefaultCategoriesIfEmpty();
  const path = `categories/${categoryId}`;
  try {
    const snap = await getDoc(doc(db, 'categories', categoryId));
    if (!snap.exists()) return;
    const subs = (Array.isArray(snap.data().subcategories) ? snap.data().subcategories : []).map(
      (s: any) => (s.id === subId || s.slug === subId ? { ...s, isActive: !s.isActive } : s)
    );
    await updateDoc(doc(db, 'categories', categoryId), {
      subcategories: subs,
      updatedAt: serverTimestamp(),
    });
    await logAuditAction(actor.id, actor.name, 'تغيير حالة قسم فرعي', subId);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function adminClearSampleAds(actor: User): Promise<number> {
  invalidateApprovedAdsCache();
  try {
    const [adsSnap, heroSnap] = await Promise.all([
      getDocs(query(collection(db, 'ads'), where('isSample', '==', true))),
      getDocs(query(collection(db, 'heroPromotions'), where('isSample', '==', true))),
    ]);
    const batch = writeBatch(db);
    let count = 0;
    adsSnap.forEach((d) => {
      batch.delete(d.ref);
      count++;
    });
    heroSnap.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    await logAuditAction(actor.id, actor.name, 'حذف الإعلانات النموذجية التوضيحية', `المحذوف: ${count}`);
    return count;
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, 'ads');
  }
}

// Unused import suppression helper if needed
export function getCurrentAuthUid(): string | null {
  return auth.currentUser?.uid ?? null;
}
