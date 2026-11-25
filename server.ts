import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import multer from 'multer';
import firebaseConfig from './firebase-applet-config.json';
import { db, initDatabase, UPLOADS_DIR } from './server/db.ts';
import {
  hashPassword,
  verifyPassword,
  createAccessToken,
  optionalAuth,
  requireAuth,
  requireModeratorOrAdmin,
  requireAdmin,
  type AuthenticatedRequest,
} from './server/auth.ts';
import { matchesSmartSearch, checkProhibitedContent } from './server/search.ts';

initDatabase();

const app = express();
const PORT = 3000;

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

// Multer configuration for ad & profile image uploads
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
    fileSize: 5 * 1024 * 1024, // 5MB per image
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

function logAudit(actorId: number | null, action: string, targetInfo = ''): void {
  db.prepare('INSERT INTO audit_logs (actor_id, action, target_info) VALUES (?, ?, ?)').run(
    actorId,
    action,
    targetInfo
  );
}

function hydrateAds(adRows: any[], viewerUserId?: number) {
  if (adRows.length === 0) return [];
  const adIds = adRows.map((a) => a.id);
  const placeholders = adIds.map(() => '?').join(',');
  const images = db
    .prepare(
      `SELECT ad_id, url, sort_order FROM ad_images WHERE ad_id IN (${placeholders}) ORDER BY sort_order ASC, id ASC`
    )
    .all(...adIds) as Array<{ ad_id: number; url: string; sort_order: number }>;

  const imgMap = new Map<number, string[]>();
  for (const img of images) {
    const arr = imgMap.get(img.ad_id) ?? [];
    arr.push(img.url);
    imgMap.set(img.ad_id, arr);
  }

  let favSet = new Set<number>();
  if (viewerUserId) {
    const favRows = db
      .prepare(`SELECT ad_id FROM favorites WHERE user_id = ? AND ad_id IN (${placeholders})`)
      .all(viewerUserId, ...adIds) as Array<{ ad_id: number }>;
    favSet = new Set(favRows.map((f) => f.ad_id));
  }

  return adRows.map((row) => ({
    ...row,
    is_negotiable: Boolean(row.is_negotiable),
    has_verified_docs: Boolean(row.has_verified_docs),
    is_featured: Boolean(row.is_featured),
    is_sample: Boolean(row.is_sample),
    owner_verified: Boolean(row.owner_verified),
    images: imgMap.get(row.id) ?? [],
    is_favorited: favSet.has(row.id),
  }));
}

function safeUnlinkUpload(urlPath: string): void {
  if (!urlPath.startsWith('/uploads/')) return;
  const filename = urlPath.slice('/uploads/'.length);
  if (!filename || filename.includes('/') || filename.includes('\\')) return;
  const resolved = path.resolve(UPLOADS_DIR, filename);
  if (!resolved.startsWith(UPLOADS_DIR + path.sep)) return;
  if (fs.existsSync(resolved)) {
    try {
      fs.unlinkSync(resolved);
    } catch {
      // ignore unlink failure
    }
  }
}

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// ==================== AUTH & PROFILE ROUTES ====================

function getConfiguredAdminPasscode(): string {
  const raw = process.env.ADMIN_PASSCODE?.trim() ?? '';
  if (!raw || raw.startsWith('MY_')) return '';
  return raw;
}

