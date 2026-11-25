import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updatePassword,
  updateProfile as updateFirebaseAuthProfile,
  type User as FirebaseUser,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';
import { auth, db, googleAuthProvider, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  fetchAds,
  fetchFavoriteIds,
  fetchUnreadMessagesCount,
  seedDefaultCategoriesIfEmpty,
  seedSampleListingsInFirestore,
} from '../lib/firestoreApi';
import { BOOTSTRAP_ADMIN_EMAILS } from '../lib/marketplaceSearch';
import type { User, UserRole } from '../types';

interface UserStats {
  unreadMessages: number;
  favoritesCount: number;
  myAdsCount: number;
}

interface PendingSignupProfile {
  name: string;
  phone: string;
  location: string;
}

const PENDING_PROFILE_KEY = 'abu_jubeiha_pending_profile';

function toIso(val: unknown): string {
  if (!val) return new Date().toISOString();
  if (val instanceof Timestamp) return val.toDate().toISOString();
  if (typeof val === 'object' && val !== null && 'toDate' in val && typeof (val as any).toDate === 'function') {
    return (val as any).toDate().toISOString();
  }
  return String(val);
}

export function mapFirebaseAuthError(err: any): string {
  const code = String(err?.code || '');
  switch (code) {
    case 'auth/operation-not-allowed':
      return 'تسجيل الدخول بالبريد وكلمة المرور غير مفعّل بعد في إعدادات Firebase Console (Authentication > Sign-in method > Email/Password). يمكنك استخدام تسجيل الدخول بحساب Google مباشرة الآن.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'البريد الإلكتروني أو كلمة المرور غير صحيحة';
    case 'auth/email-already-in-use':
      return 'هذا البريد الإلكتروني مسجل مسبقاً. يرجى تسجيل الدخول.';
    case 'auth/weak-password':
      return 'كلمة المرور ضعيفة جداً؛ يجب أن تتكون من 6 أحرف على الأقل';
    case 'auth/invalid-email':
      return 'صيغة البريد الإلكتروني غير صحيحة';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'تم إغلاق نافذة تسجيل الدخول بحساب Google قبل إتمام العملية';
    case 'auth/popup-blocked':
      return 'تم حظر النافذة المنبثقة من المتصفح. يرجى السماح بالنوافذ المنبثقة ثم المحاولة مجدداً';
    case 'auth/too-many-requests':
      return 'تم تنفيذ محاولات كثيرة متتالية. يرجى الانتظار قليلاً ثم المحاولة مرة أخرى';
    case 'auth/requires-recent-login':
      return 'يرجى إعادة تسجيل الدخول لتنفيذ هذا الإجراء الأمني';
    default:
      return err instanceof Error ? err.message : 'حدث خطأ أثناء المصادقة';
  }
}

