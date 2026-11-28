import crypto from 'crypto';
import fs from 'fs';
import type { Express, NextFunction, Request, Response } from 'express';
import firebaseConfig from '../firebase-applet-config.json';
import {
  checkProhibitedContent,
  DEFAULT_CATEGORIES_SEED,
  normalizeSearchText,
} from '../src/lib/marketplaceSearch';

type VerifyFirebaseFn = (
  idToken: string
) => Promise<{
  ok: boolean;
  localId?: string;
  email?: string;
  emailVerified?: boolean;
  disabled?: boolean;
  status?: number;
  error?: string;
}>;

interface FsTokenCache {
  token: string;
  expiresAt: number;
  actorId: string;
  refreshToken?: string;
  mode: 'service_account' | 'firebase_user' | 'metadata';
}

let cachedAdminAuth: FsTokenCache | null = null;

function getFirestoreRoot(): string {
  const projectId = encodeURIComponent(firebaseConfig.projectId);
  const dbId = encodeURIComponent(firebaseConfig.firestoreDatabaseId || '(default)');
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${dbId}/documents`;
}

function getSanadBridgeKey(): string {
  return (process.env.SANAD_BRIDGE_KEY || process.env.MARKET_API_KEY || '').trim();
}

function getSanadApiUrl(): string {
  const raw = (process.env.SANAD_API_URL || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.origin + (parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, ''));
  } catch {
    return '';
  }
}

function getSanadWebhookSecret(): string {
  return (
    process.env.SANAD_WEBHOOK_SECRET ||
    process.env.MARKET_WEBHOOK_SECRET ||
    getSanadBridgeKey()
  ).trim();
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (!a || !b) return false;
  const ha = crypto.createHash('sha256').update(a, 'utf8').digest();
  const hb = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(ha, hb);
}

function requireSanadKey(req: Request, res: Response, next: NextFunction): void {
  const expected = getSanadBridgeKey();
  if (!expected) {
    res.status(503).json({
      error: 'مفتاح ربط سند (SANAD_BRIDGE_KEY) غير مهيأ على خادم السوق.',
    });
    return;
  }
  const headerKey = typeof req.headers['x-sanad-key'] === 'string' ? req.headers['x-sanad-key'].trim() : '';
  const authHeader = typeof req.headers.authorization === 'string' ? req.headers.authorization.trim() : '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const provided = headerKey || bearer;
  if (!timingSafeEqualStr(provided, expected)) {
    res.status(403).json({ error: 'مفتاح التحقق غير صالح.' });
    return;
  }
  next();
}

export function resolveAppBaseUrl(req: Request): string {
  const envUrl = (process.env.APP_URL || '').trim().replace(/\/+$/, '');
  if (envUrl && envUrl !== 'MY_APP_URL') {
    try {
      const parsed = new URL(envUrl);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.origin;
      }
    } catch {
      // ignore invalid APP_URL
    }
  }
  const protoHeader = typeof req.headers['x-forwarded-proto'] === 'string' ? req.headers['x-forwarded-proto'] : '';
  const hostHeader = typeof req.headers['x-forwarded-host'] === 'string'
    ? req.headers['x-forwarded-host']
    : req.headers.host || '';
  const host = hostHeader.split(',')[0].trim();
  const proto = protoHeader.split(',')[0].trim() || req.protocol || 'https';
  return host ? `${proto}://${host}` : '';
}