app.get('/api/auth/bootstrap-status', (_req, res) => {
  const adminCount = (db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'admin'").get() as { c: number }).c;
  const adminPasscode = getConfiguredAdminPasscode();
  res.json({
    hasAdmin: adminCount > 0,
    requiresPasscode: Boolean(adminPasscode),
  });
});

app.post('/api/auth/claim-admin', (req: Request, res: Response) => {
  const { name, email, password, phone, passcode } = req.body ?? {};
  const cleanEmail = String(email ?? '').trim().toLowerCase();
  const designated = db
    .prepare('SELECT role FROM designated_staff WHERE email = ?')
    .get(cleanEmail) as { role: 'admin' | 'moderator' } | undefined;
  const isDesignatedAdmin = designated?.role === 'admin';

  const adminPasscode = getConfiguredAdminPasscode();
  const adminCount = (db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'admin'").get() as { c: number }).c;

  if (!isDesignatedAdmin) {
    if (adminCount > 0) {
      if (!adminPasscode || String(passcode ?? '').trim() !== adminPasscode) {
        res.status(403).json({ error: 'تم إعداد حساب المدير العام مسبقاً ولا يمكن استخدام التفعيل الأولي' });
        return;
      }
    } else if (adminPasscode && String(passcode ?? '').trim() !== adminPasscode) {
      res.status(403).json({ error: 'رمز تفعيل الإدارة غير صحيح' });
      return;
    }
  }

  const cleanName = String(name ?? '').trim();
  const cleanPassword = String(password ?? '');

  if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    res.status(400).json({ error: 'يرجى إدخال بريد إلكتروني صحيح' });
    return;
  }
  if (cleanPassword.length < 6) {
    res.status(400).json({ error: 'يجب أن تتكون كلمة المرور من 6 أحرف على الأقل' });
    return;
  }

  const existing = db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(cleanEmail) as
    | { id: number; password_hash: string }
    | undefined;

  let userId: number;
  if (existing) {
    if (!verifyPassword(cleanPassword, existing.password_hash)) {
      res.status(401).json({ error: 'كلمة المرور غير مطابقة للحساب الموجود' });
      return;
    }
    db.prepare("UPDATE users SET role = 'admin', is_verified_account = 1 WHERE id = ?").run(existing.id);
    userId = existing.id;
  } else {
    if (cleanName.length < 2) {
      res.status(400).json({ error: 'يرجى إدخال الاسم الكامل' });
      return;
    }
    const info = db
      .prepare(
        `INSERT INTO users (name, email, password_hash, phone, location, role, is_verified_account, is_sample)
         VALUES (?, ?, ?, ?, 'أبو جبيهة - الإدارة', 'admin', 1, 0)`
      )
      .run(cleanName, cleanEmail, hashPassword(cleanPassword), String(phone ?? '').trim());
    userId = Number(info.lastInsertRowid);
  }

  logAudit(userId, 'تفعيل حساب المدير العام', cleanEmail);
  const user = db
    .prepare(
      'SELECT id, name, email, phone, location, avatar_url, role, is_blocked, is_verified_account, created_at FROM users WHERE id = ?'
    )
    .get(userId);
  const token = createAccessToken(userId);
  res.status(201).json({ token, user });
});

app.post('/api/auth/register', (req: Request, res: Response) => {
  const { name, email, password, phone, location } = req.body ?? {};
  const cleanName = String(name ?? '').trim();
  const cleanEmail = String(email ?? '').trim().toLowerCase();
  const cleanPassword = String(password ?? '');
  const cleanPhone = String(phone ?? '').trim();
  const cleanLocation = String(location ?? 'أبو جبيهة - الوسط').trim() || 'أبو جبيهة - الوسط';

  if (cleanName.length < 2 || cleanName.length > 80) {
    res.status(400).json({ error: 'يرجى إدخال اسم صحيح (من حرفين إلى 80 حرفاً)' });
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    res.status(400).json({ error: 'يرجى إدخال بريد إلكتروني صحيح' });
    return;
  }
  if (cleanPassword.length < 6) {
    res.status(400).json({ error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
    return;
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
  if (existing) {
    res.status(409).json({ error: 'البريد الإلكتروني مسجل مسبقاً' });
    return;
  }

  const designated = db
    .prepare('SELECT role FROM designated_staff WHERE email = ?')
    .get(cleanEmail) as { role: 'admin' | 'moderator' } | undefined;
  const assignedRole = designated?.role ?? 'user';
  const verifiedInitial = designated ? 1 : 0;

  const passwordHash = hashPassword(cleanPassword);
  const info = db
    .prepare(
      `INSERT INTO users (name, email, password_hash, phone, location, role, is_verified_account, is_sample)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`
    )
    .run(cleanName, cleanEmail, passwordHash, cleanPhone, cleanLocation, assignedRole, verifiedInitial);

  const userId = Number(info.lastInsertRowid);
  if (designated) {
    logAudit(userId, `تفعيل حساب ${assignedRole === 'admin' ? 'مدير عام' : 'مشرف'}`, cleanEmail);
  }
  const user = db
    .prepare(
      'SELECT id, name, email, phone, location, avatar_url, role, is_blocked, is_verified_account, created_at FROM users WHERE id = ?'
    )
    .get(userId);
  const token = createAccessToken(userId);
  res.status(201).json({ token, user });
});

app.post('/api/auth/login', (req: Request, res: Response) => {
  const { email, password } = req.body ?? {};
  const cleanEmail = String(email ?? '').trim().toLowerCase();
  const cleanPassword = String(password ?? '');

  if (!cleanEmail || !cleanPassword) {
    res.status(400).json({ error: 'يرجى إدخال البريد الإلكتروني وكلمة المرور' });
    return;
  }

  const row = db
    .prepare(
      `SELECT id, name, email, password_hash, phone, location, avatar_url, role, is_blocked, is_verified_account, is_sample, created_at
       FROM users WHERE email = ?`
    )
    .get(cleanEmail) as any;

  if (!row || row.is_sample || !verifyPassword(cleanPassword, row.password_hash)) {
    res.status(401).json({ error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' });
    return;
  }
  if (row.is_blocked) {
    res.status(403).json({ error: 'تم حظر هذا الحساب لمخالفة شروط السوق' });
    return;
  }

  const designated = db
    .prepare('SELECT role FROM designated_staff WHERE email = ?')
    .get(cleanEmail) as { role: 'admin' | 'moderator' } | undefined;
  if (designated && row.role !== designated.role && row.role !== 'admin') {
    db.prepare('UPDATE users SET role = ?, is_verified_account = 1 WHERE id = ?').run(
      designated.role,
      row.id
    );
    row.role = designated.role;
    row.is_verified_account = 1;
  }

  const { password_hash: _ph, is_sample: _is, ...safeUser } = row;
  const token = createAccessToken(row.id);
  res.json({ token, user: safeUser });
});

app.post('/api/auth/forgot-password', (req: Request, res: Response) => {
  const cleanEmail = String(req.body?.email ?? '').trim().toLowerCase();
  if (!cleanEmail) {
    res.status(400).json({ error: 'يرجى إدخال البريد الإلكتروني' });
    return;
  }
  const user = db.prepare('SELECT id, is_sample FROM users WHERE email = ?').get(cleanEmail) as
    | { id: number; is_sample: number }
    | undefined;

  if (!user || user.is_sample) {
    res.json({
      message: 'إذا كان البريد الإلكتروني مسجلاً لدينا فسيتم إصدار رمز الاستعادة',
    });
    return;
  }

  const code = String(crypto.randomInt(100000, 999999));
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  db.prepare('UPDATE password_resets SET used = 1 WHERE user_id = ?').run(user.id);
  db.prepare('INSERT INTO password_resets (user_id, code, expires_at) VALUES (?, ?, ?)').run(
    user.id,
    code,
    expiresAt
  );

  // Since preview has no external SMTP configured, return the verification code directly for testing & usability
  res.json({
    message: 'تم إنشاء رمز التحقق لاستعادة كلمة المرور (صالح لمدة 15 دقيقة)',
    verificationCode: code,
  });
});

app.post('/api/auth/reset-password', (req: Request, res: Response) => {
  const cleanEmail = String(req.body?.email ?? '').trim().toLowerCase();
  const code = String(req.body?.code ?? '').trim();
  const newPassword = String(req.body?.newPassword ?? '');

  if (!cleanEmail || !code || newPassword.length < 6) {
    res.status(400).json({ error: 'يرجى إدخال البريد والرمز وكلمة مرور جديدة (6 أحرف على الأقل)' });
    return;
  }

  const user = db.prepare('SELECT id FROM users WHERE email = ? AND is_sample = 0').get(cleanEmail) as
    | { id: number }
    | undefined;
  if (!user) {
    res.status(400).json({ error: 'بيانات الاستعادة غير صالحة' });
    return;
  }

  const resetRow = db
    .prepare(
      `SELECT id, expires_at FROM password_resets
       WHERE user_id = ? AND code = ? AND used = 0
       ORDER BY id DESC LIMIT 1`
    )
    .get(user.id, code) as { id: number; expires_at: string } | undefined;

  if (!resetRow || new Date(resetRow.expires_at).getTime() < Date.now()) {
    res.status(400).json({ error: 'رمز التحقق غير صحيح أو منتهي الصلاحية' });
    return;
  }

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), user.id);
  db.prepare('UPDATE password_resets SET used = 1 WHERE id = ?').run(resetRow.id);
  res.json({ message: 'تم تحديث كلمة المرور بنجاح، يمكنك تسجيل الدخول الآن' });
});

app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const unreadMessages = (
    db.prepare('SELECT COUNT(*) as c FROM messages WHERE receiver_id = ? AND is_read = 0').get(userId) as {
      c: number;
    }
  ).c;
  const favoritesCount = (
    db.prepare('SELECT COUNT(*) as c FROM favorites WHERE user_id = ?').get(userId) as { c: number }
  ).c;
  const myAdsCount = (
    db.prepare('SELECT COUNT(*) as c FROM ads WHERE user_id = ?').get(userId) as { c: number }
  ).c;
  res.json({
    user: req.user,
    stats: { unreadMessages, favoritesCount, myAdsCount },
  });
});

app.put('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const { name, phone, location, avatar_url, currentPassword, newPassword } = req.body ?? {};
  const cleanName = String(name ?? req.user!.name).trim();
  const cleanPhone = String(phone ?? req.user!.phone).trim();
  const cleanLocation = String(location ?? req.user!.location).trim();
  const cleanAvatar = String(avatar_url ?? req.user!.avatar_url).trim();

  if (cleanName.length < 2 || cleanName.length > 80) {
    res.status(400).json({ error: 'يرجى إدخال اسم صحيح' });
    return;
  }

  if (cleanAvatar && !cleanAvatar.startsWith('/uploads/') && !cleanAvatar.startsWith('/src/assets/')) {
    res.status(400).json({ error: 'رابط الصورة غير صالح' });
    return;
  }

  if (newPassword) {
    if (String(newPassword).length < 6) {
      res.status(400).json({ error: 'كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل' });
      return;
    }
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as {
      password_hash: string;
    };
    if (!currentPassword || !verifyPassword(String(currentPassword), row.password_hash)) {
      res.status(400).json({ error: 'كلمة المرور الحالية غير صحيحة' });
      return;
    }
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(
      hashPassword(String(newPassword)),
      userId
    );
  }

  db.prepare(
    'UPDATE users SET name = ?, phone = ?, location = ?, avatar_url = ? WHERE id = ?'
  ).run(cleanName, cleanPhone, cleanLocation, cleanAvatar, userId);

  const updated = db
    .prepare(
      'SELECT id, name, email, phone, location, avatar_url, role, is_blocked, is_verified_account, created_at FROM users WHERE id = ?'
    )
    .get(userId);
  res.json({ user: updated });
});

// ==================== UPLOAD ROUTE ====================

async function requireFirebaseUploadAuth(req: Request, res: Response, next: any) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'يرجى تسجيل الدخول لرفع الصور' });
    return;
  }
  const idToken = header.slice('Bearer '.length).trim();
  if (!idToken) {
    res.status(401).json({ error: 'رمز الجلسة مفقود' });
    return;
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
      res.status(401).json({ error: 'جلسة الدخول غير صالحة، يرجى إعادة تسجيل الدخول' });
      return;
    }
    const payload = (await verifyRes.json()) as { users?: Array<{ localId?: string; disabled?: boolean }> };
    const account = payload.users?.[0];
    if (!account?.localId || account.disabled) {
      res.status(403).json({ error: 'الحساب غير مصرح له برفع الملفات' });
      return;
    }
    next();
  } catch {
    res.status(500).json({ error: 'تعذر التحقق من جلسة الرفع حالياً' });
  }
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

// ==================== CATEGORIES ROUTES ====================

app.get('/api/categories', optionalAuth, (req: AuthenticatedRequest, res: Response) => {
  const includeInactive =
    req.query.includeInactive === '1' &&
    req.user &&
    (req.user.role === 'admin' || req.user.role === 'moderator');

  const cats = db
    .prepare(
      `SELECT c.*, (
         SELECT COUNT(*) FROM ads a WHERE a.category_id = c.id AND a.status = 'approved'
       ) as ads_count
       FROM categories c
       ${includeInactive ? '' : 'WHERE c.is_active = 1'}
       ORDER BY c.sort_order ASC, c.id ASC`
    )
    .all() as any[];

  const subs = db
    .prepare(
      `SELECT * FROM subcategories
       ${includeInactive ? '' : 'WHERE is_active = 1'}
       ORDER BY sort_order ASC, id ASC`
    )
    .all() as any[];

  const subMap = new Map<number, any[]>();
  for (const s of subs) {
    const arr = subMap.get(s.category_id) ?? [];
    arr.push({ ...s, is_active: Boolean(s.is_active) });
    subMap.set(s.category_id, arr);
  }

  res.json({
    categories: cats.map((c) => ({
      ...c,
      is_active: Boolean(c.is_active),
      subcategories: subMap.get(c.id) ?? [],
    })),
  });
});

// ==================== ADS ROUTES ====================

