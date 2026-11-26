import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import multer from 'multer';
import firebaseConfig from './firebase-applet-config.json';
import { registerSanadBridgeRoutes } from './server/sanadBridge';

const app = express();
const PORT = Number(process.env.PORT || 3000);

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
      users?: Array<{ localId?: string; email?: string; disabled?: boolean }>;
    };
    const account = payload.users?.[0];
    if (!account?.localId || account.disabled) {
      return { ok: false, status: 403, error: 'الحساب غير مصرح له بهذا الإجراء' };
    }
    return {
      ok: true,
      localId: account.localId,
      email: account.email,
      disabled: account.disabled,
    };
  } catch {
    return { ok: false, status: 500, error: 'تعذر التحقق من جلسة المستخدم حالياً' };
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

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Abu Jubeiha Marketplace running on http://localhost:${PORT}`);
  });
}

startServer();
