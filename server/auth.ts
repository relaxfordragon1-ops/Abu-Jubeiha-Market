import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { db } from './db.ts';

const TOKEN_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  phone: string;
  location: string;
  avatar_url: string;
  role: 'user' | 'moderator' | 'admin';
  is_blocked: number;
  is_verified_account: number;
  created_at: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  if (!salt || !keyHex) return false;
  const keyBuf = Buffer.from(keyHex, 'hex');
  const derivedBuf = crypto.scryptSync(password, salt, 64);
  if (keyBuf.length !== derivedBuf.length) return false;
  return crypto.timingSafeEqual(keyBuf, derivedBuf);
}

export function createAccessToken(userId: number): string {
  const payload = {
    uid: userId,
    exp: Date.now() + TOKEN_TTL_MS,
    nonce: crypto.randomBytes(8).toString('hex'),
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifyAccessToken(token: string): { uid: number } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [encoded, sig] = parts;
    if (!encoded || !sig) return null;
    const expectedSig = crypto.createHmac('sha256', TOKEN_SECRET).update(encoded).digest('base64url');
    const sigBuf = Buffer.from(sig);
    const expectedBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return null;
    }
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as {
      uid: number;
      exp: number;
    };
    if (!payload.uid || typeof payload.exp !== 'number' || payload.exp < Date.now()) {
      return null;
    }
    return { uid: payload.uid };
  } catch {
    return null;
  }
}

function getUserById(userId: number): AuthUser | null {
  const row = db
    .prepare(
      `SELECT id, name, email, phone, location, avatar_url, role, is_blocked, is_verified_account, created_at
       FROM users WHERE id = ?`
    )
    .get(userId) as AuthUser | undefined;
  return row ?? null;
}

export function optionalAuth(req: AuthenticatedRequest, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    const token = header.slice(7).trim();
    const verified = verifyAccessToken(token);
    if (verified) {
      const user = getUserById(verified.uid);
      if (user && !user.is_blocked) {
        req.user = user;
      }
    }
  }
  next();
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'يرجى تسجيل الدخول للمتابعة' });
    return;
  }
  const token = header.slice(7).trim();
  const verified = verifyAccessToken(token);
  if (!verified) {
    res.status(401).json({ error: 'انتهت جلسة الدخول، يرجى تسجيل الدخول مجدداً' });
    return;
  }
  const user = getUserById(verified.uid);
  if (!user) {
    res.status(401).json({ error: 'الحساب غير موجود' });
    return;
  }
  if (user.is_blocked) {
    res.status(403).json({ error: 'تم حظر هذا الحساب لمخالفة شروط الاستخدام' });
    return;
  }
  req.user = user;
  next();
}

export function requireModeratorOrAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'moderator')) {
      res.status(403).json({ error: 'صلاحيات الإدارة أو الإشراف مطلوبة' });
      return;
    }
    next();
  });
}

export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    if (!req.user || req.user.role !== 'admin') {
      res.status(403).json({ error: 'صلاحيات المدير العام مطلوبة لهذه العملية' });
      return;
    }
    next();
  });
}