app.get('/api/ads', optionalAuth, (req: AuthenticatedRequest, res: Response) => {
  const {
    q = '',
    category = '',
    subcategory = '',
    minPrice = '',
    maxPrice = '',
    location = '',
    adType = '',
    featured = '',
    sort = 'latest',
    mine = '',
    userId = '',
  } = req.query as Record<string, string>;

  const where: string[] = [];
  const params: any[] = [];

  if (mine === '1') {
    if (!req.user) {
      res.status(401).json({ error: 'يرجى تسجيل الدخول لعرض إعلاناتك' });
      return;
    }
    where.push('a.user_id = ?');
    params.push(req.user.id);
  } else {
    where.push("a.status = 'approved'");
    if (userId && /^\d+$/.test(userId)) {
      where.push('a.user_id = ?');
      params.push(Number(userId));
    }
  }

  if (category) {
    if (/^\d+$/.test(category)) {
      where.push('a.category_id = ?');
      params.push(Number(category));
    } else {
      where.push('c.slug = ?');
      params.push(category);
    }
  }

  if (subcategory) {
    if (/^\d+$/.test(subcategory)) {
      where.push('a.subcategory_id = ?');
      params.push(Number(subcategory));
    } else {
      where.push('sc.slug = ?');
      params.push(subcategory);
    }
  }

  if (minPrice !== '' && !Number.isNaN(Number(minPrice))) {
    where.push('a.price >= ?');
    params.push(Number(minPrice));
  }
  if (maxPrice !== '' && !Number.isNaN(Number(maxPrice))) {
    where.push('a.price <= ?');
    params.push(Number(maxPrice));
  }

  if (adType && ['offer', 'wanted', 'job', 'announcement'].includes(adType)) {
    where.push('a.ad_type = ?');
    params.push(adType);
  }

  if (featured === '1') {
    where.push('a.is_featured = 1');
  }

  let orderBy = 'a.is_featured DESC, a.created_at DESC, a.id DESC';
  if (sort === 'price_asc') orderBy = 'a.price ASC, a.created_at DESC';
  else if (sort === 'price_desc') orderBy = 'a.price DESC, a.created_at DESC';
  else if (sort === 'popular') orderBy = 'a.views_count DESC, a.created_at DESC';
  else if (sort === 'latest') orderBy = 'a.created_at DESC, a.id DESC';

  const sql = `
    SELECT a.*,
           c.name_ar as category_name, c.slug as category_slug,
           sc.name_ar as subcategory_name, sc.slug as subcategory_slug,
           u.name as owner_name, u.avatar_url as owner_avatar, u.is_verified_account as owner_verified
    FROM ads a
    JOIN categories c ON c.id = a.category_id
    LEFT JOIN subcategories sc ON sc.id = a.subcategory_id
    JOIN users u ON u.id = a.user_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY ${orderBy}
  `;

  let rows = db.prepare(sql).all(...params) as any[];

  if (q && q.trim()) {
    rows = rows.filter((r) =>
      matchesSmartSearch(q, [
        r.title,
        r.description,
        r.location,
        r.category_name,
        r.subcategory_name,
        r.document_info,
        String(r.price),
      ])
    );
  }

  if (location && location.trim()) {
    rows = rows.filter((r) => matchesSmartSearch(location, [r.location]));
  }

  res.json({ ads: hydrateAds(rows, req.user?.id) });
});

app.get('/api/ads/:id', optionalAuth, (req: AuthenticatedRequest, res: Response) => {
  const adId = Number(req.params.id);
  if (!Number.isInteger(adId) || adId <= 0) {
    res.status(400).json({ error: 'معرف الإعلان غير صالح' });
    return;
  }

  const row = db
    .prepare(
      `SELECT a.*,
              c.name_ar as category_name, c.slug as category_slug,
              sc.name_ar as subcategory_name, sc.slug as subcategory_slug,
              u.name as owner_name, u.avatar_url as owner_avatar, u.is_verified_account as owner_verified,
              u.location as owner_location, u.created_at as owner_joined_at
       FROM ads a
       JOIN categories c ON c.id = a.category_id
       LEFT JOIN subcategories sc ON sc.id = a.subcategory_id
       JOIN users u ON u.id = a.user_id
       WHERE a.id = ?`
    )
    .get(adId) as any;

  if (!row) {
    res.status(404).json({ error: 'الإعلان غير موجود' });
    return;
  }

  const isOwner = req.user?.id === row.user_id;
  const isStaff = req.user?.role === 'admin' || req.user?.role === 'moderator';
  if (row.status !== 'approved' && !isOwner && !isStaff) {
    res.status(404).json({ error: 'الإعلان غير متاح للعرض العام حالياً' });
    return;
  }

  if (row.status === 'approved' && !isOwner) {
    db.prepare('UPDATE ads SET views_count = views_count + 1 WHERE id = ?').run(adId);
    row.views_count += 1;
  }

  const [hydrated] = hydrateAds([row], req.user?.id);
  res.json({ ad: hydrated });
});

app.post('/api/ads', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const {
    title,
    category_id,
    subcategory_id,
    description,
    price,
    is_negotiable,
    ad_type,
    location,
    contact_phone,
    contact_whatsapp,
    document_info,
    images,
  } = req.body ?? {};

  const cleanTitle = String(title ?? '').trim();
  const cleanDesc = String(description ?? '').trim();
  const cleanLocation = String(location ?? '').trim();
  const cleanPhone = String(contact_phone ?? '').trim();
  const cleanWhatsapp = String(contact_whatsapp ?? cleanPhone).trim();
  const cleanDocInfo = String(document_info ?? '').trim();
  const catId = Number(category_id);
  const subId = subcategory_id ? Number(subcategory_id) : null;
  const numPrice = Number(price ?? 0);
  const validTypes = ['offer', 'wanted', 'job', 'announcement'];
  const cleanType = validTypes.includes(ad_type) ? ad_type : 'offer';

  if (cleanTitle.length < 4 || cleanTitle.length > 140) {
    res.status(400).json({ error: 'عنوان الإعلان يجب أن يكون بين 4 و 140 حرفاً' });
    return;
  }
  if (cleanDesc.length < 10 || cleanDesc.length > 4000) {
    res.status(400).json({ error: 'وصف الإعلان يجب أن يكون بين 10 و 4000 حرف' });
    return;
  }
  if (!Number.isInteger(catId)) {
    res.status(400).json({ error: 'يرجى اختيار القسم الرئيسي' });
    return;
  }
  if (Number.isNaN(numPrice) || numPrice < 0) {
    res.status(400).json({ error: 'السعر غير صالح' });
    return;
  }
  if (cleanLocation.length < 2) {
    res.status(400).json({ error: 'يرجى تحديد الموقع أو الحي في أبو جبيهة' });
    return;
  }
  if (cleanPhone.length < 6) {
    res.status(400).json({ error: 'يرجى إدخال رقم هاتف صحيح للتواصل' });
    return;
  }

  const safetyError = checkProhibitedContent(`${cleanTitle} ${cleanDesc} ${cleanDocInfo}`);
  if (safetyError) {
    res.status(400).json({ error: safetyError });
    return;
  }

  const catExists = db.prepare('SELECT id, slug FROM categories WHERE id = ? AND is_active = 1').get(catId) as
    | { id: number; slug: string }
    | undefined;
  if (!catExists) {
    res.status(400).json({ error: 'القسم المختار غير متاح' });
    return;
  }

  if (subId) {
    const subExists = db
      .prepare('SELECT id FROM subcategories WHERE id = ? AND category_id = ?')
      .get(subId, catId);
    if (!subExists) {
      res.status(400).json({ error: 'القسم الفرعي غير متطابق مع القسم الرئيسي' });
      return;
    }
  }

  // Derive ad_type automatically for wanted/jobs/community if not explicitly chosen
  let finalType = cleanType;
  if (catExists.slug === 'wanted') finalType = 'wanted';
  else if (catExists.slug === 'jobs') finalType = 'job';
  else if (catExists.slug === 'community') finalType = 'announcement';

  const cleanImages: string[] = Array.isArray(images)
    ? images
        .map((u) => String(u).trim())
        .filter((u) => u.startsWith('/uploads/') || u.startsWith('/src/assets/'))
        .slice(0, 6)
    : [];

  // Staff ads go live directly; standard user ads enter pending review queue
  const initialStatus =
    req.user!.role === 'admin' || req.user!.role === 'moderator' ? 'approved' : 'pending';

  const adId = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO ads (
          user_id, category_id, subcategory_id, title, description, price, is_negotiable,
          ad_type, location, contact_phone, contact_whatsapp, document_info, status, is_sample
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
      )
      .run(
        req.user!.id,
        catId,
        subId,
        cleanTitle,
        cleanDesc,
        numPrice,
        is_negotiable ? 1 : 0,
        finalType,
        cleanLocation,
        cleanPhone,
        cleanWhatsapp,
        cleanDocInfo,
        initialStatus
      );
    const createdId = Number(info.lastInsertRowid);
    const insImg = db.prepare('INSERT INTO ad_images (ad_id, url, sort_order) VALUES (?, ?, ?)');
    cleanImages.forEach((url, idx) => insImg.run(createdId, url, idx + 1));
    return createdId;
  })();

  const created = db
    .prepare(
      `SELECT a.*, c.name_ar as category_name, c.slug as category_slug,
              sc.name_ar as subcategory_name, sc.slug as subcategory_slug,
              u.name as owner_name, u.avatar_url as owner_avatar, u.is_verified_account as owner_verified
       FROM ads a
       JOIN categories c ON c.id = a.category_id
       LEFT JOIN subcategories sc ON sc.id = a.subcategory_id
       JOIN users u ON u.id = a.user_id
       WHERE a.id = ?`
    )
    .get(adId);

  res.status(201).json({
    ad: hydrateAds([created], req.user!.id)[0],
    message:
      initialStatus === 'approved'
        ? 'تم نشر الإعلان بنجاح'
        : 'تم إرسال إعلانك بنجاح وهو قيد المراجعة من إدارة السوق قبل النشر العام',
  });
});