interface AuthContextValue {
  user: User | null;
  stats: UserStats;
  loading: boolean;
  emailNotVerified: boolean;
  pendingEmail: string;
  loginWithGoogle: () => Promise<User>;
  loginWithEmail: (email: string, password: string) => Promise<User>;
  registerWithEmail: (payload: {
    name: string;
    email: string;
    password: string;
    phone: string;
    location: string;
  }) => Promise<{ needsVerification: boolean; user?: User }>;
  sendPasswordReset: (email: string) => Promise<void>;
  resendVerificationEmail: () => Promise<void>;
  reloadVerificationStatus: () => Promise<User | null>;
  updateAccountProfile: (payload: {
    name: string;
    phone: string;
    location: string;
    avatar_url: string;
    currentPassword?: string;
    newPassword?: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [stats, setStats] = useState<UserStats>({
    unreadMessages: 0,
    favoritesCount: 0,
    myAdsCount: 0,
  });
  const [loading, setLoading] = useState<boolean>(true);
  const [emailNotVerified, setEmailNotVerified] = useState<boolean>(false);
  const [pendingEmail, setPendingEmail] = useState<string>('');

  const loadStatsForUid = useCallback(async (uid: string) => {
    try {
      const [favIds, unreadMessages, myAds] = await Promise.all([
        fetchFavoriteIds(uid),
        fetchUnreadMessagesCount(uid),
        fetchAds({ mine: true }, uid),
      ]);
      setStats({
        favoritesCount: favIds.size,
        unreadMessages,
        myAdsCount: myAds.length,
      });
    } catch {
      // ignore non-fatal stats failure
    }
  }, []);

  const syncVerifiedUser = useCallback(
    async (fbUser: FirebaseUser): Promise<User> => {
      const emailLower = (fbUser.email || '').trim().toLowerCase();
      let designatedRole: UserRole | null = BOOTSTRAP_ADMIN_EMAILS.includes(emailLower)
        ? 'admin'
        : null;

      if (!designatedRole && emailLower) {
        try {
          const staffSnap = await getDoc(doc(db, 'designatedStaff', emailLower));
          if (staffSnap.exists()) {
            designatedRole =
              staffSnap.data().role === 'moderator' ? 'moderator' : 'admin';
          }
        } catch {
          // Non-staff user or email mismatch; ignore cleanly
        }
      }

      // Ensure role marker document exists before creating/updating /users/{uid}
      if (designatedRole === 'admin') {
        const adminRef = doc(db, 'admins', fbUser.uid);
        try {
          const adminSnap = await getDoc(adminRef);
          if (!adminSnap.exists()) {
            await setDoc(adminRef, {
              uid: fbUser.uid,
              email: emailLower,
              createdAt: serverTimestamp(),
            });
          }
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, `admins/${fbUser.uid}`);
        }
      } else if (designatedRole === 'moderator') {
        const modRef = doc(db, 'moderators', fbUser.uid);
        try {
          const modSnap = await getDoc(modRef);
          if (!modSnap.exists()) {
            await setDoc(modRef, {
              uid: fbUser.uid,
              email: emailLower,
              createdAt: serverTimestamp(),
            });
          }
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, `moderators/${fbUser.uid}`);
        }
      }

      // Check pending profile info saved during email/password registration
      let pendingProfile: PendingSignupProfile | null = null;
      try {
        const raw = sessionStorage.getItem(PENDING_PROFILE_KEY);
        if (raw) {
          pendingProfile = JSON.parse(raw) as PendingSignupProfile;
        }
      } catch {
        // ignore storage errors
      }

      const userRef = doc(db, 'users', fbUser.uid);
      const privRef = doc(db, 'users', fbUser.uid, 'private', 'info');

      let pubSnap;
      try {
        pubSnap = await getDoc(userRef);
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, `users/${fbUser.uid}`);
      }

      let finalRole: UserRole = designatedRole || 'user';
      let isVerifiedAccount = designatedRole !== null;
      let isBlocked = false;
      let name = '';
      let avatarUrl = '';
      let location = 'أبو جبيهة - السوق الكبير';
      let createdAtIso = new Date().toISOString();

      if (!pubSnap.exists()) {
        const rawName = (
          pendingProfile?.name ||
          fbUser.displayName ||
          emailLower.split('@')[0] ||
          'مستخدم السوق'
        ).trim();
        name = (rawName.length >= 2 ? rawName : 'مستخدم السوق').slice(0, 80);
        avatarUrl = (fbUser.photoURL || '').slice(0, 500);
        location = (pendingProfile?.location || 'أبو جبيهة - السوق الكبير').slice(0, 120);

        try {
          await setDoc(userRef, {
            uid: fbUser.uid,
            name,
            avatarUrl,
            location,
            role: finalRole,
            isBlocked: false,
            isVerifiedAccount,
            isSample: false,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, `users/${fbUser.uid}`);
        }
      } else {
        const data = pubSnap.data();
        name = String(data.name || fbUser.displayName || 'مستخدم السوق');
        avatarUrl = String(data.avatarUrl || fbUser.photoURL || '');
        location = String(data.location || 'أبو جبيهة - السوق الكبير');
        isBlocked = Boolean(data.isBlocked);
        isVerifiedAccount = Boolean(data.isVerifiedAccount);
        createdAtIso = toIso(data.createdAt);

        const existingRole = (data.role || 'user') as UserRole;
        finalRole = designatedRole || existingRole;

        if (designatedRole === 'admin' && existingRole !== 'admin') {
          try {
            await updateDoc(userRef, {
              role: 'admin',
              isVerifiedAccount: true,
              updatedAt: serverTimestamp(),
            });
            isVerifiedAccount = true;
          } catch (err) {
            handleFirestoreError(err, OperationType.UPDATE, `users/${fbUser.uid}`);
          }
        }
      }

      let phone = '';
      let email = emailLower;
      try {
        const privSnap = await getDoc(privRef);
        if (!privSnap.exists()) {
          phone = (pendingProfile?.phone || '').slice(0, 40);
          await setDoc(privRef, {
            uid: fbUser.uid,
            email: emailLower,
            phone,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } else {
          phone = String(privSnap.data().phone || '');
          email = String(privSnap.data().email || emailLower);
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `users/${fbUser.uid}/private/info`);
      }

      if (pendingProfile) {
        try {
          sessionStorage.removeItem(PENDING_PROFILE_KEY);
        } catch {
          // ignore
        }
      }

      if (isBlocked) {
        await signOut(auth);
        throw new Error('تم حظر هذا الحساب لمخالفة سياسات سوق أبو جبيهة');
      }

      const appUser: User = {
        id: fbUser.uid,
        name,
        email,
        phone,
        location,
        avatar_url: avatarUrl,
        role: finalRole,
        is_blocked: isBlocked,
        is_verified_account: isVerifiedAccount,
        created_at: createdAtIso,
      };

      // Bootstrap default categories & initial sample ads only on first-ever admin setup
      if (finalRole === 'admin') {
        try {
          const catSnap = await getDocs(collection(db, 'categories'));
          if (catSnap.empty) {
            await seedDefaultCategoriesIfEmpty();
            await seedSampleListingsInFirestore(appUser.id, appUser.name);
          }
        } catch {
          // ignore if seeding not needed
        }
      }

      setUser(appUser);
      await loadStatsForUid(fbUser.uid);
      return appUser;
    },
    [loadStatsForUid]
  );

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      if (!fbUser) {
        setUser(null);
        setEmailNotVerified(false);
        setPendingEmail('');
        setStats({ unreadMessages: 0, favoritesCount: 0, myAdsCount: 0 });
        setLoading(false);
        return;
      }

      if (!fbUser.emailVerified) {
        setUser(null);
        setEmailNotVerified(true);
        setPendingEmail(fbUser.email || '');
        setLoading(false);
        return;
      }

      setEmailNotVerified(false);
      setPendingEmail('');
      try {
        await syncVerifiedUser(fbUser);
      } catch {
        setUser(null);
      } finally {
        setLoading(false);
      }
    });

