import { auth } from './firebase';

type ImageProcessOptions = { aspect?: number; maxDim?: number; force?: boolean };

const STORAGE_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const UNSUPPORTED_IMAGE_MSG =
  'صيغة الصورة غير مدعومة، يرجى اختيار صورة بصيغة JPG أو PNG أو WebP';

type DecodedImage = {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
};

// Decodes any browser-readable image (respects EXIF rotation when supported).
async function decodeImage(file: File): Promise<DecodedImage | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as any);
      return {
        source: bmp,
        width: bmp.width,
        height: bmp.height,
        release: () => bmp.close(),
      };
    } catch {
      // fall through to the <img> decoder
    }
  }

  return new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () =>
      resolve({
        source: img,
        width: img.naturalWidth || img.width,
        height: img.naturalHeight || img.height,
        release: () => URL.revokeObjectURL(objectUrl),
      });
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(null);
    };
    img.src = objectUrl;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), type, quality);
    } catch {
      resolve(null);
    }
  });
}

async function compressImageFile(file: File, opts: ImageProcessOptions = {}): Promise<File> {
  if (!file.type.startsWith('image/')) {
    return file;
  }
  // Keep GIFs untouched unless a fixed crop (avatar / banner) is requested
  if (file.type === 'image/gif' && !opts.aspect && !opts.force) {
    return file;
  }

  const isAllowedType = STORAGE_ALLOWED_TYPES.includes(file.type);
  const decoded = await decodeImage(file);

  if (!decoded || !decoded.width || !decoded.height) {
    decoded?.release();
    // Could not decode: keep the original only if the storage accepts its type
    if (isAllowedType) return file;
    throw new Error(UNSUPPORTED_IMAGE_MSG);
  }

  try {
    const MAX_DIM = opts.maxDim || 1280;

    // Optional centered crop to a fixed aspect ratio (avatar = 1, paid banner = 4/3)
    let sx = 0;
    let sy = 0;
    let sw = decoded.width;
    let sh = decoded.height;
    if (opts.aspect) {
      if (sw / sh > opts.aspect) {
        sw = Math.round(sh * opts.aspect);
        sx = Math.round((decoded.width - sw) / 2);
      } else {
        sh = Math.round(sw / opts.aspect);
        sy = Math.round((decoded.height - sh) / 2);
      }
    }

    let width = Math.max(1, sw);
    let height = Math.max(1, sh);
    let resized = false;
    if (width > MAX_DIM || height > MAX_DIM) {
      resized = true;
      if (width >= height) {
        height = Math.max(1, Math.round((height * MAX_DIM) / width));
        width = MAX_DIM;
      } else {
        width = Math.max(1, Math.round((width * MAX_DIM) / height));
        height = MAX_DIM;
      }
    }

    // Skip small, already well-sized images
    if (
      !opts.force &&
      !opts.aspect &&
      !resized &&
      isAllowedType &&
      file.size <= 140 * 1024
    ) {
      return file;
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      if (isAllowedType) return file;
      throw new Error(UNSUPPORTED_IMAGE_MSG);
    }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(decoded.source, sx, sy, sw, sh, 0, 0, width, height);

    // Prefer WebP; fall back to JPEG (white background) where WebP encoding is unavailable
    const qualities = [0.82, 0.7, 0.55];
    let blob: Blob | null = null;
    for (const q of qualities) {
      blob = await canvasToBlob(canvas, 'image/webp', q);
      if (!blob || blob.type !== 'image/webp') {
        const jpegCanvas = document.createElement('canvas');
        jpegCanvas.width = width;
        jpegCanvas.height = height;
        const jctx = jpegCanvas.getContext('2d');
        if (jctx) {
          jctx.fillStyle = '#ffffff';
          jctx.fillRect(0, 0, width, height);
          jctx.drawImage(canvas, 0, 0);
          blob = await canvasToBlob(jpegCanvas, 'image/jpeg', q);
        }
      }
      if (blob && blob.size <= 1.5 * 1024 * 1024) break;
    }

    if (!blob) {
      if (isAllowedType) return file;
      throw new Error(UNSUPPORTED_IMAGE_MSG);
    }
    if (!opts.aspect && !opts.force && !resized && isAllowedType && blob.size >= file.size) {
      return file;
    }

    const baseName = file.name.replace(/\.[^.]+$/, '') || 'image';
    const outExt = blob.type === 'image/jpeg' ? 'jpg' : 'webp';
    return new File([blob], `${baseName}.${outExt}`, { type: blob.type });
  } finally {
    decoded.release();
  }
}