app.put('/api/ads/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const adId = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM ads WHERE id = ?').get(adId) as any;
  if (!existing) {
    res.status(404).json({ error: 'الإعلان غير موجود' });
    return;
  }

  const isStaff = req.user!.role === 'admin' || req.user!.role === 'moderator';
  if (existing.user_id !== req.user!.id && !isStaff) {
    res.status(403).json({ error: 'لا تملك صلاحية تعديل هذا الإعلان' });
    return;
  }

  const {
    title,
    category_id,
    subcategory_id,
    description,
    price,
    is_negotiable,
    ad_type,
    location,
    contact_phone,
    contact_whatsapp,
    document_info,
    images,
  } = req.body ?? {};

  const cleanTitle = String(title ?? existing.title).trim();
  const cleanDesc = String(description ?? existing.description).trim();
  const cleanLocation = String(location ?? existing.location).trim();
  const cleanPhone = String(contact_phone ?? existing.contact_phone).trim();
  const cleanWhatsapp = String(contact_whatsapp ?? existing.contact_whatsapp).trim();
  const cleanDocInfo = String(document_info ?? existing.document_info).trim();
  const catId = Number(category_id ?? existing.category_id);
  const subId = subcategory_id !== undefined ? (subcategory_id ? Number(subcategory_id) : null) : existing.subcategory_id;
  const numPrice = Number(price ?? existing.price);
  const cleanType = ['offer', 'wanted', 'job', 'announcement'].includes(ad_type) ? ad_type : existing.ad_type;

  if (cleanTitle.length < 4 || cleanDesc.length < 10 || cleanLocation.length < 2 || cleanPhone.length < 6) {
    res.status(400).json({ error: 'يرجى التأكد من اكتمال جميع الحقول الأساسية بشكل صحيح' });
    return;
  }

  const safetyError = checkProhibitedContent(`${cleanTitle} ${cleanDesc} ${cleanDocInfo}`);
  if (safetyError) {
    res.status(400).json({ error: safetyError });
    return;
  }

  const nextStatus = isStaff ? existing.status : 'pending';

  db.transaction(() => {
    db.prepare(
      `UPDATE ads SET
        category_id = ?, subcategory_id = ?, title = ?, description = ?, price = ?,
        is_negotiable = ?, ad_type = ?, location = ?, contact_phone = ?, contact_whatsapp = ?,
        document_info = ?, status = ?, rejection_reason = '', updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      catId,
      subId,
      cleanTitle,
      cleanDesc,
      numPrice,
      is_negotiable ? 1 : 0,
      cleanType,
      cleanLocation,
      cleanPhone,
      cleanWhatsapp,
      cleanDocInfo,
      nextStatus,
      adId
    );

    if (Array.isArray(images)) {
      const cleanImages = images
        .map((u) => String(u).trim())
        .filter((u) => u.startsWith('/uploads/') || u.startsWith('/src/assets/'))
        .slice(0, 6);
      db.prepare('DELETE FROM ad_images WHERE ad_id = ?').run(adId);
      const insImg = db.prepare('INSERT INTO ad_images (ad_id, url, sort_order) VALUES (?, ?, ?)');
      cleanImages.forEach((url, idx) => insImg.run(adId, url, idx + 1));
    }
  })();

  const updated = db
    .prepare(
      `SELECT a.*, c.name_ar as category_name, c.slug as category_slug,
              sc.name_ar as subcategory_name, sc.slug as subcategory_slug,
              u.name as owner_name, u.avatar_url as owner_avatar, u.is_verified_account as owner_verified
       FROM ads a
       JOIN categories c ON c.id = a.category_id
       LEFT JOIN subcategories sc ON sc.id = a.subcategory_id
       JOIN users u ON u.id = a.user_id
       WHERE a.id = ?`
    )
    .get(adId);

  res.json({
    ad: hydrateAds([updated], req.user!.id)[0],
    message: isStaff ? 'تم تحديث الإعلان' : 'تم تحديث الإعلان وإرساله للمراجعة',
  });
});

app.patch('/api/ads/:id/status', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const adId = Number(req.params.id);
  const { status } = req.body ?? {};
  const existing = db.prepare('SELECT * FROM ads WHERE id = ?').get(adId) as any;
  if (!existing) {
    res.status(404).json({ error: 'الإعلان غير موجود' });
    return;
  }

  const isStaff = req.user!.role === 'admin' || req.user!.role === 'moderator';
  if (existing.user_id !== req.user!.id && !isStaff) {
    res.status(403).json({ error: 'غير مصرح لك بتغيير حالة هذا الإعلان' });
    return;
  }

  if (!['sold', 'pending', 'approved'].includes(status)) {
    res.status(400).json({ error: 'حالة غير صالحة' });
    return;
  }
  if (status === 'approved' && !isStaff) {
    res.status(403).json({ error: 'اعتماد الإعلانات متاح للإدارة فقط' });
    return;
  }

  db.prepare("UPDATE ads SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, adId);
  res.json({ ok: true, status });
});

app.delete('/api/ads/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const adId = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM ads WHERE id = ?').get(adId) as any;
  if (!existing) {
    res.status(404).json({ error: 'الإعلان غير موجود' });
    return;
  }
  const isStaff = req.user!.role === 'admin' || req.user!.role === 'moderator';
  if (existing.user_id !== req.user!.id && !isStaff) {
    res.status(403).json({ error: 'غير مصرح لك بحذف هذا الإعلان' });
    return;
  }

  const imgs = db.prepare('SELECT url FROM ad_images WHERE ad_id = ?').all(adId) as Array<{ url: string }>;
  db.prepare('DELETE FROM ads WHERE id = ?').run(adId);
  imgs.forEach((img) => safeUnlinkUpload(img.url));
  if (isStaff && existing.user_id !== req.user!.id) {
    logAudit(req.user!.id, 'حذف إعلان', `إعلان #${adId}: ${existing.title}`);
  }
  res.json({ ok: true });
});

// ==================== FAVORITES ROUTES ====================

app.get('/api/favorites', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const rows = db
    .prepare(
      `SELECT a.*, c.name_ar as category_name, c.slug as category_slug,
              sc.name_ar as subcategory_name, sc.slug as subcategory_slug,
              u.name as owner_name, u.avatar_url as owner_avatar, u.is_verified_account as owner_verified
       FROM favorites f
       JOIN ads a ON a.id = f.ad_id
       JOIN categories c ON c.id = a.category_id
       LEFT JOIN subcategories sc ON sc.id = a.subcategory_id
       JOIN users u ON u.id = a.user_id
       WHERE f.user_id = ? AND a.status = 'approved'
       ORDER BY f.created_at DESC`
    )
    .all(req.user!.id) as any[];

  res.json({ ads: hydrateAds(rows, req.user!.id) });
});

app.post('/api/favorites/:adId', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const adId = Number(req.params.adId);
  const ad = db.prepare("SELECT id FROM ads WHERE id = ? AND status = 'approved'").get(adId);
  if (!ad) {
    res.status(404).json({ error: 'الإعلان غير موجود' });
    return;
  }

  const exists = db
    .prepare('SELECT 1 FROM favorites WHERE user_id = ? AND ad_id = ?')
    .get(req.user!.id, adId);

  if (exists) {
    db.prepare('DELETE FROM favorites WHERE user_id = ? AND ad_id = ?').run(req.user!.id, adId);
    res.json({ favorited: false });
  } else {
    db.prepare('INSERT INTO favorites (user_id, ad_id) VALUES (?, ?)').run(req.user!.id, adId);
    res.json({ favorited: true });
  }
});

// ==================== INTERNAL MESSAGING ROUTES ====================

