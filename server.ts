import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import multer from 'multer';
import firebaseConfig from './firebase-applet-config.json';
import { registerSanadBridgeRoutes, getPublicApprovedAd, resolveAppBaseUrl } from './server/sanadBridge';

const app = express();
const PORT = Number(process.env.PORT || 3000);

// Number of reverse-proxy hops (Cloud Run / Render = 1). Needed so req.ip is the real client IP.
const trustProxyHops = Number(process.env.TRUST_PROXY ?? 1);
app.set('trust proxy', Number.isFinite(trustProxyHops) ? trustProxyHops : 1);
app.disable('x-powered-by');

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Static uploaded images with safe MIME sniffing protection
app.use(
  '/uploads',
  express.static(UPLOADS_DIR, {
    setHeaders: (res) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
    },
  })
);

// Serve generated assets in production and dev safely
const srcAssetsDir = path.resolve(process.cwd(), 'src/assets');
if (fs.existsSync(srcAssetsDir)) {
  app.use('/src/assets', express.static(srcAssetsDir));
}

// Multer configuration for compressed ad, profile, and receipt image uploads
const ALLOWED_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = ALLOWED_MIME[file.mimetype] || '.jpg';
    const uniqueName = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 6,
  },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME[file.mimetype]) {
      cb(null, true);
    } else {
      cb(new Error('صيغة الصورة غير مدعومة. يرجى استخدام JPG أو PNG أو WebP'));
    }
  },
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

async function verifyFirebaseIdToken(idToken: string): Promise<{
  ok: boolean;
  localId?: string;
  email?: string;
  emailVerified?: boolean;
  disabled?: boolean;
  status?: number;
  error?: string;
}> {
  if (!idToken) {
    return { ok: false, status: 401, error: 'رمز الجلسة مفقود' };
  }
  try {
    const verifyRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseConfig.apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      }
    );
    if (!verifyRes.ok) {
      return { ok: false, status: 401, error: 'جلسة الدخول غير صالحة، يرجى إعادة تسجيل الدخول' };
    }
    const payload = (await verifyRes.json()) as {
      users?: Array<{ localId?: string; email?: string; emailVerified?: boolean; disabled?: boolean }>;
    };
    const account = payload.users?.[0];
    if (!account?.localId || account.disabled) {
      return { ok: false, status: 403, error: 'الحساب غير مصرح له بهذا الإجراء' };
    }
    return {
      ok: true,
      localId: account.localId,
      email: account.email,
      emailVerified: account.emailVerified === true,
      disabled: account.disabled,
    };
  } catch {
    return { ok: false, status: 500, error: 'تعذر التحقق من جلسة المستخدم حالياً' };
  }
}

// Max 40 upload requests per user per hour
const uploadBuckets = new Map<string, { count: number; resetAt: number }>();
function allowUpload(uid: string): boolean {
  const now = Date.now();
  if (uploadBuckets.size > 2000) {
    for (const [k, v] of uploadBuckets) {
      if (v.resetAt <= now) uploadBuckets.delete(k);
    }
  }
  const b = uploadBuckets.get(uid);
  if (!b || b.resetAt <= now) {
    uploadBuckets.set(uid, { count: 1, resetAt: now + 3_600_000 });
    return true;
  }
  if (b.count >= 40) return false;
  b.count += 1;
  return true;
}

// Verify real image content (magic bytes), not just the client-declared MIME type
function hasValidImageSignature(filePath: string): boolean {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(12);
    fs.readSync(fd, buf, 0, 12, 0);
    fs.closeSync(fd);
    const isJpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    const isPng = buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const isGif = buf.subarray(0, 4).toString('ascii') === 'GIF8';
    const isWebp =
      buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP';
    return isJpeg || isPng || isGif || isWebp;
  } catch {
    return false;
  }
}

async function requireFirebaseUploadAuth(req: Request, res: Response, next: express.NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'يرجى تسجيل الدخول لرفع الصور' });
    return;
  }
  const idToken = header.slice('Bearer '.length).trim();
  const result = await verifyFirebaseIdToken(idToken);
  if (!result.ok) {
    res.status(result.status || 401).json({ error: result.error || 'جلسة غير صالحة' });
    return;
  }
  if (!result.emailVerified) {
    res.status(403).json({ error: 'يرجى تأكيد بريدك الإلكتروني قبل رفع الصور' });
    return;
  }
  if (!allowUpload(result.localId || 'unknown')) {
    res.status(429).json({ error: 'تم تجاوز الحد المسموح لرفع الصور، يرجى المحاولة لاحقاً' });
    return;
  }
  next();
}