// Supabase Storage (free, no billing card required). The publishable key is public by design.
const SUPABASE_URL: string =
  (import.meta as any).env?.VITE_SUPABASE_URL || 'https://insikjodpyhcwnwvuixn.supabase.co';
const SUPABASE_KEY: string =
  (import.meta as any).env?.VITE_SUPABASE_PUBLISHABLE_KEY ||
  'sb_publishable_eZFNBEDINKiRu7JAzvH4AQ_E4WRmeKr';
const SUPABASE_BUCKET = 'marketplace';

async function uploadToSupabaseStorage(file: File, uid: string): Promise<string> {
  const ext =
    file.type === 'image/webp'
      ? 'webp'
      : file.type === 'image/png'
      ? 'png'
      : file.type === 'image/gif'
      ? 'gif'
      : 'jpg';
  const rand = Math.random().toString(36).slice(2, 10);
  const objectPath = `${uid}/${Date.now()}-${rand}.${ext}`;

  // 20s budget (slow mobile networks); aborted on timeout so the server fallback
  // never creates a duplicate copy of the same image.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(
      `${SUPABASE_URL}/storage/v1/object/${SUPABASE_BUCKET}/${objectPath}`,
      {
        method: 'POST',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': file.type || 'image/jpeg',
          'Cache-Control': 'max-age=31536000',
          'x-upsert': 'false',
        },
        body: file,
        signal: controller.signal,
      }
    );
    if (!res.ok) {
      throw new Error(`supabase-upload-${res.status}`);
    }
    return `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_BUCKET}/${objectPath}`;
  } finally {
    clearTimeout(timer);
  }
}

export async function uploadImages(
  files: FileList | File[],
  options: ImageProcessOptions = {}
): Promise<string[]> {
  const rawList = Array.from(files).slice(0, 6);
  if (rawList.length === 0) return [];

  const compressedFiles = await Promise.all(rawList.map((f) => compressImageFile(f, options)));
  const uid = auth.currentUser?.uid;

  // Attempt cloud storage first so images persist across deployments
  if (uid) {
    try {
      const cloudUrls = await Promise.all(
        compressedFiles.map((file) => uploadToSupabaseStorage(file, uid))
      );
      if (cloudUrls.length === compressedFiles.length) {
        return cloudUrls;
      }
    } catch {
      // Fallback transparently to authenticated server upload when cloud storage is unavailable
    }
  }

  const formData = new FormData();
  compressedFiles.forEach((f) => formData.append('images', f));

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
    throw new Error('تعذر رفع الصور حالياً، يرجى التحقق من اتصال الإنترنت');
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

export function getRemainingDaysLabel(expiresAtIso: string): string {
  if (!expiresAtIso) return '';
  const ms = new Date(expiresAtIso).getTime() - Date.now();
  if (Number.isNaN(ms)) return '';
  if (ms <= 0) return 'منتهي الصلاحية';
  const days = Math.ceil(ms / (1000 * 60 * 60 * 24));
  if (days === 1) return 'ينتهي خلال أقل من يوم';
  if (days === 2) return 'متبقي يومان';
  if (days <= 10) return `متبقي ${days} أيام`;
  return `متبقي ${days} يوماً`;
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

// Paid hero banner images: centered 4:3 crop, max 1200px wide, always re-encoded to WebP
export const BANNER_IMAGE_OPTIONS: ImageProcessOptions = { aspect: 4 / 3, maxDim: 1200, force: true };