app.get('/api/messages/conversations', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const rows = db
    .prepare(
      `SELECT m.*,
              s.name as sender_name, s.avatar_url as sender_avatar, s.is_verified_account as sender_verified,
              r.name as receiver_name, r.avatar_url as receiver_avatar, r.is_verified_account as receiver_verified,
              a.title as ad_title
       FROM messages m
       JOIN users s ON s.id = m.sender_id
       JOIN users r ON r.id = m.receiver_id
       LEFT JOIN ads a ON a.id = m.ad_id
       WHERE m.sender_id = ? OR m.receiver_id = ?
       ORDER BY m.created_at DESC, m.id DESC`
    )
    .all(userId, userId) as any[];

  const map = new Map<string, any>();
  for (const m of rows) {
    const otherId = m.sender_id === userId ? m.receiver_id : m.sender_id;
    const otherName = m.sender_id === userId ? m.receiver_name : m.sender_name;
    const otherAvatar = m.sender_id === userId ? m.receiver_avatar : m.sender_avatar;
    const otherVerified = m.sender_id === userId ? m.receiver_verified : m.sender_verified;
    const key = `${otherId}:${m.ad_id ?? 'general'}`;
    if (!map.has(key)) {
      map.set(key, {
        other_user_id: otherId,
        other_user_name: otherName,
        other_user_avatar: otherAvatar,
        other_user_verified: Boolean(otherVerified),
        ad_id: m.ad_id,
        ad_title: m.ad_title || 'محادثة مباشرة',
        last_message: m.body,
        last_at: m.created_at,
        unread_count: 0,
      });
    }
    if (m.receiver_id === userId && !m.is_read) {
      map.get(key).unread_count += 1;
    }
  }

  res.json({ conversations: Array.from(map.values()) });
});

app.get('/api/messages/thread', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const otherId = Number(req.query.withUserId);
  const adId = req.query.adId ? Number(req.query.adId) : null;

  if (!Number.isInteger(otherId) || otherId <= 0) {
    res.status(400).json({ error: 'معرف الطرف الآخر غير صالح' });
    return;
  }

  const otherUser = db
    .prepare('SELECT id, name, avatar_url, is_verified_account FROM users WHERE id = ?')
    .get(otherId) as any;
  if (!otherUser) {
    res.status(404).json({ error: 'المستخدم غير موجود' });
    return;
  }

  const sql = adId
    ? `SELECT m.*, s.name as sender_name
       FROM messages m JOIN users s ON s.id = m.sender_id
       WHERE ((m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?))
         AND m.ad_id = ?
       ORDER BY m.created_at ASC, m.id ASC`
    : `SELECT m.*, s.name as sender_name
       FROM messages m JOIN users s ON s.id = m.sender_id
       WHERE ((m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?))
       ORDER BY m.created_at ASC, m.id ASC`;

  const messages = adId
    ? db.prepare(sql).all(userId, otherId, otherId, userId, adId)
    : db.prepare(sql).all(userId, otherId, otherId, userId);

  if (adId) {
    db.prepare(
      'UPDATE messages SET is_read = 1 WHERE receiver_id = ? AND sender_id = ? AND ad_id = ?'
    ).run(userId, otherId, adId);
  } else {
    db.prepare('UPDATE messages SET is_read = 1 WHERE receiver_id = ? AND sender_id = ?').run(
      userId,
      otherId
    );
  }

  res.json({
    otherUser: { ...otherUser, is_verified_account: Boolean(otherUser.is_verified_account) },
    messages,
  });
});

app.post('/api/messages', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const senderId = req.user!.id;
  const receiverId = Number(req.body?.receiver_id);
  const adId = req.body?.ad_id ? Number(req.body.ad_id) : null;
  const body = String(req.body?.body ?? '').trim();

  if (!Number.isInteger(receiverId) || receiverId <= 0) {
    res.status(400).json({ error: 'المستلم غير صالح' });
    return;
  }
  if (receiverId === senderId) {
    res.status(400).json({ error: 'لا يمكنك إرسال رسالة لنفسك' });
    return;
  }
  if (body.length < 1 || body.length > 2000) {
    res.status(400).json({ error: 'الرسالة يجب أن تكون بين حرف واحد و 2000 حرف' });
    return;
  }

  const safetyError = checkProhibitedContent(body);
  if (safetyError) {
    res.status(400).json({ error: safetyError });
    return;
  }

  const receiver = db.prepare('SELECT id, is_blocked FROM users WHERE id = ?').get(receiverId) as
    | { id: number; is_blocked: number }
    | undefined;
  if (!receiver || receiver.is_blocked) {
    res.status(404).json({ error: 'حساب المستلم غير متاح' });
    return;
  }

  const info = db
    .prepare('INSERT INTO messages (ad_id, sender_id, receiver_id, body) VALUES (?, ?, ?, ?)')
    .run(adId, senderId, receiverId, body);

  const created = db
    .prepare(
      `SELECT m.*, s.name as sender_name
       FROM messages m JOIN users s ON s.id = m.sender_id WHERE m.id = ?`
    )
    .get(Number(info.lastInsertRowid));

  res.status(201).json({ message: created });
});

// ==================== REPORTS ROUTE ====================

app.post('/api/reports', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const { target_type, target_ad_id, target_user_id, reason, details } = req.body ?? {};
  const cleanReason = String(reason ?? '').trim();
  const cleanDetails = String(details ?? '').trim();

  if (!['ad', 'user'].includes(target_type)) {
    res.status(400).json({ error: 'نوع البلاغ غير صالح' });
    return;
  }
  if (cleanReason.length < 3) {
    res.status(400).json({ error: 'يرجى تحديد سبب البلاغ' });
    return;
  }

  let adId: number | null = null;
  let userId: number | null = null;
  if (target_type === 'ad') {
    adId = Number(target_ad_id);
    const ad = db.prepare('SELECT id, user_id FROM ads WHERE id = ?').get(adId) as
      | { id: number; user_id: number }
      | undefined;
    if (!ad) {
      res.status(404).json({ error: 'الإعلان غير موجود' });
      return;
    }
    userId = ad.user_id;
  } else {
    userId = Number(target_user_id);
    const u = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!u) {
      res.status(404).json({ error: 'الحساب غير موجود' });
      return;
    }
  }

  db.prepare(
    `INSERT INTO reports (reporter_id, target_type, target_ad_id, target_user_id, reason, details)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(req.user!.id, target_type, adId, userId, cleanReason, cleanDetails);

  res.status(201).json({ message: 'تم استلام البلاغ بنجاح وستقوم إدارة السوق بمراجعته فوراً' });
});

// ==================== ADMIN & MODERATOR DASHBOARD ROUTES ====================

app.get('/api/admin/overview', requireModeratorOrAdmin, (_req: AuthenticatedRequest, res: Response) => {
  const stats = {
    totalUsers: (db.prepare('SELECT COUNT(*) as c FROM users WHERE is_sample = 0').get() as { c: number }).c,
    blockedUsers: (db.prepare('SELECT COUNT(*) as c FROM users WHERE is_blocked = 1').get() as { c: number }).c,
    pendingAds: (db.prepare("SELECT COUNT(*) as c FROM ads WHERE status = 'pending'").get() as { c: number }).c,
    approvedAds: (db.prepare("SELECT COUNT(*) as c FROM ads WHERE status = 'approved'").get() as { c: number }).c,
    rejectedAds: (db.prepare("SELECT COUNT(*) as c FROM ads WHERE status = 'rejected'").get() as { c: number }).c,
    openReports: (db.prepare("SELECT COUNT(*) as c FROM reports WHERE status = 'open'").get() as { c: number }).c,
    totalMessages: (db.prepare('SELECT COUNT(*) as c FROM messages').get() as { c: number }).c,
  };

  const logs = db
    .prepare(
      `SELECT l.*, u.name as actor_name
       FROM audit_logs l LEFT JOIN users u ON u.id = l.actor_id
       ORDER BY l.created_at DESC, l.id DESC LIMIT 25`
    )
    .all();

  res.json({ stats, logs });
});

app.get('/api/admin/users', requireModeratorOrAdmin, (req: AuthenticatedRequest, res: Response) => {
  const q = String(req.query.q ?? '').trim();
  let users = db
    .prepare(
      `SELECT u.id, u.name, u.email, u.phone, u.location, u.avatar_url, u.role,
              u.is_blocked, u.is_verified_account, u.is_sample, u.created_at,
              (SELECT COUNT(*) FROM ads a WHERE a.user_id = u.id) as ads_count
       FROM users u
       ORDER BY u.is_sample ASC, u.created_at DESC`
    )
    .all() as any[];

  if (q) {
    users = users.filter((u) => matchesSmartSearch(q, [u.name, u.email, u.phone, u.location]));
  }

  res.json({
    users: users.map((u) => ({
      ...u,
      is_blocked: Boolean(u.is_blocked),
      is_verified_account: Boolean(u.is_verified_account),
      is_sample: Boolean(u.is_sample),
    })),
  });
});

app.patch('/api/admin/users/:id/block', requireModeratorOrAdmin, (req: AuthenticatedRequest, res: Response) => {
  const targetId = Number(req.params.id);
  const { is_blocked } = req.body ?? {};
  const target = db.prepare('SELECT id, name, role FROM users WHERE id = ?').get(targetId) as
    | { id: number; name: string; role: string }
    | undefined;

  if (!target) {
    res.status(404).json({ error: 'المستخدم غير موجود' });
    return;
  }
  if (target.id === req.user!.id) {
    res.status(400).json({ error: 'لا يمكنك حظر حسابك الشخصي' });
    return;
  }
  if (target.role === 'admin' && req.user!.role !== 'admin') {
    res.status(403).json({ error: 'لا يمكن للمشرف حظر مدير عام' });
    return;
  }

  const nextVal = is_blocked ? 1 : 0;
  db.prepare('UPDATE users SET is_blocked = ? WHERE id = ?').run(nextVal, targetId);
  logAudit(req.user!.id, nextVal ? 'حظر مستخدم' : 'إلغاء حظر مستخدم', `${target.name} (#${targetId})`);
  res.json({ ok: true, is_blocked: Boolean(nextVal) });
});

