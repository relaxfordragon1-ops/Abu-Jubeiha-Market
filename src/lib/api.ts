import { getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage';
import { auth, storage } from './firebase';

type ImageProcessOptions = { aspect?: number; maxDim?: number; force?: boolean };

async function compressImageFile(file: File, opts: ImageProcessOptions = {}): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') {
    return file;
  }

  // Skip tiny images already under 140KB
  if (!opts.force && !opts.aspect && file.size <= 140 * 1024) {
    return file;
  }

  return new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      try {
        const MAX_DIM = opts.maxDim || 1280;
        // Optional centered crop to a fixed aspect ratio (used for paid banner images)
        let sx = 0;
        let sy = 0;
        let sw = img.width;
        let sh = img.height;
        if (opts.aspect) {
          if (sw / sh > opts.aspect) {
            sw = Math.round(sh * opts.aspect);
            sx = Math.round((img.width - sw) / 2);
          } else {
            sh = Math.round(sw / opts.aspect);
            sy = Math.round((img.height - sh) / 2);
          }
        }
        let width = sw;
        let height = sh;
        if (width > MAX_DIM || height > MAX_DIM) {
          if (width >= height) {
            height = Math.round((height * MAX_DIM) / width);
            width = MAX_DIM;
          } else {
            width = Math.round((width * MAX_DIM) / height);
            height = MAX_DIM;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(objectUrl);
          resolve(file);
          return;
        }
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, width, height);

        const targetMime = 'image/webp';
        canvas.toBlob(
          (blob) => {
            URL.revokeObjectURL(objectUrl);
            if (!blob || (!opts.aspect && blob.size >= file.size)) {
              resolve(file);
              return;
            }
            const baseName = file.name.replace(/\.[^.]+$/, '') || 'image';
            resolve(new File([blob], `${baseName}.webp`, { type: targetMime }));
          },
          targetMime,
          0.82
        );
      } catch {
        URL.revokeObjectURL(objectUrl);
        resolve(file);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file);
    };

    img.src = objectUrl;
  });
}

async function uploadToFirebaseStorage(file: File, uid: string): Promise<string> {
  const ext = file.type === 'image/webp' ? 'webp' : file.type === 'image/png' ? 'png' : 'jpg';
  const rand = Math.random().toString(36).slice(2, 10);
  const storageRef = ref(storage, `marketplace/${uid}/${Date.now()}-${rand}.${ext}`);

  const task = uploadBytesResumable(storageRef, file, {
    contentType: file.type || 'image/jpeg',
    cacheControl: 'public, max-age=31536000',
  });

  // 20s budget (slow mobile networks); the upload is cancelled on timeout so the
  // server fallback never creates a duplicate copy of the same image.
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      task.cancel();
      reject(new Error('storage-timeout'));
    }, 20000);
    task.on(
      'state_changed',
      undefined,
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
      async () => {
        clearTimeout(timer);
        try {
          resolve(await getDownloadURL(task.snapshot.ref));
        } catch (err) {
          reject(err);
        }
      }
    );
  });
}

export async function uploadImages(
  files: FileList | File[],
  options: ImageProcessOptions = {}
): Promise<string[]> {
  const rawList = Array.from(files).slice(0, 6);
  if (rawList.length === 0) return [];

  const compressedFiles = await Promise.all(rawList.map((f) => compressImageFile(f, options)));
  const uid = auth.currentUser?.uid;

  // Attempt Firebase Cloud Storage first so images persist across deployments
  if (uid) {
    try {
      const cloudUrls = await Promise.all(
        compressedFiles.map((file) => uploadToFirebaseStorage(file, uid))
      );
      if (cloudUrls.length === compressedFiles.length) {
        return cloudUrls;
      }
    } catch {
      // Fallback transparently to authenticated server upload when Storage bucket rules aren't configured
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
