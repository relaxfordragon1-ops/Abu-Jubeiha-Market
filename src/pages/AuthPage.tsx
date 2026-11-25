import { useState, useEffect, type FormEvent } from 'react';
import { KeyRound, UserPlus, LogIn, MailCheck, RefreshCw, LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { ABU_JUBEIHA_AREAS } from '../lib/api';
import type { AppRoute } from '../types';

interface AuthPageProps {
  initialMode?: 'login' | 'register' | 'forgot';
  onNavigate: (route: AppRoute) => void;
}

export function AuthPage({ initialMode = 'login', onNavigate }: AuthPageProps) {
  const {
    loginWithGoogle,
    loginWithEmail,
    registerWithEmail,
    sendPasswordReset,
    emailNotVerified,
    pendingEmail,
    resendVerificationEmail,
    reloadVerificationStatus,
    logout,
  } = useAuth();

  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>(initialMode);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [location, setLocation] = useState(ABU_JUBEIHA_AREAS[0]);

  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const clearFeedback = () => {
    setError('');
    setSuccessMsg('');
  };

  const routeAfterAuth = (role: string) => {
    if (role === 'admin' || role === 'moderator') {
      onNavigate({ page: 'admin', tab: 'overview' });
    } else {
      onNavigate({ page: 'home' });
    }
  };

  const handleGoogleSignIn = async () => {
    clearFeedback();
    setGoogleSubmitting(true);
    try {
      const u = await loginWithGoogle();
      routeAfterAuth(u.role);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setGoogleSubmitting(false);
    }
  };

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    clearFeedback();
    setSubmitting(true);
    try {
      const u = await loginWithEmail(email, password);
      routeAfterAuth(u.role);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegister = async (e: FormEvent) => {
    e.preventDefault();
    clearFeedback();
    setSubmitting(true);
    try {
      const res = await registerWithEmail({ name, email, password, phone, location });
      if (res.needsVerification) {
        setSuccessMsg(
          'تم إنشاء الحساب وإرسال رابط تأكيد البريد الإلكتروني. يرجى فتح بريدك وتأكيد الرابط ثم المتابعة.'
        );
      } else if (res.user) {
        routeAfterAuth(res.user.role);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSendReset = async (e: FormEvent) => {
    e.preventDefault();
    clearFeedback();
    setSubmitting(true);
    try {
      await sendPasswordReset(email);
      setSuccessMsg(
        'تم إرسال رابط إعادة تعيين كلمة المرور إلى بريدك الإلكتروني (يرجى مراجعة البريد الوارد أو الرسائل غير المرغوب فيها).'
      );
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCheckVerified = async () => {
    clearFeedback();
    setSubmitting(true);
    try {
      const verifiedUser = await reloadVerificationStatus();
      if (verifiedUser) {
        routeAfterAuth(verifiedUser.role);
      } else {
        setError('لم يتم تأكيد البريد الإلكتروني بعد. يرجى الضغط على الرابط المرسل لبريدك.');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleResendVerification = async () => {
    clearFeedback();
    setSubmitting(true);
    try {
      await resendVerificationEmail();
      setSuccessMsg('تمت إعادة إرسال رسالة تأكيد البريد الإلكتروني بنجاح.');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto px-4 sm:px-6 py-10">
      <div className="bg-white border border-stone-200 rounded-2xl p-6 sm:p-8 space-y-6">
        <div className="text-center space-y-1.5">
          <h1 className="font-display text-2xl font-extrabold text-stone-900">
            {mode === 'login' && 'تسجيل الدخول إلى سوق أبو جبيهة'}
            {mode === 'register' && 'إنشاء حساب جديد'}
            {mode === 'forgot' && 'استعادة كلمة المرور'}
          </h1>
          <p className="text-sm text-stone-500">
            {mode === 'login' && 'سجّل الدخول بحساب Google بنقرة واحدة أو بالبريد الإلكتروني'}
            {mode === 'register' && 'أنشئ حسابك مجاناً لنشر الإعلانات والتواصل مع البائعين'}
            {mode === 'forgot' && 'أدخل بريدك الإلكتروني لإرسال رابط استعادة كلمة المرور'}
          </p>
        </div>

        {/* Email Verification Pending Banner */}
        {emailNotVerified && (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl space-y-3">
            <div className="flex items-start gap-2.5 text-amber-950">
              <MailCheck className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
              <div className="text-xs leading-relaxed">
                <p className="font-bold">بانتظار تأكيد البريد الإلكتروني</p>
                <p className="mt-0.5">
                  أرسلنا رسالة تفعيل إلى{' '}
                  <span className="font-mono-num font-bold" dir="ltr">
                    {pendingEmail}
                  </span>
                  . بعد الضغط على رابط التفعيل، اضغط «تحققت من بريدي».
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={submitting}
                onClick={handleCheckVerified}
                className="px-3.5 py-2 bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>تحققت من بريدي — متابعة</span>
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleResendVerification}
                className="px-3.5 py-2 bg-white border border-amber-300 text-amber-900 text-xs font-semibold rounded-lg cursor-pointer"
              >
                إعادة إرسال الرابط
              </button>
              <button
                type="button"
                onClick={() => logout()}
                className="px-3 py-2 text-stone-600 hover:text-stone-900 text-xs font-semibold inline-flex items-center gap-1 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>تبديل الحساب</span>
              </button>
            </div>
          </div>
        )}

        {/* Primary Google Sign-In CTA */}
        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={googleSubmitting || submitting}
          className="w-full py-3 px-4 bg-stone-900 hover:bg-stone-800 text-white text-sm font-bold rounded-xl flex items-center justify-center gap-2.5 transition-colors disabled:opacity-60 cursor-pointer"
        >
          <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="#EA4335"
              d="M12 10.2v3.9h5.5c-.2 1.3-1.5 3.9-5.5 3.9-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.1.8 3.9 1.5l2.7-2.6C16.9 3.3 14.7 2.4 12 2.4 6.7 2.4 2.4 6.7 2.4 12s4.3 9.6 9.6 9.6c5.5 0 9.2-3.9 9.2-9.4 0-.6-.1-1.1-.2-1.6H12z"
            />
            <path
              fill="#34A853"
              d="M3.5 7.4l3.2 2.4C7.6 7.9 9.6 6.4 12 6.4c1.9 0 3.1.8 3.9 1.5l2.7-2.6C16.9 3.3 14.7 2.4 12 2.4 8.2 2.4 5 4.5 3.5 7.4z"
            />
            <path
              fill="#FBBC05"
              d="M12 21.6c2.6 0 4.8-.9 6.4-2.4l-3-2.5c-.8.6-1.9 1-3.4 1-2.6 0-4.8-1.7-5.6-4.1l-3.2 2.5c1.6 3.3 4.9 5.5 8.8 5.5z"
            />
            <path
              fill="#4285F4"
              d="M21.2 12.2c0-.6-.1-1.1-.2-1.6H12v3.9h5.5c-.3 1.4-1.1 2.5-2.1 3.2l3 2.5c1.8-1.6 2.8-4.1 2.8-8z"
            />
          </svg>
          <span>
            {googleSubmitting ? 'جاري الاتصال بحساب Google...' : 'المتابعة باستخدام حساب Google'}
          </span>
        </button>

        <div className="relative flex items-center justify-center">
          <div className="border-t border-stone-200 w-full" />
          <span className="bg-white px-3 text-xs text-stone-400 shrink-0">
            أو بالبريد الإلكتروني
          </span>
          <div className="border-t border-stone-200 w-full" />
        </div>

        {/* Mode Switcher */}
        <div className="grid grid-cols-3 gap-1 p-1 bg-stone-100 rounded-xl text-xs font-semibold">
          <button
            type="button"
            onClick={() => {
              clearFeedback();
              setMode('login');
            }}
            className={`py-2 rounded-lg transition-colors cursor-pointer ${
              mode === 'login' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600'
            }`}
          >
            تسجيل الدخول
          </button>
          <button
            type="button"
            onClick={() => {
              clearFeedback();
              setMode('register');
            }}
            className={`py-2 rounded-lg transition-colors cursor-pointer ${
              mode === 'register' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600'
            }`}
          >
            حساب جديد
          </button>
          <button
            type="button"
            onClick={() => {
              clearFeedback();
              setMode('forgot');
            }}
            className={`py-2 rounded-lg transition-colors cursor-pointer ${
              mode === 'forgot' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600'
            }`}
          >
            نسيت كلمة المرور
          </button>
        </div>

        {error && (
          <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-800 leading-relaxed">
            {error}
          </div>
        )}
        {successMsg && (
          <div className="p-3.5 bg-teal-50 border border-teal-200 rounded-xl text-sm text-teal-900 leading-relaxed">
            {successMsg}
          </div>
        )}

        {/* LOGIN FORM */}
        {mode === 'login' && (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1.5">
                البريد الإلكتروني
              </label>
              <input
                type="email"
                required
                dir="ltr"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="w-full px-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm text-left focus:outline-none focus:border-teal-700"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1.5">
                كلمة المرور
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:outline-none focus:border-teal-700"
              />
            </div>

            <button
              type="submit"
              disabled={submitting || googleSubmitting}
              className="w-full py-3 bg-teal-700 hover:bg-teal-800 text-white text-sm font-bold rounded-xl flex items-center justify-center gap-2 transition-colors disabled:opacity-60 cursor-pointer"
            >
              <LogIn className="w-4 h-4" />
              <span>{submitting ? 'جاري الدخول...' : 'دخول بالبريد الإلكتروني'}</span>
            </button>
          </form>
        )}

        {/* REGISTER FORM */}
        {mode === 'register' && (
          <form onSubmit={handleRegister} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1.5">
                الاسم الكامل
              </label>
              <input
                type="text"
                required
                minLength={2}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="مثال: محمد عثمان إبراهيم"
                className="w-full px-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:outline-none focus:border-teal-700"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1.5">
                البريد الإلكتروني
              </label>
              <input
                type="email"
                required
                dir="ltr"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="w-full px-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm text-left focus:outline-none focus:border-teal-700"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1.5">
                  رقم الهاتف / واتساب
                </label>
                <input
                  type="tel"
                  dir="ltr"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+2499..."
                  className="w-full px-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm text-left focus:outline-none focus:border-teal-700"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1.5">
                  المنطقة / الحي
                </label>
                <select
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className="w-full px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:outline-none focus:border-teal-700"
                >
                  {ABU_JUBEIHA_AREAS.map((area) => (
                    <option key={area} value={area}>
                      {area}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1.5">
                كلمة المرور (6 أحرف على الأقل)
              </label>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:outline-none focus:border-teal-700"
              />
            </div>

            <button
              type="submit"
              disabled={submitting || googleSubmitting}
              className="w-full py-3 bg-teal-700 hover:bg-teal-800 text-white text-sm font-bold rounded-xl flex items-center justify-center gap-2 transition-colors disabled:opacity-60 cursor-pointer"
            >
              <UserPlus className="w-4 h-4" />
              <span>{submitting ? 'جاري إنشاء الحساب...' : 'إنشاء الحساب'}</span>
            </button>
          </form>
        )}

        {/* FORGOT / RESET PASSWORD FORM */}
        {mode === 'forgot' && (
          <form onSubmit={handleSendReset} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1.5">
                البريد الإلكتروني المسجل
              </label>
              <input
                type="email"
                required
                dir="ltr"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="w-full px-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm text-left focus:outline-none focus:border-teal-700"
              />
            </div>
            <button
              type="submit"
              disabled={submitting || googleSubmitting}
              className="w-full py-3 bg-stone-900 hover:bg-stone-800 text-white text-sm font-bold rounded-xl flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
            >
              <KeyRound className="w-4 h-4" />
              <span>{submitting ? 'جاري الإرسال...' : 'إرسال رابط استعادة كلمة المرور'}</span>
            </button>
          </form>
        )}

        <p className="text-[11px] text-center text-stone-500 leading-relaxed pt-2 border-t border-stone-100">
          تُمنح صلاحيات الإدارة والمشرفين تلقائياً فور تسجيل الدخول بالبريد الإلكتروني المعتمد.
        </p>
      </div>
    </div>
  );
}