app.patch('/api/admin/users/:id/verify', requireModeratorOrAdmin, (req: AuthenticatedRequest, res: Response) => {
  const targetId = Number(req.params.id);
  const { is_verified_account } = req.body ?? {};
  const target = db.prepare('SELECT id, name FROM users WHERE id = ?').get(targetId) as
    | { id: number; name: string }
    | undefined;
  if (!target) {
    res.status(404).json({ error: 'المستخدم غير موجود' });
    return;
  }
  const nextVal = is_verified_account ? 1 : 0;
  db.prepare('UPDATE users SET is_verified_account = ? WHERE id = ?').run(nextVal, targetId);
  logAudit(req.user!.id, nextVal ? 'توثيق حساب' : 'إلغاء توثيق حساب', `${target.name} (#${targetId})`);
  res.json({ ok: true, is_verified_account: Boolean(nextVal) });
});

app.patch('/api/admin/users/:id/role', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  const targetId = Number(req.params.id);
  const { role } = req.body ?? {};
  if (!['user', 'moderator', 'admin'].includes(role)) {
    res.status(400).json({ error: 'الصلاحية غير صالحة' });
    return;
  }
  const target = db.prepare('SELECT id, name, role, is_sample FROM users WHERE id = ?').get(targetId) as any;
  if (!target || target.is_sample) {
    res.status(404).json({ error: 'الحساب غير مؤهل لتغيير الصلاحية' });
    return;
  }
  if (target.id === req.user!.id && role !== 'admin') {
    const adminCount = (db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'admin'").get() as { c: number }).c;
    if (adminCount <= 1) {
      res.status(400).json({ error: 'يجب بقاء مدير عام واحد على الأقل في المنصة' });
      return;
    }
  }
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, targetId);
  logAudit(req.user!.id, `تعيين صلاحية (${role})`, `${target.name} (#${targetId})`);
  res.json({ ok: true, role });
});

app.get('/api/admin/ads', requireModeratorOrAdmin, (req: AuthenticatedRequest, res: Response) => {
  const status = String(req.query.status ?? '');
  const q = String(req.query.q ?? '').trim();

  const where = status && ['pending', 'approved', 'rejected', 'sold'].includes(status) ? 'WHERE a.status = ?' : '';
  const params = where ? [status] : [];

  let rows = db
    .prepare(
      `SELECT a.*, c.name_ar as category_name, c.slug as category_slug,
              sc.name_ar as subcategory_name, sc.slug as subcategory_slug,
              u.name as owner_name, u.email as owner_email, u.avatar_url as owner_avatar, u.is_verified_account as owner_verified
       FROM ads a
       JOIN categories c ON c.id = a.category_id
       LEFT JOIN subcategories sc ON sc.id = a.subcategory_id
       JOIN users u ON u.id = a.user_id
       ${where}
       ORDER BY CASE WHEN a.status = 'pending' THEN 0 ELSE 1 END, a.created_at DESC`
    )
    .all(...params) as any[];

  if (q) {
    rows = rows.filter((r) => matchesSmartSearch(q, [r.title, r.description, r.owner_name, r.location]));
  }

  res.json({ ads: hydrateAds(rows, req.user!.id) });
});

app.patch('/api/admin/ads/:id/moderate', requireModeratorOrAdmin, (req: AuthenticatedRequest, res: Response) => {
  const adId = Number(req.params.id);
  const { status, rejection_reason, is_featured, has_verified_docs } = req.body ?? {};
  const existing = db.prepare('SELECT id, title FROM ads WHERE id = ?').get(adId) as
    | { id: number; title: string }
    | undefined;
  if (!existing) {
    res.status(404).json({ error: 'الإعلان غير موجود' });
    return;
  }

  const updates: string[] = ["updated_at = datetime('now')"];
  const params: any[] = [];

  if (status && ['pending', 'approved', 'rejected', 'sold'].includes(status)) {
    updates.push('status = ?');
    params.push(status);
    updates.push('rejection_reason = ?');
    params.push(status === 'rejected' ? String(rejection_reason ?? 'مخالف لشروط النشر').trim() : '');
  }
  if (typeof is_featured === 'boolean') {
    updates.push('is_featured = ?');
    params.push(is_featured ? 1 : 0);
  }
  if (typeof has_verified_docs === 'boolean') {
    updates.push('has_verified_docs = ?');
    params.push(has_verified_docs ? 1 : 0);
  }

  params.push(adId);
  db.prepare(`UPDATE ads SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  logAudit(
    req.user!.id,
    'مراجعة وتحديث إعلان',
    `إعلان #${adId} (${status ?? 'تحديث خصائص'}) - ${existing.title}`
  );
  res.json({ ok: true });
});

app.get('/api/admin/reports', requireModeratorOrAdmin, (_req: AuthenticatedRequest, res: Response) => {
  const rows = db
    .prepare(
      `SELECT r.*,
              rep.name as reporter_name, rep.email as reporter_email,
              a.title as target_ad_title, a.status as target_ad_status,
              tu.name as target_user_name, tu.is_blocked as target_user_blocked
       FROM reports r
       JOIN users rep ON rep.id = r.reporter_id
       LEFT JOIN ads a ON a.id = r.target_ad_id
       LEFT JOIN users tu ON tu.id = r.target_user_id
       ORDER BY CASE WHEN r.status = 'open' THEN 0 ELSE 1 END, r.created_at DESC`
    )
    .all() as any[];

  res.json({
    reports: rows.map((r) => ({
      ...r,
      target_user_blocked: Boolean(r.target_user_blocked),
    })),
  });
});

app.patch('/api/admin/reports/:id', requireModeratorOrAdmin, (req: AuthenticatedRequest, res: Response) => {
  const reportId = Number(req.params.id);
  const { status, admin_note } = req.body ?? {};
  if (!['open', 'reviewed', 'dismissed'].includes(status)) {
    res.status(400).json({ error: 'حالة البلاغ غير صالحة' });
    return;
  }
  db.prepare(
    'UPDATE reports SET status = ?, admin_note = ?, reviewed_by = ? WHERE id = ?'
  ).run(status, String(admin_note ?? '').trim(), req.user!.id, reportId);
  logAudit(req.user!.id, `معالجة بلاغ #${reportId}`, status);
  res.json({ ok: true });
});

