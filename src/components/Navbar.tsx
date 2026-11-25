import {
  Home,
  Heart,
  PlusCircle,
  MessageSquare,
  User as UserIcon,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type { AppRoute } from '../types';

interface NavbarProps {
  route: AppRoute;
  onNavigate: (route: AppRoute) => void;
}

export function Navbar({ route, onNavigate }: NavbarProps) {
  const { user, stats } = useAuth();
  const isStaff = user?.role === 'admin' || user?.role === 'moderator';

  const navLinkClass = (active: boolean) =>
    `text-sm font-medium whitespace-nowrap shrink-0 transition-colors py-1 border-b-2 ${
      active
        ? 'text-teal-800 border-teal-700'
        : 'text-stone-600 border-transparent hover:text-stone-900 hover:border-stone-300'
    }`;

  return (
    <>
      {/* Desktop & Tablet Top Header — Strict 3-Zone Contract */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-stone-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Brand Wordmark */}
          <button
            type="button"
            onClick={() => onNavigate({ page: 'home' })}
            className="font-display text-lg sm:text-xl font-extrabold tracking-tight text-stone-900 hover:text-teal-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            سوق أبو جبيهة
          </button>

          {/* Zone 2: Single-line Text Navigation Links */}
          <nav className="hidden md:flex items-center gap-6">
            <button
              type="button"
              onClick={() => onNavigate({ page: 'home' })}
              className={`${navLinkClass(route.page === 'home')} cursor-pointer`}
            >
              الرئيسية
            </button>
            <button
              type="button"
              onClick={() => onNavigate({ page: 'search' })}
              className={`${navLinkClass(route.page === 'search')} cursor-pointer`}
            >
              تصفح الإعلانات
            </button>
            <button
              type="button"
              onClick={() =>
                onNavigate(user ? { page: 'favorites' } : { page: 'auth', mode: 'login' })
              }
              className={`${navLinkClass(route.page === 'favorites')} cursor-pointer`}
            >
              المفضلة
              {user && stats.favoritesCount > 0 ? (
                <span className="mr-1.5 text-xs font-mono-num text-teal-700">
                  ({stats.favoritesCount})
                </span>
              ) : null}
            </button>
            <button
              type="button"
              onClick={() =>
                onNavigate(user ? { page: 'messages' } : { page: 'auth', mode: 'login' })
              }
              className={`${navLinkClass(route.page === 'messages')} cursor-pointer`}
            >
              الرسائل
              {user && stats.unreadMessages > 0 ? (
                <span className="mr-1.5 text-xs font-mono-num font-bold text-amber-700">
                  ({stats.unreadMessages})
                </span>
              ) : null}
            </button>
            {isStaff ? (
              <button
                type="button"
                onClick={() => onNavigate({ page: 'admin', tab: 'overview' })}
                className={`${navLinkClass(route.page === 'admin')} flex items-center gap-1.5 cursor-pointer`}
              >
                <ShieldCheck className="w-4 h-4 text-teal-700" />
                <span>لوحة الإدارة</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() =>
                  onNavigate(user ? { page: 'account', tab: 'profile' } : { page: 'auth', mode: 'login' })
                }
                className={`${navLinkClass(route.page === 'account' || route.page === 'auth')} cursor-pointer`}
              >
                {user ? 'حسابي' : 'تسجيل الدخول'}
              </button>
            )}
          </nav>

          {/* Zone 3: Single Primary Action + Compact Account Access */}
          <div className="flex items-center gap-3 shrink-0">
            {isStaff && (
              <button
                type="button"
                onClick={() => onNavigate({ page: 'account', tab: 'profile' })}
                className="hidden lg:inline-flex items-center gap-1.5 text-sm font-medium text-stone-700 hover:text-stone-900 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <UserIcon className="w-4 h-4" />
                <span className="max-w-[110px] truncate">{user?.name}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() =>
                onNavigate(user ? { page: 'ad-new' } : { page: 'auth', mode: 'login' })
              }
              className="px-4 py-2 text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-2 cursor-pointer"
            >
              <PlusCircle className="w-4 h-4" />
              <span>أضف إعلاناً</span>
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Fixed Bottom Navigation Menu (Exact 5 requested destinations, <= 64px height) */}
      <nav
        aria-label="التنقل السفلي"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 h-16 bg-white/95 backdrop-blur-md border-t border-stone-200 grid grid-cols-5 items-center"
      >
        <button
          type="button"
          onClick={() => onNavigate({ page: 'home' })}
          className={`flex flex-col items-center justify-center min-h-[44px] text-[11px] font-medium transition-colors cursor-pointer ${
            route.page === 'home' ? 'text-teal-700 font-semibold' : 'text-stone-500'
          }`}
        >
          <Home className="w-5 h-5 mb-0.5" />
          <span>الرئيسية</span>
        </button>

        <button
          type="button"
          onClick={() =>
            onNavigate(user ? { page: 'favorites' } : { page: 'auth', mode: 'login' })
          }
          className={`flex flex-col items-center justify-center min-h-[44px] text-[11px] font-medium transition-colors cursor-pointer ${
            route.page === 'favorites' ? 'text-teal-700 font-semibold' : 'text-stone-500'
          }`}
        >
          <Heart className="w-5 h-5 mb-0.5" />
          <span>المفضلة</span>
        </button>

        <button
          type="button"
          onClick={() =>
            onNavigate(user ? { page: 'ad-new' } : { page: 'auth', mode: 'login' })
          }
          className={`flex flex-col items-center justify-center min-h-[44px] text-[11px] font-semibold transition-colors cursor-pointer ${
            route.page === 'ad-new' ? 'text-teal-800' : 'text-teal-700'
          }`}
        >
          <PlusCircle className="w-6 h-6 mb-0.5" />
          <span>أضف إعلان</span>
        </button>

        <button
          type="button"
          onClick={() =>
            onNavigate(user ? { page: 'messages' } : { page: 'auth', mode: 'login' })
          }
          className={`relative flex flex-col items-center justify-center min-h-[44px] text-[11px] font-medium transition-colors cursor-pointer ${
            route.page === 'messages' ? 'text-teal-700 font-semibold' : 'text-stone-500'
          }`}
        >
          <MessageSquare className="w-5 h-5 mb-0.5" />
          <span>الرسائل</span>
          {user && stats.unreadMessages > 0 && (
            <span className="absolute top-1.5 right-3 text-[10px] font-mono-num font-bold text-amber-700">
              {stats.unreadMessages}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() =>
            onNavigate(
              user
                ? isStaff && route.page !== 'account'
                  ? { page: 'account', tab: 'profile' }
                  : { page: 'account', tab: 'profile' }
                : { page: 'auth', mode: 'login' }
            )
          }
          className={`flex flex-col items-center justify-center min-h-[44px] text-[11px] font-medium transition-colors cursor-pointer ${
            route.page === 'account' || route.page === 'auth' || route.page === 'admin'
              ? 'text-teal-700 font-semibold'
              : 'text-stone-500'
          }`}
        >
          <UserIcon className="w-5 h-5 mb-0.5" />
          <span>حسابي</span>
        </button>
      </nav>
    </>
  );
}