function clampStr(val: unknown, max = 500): string {
  return String(val ?? '').trim().slice(0, max);
}

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function loadServiceAccountJson(): { client_email: string; private_key: string; token_uri?: string } | null {
  const raw = (process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  if (!raw) return null;
  try {
    let jsonStr = raw;
    if (!raw.startsWith('{') && fs.existsSync(raw)) {
      jsonStr = fs.readFileSync(raw, 'utf8');
    }
    const parsed = JSON.parse(jsonStr) as {
      client_email?: string;
      private_key?: string;
      token_uri?: string;
    };
    if (parsed.client_email && parsed.private_key) {
      return {
        client_email: parsed.client_email,
        private_key: parsed.private_key.replace(/\\n/g, '\n'),
        token_uri: parsed.token_uri,
      };
    }
  } catch {
    // ignore malformed service account
  }
  return null;
}

async function getFirestoreAdminAuth(): Promise<{ token: string; actorId: string }> {
  if (cachedAdminAuth && cachedAdminAuth.expiresAt > Date.now() + 60_000) {
    return { token: cachedAdminAuth.token, actorId: cachedAdminAuth.actorId };
  }

  // 1. Service Account JSON (works anywhere: Cloud Run, Render, VPS, local)
  const sa = loadServiceAccountJson();
  if (sa) {
    const nowSec = Math.floor(Date.now() / 1000);
    const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const payload = base64UrlEncode(
      JSON.stringify({
        iss: sa.client_email,
        scope: 'https://www.googleapis.com/auth/datastore',
        aud: sa.token_uri || 'https://oauth2.googleapis.com/token',
        exp: nowSec + 3600,
        iat: nowSec,
      })
    );
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(`${header}.${payload}`);
    const signature = base64UrlEncode(signer.sign(sa.private_key));
    const assertion = `${header}.${payload}.${signature}`;

    const resp = await fetch(sa.token_uri || 'https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }).toString(),
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      throw new Error(`تعذر مصادقة حساب الخدمة مع Firestore: ${txt || resp.status}`);
    }
    const data = (await resp.json()) as { access_token: string; expires_in?: number };
    cachedAdminAuth = {
      token: data.access_token,
      expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
      actorId: 'sanad-admin',
      mode: 'service_account',
    };
    return { token: cachedAdminAuth.token, actorId: cachedAdminAuth.actorId };
  }

  // 2. Firebase Admin Email + Password sign-in (matches isAdmin() in firestore.rules)
  const adminEmail = (process.env.MARKET_FIREBASE_ADMIN_EMAIL || '').trim();
  const adminPass = (process.env.MARKET_FIREBASE_ADMIN_PASSWORD || '').trim();
  if (adminEmail && adminPass) {
    if (cachedAdminAuth?.mode === 'firebase_user' && cachedAdminAuth.refreshToken) {
      try {
        const refreshResp = await fetch(
          `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(firebaseConfig.apiKey)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              grant_type: 'refresh_token',
              refresh_token: cachedAdminAuth.refreshToken,
            }).toString(),
          }
        );
        if (refreshResp.ok) {
          const refData = (await refreshResp.json()) as {
            id_token: string;
            refresh_token: string;
            expires_in?: string;
            user_id: string;
          };
          cachedAdminAuth = {
            token: refData.id_token,
            refreshToken: refData.refresh_token,
            expiresAt: Date.now() + (Number(refData.expires_in) || 3600) * 1000,
            actorId: refData.user_id || cachedAdminAuth.actorId,
            mode: 'firebase_user',
          };
          return { token: cachedAdminAuth.token, actorId: cachedAdminAuth.actorId };
        }
      } catch {
        // fall through to fresh password sign-in
      }
    }

    const signResp = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(firebaseConfig.apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: adminEmail,
          password: adminPass,
          returnSecureToken: true,
        }),
      }
    );
    if (!signResp.ok) {
      const txt = await signResp.text().catch(() => '');
      throw new Error(`فشل تسجيل دخول حساب الإدارة في Firebase: ${txt || signResp.status}`);
    }
    const signData = (await signResp.json()) as {
      idToken: string;
      refreshToken: string;
      expiresIn?: string;
      localId: string;
    };
    cachedAdminAuth = {
      token: signData.idToken,
      refreshToken: signData.refreshToken,
      expiresAt: Date.now() + (Number(signData.expiresIn) || 3600) * 1000,
      actorId: signData.localId,
      mode: 'firebase_user',
    };
    return { token: cachedAdminAuth.token, actorId: cachedAdminAuth.actorId };
  }

  // 3. GCP Metadata Server (Cloud Run with Firestore IAM permissions)
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const metaResp = await fetch(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
      {
        headers: { 'Metadata-Flavor': 'Google' },
        signal: controller.signal,
      }
    );
    if (metaResp.ok) {
      const metaData = (await metaResp.json()) as { access_token: string; expires_in?: number };
      cachedAdminAuth = {
        token: metaData.access_token,
        expiresAt: Date.now() + (Number(metaData.expires_in) || 3600) * 1000,
        actorId: 'sanad-admin',
        mode: 'metadata',
      };
      return { token: cachedAdminAuth.token, actorId: cachedAdminAuth.actorId };
    }
  } catch {
    // not running on GCP metadata environment
  } finally {
    clearTimeout(timer);
  }

  throw new Error(
    'تعذر الوصول الإداري لقاعدة بيانات Firestore. يرجى إضافة FIREBASE_SERVICE_ACCOUNT_JSON أو MARKET_FIREBASE_ADMIN_EMAIL و MARKET_FIREBASE_ADMIN_PASSWORD.'
  );
}

// ==================== FIRESTORE REST VALUE HELPERS ====================

type FsValue =
  | { nullValue: null }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { timestampValue: string }
  | { stringValue: string }
  | { arrayValue: { values?: FsValue[] } }
  | { mapValue: { fields?: Record<string, FsValue> } };

function fromFsValue(val: FsValue | undefined): unknown {
  if (!val || 'nullValue' in val) return null;
  if ('booleanValue' in val) return val.booleanValue;
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return Number(val.doubleValue);
  if ('timestampValue' in val) return val.timestampValue;
  if ('stringValue' in val) return val.stringValue;
  if ('arrayValue' in val) return (val.arrayValue.values || []).map(fromFsValue);
  if ('mapValue' in val) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val.mapValue.fields || {})) {
      out[k] = fromFsValue(v);
    }
    return out;
  }
  return null;
}

function toFsValue(val: unknown): FsValue {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    if (Number.isInteger(val)) return { integerValue: String(val) };
    return { doubleValue: val };
  }
  if (typeof val === 'string') return { stringValue: val };
  if (Array.isArray(val)) return { arrayValue: { values: val.map(toFsValue) } };
  if (typeof val === 'object') {
    const fields: Record<string, FsValue> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (v !== undefined) fields[k] = toFsValue(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

interface FsDoc {
  name: string;
  fields?: Record<string, FsValue>;
  createTime?: string;
  updateTime?: string;
}

function docToPlain(doc: FsDoc): Record<string, unknown> {
  const id = doc.name.split('/').pop() || '';
  const out: Record<string, unknown> = { id };
  for (const [k, v] of Object.entries(doc.fields || {})) {
    out[k] = fromFsValue(v);
  }
  return out;
}

async function runFirestoreQuery(
  collectionId: string,
  options: {
    whereEquals?: Array<{ field: string; value: string | boolean | number }>;
    limit?: number;
    token?: string;
  } = {}
): Promise<Array<Record<string, unknown>>> {
  const root = getFirestoreRoot();
  const url = options.token
    ? `${root}:runQuery`
    : `${root}:runQuery?key=${encodeURIComponent(firebaseConfig.apiKey)}`;

  const filters = (options.whereEquals || []).map((f) => ({
    fieldFilter: {
      field: { fieldPath: f.field },
      op: 'EQUAL',
      value: toFsValue(f.value),
    },
  }));

  const structuredQuery: Record<string, unknown> = {
    from: [{ collectionId }],
  };
  if (filters.length === 1) {
    structuredQuery.where = filters[0];
  } else if (filters.length > 1) {
    structuredQuery.where = {
      compositeFilter: { op: 'AND', filters },
    };
  }
  if (options.limit) {
    structuredQuery.limit = options.limit;
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ structuredQuery }),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Firestore query failed (${collectionId}): ${errText || resp.status}`);
  }
  const rows = (await resp.json()) as Array<{ document?: FsDoc }>;
  return rows.filter((r) => Boolean(r.document)).map((r) => docToPlain(r.document!));
}

async function getFirestoreDoc(
  collectionId: string,
  docId: string,
  token?: string
): Promise<Record<string, unknown> | null> {
  const root = getFirestoreRoot();
  const base = `${root}/${encodeURIComponent(collectionId)}/${encodeURIComponent(docId)}`;
  const url = token ? base : `${base}?key=${encodeURIComponent(firebaseConfig.apiKey)}`;
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const resp = await fetch(url, { headers });
  if (resp.status === 404) return null;
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Firestore get failed (${collectionId}/${docId}): ${errText || resp.status}`);
  }
  const doc = (await resp.json()) as FsDoc;
  return docToPlain(doc);
}

async function commitFirestoreWrite(
  writes: Array<Record<string, unknown>>,
  token: string
): Promise<void> {
  const root = getFirestoreRoot();
  const commitUrl = root.replace(/\/documents$/, '/documents:commit');
  const resp = await fetch(commitUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ writes }),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Firestore commit failed: ${errText || resp.status}`);
  }
}

function docPath(collectionId: string, docId: string): string {
  const dbId = firebaseConfig.firestoreDatabaseId || '(default)';
  return `projects/${firebaseConfig.projectId}/databases/${dbId}/documents/${collectionId}/${docId}`;
}

function makeUpdateWrite(
  collectionId: string,
  docId: string,
  fields: Record<string, unknown>,
  serverTimestampFields: string[]
): Record<string, unknown> {
  const encodedFields: Record<string, FsValue> = {};
  const fieldPaths = Object.keys(fields);
  for (const k of fieldPaths) {
    encodedFields[k] = toFsValue(fields[k]);
  }
  return {
    update: {
      name: docPath(collectionId, docId),
      fields: encodedFields,
    },
    updateMask: { fieldPaths },
    ...(serverTimestampFields.length > 0
      ? {
          updateTransforms: serverTimestampFields.map((fieldPath) => ({
            fieldPath,
            setToServerValue: 'REQUEST_TIME',
          })),
        }
      : {}),
  };
}

function makeCreateWrite(
  collectionId: string,
  docId: string,
  fields: Record<string, unknown>,
  serverTimestampFields: string[]
): Record<string, unknown> {
  const encodedFields: Record<string, FsValue> = {};
  for (const [k, v] of Object.entries(fields)) {
    encodedFields[k] = toFsValue(v);
  }
  return {
    update: {
      name: docPath(collectionId, docId),
      fields: encodedFields,
    },
    currentDocument: { exists: false },
    ...(serverTimestampFields.length > 0
      ? {
          updateTransforms: serverTimestampFields.map((fieldPath) => ({
            fieldPath,
            setToServerValue: 'REQUEST_TIME',
          })),
        }
      : {}),
  };
}

function makeUpsertWrite(
  collectionId: string,
  docId: string,
  fields: Record<string, unknown>,
  serverTimestampFields: string[]
): Record<string, unknown> {
  const encodedFields: Record<string, FsValue> = {};
  for (const [k, v] of Object.entries(fields)) {
    encodedFields[k] = toFsValue(v);
  }
  return {
    update: {
      name: docPath(collectionId, docId),
      fields: encodedFields,
    },
    ...(serverTimestampFields.length > 0
      ? {
          updateTransforms: serverTimestampFields.map((fieldPath) => ({
            fieldPath,
            setToServerValue: 'REQUEST_TIME',
          })),
        }
      : {}),
  };
}

function makeNewAdAlertWrite(
  adId: string,
  existing: Record<string, unknown>
): Record<string, unknown> {
  const images = Array.isArray(existing.images) ? existing.images : [];
  const rawType = String(existing.adType || 'offer');
  const adType =
    rawType === 'wanted' || rawType === 'job' || rawType === 'announcement'
      ? rawType
      : 'offer';
  const cleanId = clampStr(adId, 110);
  return makeUpsertWrite(
    'newAdAlerts',
    `alert_${cleanId}`,
    {
      adId: cleanId,
      title: clampStr(existing.title || 'إعلان جديد', 160),
      categoryName: clampStr(existing.categoryName || 'سوق أبو جبيهة', 100),
      categorySlug: clampStr(existing.categorySlug || '', 80),
      price: Math.max(0, Number(existing.price) || 0),
      adType,
      location: clampStr(existing.location || '', 120),
      imageUrl: clampStr(images[0] || '', 500),
      ownerId: clampStr(existing.ownerId || '', 128),
      ownerName: clampStr(existing.ownerName || 'معلن', 80),
    },
    ['createdAt']
  );
}

function makeAuditWrite(
  actorId: string,
  action: string,
  targetInfo: string
): Record<string, unknown> {
  const logId = `log_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  return makeCreateWrite(
    'auditLogs',
    logId,
    {
      actorId: clampStr(actorId || 'sanad-admin', 128),
      actorName: 'سند (مساعد الإدارة)',
      action: clampStr(action, 160),
      targetInfo: clampStr(targetInfo, 300),
    },
    ['createdAt']
  );
}

function makeNotificationWrite(payload: {
  userId: string;
  title: string;
  body: string;
  type: 'ad_approved' | 'ad_rejected' | 'hero_active' | 'hero_rejected' | 'system';
  linkAdId?: string;
  linkPage?: string;
}): Record<string, unknown> {
  const notifId = `notif_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  return makeCreateWrite(
    'notifications',
    notifId,
    {
      userId: clampStr(payload.userId, 128),
      title: clampStr(payload.title, 160),
      body: clampStr(payload.body, 500),
      type: payload.type,
      linkAdId: clampStr(payload.linkAdId || '', 128),
      linkUserId: '',
      linkPage: clampStr(payload.linkPage || 'account', 60),
      isRead: false,
    },
    ['createdAt']
  );
}

function formatAdSummary(doc: Record<string, unknown>, baseUrl: string): Record<string, unknown> {
  const id = String(doc.id || '');
  const images = Array.isArray(doc.images) ? doc.images.map(String).filter(Boolean) : [];
  return {
    id,
    title: String(doc.title || ''),
    description: String(doc.description || ''),
    price: Number(doc.price || 0),
    isNegotiable: Boolean(doc.isNegotiable),
    adType: String(doc.adType || 'offer'),
    category: String(doc.categorySlug || ''),
    categoryName: String(doc.categoryName || ''),
    subcategoryName: String(doc.subcategoryName || ''),
    location: String(doc.location || ''),
    ownerId: String(doc.ownerId || ''),
    ownerName: String(doc.ownerName || ''),
    contactPhone: String(doc.contactPhone || ''),
    status: String(doc.status || ''),
    isFeatured: Boolean(doc.isFeatured),
    images,
    createdAt: String(doc.createdAt || ''),
    url: baseUrl && id ? `${baseUrl}/ad/${encodeURIComponent(id)}` : `/ad/${encodeURIComponent(id)}`,
  };
}

function formatPromoSummary(doc: Record<string, unknown>, baseUrl: string): Record<string, unknown> {
  const id = String(doc.id || '');
  const adId = String(doc.adId || '');
  return {
    id,
    adId,
    userId: String(doc.userId || ''),
    ownerName: String(doc.ownerName || ''),
    title: String(doc.title || ''),
    priceLabel: String(doc.priceLabel || ''),
    locationLabel: String(doc.locationLabel || ''),
    packageDays: Number(doc.packageDays || 7),
    amountSdg: Number(doc.amountSdg || 0),
    paymentMethod: String(doc.paymentMethod || ''),
    paymentReference: String(doc.paymentReference || ''),
    imageUrl: String(doc.imageUrl || ''),
    receiptUrl: String(doc.paymentReceiptUrl || ''),
    status: String(doc.status || ''),
    createdAt: String(doc.createdAt || ''),
    url: baseUrl && adId ? `${baseUrl}/ad/${encodeURIComponent(adId)}` : '',
  };
}

function formatReportSummary(doc: Record<string, unknown>): Record<string, unknown> {
  return {
    id: String(doc.id || ''),
    reporterId: String(doc.reporterId || ''),
    reporterName: String(doc.reporterName || ''),
    targetType: String(doc.targetType || 'ad'),
    targetAdId: String(doc.targetAdId || ''),
    targetAdTitle: String(doc.targetAdTitle || ''),
    targetUserId: String(doc.targetUserId || ''),
    targetUserName: String(doc.targetUserName || ''),
    reason: String(doc.reason || ''),
    details: String(doc.details || ''),
    status: String(doc.status || 'open'),
    createdAt: String(doc.createdAt || ''),
  };
}

// Fixed-window rate limiter factory. Keys come from req.ip (requires app 'trust proxy')
// or from a verified user id; never from the raw X-Forwarded-For header.
function makeRateBucket(max: number, windowMs: number): (key: string) => boolean {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return (key: string): boolean => {
    const now = Date.now();
    if (buckets.size > 1500) {
      for (const [k, v] of buckets) {
        if (v.resetAt <= now) buckets.delete(k);
      }
    }
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    if (bucket.count >= max) return false;
    bucket.count += 1;
    return true;
  };
}

function ipRateLimit(max: number, windowMs: number, message: string) {
  const allow = makeRateBucket(max, windowMs);
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!allow(req.ip || 'unknown')) {
      res.status(429).json({ error: message, detail: message });
      return;
    }
    next();
  };
}