app.post('/api/admin/categories', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  const { name_ar, slug, icon } = req.body ?? {};
  const cleanName = String(name_ar ?? '').trim();
  const cleanSlug =
    String(slug ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-') || `cat-${Date.now()}`;
  if (cleanName.length < 2) {
    res.status(400).json({ error: 'يرجى إدخال اسم القسم' });
    return;
  }
  const maxOrder = (db.prepare('SELECT COALESCE(MAX(sort_order), 0) as m FROM categories').get() as { m: number }).m;
  const info = db
    .prepare('INSERT INTO categories (slug, name_ar, icon, sort_order, is_active) VALUES (?, ?, ?, ?, 1)')
    .run(cleanSlug, cleanName, String(icon || 'Package').trim(), maxOrder + 1);
  logAudit(req.user!.id, 'إضافة قسم رئيسي', cleanName);
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

app.put('/api/admin/categories/:id', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  const id = Number(req.params.id);
  const { name_ar, is_active } = req.body ?? {};
  const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as any;
  if (!existing) {
    res.status(404).json({ error: 'القسم غير موجود' });
    return;
  }
  db.prepare('UPDATE categories SET name_ar = ?, is_active = ? WHERE id = ?').run(
    String(name_ar ?? existing.name_ar).trim(),
    is_active === undefined ? existing.is_active : is_active ? 1 : 0,
    id
  );
  logAudit(req.user!.id, 'تعديل قسم رئيسي', String(name_ar ?? existing.name_ar));
  res.json({ ok: true });
});

app.post('/api/admin/subcategories', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  const { category_id, name_ar, slug } = req.body ?? {};
  const catId = Number(category_id);
  const cleanName = String(name_ar ?? '').trim();
  const cleanSlug =
    String(slug ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-') || `sub-${Date.now()}`;
  if (!Number.isInteger(catId) || cleanName.length < 2) {
    res.status(400).json({ error: 'يرجى اختيار القسم وإدخال اسم القسم الفرعي' });
    return;
  }
  const maxOrder = (
    db
      .prepare('SELECT COALESCE(MAX(sort_order), 0) as m FROM subcategories WHERE category_id = ?')
      .get(catId) as { m: number }
  ).m;
  const info = db
    .prepare(
      'INSERT INTO subcategories (category_id, slug, name_ar, sort_order, is_active) VALUES (?, ?, ?, ?, 1)'
    )
    .run(catId, cleanSlug, cleanName, maxOrder + 1);
  logAudit(req.user!.id, 'إضافة قسم فرعي', cleanName);
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

app.put('/api/admin/subcategories/:id', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  const id = Number(req.params.id);
  const { name_ar, is_active } = req.body ?? {};
  const existing = db.prepare('SELECT * FROM subcategories WHERE id = ?').get(id) as any;
  if (!existing) {
    res.status(404).json({ error: 'القسم الفرعي غير موجود' });
    return;
  }
  db.prepare('UPDATE subcategories SET name_ar = ?, is_active = ? WHERE id = ?').run(
    String(name_ar ?? existing.name_ar).trim(),
    is_active === undefined ? existing.is_active : is_active ? 1 : 0,
    id
  );
  res.json({ ok: true });
});

app.get('/api/admin/staff', requireAdmin, (_req: AuthenticatedRequest, res: Response) => {
  const rows = db
    .prepare(
      `SELECT ds.email, ds.role, ds.created_at,
              u.id as user_id, u.name as user_name, u.is_blocked as user_blocked
       FROM designated_staff ds
       LEFT JOIN users u ON LOWER(u.email) = LOWER(ds.email) AND u.is_sample = 0
       ORDER BY ds.role ASC, ds.created_at DESC`
    )
    .all() as any[];

  res.json({
    staff: rows.map((r) => ({
      ...r,
      registered: Boolean(r.user_id),
      user_blocked: Boolean(r.user_blocked),
    })),
  });
});

app.post('/api/admin/staff', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  const cleanEmail = String(req.body?.email ?? '').trim().toLowerCase();
  const role = req.body?.role === 'moderator' ? 'moderator' : 'admin';

  if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    res.status(400).json({ error: 'يرجى إدخال بريد إلكتروني صحيح' });
    return;
  }

  db.prepare(
    `INSERT INTO designated_staff (email, role, added_by)
     VALUES (?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET role = excluded.role, added_by = excluded.added_by`
  ).run(cleanEmail, role, req.user!.id);

  const existingUser = db
    .prepare('SELECT id, name FROM users WHERE LOWER(email) = ? AND is_sample = 0')
    .get(cleanEmail) as { id: number; name: string } | undefined;

  if (existingUser) {
    db.prepare('UPDATE users SET role = ?, is_verified_account = 1 WHERE id = ?').run(
      role,
      existingUser.id
    );
  }

  logAudit(
    req.user!.id,
    `إضافة ${role === 'admin' ? 'مدير عام' : 'مشرف'}`,
    cleanEmail
  );
  res.status(201).json({
    ok: true,
    registered: Boolean(existingUser),
    message: existingUser
      ? `تمت ترقية الحساب (${existingUser.name}) إلى ${role === 'admin' ? 'مدير عام' : 'مشرف'} بنجاح`
      : `تمت إضافة البريد ${cleanEmail} لقائمة ${role === 'admin' ? 'المديرين' : 'المشرفين'} وسيتم تفعيل الصلاحية تلقائياً عند التسجيل`,
  });
});

app.delete('/api/admin/staff/:email', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  const targetEmail = decodeURIComponent(String(req.params.email ?? '')).trim().toLowerCase();
  if (targetEmail === req.user!.email.toLowerCase()) {
    res.status(400).json({ error: 'لا يمكنك إزالة بريدك الشخصي من الإدارة' });
    return;
  }
  db.prepare('DELETE FROM designated_staff WHERE LOWER(email) = ?').run(targetEmail);
  logAudit(req.user!.id, 'إزالة بريد من قائمة الإدارة', targetEmail);
  res.json({ ok: true });
});

app.delete('/api/admin/sample-ads', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  db.prepare('DELETE FROM hero_promotions WHERE is_sample = 1').run();
  const result = db.prepare('DELETE FROM ads WHERE is_sample = 1').run();
  db.prepare('DELETE FROM users WHERE is_sample = 1').run();
  logAudit(req.user!.id, 'حذف الإعلانات النموذجية التوضيحية', `عدد المحذوف: ${result.changes}`);
  res.json({ ok: true, deleted: result.changes });
});

// ==================== PAID HERO BANNER PROMOTIONS ====================

const HERO_PACKAGES: Record<number, number> = {
  3: 5000,
  7: 10000,
  14: 18000,
  30: 30000,
};

function expireElapsedHeroPromotions(): void {
  db.prepare(
    `UPDATE hero_promotions
     SET status = 'expired'
     WHERE status = 'active' AND expires_at != '' AND datetime(expires_at) <= datetime('now')`
  ).run();
}

app.get('/api/hero-promotions', (_req: Request, res: Response) => {
  expireElapsedHeroPromotions();
  const rows = db
    .prepare(
      `SELECT hp.id, hp.ad_id, hp.user_id, hp.title, hp.subtitle, hp.image_url,
              hp.price_label, hp.location_label, hp.package_days, hp.amount_sdg,
              hp.status, hp.sort_order, hp.starts_at, hp.expires_at, hp.created_at,
              u.name as owner_name, u.is_verified_account as owner_verified,
              a.title as ad_title, c.name_ar as category_name
       FROM hero_promotions hp
       JOIN users u ON hp.user_id = u.id
       LEFT JOIN ads a ON hp.ad_id = a.id
       LEFT JOIN categories c ON a.category_id = c.id
       WHERE hp.status = 'active'
         AND (hp.ad_id IS NULL OR a.status = 'approved')
         AND u.is_blocked = 0
       ORDER BY hp.sort_order ASC, hp.id DESC`
    )
    .all();

  res.json({ promotions: rows });
});

app.get('/api/hero-promotions/mine', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  expireElapsedHeroPromotions();
  const rows = db
    .prepare(
      `SELECT hp.*, a.title as ad_title
       FROM hero_promotions hp
       LEFT JOIN ads a ON hp.ad_id = a.id
       WHERE hp.user_id = ?
       ORDER BY hp.id DESC`
    )
    .all(req.user!.id);

  res.json({ promotions: rows });
});

