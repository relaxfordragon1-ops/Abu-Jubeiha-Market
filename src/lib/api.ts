import { auth } from './firebase';

export async function uploadImages(files: FileList | File[]): Promise<string[]> {
  const formData = new FormData();
  Array.from(files)
    .slice(0, 6)
    .forEach((f) => formData.append('images', f));

  const headers = new Headers();
  const idToken = await auth.currentUser?.getIdToken();
  if (idToken) {
    headers.set('Authorization', `Bearer ${idToken}`);
  }

  let res: Response;
  try {
    res = await fetch('/api/upload', {
      method: 'POST',
      headers,
      body: formData,
    });
  } catch {
    throw new Error('تعذر رفع الصور إلى الخادم حالياً');
  }

  const rawText = await res.text();
  let data: any = {};
  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch {
    data = {};
  }

  if (!res.ok) {
    throw new Error(data.error || `فشل رفع الصور (رمز الحالة: ${res.status})`);
  }
  return data.urls as string[];
}

export function formatPriceSDG(price: number, adType?: string): string {
  if (!price || price <= 0) {
    if (adType === 'job') return 'الراتب يحدد عند المقابلة';
    if (adType === 'announcement') return 'إعلان مجتمعي';
    if (adType === 'wanted') return 'حسب الاتفاق';
    return 'السعر عند التواصل';
  }
  return `${new Intl.NumberFormat('en-US').format(price)} ج.س`;
}

export function formatArabicDate(isoString: string): string {
  if (!isoString) return '';
  const normalized = isoString.includes('T') ? isoString : isoString.replace(' ', 'T') + 'Z';
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return isoString;
  return new Intl.DateTimeFormat('ar-SD', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

export function buildWhatsAppHref(phone: string, adTitle?: string): string {
  const digits = (phone || '').replace(/[^\d]/g, '');
  const intl = digits.startsWith('0') ? `249${digits.slice(1)}` : digits;
  const text = adTitle
    ? encodeURIComponent(`مرحباً، أتواصل معك بخصوص إعلانك في سوق أبو جبيهة: ${adTitle}`)
    : encodeURIComponent('مرحباً، أتواصل معك عبر سوق أبو جبيهة الإلكتروني');
  return `https://wa.me/${intl}?text=${text}`;
}

export function getAdStatusLabel(status: string): string {
  switch (status) {
    case 'approved':
      return 'منشور';
    case 'pending':
      return 'قيد المراجعة';
    case 'rejected':
      return 'مرفوض';
    case 'sold':
      return 'تم البيع / الإغلاق';
    default:
      return status;
  }
}

export function getAdTypeLabel(adType: string): string {
  switch (adType) {
    case 'wanted':
      return 'مطلوب';
    case 'job':
      return 'وظيفة';
    case 'announcement':
      return 'إعلان مجتمعي';
    default:
      return 'عرض بيع / إيجار';
  }
}

export const ABU_JUBEIHA_AREAS = [
  'أبو جبيهة - الوسط',
  'أبو جبيهة - السوق الكبير',
  'أبو جبيهة - حي المطار',
  'أبو جبيهة - حي السلام',
  'أبو جبيهة - حي النصر',
  'أبو جبيهة - الامتداد الشرقي',
  'أبو جبيهة - سوق المحاصيل',
  'أبو جبيهة - موقف السيارات',
  'القرى والمناطق المجاورة',
];