app.post('/api/upload', requireFirebaseUploadAuth, (req: Request, res: Response) => {
  upload.array('images', 6)(req, res, (err: any) => {
    if (err) {
      res.status(400).json({ error: err.message || 'فشل رفع الصور' });
      return;
    }
    const files = (req.files as Express.Multer.File[]) || [];
    if (files.length === 0) {
      res.status(400).json({ error: 'لم يتم اختيار أي صورة للرفع' });
      return;
    }
    if (!files.every((f) => hasValidImageSignature(f.path))) {
      for (const f of files) {
        fs.unlink(f.path, () => {});
      }
      res.status(400).json({ error: 'أحد الملفات ليس صورة صالحة' });
      return;
    }
    const urls = files.map((f) => `/uploads/${f.filename}`);
    res.status(201).json({ urls });
  });
});

// Mount Sanad Admin Bridge, Webhook Relay, Public Ad Search & Help Proxy
registerSanadBridgeRoutes(app, verifyFirebaseIdToken);

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'المسار المطلوب غير موجود' });
});

app.use((err: any, req: Request, res: Response, next: express.NextFunction) => {
  if (req.path.startsWith('/api')) {
    console.error('API Error:', err);
    res.status(err?.status || 500).json({
      error: err?.message || 'حدث خطأ داخلي في الخادم',
    });
    return;
  }
  next(err);
});

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function injectAdOpenGraph(html: string, ad: Record<string, unknown>, baseUrl: string, adId: string): string {
  const title = `${String(ad.title || 'إعلان')} | سوق أبو جبيهة`;
  const price = Number(ad.price || 0);
  const parts = [
    price > 0 ? `${new Intl.NumberFormat('en-US').format(price)} ج.س` : '',
    String(ad.location || ''),
    String(ad.description || '').replace(/\s+/g, ' ').slice(0, 140),
  ].filter(Boolean);
  const description = parts.join(' — ');
  const images = Array.isArray(ad.images) ? ad.images.map(String) : [];
  let image = images[0] || '';
  if (image.startsWith('/') && !image.startsWith('//') && baseUrl) image = `${baseUrl}${image}`;
  if (!/^https?:\/\//i.test(image)) image = '';
  const url = baseUrl ? `${baseUrl}/ad/${encodeURIComponent(adId)}` : '';

  const tags = [
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
    url ? `<meta property="og:url" content="${escapeHtml(url)}" />` : '',
    image ? `<meta property="og:image" content="${escapeHtml(image)}" />` : '',
  ].filter(Boolean).join('\n    ');

  return html
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(title)}</title>`)
    .replace(/<meta\s+property="og:(?:title|description)"[\s\S]*?\/>/g, '')
    .replace('</head>', `    ${tags}\n  </head>`);
}

async function startServer() {
  const distDir = path.resolve(process.cwd(), 'dist');
  const indexPath = path.join(distDir, 'index.html');
  const isProd = process.env.NODE_ENV === 'production';
  const useVite = !isProd || !fs.existsSync(indexPath);

  if (isProd && useVite) {
    console.warn('تحذير: NODE_ENV=production لكن مجلد dist غير موجود. شغّل "npm run build" أولاً. سيتم استخدام وضع التطوير مؤقتاً.');
  }

  if (useVite) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distDir));

    // Share previews (WhatsApp, Facebook, ...) need per-ad Open Graph tags in the initial HTML
    app.get('/ad/:id', async (req, res, next) => {
      try {
        const adId = String(req.params.id || '');
        if (!/^[a-zA-Z0-9_-]{1,128}$/.test(adId)) {
          next();
          return;
        }
        const ad = await getPublicApprovedAd(adId);
        if (!ad) {
          next();
          return;
        }
        const html = await fs.promises.readFile(indexPath, 'utf8');
        res.setHeader('Cache-Control', 'public, max-age=60');
        res.type('html').send(injectAdOpenGraph(html, ad, resolveAppBaseUrl(req), adId));
      } catch {
        next();
      }
    });

    app.get('/{*splat}', (_req, res) => {
      res.sendFile(indexPath);
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Abu Jubeiha Marketplace running on http://localhost:${PORT}`);
  });
}

startServer();