const publicHelpRateLimit = ipRateLimit(
  20,
  60_000,
  'تم تجاوز الحد المؤقت لعدد الأسئلة. يرجى الانتظار دقيقة ثم المحاولة مجدداً.'
);
const publicSearchRateLimit = ipRateLimit(
  60,
  60_000,
  'تم تجاوز الحد المؤقت لعدد عمليات البحث. يرجى الانتظار دقيقة ثم المحاولة مجدداً.'
);
const notifyAllow = makeRateBucket(10, 60_000);

// Cache of approved ads for the public search endpoint (avoids a full collection read per request)
const APPROVED_CACHE_TTL_MS = 60_000;
let approvedAdsCache: { at: number; rows: Array<Record<string, unknown>> } | null = null;
async function getApprovedAdsCached(): Promise<Array<Record<string, unknown>>> {
  if (approvedAdsCache && Date.now() - approvedAdsCache.at < APPROVED_CACHE_TTL_MS) {
    return approvedAdsCache.rows;
  }
  const rows = await runFirestoreQuery('ads', {
    whereEquals: [{ field: 'status', value: 'approved' }],
    limit: 1000,
  });
  approvedAdsCache = { at: Date.now(), rows };
  return rows;
}

// Single approved ad lookup for server-rendered share previews (Open Graph)
const adPreviewCache = new Map<string, { at: number; ad: Record<string, unknown> | null }>();
export async function getPublicApprovedAd(adId: string): Promise<Record<string, unknown> | null> {
  const hit = adPreviewCache.get(adId);
  if (hit && Date.now() - hit.at < 60_000) return hit.ad;
  let ad: Record<string, unknown> | null = null;
  try {
    const doc = await getFirestoreDoc('ads', adId);
    ad = doc && doc.status === 'approved' ? doc : null;
  } catch {
    ad = null;
  }
  if (adPreviewCache.size > 500) adPreviewCache.clear();
  adPreviewCache.set(adId, { at: Date.now(), ad });
  return ad;
}

const escalateAllow = makeRateBucket(5, 600_000);

