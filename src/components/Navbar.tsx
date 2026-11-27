import { useState, useRef, useEffect } from 'react';
import {
  Home,
  Heart,
  PlusCircle,
  MessageSquare,
  User as UserIcon,
  ShieldCheck,
  Bell,
  CheckCheck,
  Tag,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { formatArabicDate, formatPriceSDG } from '../lib/api';
import { PWAInstallButton } from './PWAInstallButton';
import type { AppNotification, AppRoute, NewAdAlert } from '../types';

interface NavbarProps {
  route: AppRoute;
  onNavigate: (route: AppRoute) => void;
}

export function Navbar({ route, onNavigate }: NavbarProps) {
  const {
    user,
    loading: authLoading,
    stats,
    notifications,
    newAdAlerts,
    newAlertsLastSeenAt,
    unreadNewAdAlertsCount,
    markNotificationAsRead,
    markAllNotificationsAsRead,
    markNewAdAlertsSeen,
  } = useAuth();
  const isStaff = user?.role === 'admin' || user?.role === 'moderator';
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifTab, setNotifTab] = useState<'new-ads' | 'personal'>('new-ads');
  const notifRef = useRef<HTMLDivElement>(null);
  const totalUnreadBell = unreadNewAdAlertsCount + (user ? stats.unreadNotifications : 0);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const handleNewAdAlertClick = (alert: NewAdAlert) => {
    markNewAdAlertsSeen();
    setNotifOpen(false);
    onNavigate({ page: 'ad-detail', adId: alert.ad_id });
  };

  const handleNotificationClick = async (n: AppNotification) => {
    if (!n.is_read) {
      await markNotificationAsRead(n.id);
    }
    setNotifOpen(false);
    if (n.link_page === 'messages') {
      onNavigate({
        page: 'messages',
        withUserId: n.link_user_id || undefined,
        adId: n.link_ad_id || null,
      });
    } else if (n.link_page === 'ad-detail' && n.link_ad_id) {
      onNavigate({ page: 'ad-detail', adId: n.link_ad_id });
    } else if (n.link_page === 'account') {
      onNavigate({ page: 'account', tab: 'my-ads' });
    } else {
      onNavigate({ page: 'home' });
    }
  };

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
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4 sm:gap-8">
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
                {user ? 'حسابي' : authLoading ? '...' : 'تسجيل الدخول'}
              </button>
            )}
          </nav>

          {/* Zone 3: Install Prompt + Notifications + Primary Action */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <PWAInstallButton />

            <div className="relative" ref={notifRef}>
              <button
                type="button"
                onClick={() => {
                  setNotifOpen((prev) => {
                    const next = !prev;
                    if (next) {
                      if (unreadNewAdAlertsCount > 0 || !user) {
                        setNotifTab('new-ads');
                      } else if (stats.unreadNotifications > 0) {
                        setNotifTab('personal');
                      }
                    }
                    return next;
                  });
                }}
                aria-label="الإشعارات"
                className="relative p-2 rounded-lg text-stone-600 hover:text-stone-900 hover:bg-stone-100 transition-colors cursor-pointer"
              >
                <Bell className="w-5 h-5" />
                {totalUnreadBell > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-md bg-amber-500 text-stone-950 text-[10px] font-mono-num font-extrabold flex items-center justify-center">
                    {totalUnreadBell > 9 ? '9+' : totalUnreadBell}
                  </span>
                )}
              </button>

              {notifOpen && (
                <div className="fixed inset-x-3 top-[72px] sm:absolute sm:inset-x-auto sm:top-auto sm:left-0 mt-2 sm:w-96 max-w-none sm:max-w-[92vw] bg-white border border-stone-200 rounded-2xl shadow-xl overflow-hidden z-50">
                  <div className="px-3 pt-2.5 pb-2 border-b border-stone-100 bg-stone-50 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-sm text-stone-900">
                        الإشعارات ({totalUnreadBell})
                      </span>
                      {notifTab === 'new-ads' ? (
                        unreadNewAdAlertsCount > 0 && (
                          <button
                            type="button"
                            onClick={markNewAdAlertsSeen}
                            className="text-xs font-semibold text-teal-700 hover:underline flex items-center gap-1 cursor-pointer"
                          >
                            <CheckCheck className="w-3.5 h-3.5" />
                            <span>تحديد الكل كمقروء</span>
                          </button>
                        )
                      ) : (
                        user &&
                        stats.unreadNotifications > 0 && (
                          <button
                            type="button"
                            onClick={() => void markAllNotificationsAsRead()}
                            className="text-xs font-semibold text-teal-700 hover:underline flex items-center gap-1 cursor-pointer"
                          >
                            <CheckCheck className="w-3.5 h-3.5" />
                            <span>تحديد الكل كمقروء</span>
                          </button>
                        )
                      )}
                    </div>

                    {user && (
                      <div className="grid grid-cols-2 gap-1.5 bg-stone-200/70 p-1 rounded-xl">
                        <button
                          type="button"
                          onClick={() => setNotifTab('new-ads')}
                          className={`py-1.5 px-2 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                            notifTab === 'new-ads'
                              ? 'bg-white text-teal-800 shadow-xs'
                              : 'text-stone-600 hover:text-stone-900'
                          }`}
                        >
                          إعلانات جديدة ({unreadNewAdAlertsCount})
                        </button>
                        <button
                          type="button"
                          onClick={() => setNotifTab('personal')}
                          className={`py-1.5 px-2 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                            notifTab === 'personal'
                              ? 'bg-white text-teal-800 shadow-xs'
                              : 'text-stone-600 hover:text-stone-900'
                          }`}
                        >
                          إشعاراتي ({stats.unreadNotifications})
                        </button>
                      </div>
                    )}
                  </div>

                  {notifTab === 'new-ads' || !user ? (
                    <div className="max-h-80 overflow-y-auto divide-y divide-stone-100">
                      {newAdAlerts.length === 0 ? (
                        <div className="p-6 text-center text-xs text-stone-500">
                          لا توجد إعلانات جديدة حالياً
                        </div>
                      ) : (
                        newAdAlerts.slice(0, 12).map((alert) => {
                          const isUnread =
                            !(user?.id && alert.owner_id === user.id) &&
                            (!newAlertsLastSeenAt || alert.created_at > newAlertsLastSeenAt);
                          return (
                            <button
                              key={alert.id}
                              type="button"
                              onClick={() => handleNewAdAlertClick(alert)}
                              className={`w-full p-3 text-right hover:bg-stone-50 transition-colors cursor-pointer flex items-center gap-3 ${
                                isUnread ? 'bg-teal-50/50' : ''
                              }`}
                            >
                              <div className="w-11 h-11 rounded-lg bg-stone-100 border border-stone-200 overflow-hidden shrink-0 flex items-center justify-center">
                                {alert.image_url ? (
                                  <img
                                    src={alert.image_url}
                                    alt={alert.title}
                                    className="w-full h-full object-cover"
                                  />
                                ) : (
                                  <Tag className="w-4 h-4 text-stone-400" />
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-xs font-bold text-stone-900 truncate">
                                    {alert.title}
                                  </span>
                                  {isUnread && (
                                    <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                                  )}
                                </div>
                                <p className="text-[11px] text-teal-800 font-semibold mt-0.5 truncate">
                                  {alert.category_name} · {formatPriceSDG(alert.price, alert.ad_type)}
                                </p>
                                <p className="text-[11px] text-stone-400 mt-0.5 truncate">
                                  {alert.location || 'أبو جبيهة'} · {formatArabicDate(alert.created_at)}
                                </p>
                              </div>
                            </button>
                          );
                        })
                      )}
                    </div>
                  ) : (
                    <div className="max-h-80 overflow-y-auto divide-y divide-stone-100">
                      {notifications.length === 0 ? (
                        <div className="p-6 text-center text-xs text-stone-500">
                          لا توجد إشعارات شخصية حالياً
                        </div>
                      ) : (
                        notifications.map((n) => (
                          <button
                            key={n.id}
                            type="button"
                            onClick={() => void handleNotificationClick(n)}
                            className={`w-full p-3.5 text-right hover:bg-stone-50 transition-colors cursor-pointer block ${
                              !n.is_read ? 'bg-teal-50/50' : ''
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-bold text-stone-900">{n.title}</span>
                              {!n.is_read && (
                                <span className="w-2 h-2 rounded-full bg-teal-700 shrink-0" />
                              )}
                            </div>
                            <p className="text-xs text-stone-600 mt-1 line-clamp-2 leading-relaxed">
                              {n.body}
                            </p>
                            <p className="text-[11px] text-stone-400 mt-1">
                              {formatArabicDate(n.created_at)}
                            </p>
                          </button>
                        ))
                      )}
                    </div>
                  )}

                  <div className="p-2.5 border-t border-stone-100 bg-stone-50">
                    <button
                      type="button"
                      onClick={() => {
                        setNotifOpen(false);
                        onNavigate({ page: 'new-ads-alerts' });
                      }}
                      className="w-full py-2 px-3 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold transition-colors cursor-pointer"
                    >
                      فتح قسم إشعارات الإعلانات الجديدة
                    </button>
                  </div>
                </div>
              )}
            </div>

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
              className="px-3.5 sm:px-4 py-2 text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-2 cursor-pointer"
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