    return () => unsub();
  }, [syncVerifiedUser]);

  const refreshMe = useCallback(async () => {
    const current = auth.currentUser;
    if (!current || !current.emailVerified) return;
    await syncVerifiedUser(current);
  }, [syncVerifiedUser]);

  const loginWithGoogle = async (): Promise<User> => {
    try {
      const cred = await signInWithPopup(auth, googleAuthProvider);
      setEmailNotVerified(false);
      setPendingEmail('');
      return await syncVerifiedUser(cred.user);
    } catch (err) {
      throw new Error(mapFirebaseAuthError(err));
    }
  };

  const loginWithEmail = async (email: string, password: string): Promise<User> => {
    try {
      const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
      if (!cred.user.emailVerified) {
        setEmailNotVerified(true);
        setPendingEmail(cred.user.email || email.trim());
        throw new Error(
          'يرجى تأكيد بريدك الإلكتروني أولاً عبر الرابط المرسل إليك، ثم تحديث الصفحة أو الضغط على زر التحقق'
        );
      }
      setEmailNotVerified(false);
      setPendingEmail('');
      return await syncVerifiedUser(cred.user);
    } catch (err: any) {
      if (err instanceof Error && !('code' in err)) throw err;
      throw new Error(mapFirebaseAuthError(err));
    }
  };

  const registerWithEmail = async (payload: {
    name: string;
    email: string;
    password: string;
    phone: string;
    location: string;
  }): Promise<{ needsVerification: boolean; user?: User }> => {
    try {
      const cred = await createUserWithEmailAndPassword(
        auth,
        payload.email.trim(),
        payload.password
      );
      await updateFirebaseAuthProfile(cred.user, {
        displayName: payload.name.trim(),
      });
      try {
        sessionStorage.setItem(
          PENDING_PROFILE_KEY,
          JSON.stringify({
            name: payload.name.trim(),
            phone: payload.phone.trim(),
            location: payload.location.trim(),
          })
        );
      } catch {
        // ignore storage errors
      }

      if (!cred.user.emailVerified) {
        await sendEmailVerification(cred.user);
        setEmailNotVerified(true);
        setPendingEmail(cred.user.email || payload.email.trim());
        return { needsVerification: true };
      }

      const appUser = await syncVerifiedUser(cred.user);
      return { needsVerification: false, user: appUser };
    } catch (err) {
      throw new Error(mapFirebaseAuthError(err));
    }
  };

  const sendPasswordReset = async (email: string) => {
    try {
      await sendPasswordResetEmail(auth, email.trim());
    } catch (err) {
      throw new Error(mapFirebaseAuthError(err));
    }
  };

  const resendVerificationEmail = async () => {
    if (!auth.currentUser) throw new Error('لا توجد جلسة قيد التحقق حالياً');
    try {
      await sendEmailVerification(auth.currentUser);
    } catch (err) {
      throw new Error(mapFirebaseAuthError(err));
    }
  };

  const reloadVerificationStatus = async (): Promise<User | null> => {
    if (!auth.currentUser) return null;
    await auth.currentUser.reload();
    if (auth.currentUser.emailVerified) {
      setEmailNotVerified(false);
      setPendingEmail('');
      return await syncVerifiedUser(auth.currentUser);
    }
    return null;
  };

  const updateAccountProfile = async (payload: {
    name: string;
    phone: string;
    location: string;
    avatar_url: string;
    currentPassword?: string;
    newPassword?: string;
  }) => {
    const fbUser = auth.currentUser;
    if (!fbUser || !user) throw new Error('يجب تسجيل الدخول أولاً');

    const cleanName = payload.name.trim().slice(0, 80);
    if (cleanName.length < 2) throw new Error('الاسم يجب أن يكون حرفين على الأقل');

    const userPath = `users/${fbUser.uid}`;
    const privPath = `users/${fbUser.uid}/private/info`;

    try {
      await updateDoc(doc(db, 'users', fbUser.uid), {
        name: cleanName,
        avatarUrl: payload.avatar_url.trim().slice(0, 500),
        location: payload.location.trim().slice(0, 120),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, userPath);
    }

    try {
      await updateDoc(doc(db, 'users', fbUser.uid, 'private', 'info'), {
        phone: payload.phone.trim().slice(0, 40),
        email: user.email,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, privPath);
    }

    if (cleanName !== fbUser.displayName) {
      await updateFirebaseAuthProfile(fbUser, { displayName: cleanName }).catch(() => {});
    }

    if (payload.newPassword && payload.newPassword.trim()) {
      if (payload.newPassword.trim().length < 6) {
        throw new Error('كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل');
      }
      if (!payload.currentPassword) {
        throw new Error('يرجى إدخال كلمة المرور الحالية لتغيير كلمة المرور');
      }
      try {
        const cred = EmailAuthProvider.credential(user.email, payload.currentPassword);
        await reauthenticateWithCredential(fbUser, cred);
        await updatePassword(fbUser, payload.newPassword.trim());
      } catch (err) {
        throw new Error(mapFirebaseAuthError(err));
      }
    }

    await refreshMe();
  };

  const logout = async () => {
    await signOut(auth);
    setUser(null);
    setEmailNotVerified(false);
    setPendingEmail('');
    setStats({ unreadMessages: 0, favoritesCount: 0, myAdsCount: 0 });
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        stats,
        loading,
        emailNotVerified,
        pendingEmail,
        loginWithGoogle,
        loginWithEmail,
        registerWithEmail,
        sendPasswordReset,
        resendVerificationEmail,
        reloadVerificationStatus,
        updateAccountProfile,
        logout,
        refreshMe,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