// Really forwards an escalated help question to the admins: creates an open report in
// Firestore (visible in the admin dashboard) and relays it to Sanad. Returns true only if
// at least one of the two succeeded, so the widget never claims a false "admins notified".
async function recordEscalation(
  question: string,
  ctx: { page?: string; adId?: string },
  ip: string
): Promise<boolean> {
  if (!escalateAllow(ip)) return false;
  let saved = false;
  const reportId = `rep_help_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

  try {
    const { token } = await getFirestoreAdminAuth();
    await commitFirestoreWrite(
      [
        makeCreateWrite(
          'reports',
          reportId,
          {
            reporterId: 'visitor_help',
            reporterName: 'زائر (مساعد السوق)',
            targetType: ctx.adId ? 'ad' : 'user',
            targetAdId: clampStr(ctx.adId || '', 128),
            targetAdTitle: '',
            targetUserId: '',
            targetUserName: '',
            reason: 'استفسار/شكوى محوّلة من مساعد السوق',
            details: clampStr(question, 1000),
            status: 'open',
            adminNote: '',
          },
          ['createdAt', 'updatedAt']
        ),
      ],
      token
    );
    saved = true;
  } catch (err) {
    console.error('Escalation report write failed:', err instanceof Error ? err.message : err);
  }

  const sanadUrl = getSanadApiUrl();
  const secret = getSanadWebhookSecret();
  if (sanadUrl && secret) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const resp = await fetch(`${sanadUrl}/api/webhooks/market`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-sanad-key': secret },
        body: JSON.stringify({
          event: 'new_report',
          id: reportId,
          reason: 'استفسار/شكوى محوّلة من مساعد السوق',
          message: clampStr(question, 600),
        }),
        signal: controller.signal,
      });
      if (resp.ok) saved = true;
    } catch {
      // webhook is best-effort
    } finally {
      clearTimeout(timer);
    }
  }
  return saved;
}

const assistantAdSubmitAllow = makeRateBucket(6, 3_600_000);

function isSafeStoredImageRef(raw: unknown): boolean {
  const val = clampStr(raw, 500);
  if (!val) return false;
  if (val.startsWith('/uploads/') && !val.includes('..')) return true;
  try {
    const parsed = new URL(val);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function sanitizeImageList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const val = clampStr(item, 500);
    if (!val || !isSafeStoredImageRef(val) || seen.has(val)) continue;
    seen.add(val);
    out.push(val);
    if (out.length >= 6) break;
  }
  return out;
}

interface MarketCategoryEntry {
  id: string;
  slug: string;
  nameAr: string;
  subcategories: Array<{ id: string; slug: string; nameAr: string }>;
}

let categoriesCache: { at: number; items: MarketCategoryEntry[] } | null = null;

async function getMarketCategoriesCached(token?: string): Promise<MarketCategoryEntry[]> {
  if (categoriesCache && Date.now() - categoriesCache.at < 300_000) {
    return categoriesCache.items;
  }
  const fallback: MarketCategoryEntry[] = DEFAULT_CATEGORIES_SEED.map((c) => ({
    id: c.id,
    slug: c.slug,
    nameAr: c.nameAr,
    subcategories: c.subcategories.map((s) => ({
      id: s.id,
      slug: s.slug,
      nameAr: s.nameAr,
    })),
  }));
  try {
    const rows = await runFirestoreQuery('categories', {
      whereEquals: [{ field: 'isActive', value: true }],
      token,
    });
    if (rows.length > 0) {
      const mapped = rows
        .sort((a, b) => Number(a.sortOrder || 99) - Number(b.sortOrder || 99))
        .map((c) => {
          const subs = Array.isArray(c.subcategories) ? c.subcategories : [];
          return {
            id: clampStr(c.id || c.slug, 128),
            slug: clampStr(c.slug || c.id, 80),
            nameAr: clampStr(c.nameAr || c.slug, 100),
            subcategories: subs
              .filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === 'object' && s.isActive !== false)
              .map((s) => ({
                id: clampStr(s.id || s.slug, 80),
                slug: clampStr(s.slug || s.id, 80),
                nameAr: clampStr(s.nameAr || s.slug, 100),
              })),
          };
        })
        .filter((c) => c.id && c.slug && c.nameAr);
      if (mapped.length > 0) {
        categoriesCache = { at: Date.now(), items: mapped };
        return mapped;
      }
    }
  } catch {
    // fallback to default seed
  }
  categoriesCache = { at: Date.now(), items: fallback };
  return fallback;
}

async function resolveCategoryAndSubcategory(
  rawCategory: string,
  rawSubcategory: string,
  adType: string,
  token?: string
): Promise<{
  categoryId: string;
  categorySlug: string;
  categoryName: string;
  subcategorySlug: string;
  subcategoryName: string;
}> {
  const cats = await getMarketCategoriesCached(token);
  const normCat = normalizeSearchText(rawCategory);

  let matched = cats.find(
    (c) =>
      normalizeSearchText(c.slug) === normCat ||
      normalizeSearchText(c.id) === normCat ||
      normalizeSearchText(c.nameAr) === normCat
  );

  if (!matched && normCat) {
    matched = cats.find(
      (c) =>
        normalizeSearchText(c.nameAr).includes(normCat) ||
        normCat.includes(normalizeSearchText(c.nameAr)) ||
        normalizeSearchText(c.slug).includes(normCat)
    );
  }

  if (!matched && normCat) {
    const keywordMap: Array<[string[], string]> = [
      [['مطلوب', 'ابحث', 'wanted'], 'wanted'],
      [['وظيف', 'عمل', 'شغل', 'job'], 'jobs'],
      [['ايجار', 'للايجار', 'شقه', 'rent'], 'properties-rent'],
      [['عقار', 'بيت', 'منزل', 'عماره', 'دكان', 'محل'], 'properties-sale'],
      [['ارض', 'قطعه', 'land'], 'land'],
      [['سيار', 'موتر', 'ركش', 'دراج', 'car'], 'cars-transport'],
      [['هاتف', 'تلفون', 'موبايل', 'جوال', 'ايفون', 'سامسونج', 'لابتوب', 'الكترون', 'شاش'], 'phones-electronics'],
      [['اثاث', 'غرفه', 'ثلاج', 'مطبخ', 'كنب'], 'furniture-home'],
      [['زراع', 'محاص', 'ذره', 'سمسم', 'غنم', 'بقر', 'ماشي'], 'agriculture-livestock'],
      [['خدم', 'صيان', 'سباك', 'نجار', 'كهرب'], 'services-businesses'],
      [['مجتمع', 'مفقود', 'فعال', 'مناسب'], 'community'],
    ];
    for (const [keys, targetSlug] of keywordMap) {
      if (keys.some((k) => normCat.includes(normalizeSearchText(k)))) {
        matched = cats.find((c) => c.slug === targetSlug);
        if (matched) break;
      }
    }
  }

  if (!matched) {
    if (adType === 'wanted') matched = cats.find((c) => c.slug === 'wanted');
    else if (adType === 'job') matched = cats.find((c) => c.slug === 'jobs');
    else if (adType === 'announcement') matched = cats.find((c) => c.slug === 'community');
  }

  if (!matched) {
    matched = cats.find((c) => c.slug === 'miscellaneous') || cats[0];
  }

  let subSlug = '';
  let subName = '';
  const normSub = normalizeSearchText(rawSubcategory);
  if (matched && normSub && matched.subcategories.length > 0) {
    const subMatch = matched.subcategories.find(
      (s) =>
        normalizeSearchText(s.slug) === normSub ||
        normalizeSearchText(s.id) === normSub ||
        normalizeSearchText(s.nameAr) === normSub ||
        normalizeSearchText(s.nameAr).includes(normSub) ||
        normSub.includes(normalizeSearchText(s.nameAr))
    );
    if (subMatch) {
      subSlug = subMatch.slug;
      subName = subMatch.nameAr;
    }
  }

  return {
    categoryId: matched.id,
    categorySlug: matched.slug,
    categoryName: matched.nameAr,
    subcategorySlug: subSlug,
    subcategoryName: subName,
  };
}

interface VerifiedWidgetUserContext {
  authenticated: boolean;
  emailVerified: boolean;
  blocked: boolean;
  uid: string;
  name: string;
  phone: string;
  location: string;
}

async function resolveVerifiedWidgetUser(
  req: Request,
  verifyFirebaseIdToken: VerifyFirebaseFn
): Promise<VerifiedWidgetUserContext | undefined> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return undefined;
  }
  const idToken = authHeader.slice('Bearer '.length).trim();
  if (!idToken) return undefined;
  const verified = await verifyFirebaseIdToken(idToken);
  if (!verified.ok || !verified.localId || verified.disabled) {
    return undefined;
  }

  let name = clampStr(verified.email?.split('@')[0] || '', 80);
  let phone = '';
  let location = '';
  let blocked = false;

  try {
    const { token } = await getFirestoreAdminAuth();
    const [userDoc, privateDoc] = await Promise.all([
      getFirestoreDoc('users', verified.localId, token).catch(() => null),
      getFirestoreDoc(`users/${verified.localId}/private`, 'info', token).catch(() => null),
    ]);
    if (userDoc) {
      if (userDoc.name) name = clampStr(userDoc.name, 80);
      if (userDoc.location) location = clampStr(userDoc.location, 120);
      blocked = Boolean(userDoc.isBlocked);
    }
    if (privateDoc?.phone) {
      phone = clampStr(privateDoc.phone, 40);
    }
  } catch {
    // Firestore admin lookup optional for chat context
  }

  return {
    authenticated: true,
    emailVerified: Boolean(verified.emailVerified),
    blocked,
    uid: verified.localId,
    name,
    phone,
    location,
  };
}

export function registerSanadBridgeRoutes(app: Express, verifyFirebaseIdToken: VerifyFirebaseFn): void {
  // 1. Admin Stats
  app.get('/api/sanad/stats', requireSanadKey, async (_req: Request, res: Response) => {
    try {
      const { token } = await getFirestoreAdminAuth();
      const [users, ads, reports, promos] = await Promise.all([
        runFirestoreQuery('users', { token }),
        runFirestoreQuery('ads', { token }),
        runFirestoreQuery('reports', { token }),
        runFirestoreQuery('heroPromotions', { token }),
      ]);

      let totalUsers = 0;
      let blockedUsers = 0;
      for (const u of users) {
        if (!u.isSample) {
          totalUsers++;
          if (u.isBlocked) blockedUsers++;
        }
      }

      let pendingAds = 0;
      let approvedAds = 0;
      let rejectedAds = 0;
      let soldAds = 0;
      for (const a of ads) {
        if (a.status === 'pending') pendingAds++;
        else if (a.status === 'approved') approvedAds++;
        else if (a.status === 'rejected') rejectedAds++;
        else if (a.status === 'sold') soldAds++;
      }

      const openReports = reports.filter((r) => r.status === 'open').length;
      const pendingPromotions = promos.filter((p) => p.status === 'pending').length;
      const activePromotions = promos.filter((p) => p.status === 'active').length;

      res.json({
        stats: {
          totalUsers,
          blockedUsers,
          pendingAds,
          approvedAds,
          rejectedAds,
          soldAds,
          openReports,
          pendingPromotions,
          activePromotions,
        },
      });
    } catch (err) {
      res.status(503).json({
        error: err instanceof Error ? err.message : 'تعذر جلب إحصائيات السوق حالياً.',
      });
    }
  });

  // 2. Admin Pending Queue
  app.get('/api/sanad/pending', requireSanadKey, async (req: Request, res: Response) => {
    try {
      const { token } = await getFirestoreAdminAuth();
      const type = clampStr(req.query.type || 'all', 20);
      const limit = Math.min(Math.max(Number(req.query.limit) || 15, 1), 30);
      const baseUrl = resolveAppBaseUrl(req);

      const wantAds = type === 'all' || type === 'ads';
      const wantPromos = type === 'all' || type === 'promotions';
      const wantReports = type === 'all' || type === 'reports';

      const [rawAds, rawPromos, rawReports] = await Promise.all([
        wantAds
          ? runFirestoreQuery('ads', { whereEquals: [{ field: 'status', value: 'pending' }], token })
          : Promise.resolve([]),
        wantPromos
          ? runFirestoreQuery('heroPromotions', { whereEquals: [{ field: 'status', value: 'pending' }], token })
          : Promise.resolve([]),
        wantReports
          ? runFirestoreQuery('reports', { whereEquals: [{ field: 'status', value: 'open' }], token })
          : Promise.resolve([]),
      ]);

      const ads = rawAds
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
        .slice(0, limit)
        .map((a) => formatAdSummary(a, baseUrl));

      const promotions = rawPromos
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
        .slice(0, limit)
        .map((p) => formatPromoSummary(p, baseUrl));

      const reports = rawReports
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
        .slice(0, limit)
        .map(formatReportSummary);

      res.json({ ads, promotions, reports });
    } catch (err) {
      res.status(503).json({
        error: err instanceof Error ? err.message : 'تعذر جلب قائمة الانتظار.',
      });
    }
  });

  // 3. Admin Search Ads
  app.get('/api/sanad/ads', requireSanadKey, async (req: Request, res: Response) => {
    try {
      const { token } = await getFirestoreAdminAuth();
      const q = clampStr(req.query.q || '', 120).toLowerCase();
      const category = clampStr(req.query.category || '', 80).toLowerCase();
      const status = clampStr(req.query.status || 'all', 30);
      const limit = Math.min(Math.max(Number(req.query.limit) || 15, 1), 30);
      const baseUrl = resolveAppBaseUrl(req);

      const whereEquals =
        status && status !== 'all' ? [{ field: 'status', value: status }] : undefined;
      const rawAds = await runFirestoreQuery('ads', { whereEquals, token });

      const filtered = rawAds
        .filter((a) => {
          if (category) {
            const catSlug = String(a.categorySlug || '').toLowerCase();
            const catName = String(a.categoryName || '').toLowerCase();
            if (catSlug !== category && !catName.includes(category)) return false;
          }
          if (q) {
            const haystack = [
              a.title,
              a.description,
              a.location,
              a.ownerName,
              a.categoryName,
              a.subcategoryName,
            ]
              .map((v) => String(v || '').toLowerCase())
              .join(' ');
            if (!haystack.includes(q)) return false;
          }
          return true;
        })
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
        .slice(0, limit)
        .map((a) => formatAdSummary(a, baseUrl));

      res.json({ ads: filtered });
    } catch (err) {
      res.status(503).json({
        error: err instanceof Error ? err.message : 'تعذر البحث في الإعلانات.',
      });
    }
  });

  // 4. Admin Review Ad (approve | reject | delete)
  app.post('/api/sanad/ads/:id/review', requireSanadKey, async (req: Request, res: Response) => {
    const adId = clampStr(req.params.id || '', 128);
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(adId)) {
      res.status(400).json({ error: 'معرف الإعلان غير صالح.' });
      return;
    }
    const decision = clampStr(req.body?.decision || '', 20);
    if (!['approve', 'reject', 'delete'].includes(decision)) {
      res.status(400).json({ error: 'القرار يجب أن يكون approve أو reject أو delete.' });
      return;
    }
    const reason = clampStr(req.body?.reason || '', 500);

    try {
      const { token, actorId } = await getFirestoreAdminAuth();
      const existing = await getFirestoreDoc('ads', adId, token);
      if (!existing) {
        res.status(404).json({ error: 'الإعلان غير موجود.' });
        return;
      }

      const writes: Array<Record<string, unknown>> = [];
      if (decision === 'delete') {
        writes.push({ delete: docPath('ads', adId) });
        writes.push(makeAuditWrite(actorId, 'حذف إعلان عبر سند', String(existing.title || adId)));
      } else {
        const nextStatus = decision === 'approve' ? 'approved' : 'rejected';
        writes.push(
          makeUpdateWrite(
            'ads',
            adId,
            {
              status: nextStatus,
              rejectionReason: decision === 'reject' ? reason : '',
            },
            ['updatedAt']
          )
        );
        writes.push(
          makeAuditWrite(actorId, `مراجعة إعلان عبر سند (${nextStatus})`, String(existing.title || adId))
        );
        const ownerId = String(existing.ownerId || '');
        if (ownerId && ownerId !== actorId) {
          writes.push(
            makeNotificationWrite({
              userId: ownerId,
              title: nextStatus === 'approved' ? 'تمت الموافقة على إعلانك' : 'لم يتم اعتماد إعلانك',
              body:
                nextStatus === 'approved'
                  ? `أصبح إعلانك "${String(existing.title || '')}" منشوراً ومتاحاً لجميع المتصفحين.`
                  : `إعلانك "${String(existing.title || '')}" بحاجة لتعديل: ${reason || 'راجع شروط النشر'}`,
              type: nextStatus === 'approved' ? 'ad_approved' : 'ad_rejected',
              linkAdId: adId,
              linkPage: nextStatus === 'approved' ? 'ad-detail' : 'account',
            })
          );
        }
      }

      await commitFirestoreWrite(writes, token);
      if (decision === 'approve') {
        try {
          await commitFirestoreWrite([makeNewAdAlertWrite(adId, existing)], token);
        } catch {
          // Non-fatal if firestore.rules has not been published yet
        }
      }
      res.json({
        ok: true,
        id: adId,
        decision,
        title: String(existing.title || ''),
      });
    } catch (err) {
      res.status(503).json({
        error: err instanceof Error ? err.message : 'تعذر تنفيذ مراجعة الإعلان.',
      });
    }
  });

  // 5. Admin Review Paid Hero Promotion (approve | reject)
  app.post('/api/sanad/promotions/:id/review', requireSanadKey, async (req: Request, res: Response) => {
    const promoId = clampStr(req.params.id || '', 128);
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(promoId)) {
      res.status(400).json({ error: 'معرف البنر غير صالح.' });
      return;
    }
    const decision = clampStr(req.body?.decision || '', 20);
    if (!['approve', 'reject'].includes(decision)) {
      res.status(400).json({ error: 'القرار يجب أن يكون approve أو reject.' });
      return;
    }
    const reason = clampStr(req.body?.reason || '', 300);

    try {
      const { token, actorId } = await getFirestoreAdminAuth();
      const existing = await getFirestoreDoc('heroPromotions', promoId, token);
      if (!existing) {
        res.status(404).json({ error: 'طلب البنر المدفوع غير موجود.' });
        return;
      }

      const nextStatus = decision === 'approve' ? 'active' : 'rejected';
      let startsAt = String(existing.startsAt || '');
      let expiresAt = String(existing.expiresAt || '');
      if (nextStatus === 'active') {
        const days = Math.max(1, Math.min(365, Number(existing.packageDays) || 7));
        if (!startsAt) startsAt = new Date().toISOString();
        if (!expiresAt || Date.parse(expiresAt) <= Date.now()) {
          expiresAt = new Date(Date.now() + days * 24 * 3600 * 1000).toISOString();
        }
      }

      const writes: Array<Record<string, unknown>> = [
        makeUpdateWrite(
          'heroPromotions',
          promoId,
          {
            status: nextStatus,
            startsAt,
            expiresAt,
            adminNote: reason,
          },
          ['updatedAt']
        ),
        makeAuditWrite(
          actorId,
          `مراجعة بنر مدفوع عبر سند (${nextStatus})`,
          String(existing.title || promoId)
        ),
      ];

      const linkedAdId = String(existing.adId || '');
      if (nextStatus === 'active' && linkedAdId) {
        const linkedAd = await getFirestoreDoc('ads', linkedAdId, token).catch(() => null);
        if (linkedAd) {
          writes.push(makeUpdateWrite('ads', linkedAdId, { isFeatured: true }, ['updatedAt']));
        }
      }

      const promoOwner = String(existing.userId || '');
      if (promoOwner && promoOwner !== actorId) {
        writes.push(
          makeNotificationWrite({
            userId: promoOwner,
            title: nextStatus === 'active' ? 'تم تفعيل إعلانك المدفوع' : 'تم رفض طلب الترويج المدفوع',
            body:
              nextStatus === 'active'
                ? `إعلانك "${String(existing.title || '')}" يظهر الآن في بنر الواجهة الرئيسية.`
                : `تعذر تفعيل بنر "${String(existing.title || '')}". ${reason || 'يرجى مراجعة بيانات الدفع والتواصل مع الإدارة.'}`,
            type: nextStatus === 'active' ? 'hero_active' : 'hero_rejected',
            linkAdId: linkedAdId,
            linkPage: 'account',
          })
        );
      }

      await commitFirestoreWrite(writes, token);
      res.json({
        ok: true,
        id: promoId,
        decision,
        status: nextStatus,
        title: String(existing.title || ''),
      });
    } catch (err) {
      res.status(503).json({
        error: err instanceof Error ? err.message : 'تعذر تنفيذ مراجعة البنر المدفوع.',
      });
    }
  });

  // 6. Admin Resolve Report (dismiss | remove_ad)
  app.post('/api/sanad/reports/:id/resolve', requireSanadKey, async (req: Request, res: Response) => {
    const reportId = clampStr(req.params.id || '', 128);
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(reportId)) {
      res.status(400).json({ error: 'معرف البلاغ غير صالح.' });
      return;
    }
    const action = clampStr(req.body?.action || '', 20);
    if (!['dismiss', 'remove_ad'].includes(action)) {
      res.status(400).json({ error: 'الإجراء يجب أن يكون dismiss أو remove_ad.' });
      return;
    }
    const note = clampStr(req.body?.note || '', 400);

    try {
      const { token, actorId } = await getFirestoreAdminAuth();
      const existing = await getFirestoreDoc('reports', reportId, token);
      if (!existing) {
        res.status(404).json({ error: 'البلاغ غير موجود.' });
        return;
      }

      const nextStatus = action === 'dismiss' ? 'dismissed' : 'reviewed';
      const writes: Array<Record<string, unknown>> = [
        makeUpdateWrite(
          'reports',
          reportId,
          {
            status: nextStatus,
            adminNote: note,
          },
          ['updatedAt']
        ),
        makeAuditWrite(
          actorId,
          `معالجة بلاغ عبر سند (${action})`,
          String(existing.targetAdTitle || existing.targetUserName || reportId)
        ),
      ];

      const targetAdId = String(existing.targetAdId || '');
      let removedAd = false;
      if (action === 'remove_ad' && targetAdId) {
        const targetAd = await getFirestoreDoc('ads', targetAdId, token).catch(() => null);
        if (targetAd) {
          removedAd = true;
          const reasonText = note || 'تمت إزالة الإعلان بعد مراجعة البلاغ';
          writes.push(
            makeUpdateWrite(
              'ads',
              targetAdId,
              {
                status: 'rejected',
                rejectionReason: reasonText,
              },
              ['updatedAt']
            )
          );
          const ownerId = String(targetAd.ownerId || '');
          if (ownerId && ownerId !== actorId) {
            writes.push(
              makeNotificationWrite({
                userId: ownerId,
                title: 'تم إيقاف إعلانك بعد مراجعة بلاغ',
                body: `تم إيقاف إعلانك "${String(targetAd.title || '')}": ${reasonText}`,
                type: 'ad_rejected',
                linkAdId: targetAdId,
                linkPage: 'account',
              })
            );
          }
        }
      }

      await commitFirestoreWrite(writes, token);
      res.json({
        ok: true,
        id: reportId,
        action,
        status: nextStatus,
        removedAd,
      });
    } catch (err) {
      res.status(503).json({
        error: err instanceof Error ? err.message : 'تعذر معالجة البلاغ.',
      });
    }
  });

  // 7. Public Approved Ads Search (for Sanad Public Help Widget)
  app.get('/api/public/ads/search', publicSearchRateLimit, async (req: Request, res: Response) => {
    const q = clampStr(req.query.q || '', 120).toLowerCase();
    const category = clampStr(req.query.category || '', 80).toLowerCase();
    const limit = Math.min(Math.max(Number(req.query.limit) || 6, 1), 12);
    const baseUrl = resolveAppBaseUrl(req);

    try {
      const rawAds = await getApprovedAdsCached();
      const ads = rawAds
        .filter((a) => {
          if (category) {
            const catSlug = String(a.categorySlug || '').toLowerCase();
            const catName = String(a.categoryName || '').toLowerCase();
            if (catSlug !== category && !catName.includes(category)) return false;
          }
          if (q) {
            const haystack = [
              a.title,
              a.description,
              a.location,
              a.categoryName,
              a.subcategoryName,
            ]
              .map((v) => String(v || '').toLowerCase())
              .join(' ');
            if (!haystack.includes(q)) return false;
          }
          return true;
        })
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
        .slice(0, limit)
        .map((a) => {
          const id = String(a.id || '');
          return {
            id,
            title: String(a.title || ''),
            price: Number(a.price || 0),
            category: String(a.categorySlug || ''),
            categoryName: String(a.categoryName || ''),
            location: String(a.location || ''),
            adType: String(a.adType || 'offer'),
            url: baseUrl && id ? `${baseUrl}/ad/${encodeURIComponent(id)}` : `/ad/${encodeURIComponent(id)}`,
          };
        });

      res.json({ ads });
    } catch (err) {
      res.status(503).json({
        ads: [],
        error: err instanceof Error ? err.message : 'تعذر البحث العام في الإعلانات حالياً.',
      });
    }
  });

  // 8. Authenticated Webhook Relay from Market Users -> Sanad Admin
  app.post('/api/sanad/notify', async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'يرجى تسجيل الدخول لإرسال الإشعار.' });
      return;
    }
    const idToken = authHeader.slice('Bearer '.length).trim();
    const verified = await verifyFirebaseIdToken(idToken);
    if (!verified.ok || !verified.localId || verified.disabled) {
      res.status(verified.status || 401).json({ error: verified.error || 'جلسة غير صالحة.' });
      return;
    }

    if (!verified.emailVerified) {
      res.status(403).json({ error: 'يرجى تأكيد بريدك الإلكتروني أولاً.' });
      return;
    }
    if (!notifyAllow(verified.localId)) {
      res.status(429).json({ error: 'تم تجاوز الحد المؤقت للإشعارات، يرجى المحاولة بعد قليل.' });
      return;
    }

    const sanadUrl = getSanadApiUrl();
    const secret = getSanadWebhookSecret();
    if (!sanadUrl || !secret) {
      res.json({ ok: true, skipped: true });
      return;
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const event = clampStr(body.event || '', 40);
    if (!['new_ad', 'ad_approved', 'new_hero', 'new_report'].includes(event)) {
      res.status(400).json({ error: 'نوع الحدث غير مدعوم.' });
      return;
    }

    const baseUrl = resolveAppBaseUrl(req);
    const resolveAsset = (rawPath: unknown): string | undefined => {
      const s = clampStr(rawPath, 500);
      if (!s) return undefined;
      if (s.startsWith('/') && !s.startsWith('//') && baseUrl) return `${baseUrl}${s}`;
      // Forward HTTPS URLs pointing at our origin or trusted storage providers (Firebase, Google Cloud, Supabase)
      try {
        const u = new URL(s);
        if (u.protocol !== 'https:') return undefined;
        const host = u.host.toLowerCase();
        const allowedExact = new Set(['firebasestorage.googleapis.com', 'storage.googleapis.com']);
        if (baseUrl) allowedExact.add(new URL(baseUrl).host.toLowerCase());
        if (
          allowedExact.has(host) ||
          host.endsWith('.supabase.co') ||
          host.endsWith('.firebasestorage.app')
        ) {
          return u.toString();
        }
      } catch {
        // not a valid absolute URL
      }
      return undefined;
    };

    let payload: Record<string, unknown> = {
      event,
      id: clampStr(body.id, 128) || undefined,
      title: clampStr(body.title, 160) || undefined,
      category: clampStr(body.category, 100) || undefined,
      price: body.price !== undefined ? Number(body.price) || 0 : undefined,
      owner_name: clampStr(body.owner_name, 80) || undefined,
      ad_type: clampStr(body.ad_type, 40) || undefined,
      reason: clampStr(body.reason, 400) || undefined,
      image_url: resolveAsset(body.image_url),
      receipt_url: resolveAsset(body.receipt_url),
      contact: clampStr(body.contact, 80) || undefined,
      message: clampStr(body.message, 600) || undefined,
    };

    if (event === 'ad_approved') {
      const adId = clampStr(body.id || '', 128);
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(adId)) {
        res.status(400).json({ error: 'معرف الإعلان غير صالح.' });
        return;
      }
      try {
        const { token } = await getFirestoreAdminAuth();
        const existing = await getFirestoreDoc('ads', adId, token);
        if (!existing || String(existing.status || '') !== 'approved') {
          res.status(403).json({ error: 'الإعلان غير معتمد بعد.' });
          return;
        }
        const rawImgs = Array.isArray(existing.images) ? existing.images : [];
        const resolvedImages = rawImgs.map((u) => resolveAsset(u)).filter((u): u is string => Boolean(u)).slice(0, 10);
        payload = {
          event: 'ad_approved',
          id: adId,
          title: clampStr(existing.title, 160) || undefined,
          description: clampStr(existing.description, 1000) || undefined,
          category: clampStr(existing.categoryName || existing.categorySlug, 100) || undefined,
          price: existing.price !== undefined ? Number(existing.price) || 0 : undefined,
          location: clampStr(existing.location, 120) || undefined,
          owner_name: clampStr(existing.ownerName, 80) || undefined,
          ad_type: clampStr(existing.adType, 40) || undefined,
          image_url: resolvedImages[0] || undefined,
          images: resolvedImages,
          url: baseUrl ? `${baseUrl}/ad/${encodeURIComponent(adId)}` : undefined,
        };
      } catch {
        res.status(503).json({ error: 'تعذر التحقق من حالة الإعلان.' });
        return;
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const resp = await fetch(`${sanadUrl}/api/webhooks/market`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-sanad-key': secret,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!resp.ok) {
        const txt = await resp.text().catch(() => '');
        res.status(502).json({ ok: false, error: txt || `Sanad webhook HTTP ${resp.status}` });
        return;
      }
      const data = await resp.json().catch(() => ({ ok: true }));
      res.json({ ok: true, ...(typeof data === 'object' && data ? data : {}) });
    } catch {
      res.status(502).json({ ok: false, error: 'تعذر الوصول إلى خادم سند مؤقتاً.' });
    } finally {
      clearTimeout(timer);
    }
  });

  // 9. Public Visitor & Authenticated Help Proxy (same-origin for Market Widget -> Sanad /api/public/market-help)
  app.post('/api/public/help', publicHelpRateLimit, async (req: Request, res: Response) => {
    const question = clampStr(req.body?.question || '', 800);
    if (question.length < 1) {
      res.status(400).json({ detail: 'يرجى كتابة سؤالك أو ردك أولاً.' });
      return;
    }

    const sanadUrl = getSanadApiUrl();
    if (!sanadUrl) {
      res.status(503).json({
        detail: 'خدمة المساعد الذكي غير مربوطة حالياً (SANAD_API_URL غير مضاف في إعدادات الخادم).',
      });
      return;
    }

    const rawHistory: unknown[] = Array.isArray(req.body?.history) ? req.body.history : [];
    const history = rawHistory
      .slice(-10)
      .filter(
        (m: unknown): m is { role: 'user' | 'assistant'; content: string } =>
          Boolean(m) &&
          typeof m === 'object' &&
          ((m as { role?: unknown }).role === 'user' || (m as { role?: unknown }).role === 'assistant') &&
          typeof (m as { content?: unknown }).content === 'string'
      )
      .map((m) => ({ role: m.role, content: m.content.slice(0, 800) }));

    const userContext = await resolveVerifiedWidgetUser(req, verifyFirebaseIdToken);
    const rawCtx = req.body?.context && typeof req.body.context === 'object' ? req.body.context : {};
    const canAttachImages = Boolean(
      userContext?.authenticated && userContext.emailVerified && !userContext.blocked
    );
    const attachedImages = canAttachImages ? sanitizeImageList(rawCtx.attachedImages) : [];
    const categoriesList = await getMarketCategoriesCached()
      .then((cats) => cats.map((c) => ({ slug: c.slug, nameAr: c.nameAr })))
      .catch(() => []);

    const context = {
      page: typeof rawCtx.page === 'string' ? rawCtx.page.slice(0, 60) : undefined,
      adId: typeof rawCtx.adId === 'string' ? rawCtx.adId.slice(0, 80) : undefined,
      attachedImages,
      categories: categoriesList,
    };

    const secret = getSanadWebhookSecret() || getSanadBridgeKey();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 32_000);
    try {
      const origin = resolveAppBaseUrl(req);
      const resp = await fetch(`${sanadUrl}/api/public/market-help`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(origin ? { Origin: origin } : {}),
          ...(secret ? { 'x-sanad-key': secret } : {}),
        },
        body: JSON.stringify({ question, history, context, userContext }),
        signal: controller.signal,
      });
      const data = (await resp.json().catch(() => null)) as Record<string, unknown> | null;
      if (!resp.ok) {
        res.status(resp.status).json({
          detail:
            (typeof data?.detail === 'string' && data.detail) ||
            (typeof data?.error === 'string' && data.error) ||
            'المساعد غير متاح حالياً، يرجى المحاولة بعد قليل.',
        });
        return;
      }
      const result: Record<string, unknown> = data || { answer: '', escalated: false };
      if (result.escalated === true) {
        const recorded = await recordEscalation(question, context, req.ip || 'unknown');
        result.escalated = recorded;
        if (!recorded) result.escalationFailed = true;
      }
      res.json(result);
    } catch {
      res.status(503).json({
        detail: 'تعذر الاتصال بمساعد سند حالياً، يرجى المحاولة لاحقاً.',
      });
    } finally {
      clearTimeout(timer);
    }
  });

  // 9b. Submit New Pending Ad via Sanad Assistant (Registered & Verified Users Only)
  app.post('/api/sanad/ads/submit', requireSanadKey, async (req: Request, res: Response) => {
    const ownerId = clampStr(req.body?.ownerId || '', 128);
    if (!/^[a-zA-Z0-9_-]{3,128}$/.test(ownerId)) {
      res.status(400).json({ error: 'معرف المستخدم غير صالح.' });
      return;
    }

    const title = clampStr(req.body?.title || '', 160);
    const description = clampStr(req.body?.description || '', 4000);
    const location = clampStr(req.body?.location || '', 120);
    const contactPhone = clampStr(req.body?.contactPhone || req.body?.contact_phone || '', 40);
    const contactWhatsapp = clampStr(
      req.body?.contactWhatsapp || req.body?.contact_whatsapp || contactPhone,
      40
    );
    const documentInfo = clampStr(req.body?.documentInfo || '', 500);
    const rawAdType = clampStr(req.body?.adType || req.body?.ad_type || 'offer', 20).toLowerCase();
    const adType = ['offer', 'wanted', 'job', 'announcement'].includes(rawAdType)
      ? rawAdType
      : 'offer';
    const priceNum = Math.max(0, Number(req.body?.price) || 0);
    const isNegotiable =
      typeof req.body?.isNegotiable === 'boolean'
        ? req.body.isNegotiable
        : typeof req.body?.is_negotiable === 'boolean'
        ? req.body.is_negotiable
        : priceNum === 0;
    const rawCategory = clampStr(req.body?.category || req.body?.categorySlug || '', 100);
    const rawSubcategory = clampStr(req.body?.subcategory || req.body?.subcategorySlug || '', 100);
    const images = sanitizeImageList(req.body?.images);

    if (title.length < 3 || title.length > 160) {
      res.status(400).json({ error: 'يجب أن يكون عنوان الإعلان بين 3 و 160 حرفاً.' });
      return;
    }
    if (description.length < 5 || description.length > 4000) {
      res.status(400).json({ error: 'يجب أن يكون وصف الإعلان 5 أحرف على الأقل.' });
      return;
    }
    if (location.length < 2) {
      res.status(400).json({ error: 'يرجى تحديد الموقع أو الحي داخل أبوجبيهة.' });
      return;
    }
    if (contactPhone.length < 6) {
      res.status(400).json({ error: 'يرجى إدخال رقم هاتف أو واتساب صحيح للتواصل.' });
      return;
    }

    const prohibited = checkProhibitedContent(`${title} ${description}`);
    if (prohibited) {
      res.status(400).json({
        error: `عذراً، الإعلان يحتوي على محتوى غير مسموح به (${prohibited}).`,
      });
      return;
    }

    if (!assistantAdSubmitAllow(ownerId)) {
      res.status(429).json({
        error: 'تم تجاوز الحد المسموح لرفع الإعلانات عبر المساعد حالياً، يرجى المحاولة بعد ساعة.',
      });
      return;
    }

    try {
      const { token, actorId } = await getFirestoreAdminAuth();
      const [userDoc, privateDoc] = await Promise.all([
        getFirestoreDoc('users', ownerId, token),
        getFirestoreDoc(`users/${ownerId}/private`, 'info', token).catch(() => null),
      ]);

      if (!userDoc) {
        res.status(403).json({
          error: 'يرجى تسجيل الدخول وإكمال ملفك الشخصي في الموقع قبل رفع الإعلان.',
        });
        return;
      }
      if (userDoc.isBlocked) {
        res.status(403).json({
          error: 'هذا الحساب محظور ولا يمكنه نشر إعلانات حالياً.',
        });
        return;
      }

      const resolvedCat = await resolveCategoryAndSubcategory(rawCategory, rawSubcategory, adType, token);
      const ownerName = clampStr(userDoc.name || req.body?.ownerName || 'معلن', 80) || 'معلن';
      const ownerAvatar = clampStr(userDoc.avatarUrl || '', 500);
      const ownerVerified = Boolean(userDoc.isVerifiedAccount);
      const fallbackPhone = clampStr(privateDoc?.phone || '', 40);
      const finalPhone = contactPhone || fallbackPhone;
      const finalWhatsapp = contactWhatsapp || finalPhone;

      const adId = `ad_sanad_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

      const writes: Array<Record<string, unknown>> = [
        makeCreateWrite(
          'ads',
          adId,
          {
            ownerId,
            ownerName,
            ownerAvatar,
            ownerVerified,
            categoryId: resolvedCat.categoryId,
            categorySlug: resolvedCat.categorySlug,
            categoryName: resolvedCat.categoryName,
            subcategorySlug: resolvedCat.subcategorySlug,
            subcategoryName: resolvedCat.subcategoryName,
            title,
            description,
            price: priceNum,
            isNegotiable,
            adType,
            location,
            contactPhone: finalPhone,
            contactWhatsapp: finalWhatsapp,
            documentInfo,
            hasVerifiedDocs: false,
            status: 'pending',
            rejectionReason: '',
            isFeatured: false,
            isSample: false,
            viewsCount: 0,
            images,
          },
          ['createdAt', 'updatedAt']
        ),
        makeAuditWrite(
          actorId,
          'استلام إعلان قيد المراجعة عبر مساعد الموقع',
          `${title} (${ownerName})`
        ),
      ];

      if (ownerId !== actorId) {
        writes.push(
          makeNotificationWrite({
            userId: ownerId,
            title: 'تم استلام إعلانك للمراجعة',
            body: `تم استلام إعلانك "${title}" عبر مساعد السوق وهو الآن قيد مراجعة الإدارة.`,
            type: 'system',
            linkAdId: adId,
            linkPage: 'account',
          })
        );
      }

      await commitFirestoreWrite(writes, token);

      const baseUrl = resolveAppBaseUrl(req);
      const resolvedImages = images
        .map((img) => {
          if (img.startsWith('/') && !img.startsWith('//') && baseUrl) return `${baseUrl}${img}`;
          return img;
        })
        .filter((u) => /^https?:\/\//i.test(u));

      const sanadUrl = getSanadApiUrl();
      const secret = getSanadWebhookSecret() || getSanadBridgeKey();
      if (sanadUrl && secret) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        try {
          await fetch(`${sanadUrl}/api/webhooks/market`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-sanad-key': secret,
            },
            body: JSON.stringify({
              event: 'new_ad',
              id: adId,
              title,
              category: resolvedCat.categoryName,
              price: priceNum,
              location,
              owner_name: ownerName,
              ad_type: adType,
              image_url: resolvedImages[0] || undefined,
              images: resolvedImages,
              contact: finalPhone,
              source: 'sanad_widget',
              url: baseUrl ? `${baseUrl}/ad/${encodeURIComponent(adId)}` : undefined,
            }),
            signal: controller.signal,
          });
        } catch {
          // best-effort notification to Sanad
        } finally {
          clearTimeout(timer);
        }
      }

      res.status(201).json({
        ok: true,
        id: adId,
        status: 'pending',
        title,
        categoryName: resolvedCat.categoryName,
        message: 'تم إرسال إعلانك بنجاح بحالة قيد المراجعة (pending)، وسيظهر في الموقع بعد موافقة الإدارة.',
      });
    } catch (err) {
      res.status(503).json({
        error: err instanceof Error ? err.message : 'تعذر حفظ الإعلان حالياً، يرجى المحاولة بعد قليل.',
      });
    }
  });

  // 10. Authenticated AI Ad Writer Proxy (-> Sanad /api/public/market-draft-ad)
  app.post('/api/public/draft-ad', publicHelpRateLimit, async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'يرجى تسجيل الدخول لاستخدام ميزة كتابة الإعلان بالذكاء الاصطناعي.' });
      return;
    }
    const idToken = authHeader.slice('Bearer '.length).trim();
    const verified = await verifyFirebaseIdToken(idToken);
    if (!verified.ok || !verified.localId || verified.disabled) {
      res.status(verified.status || 401).json({ error: verified.error || 'جلسة الدخول غير صالحة.' });
      return;
    }
    if (!verified.emailVerified) {
      res.status(403).json({ error: 'يرجى تأكيد بريدك الإلكتروني أولاً لاستخدام الصياغة الذكية.' });
      return;
    }

    const prompt = clampStr(req.body?.prompt || '', 1000);
    if (prompt.length < 4) {
      res.status(400).json({ error: 'يرجى كتابة وصف مختصر للسلعة أو الخدمة أولاً.' });
      return;
    }

    const sanadUrl = getSanadApiUrl();
    if (!sanadUrl) {
      res.status(503).json({
        error: 'خدمة الصياغة الذكية غير مربوطة حالياً (SANAD_API_URL غير مضاف في إعدادات الخادم).',
      });
      return;
    }

    const rawCats: unknown[] = Array.isArray(req.body?.categories) ? req.body.categories : [];
    const categories = rawCats
      .slice(0, 25)
      .filter((c: unknown): c is Record<string, unknown> => Boolean(c) && typeof c === 'object')
      .map((c: Record<string, unknown>) => ({
        slug: clampStr(c.slug || '', 80),
        name_ar: clampStr(c.name_ar || c.nameAr || '', 100),
        subcategories: Array.isArray(c.subcategories)
          ? (c.subcategories as unknown[])
              .slice(0, 25)
              .filter((s: unknown): s is Record<string, unknown> => Boolean(s) && typeof s === 'object')
              .map((s: Record<string, unknown>) => ({
                slug: clampStr(s.slug || '', 80),
                name_ar: clampStr(s.name_ar || s.nameAr || '', 100),
              }))
          : [],
      }));

    const secret = getSanadWebhookSecret() || getSanadBridgeKey();
    const origin = resolveAppBaseUrl(req);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const resp = await fetch(`${sanadUrl}/api/public/market-draft-ad`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(origin ? { Origin: origin } : {}),
          ...(secret ? { 'x-sanad-key': secret } : {}),
        },
        body: JSON.stringify({ prompt, categories }),
        signal: controller.signal,
      });
      const data = (await resp.json().catch(() => null)) as Record<string, unknown> | null;
      if (!resp.ok || !data?.draft) {
        res.status(resp.status >= 400 ? resp.status : 502).json({
          error:
            (typeof data?.detail === 'string' && data.detail) ||
            (typeof data?.error === 'string' && data.error) ||
            'تعذر توليد صياغة الإعلان حالياً، يرجى المحاولة بعد قليل.',
        });
        return;
      }
      res.json({ draft: data.draft });
    } catch {
      res.status(503).json({
        error: 'تعذر الاتصال بخدمة الذكاء الاصطناعي حالياً، يرجى المحاولة لاحقاً.',
      });
    } finally {
      clearTimeout(timer);
    }
  });
}