app.post('/api/hero-promotions', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const adId = Number(req.body?.ad_id || 0);
  const packageDays = Number(req.body?.package_days || 7);
  const paymentMethod = String(req.body?.payment_method ?? 'بنكك').trim() || 'بنكك';
  const paymentReference = String(req.body?.payment_reference ?? '').trim();
  const customTitle = String(req.body?.title ?? '').trim();
  const customSubtitle = String(req.body?.subtitle ?? '').trim();
  const customImage = String(req.body?.image_url ?? '').trim();

  if (!HERO_PACKAGES[packageDays]) {
    res.status(400).json({ error: 'باقة الترويج غير صالحة (المتاح: 3، 7، 14، 30 يوماً)' });
    return;
  }
  if (!paymentReference || paymentReference.length < 3) {
    res.status(400).json({ error: 'يرجى إدخال رقم إشعار الدفع أو المرجع لتأكيد الطلب' });
    return;
  }

  let linkedAd: any = null;
  let imageUrl = customImage;
  let title = customTitle;
  let subtitle = customSubtitle || 'إعلان مميز في واجهة سوق أبو جبيهة';
  let priceLabel = '';
  let locationLabel = req.user!.location || 'أبو جبيهة';

  if (adId > 0) {
    linkedAd = db.prepare('SELECT * FROM ads WHERE id = ?').get(adId) as any;
    if (!linkedAd) {
      res.status(404).json({ error: 'الإعلان المختار غير موجود' });
      return;
    }
    if (linkedAd.user_id !== req.user!.id && req.user!.role === 'user') {
      res.status(403).json({ error: 'يمكنك تمييز إعلاناتك الخاصة فقط' });
      return;
    }
    if (linkedAd.status !== 'approved') {
      res.status(400).json({ error: 'يجب أن يكون الإعلان معتمداً ومنشوراً قبل ترقيته للبنر المدفوع' });
      return;
    }

    const firstImg = db
      .prepare('SELECT url FROM ad_images WHERE ad_id = ? ORDER BY sort_order ASC LIMIT 1')
      .get(adId) as { url: string } | undefined;

    imageUrl = imageUrl || firstImg?.url || '/src/assets/images/hero_abu_jubeiha_1795626053117.jpg';
    title = title || linkedAd.title;
    priceLabel =
      linkedAd.price > 0
        ? `${new Intl.NumberFormat('en-US').format(linkedAd.price)} ج.س`
        : 'عرض مميز';
    locationLabel = linkedAd.location;
  }

  if (!title || title.length < 3) {
    res.status(400).json({ error: 'يرجى إدخال عنوان مناسب للبنر الإعلاني' });
    return;
  }
  if (!imageUrl) {
    res.status(400).json({ error: 'يرجى إرفاق صورة للعرض في البنر الرئيسي' });
    return;
  }

  const prohibitedTerm = checkProhibitedContent(`${title} ${subtitle}`);
  if (prohibitedTerm) {
    res.status(400).json({ error: `محتوى غير مسموح به (${prohibitedTerm})` });
    return;
  }

  const amountSdg = HERO_PACKAGES[packageDays];
  const info = db
    .prepare(
      `INSERT INTO hero_promotions (
        ad_id, user_id, title, subtitle, image_url, price_label, location_label,
        package_days, amount_sdg, payment_method, payment_reference, status, sort_order, is_sample
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 10, 0)`
    )
    .run(
      adId > 0 ? adId : null,
      req.user!.id,
      title,
      subtitle,
      imageUrl,
      priceLabel,
      locationLabel,
      packageDays,
      amountSdg,
      paymentMethod,
      paymentReference
    );

  res.status(201).json({
    id: Number(info.lastInsertRowid),
    message: 'تم إرسال طلب الإعلان المميز المدفوع بنجاح، وسيتم تفعيله في الواجهة فور مراجعة الدفع',
  });
});

app.get('/api/admin/hero-promotions', requireModeratorOrAdmin, (req: AuthenticatedRequest, res: Response) => {
  expireElapsedHeroPromotions();
  const status = String(req.query.status ?? '').trim();
  let query = `
    SELECT hp.*, u.name as owner_name, u.email as owner_email, u.phone as owner_phone,
           a.title as ad_title
    FROM hero_promotions hp
    JOIN users u ON hp.user_id = u.id
    LEFT JOIN ads a ON hp.ad_id = a.id
  `;
  const params: any[] = [];
  if (status) {
    query += ' WHERE hp.status = ?';
    params.push(status);
  }
  query += ' ORDER BY hp.sort_order ASC, hp.id DESC';

  const rows = db.prepare(query).all(...params);
  res.json({ promotions: rows });
});

app.post('/api/admin/hero-promotions', requireModeratorOrAdmin, (req: AuthenticatedRequest, res: Response) => {
  const adId = Number(req.body?.ad_id || 0);
  const packageDays = Math.max(1, Math.min(365, Number(req.body?.package_days || 7)));
  const amountSdg = Math.max(0, Number(req.body?.amount_sdg ?? 0));
  const sortOrder = Number(req.body?.sort_order ?? 1);
  const paymentMethod = String(req.body?.payment_method ?? 'دفع مباشر للإدارة').trim();
  const paymentReference = String(req.body?.payment_reference ?? 'ADMIN-DIRECT').trim();
  let title = String(req.body?.title ?? '').trim();
  let subtitle = String(req.body?.subtitle ?? '').trim() || 'إعلان مميز مدفوع في واجهة سوق أبو جبيهة';
  let imageUrl = String(req.body?.image_url ?? '').trim();
  let priceLabel = String(req.body?.price_label ?? '').trim();
  let locationLabel = String(req.body?.location_label ?? '').trim() || 'أبو جبيهة';
  let targetUserId = req.user!.id;

  if (adId > 0) {
    const ad = db.prepare('SELECT * FROM ads WHERE id = ?').get(adId) as any;
    if (!ad) {
      res.status(404).json({ error: 'الإعلان المحدد غير موجود' });
      return;
    }
    const firstImg = db
      .prepare('SELECT url FROM ad_images WHERE ad_id = ? ORDER BY sort_order ASC LIMIT 1')
      .get(adId) as { url: string } | undefined;
    title = title || ad.title;
    imageUrl = imageUrl || firstImg?.url || '/src/assets/images/hero_abu_jubeiha_1795626053117.jpg';
    priceLabel =
      priceLabel ||
      (ad.price > 0 ? `${new Intl.NumberFormat('en-US').format(ad.price)} ج.س` : 'عرض مميز');
    locationLabel = locationLabel || ad.location;
    targetUserId = ad.user_id;
    db.prepare('UPDATE ads SET is_featured = 1 WHERE id = ?').run(adId);
  }

  if (!title || !imageUrl) {
    res.status(400).json({ error: 'يرجى إدخال العنوان والصورة أو اختيار إعلان منشور' });
    return;
  }

  const info = db
    .prepare(
      `INSERT INTO hero_promotions (
        ad_id, user_id, title, subtitle, image_url, price_label, location_label,
        package_days, amount_sdg, payment_method, payment_reference, status, sort_order,
        is_sample, starts_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, 0, datetime('now'), datetime('now', '+' || ? || ' days'))`
    )
    .run(
      adId > 0 ? adId : null,
      targetUserId,
      title,
      subtitle,
      imageUrl,
      priceLabel,
      locationLabel,
      packageDays,
      amountSdg,
      paymentMethod,
      paymentReference,
      sortOrder,
      packageDays
    );

  logAudit(req.user!.id, 'نشر إعلان بنر مدفوع في الواجهة', title);
  res.status(201).json({ id: Number(info.lastInsertRowid), ok: true });
});

app.patch('/api/admin/hero-promotions/:id', requireModeratorOrAdmin, (req: AuthenticatedRequest, res: Response) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM hero_promotions WHERE id = ?').get(id) as any;
  if (!existing) {
    res.status(404).json({ error: 'طلب الإعلان المدفوع غير موجود' });
    return;
  }

  const nextStatus = String(req.body?.status ?? existing.status);
  if (!['pending', 'active', 'paused', 'rejected', 'expired'].includes(nextStatus)) {
    res.status(400).json({ error: 'حالة غير صالحة' });
    return;
  }

  const nextOrder =
    req.body?.sort_order !== undefined ? Number(req.body.sort_order) : existing.sort_order;
  const adminNote =
    req.body?.admin_note !== undefined ? String(req.body.admin_note).trim() : existing.admin_note;

  if (nextStatus === 'active') {
    const days = existing.package_days || 7;
    db.prepare(
      `UPDATE hero_promotions
       SET status = 'active',
           sort_order = ?,
           admin_note = ?,
           starts_at = CASE WHEN starts_at = '' THEN datetime('now') ELSE starts_at END,
           expires_at = CASE WHEN expires_at = '' OR datetime(expires_at) <= datetime('now') THEN datetime('now', '+' || ? || ' days') ELSE expires_at END
       WHERE id = ?`
    ).run(nextOrder, adminNote, days, id);

    if (existing.ad_id) {
      db.prepare('UPDATE ads SET is_featured = 1 WHERE id = ?').run(existing.ad_id);
    }
  } else {
    db.prepare(
      `UPDATE hero_promotions SET status = ?, sort_order = ?, admin_note = ? WHERE id = ?`
    ).run(nextStatus, nextOrder, adminNote, id);
  }

  logAudit(req.user!.id, `تحديث حالة البنر المدفوع (${nextStatus})`, existing.title);
  res.json({ ok: true });
});

app.delete('/api/admin/hero-promotions/:id', requireModeratorOrAdmin, (req: AuthenticatedRequest, res: Response) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT title FROM hero_promotions WHERE id = ?').get(id) as
    | { title: string }
    | undefined;
  if (!existing) {
    res.status(404).json({ error: 'الإعلان المدفوع غير موجود' });
    return;
  }
  db.prepare('DELETE FROM hero_promotions WHERE id = ?').run(id);
  logAudit(req.user!.id, 'حذف إعلان بنر مدفوع', existing.title);
  res.json({ ok: true });
});

// Guarantee /api/* always returns JSON on 404 or unexpected errors
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'المسار المطلوب غير موجود' });
});

app.use((err: any, req: Request, res: Response, next: any) => {
  if (req.path.startsWith('/api')) {
    console.error('API Error:', err);
    res.status(err?.status || 500).json({
      error: err?.message || 'حدث خطأ داخلي في الخادم',
    });
    return;
  }
  next(err);
});

// ==================== VITE / STATIC SERVING ====================

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
