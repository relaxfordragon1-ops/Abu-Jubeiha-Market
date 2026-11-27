import { useMemo, useState } from 'react';
import { Bell, CheckCheck, MapPin, Tag, ArrowLeft, User as UserIcon } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { formatArabicDate, formatPriceSDG, getAdTypeLabel } from '../lib/api';
import type { AppRoute, Category, NewAdAlert } from '../types';

interface NewAdAlertsPageProps {
  categories: Category[];
  onNavigate: (route: AppRoute) => void;
}

export function NewAdAlertsPage({ categories, onNavigate }: NewAdAlertsPageProps) {
  const {
    user,
    newAdAlerts,
    newAlertsLastSeenAt,
    unreadNewAdAlertsCount,
    markNewAdAlertsSeen,
  } = useAuth();
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  const filteredAlerts = useMemo(() => {
    if (selectedCategory === 'all') return newAdAlerts;
    return newAdAlerts.filter((a) => a.category_slug === selectedCategory);
  }, [newAdAlerts, selectedCategory]);

  const isAlertUnread = (alert: NewAdAlert): boolean => {
    if (user?.id && alert.owner_id === user.id) return false;
    if (!newAlertsLastSeenAt) return true;
    return alert.created_at > newAlertsLastSeenAt;
  };

  const handleOpenAlert = (alert: NewAdAlert) => {
    markNewAdAlertsSeen();
    onNavigate({ page: 'ad-detail', adId: alert.ad_id });
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="font-display text-2xl font-extrabold text-stone-900">
              إشعارات الإعلانات الجديدة
            </h1>
            {unreadNewAdAlertsCount > 0 && (
              <span className="px-2 py-0.5 rounded-md bg-amber-500 text-stone-950 text-xs font-mono-num font-extrabold">
                {unreadNewAdAlertsCount} جديد
              </span>
            )}
          </div>
          <p className="text-sm text-stone-500 mt-1">
            تنبيهات فورية عند اعتماد ونشر كل إعلان جديد في سوق أبو جبيهة — اضغط على أي إشعار للانتقال للإعلان مباشرة
          </p>
        </div>

        {unreadNewAdAlertsCount > 0 && (
          <button
            type="button"
            onClick={markNewAdAlertsSeen}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white border border-stone-200 hover:border-teal-700 text-teal-800 text-xs font-bold rounded-lg transition-colors shrink-0 cursor-pointer"
          >
            <CheckCheck className="w-4 h-4" />
            <span>تحديد الكل كمقروء</span>
          </button>
        )}
      </div>

      {/* Category Filter */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        <button
          type="button"
          onClick={() => setSelectedCategory('all')}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors cursor-pointer ${
            selectedCategory === 'all'
              ? 'bg-teal-700 text-white'
              : 'bg-white border border-stone-200 text-stone-700 hover:bg-stone-50'
          }`}
        >
          الكل ({newAdAlerts.length})
        </button>
        {categories.map((cat) => {
          const count = newAdAlerts.filter((a) => a.category_slug === cat.slug).length;
          if (count === 0) return null;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => setSelectedCategory(cat.slug)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors cursor-pointer ${
                selectedCategory === cat.slug
                  ? 'bg-teal-700 text-white'
                  : 'bg-white border border-stone-200 text-stone-700 hover:bg-stone-50'
              }`}
            >
              {cat.name_ar} ({count})
            </button>
          );
        })}
      </div>

      {/* Alerts List */}
      {filteredAlerts.length === 0 ? (
        <div className="bg-white border border-stone-200 rounded-2xl p-12 text-center space-y-3">
          <Bell className="w-10 h-10 text-stone-300 mx-auto" />
          <p className="text-base font-bold text-stone-900">
            لا توجد إشعارات إعلانات جديدة في هذا القسم حالياً
          </p>
          <p className="text-sm text-stone-500">
            سيظهر هنا كل إعلان جديد فور اعتماده ونشره في السوق.
          </p>
          <button
            type="button"
            onClick={() => onNavigate({ page: 'search' })}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-teal-700 text-white text-sm font-semibold rounded-lg cursor-pointer"
          >
            تصفح الإعلانات
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredAlerts.map((alert) => {
            const unread = isAlertUnread(alert);
            return (
              <button
                key={alert.id}
                type="button"
                onClick={() => handleOpenAlert(alert)}
                className={`w-full text-right bg-white border rounded-2xl p-3.5 sm:p-4 flex items-center gap-3.5 sm:gap-4 hover:border-teal-700 transition-all cursor-pointer ${
                  unread ? 'border-teal-300 bg-teal-50/30' : 'border-stone-200'
                }`}
              >
                <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl bg-stone-100 border border-stone-200 overflow-hidden shrink-0 flex items-center justify-center">
                  {alert.image_url ? (
                    <img
                      src={alert.image_url}
                      alt={alert.title}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <Tag className="w-6 h-6 text-stone-400" />
                  )}
                </div>

                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex items-center flex-wrap gap-2">
                    {unread && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500 text-stone-950 text-[10px] font-extrabold">
                        جديد
                      </span>
                    )}
                    <span className="px-2 py-0.5 rounded bg-stone-100 text-stone-700 text-[11px] font-semibold">
                      {alert.category_name}
                    </span>
                    <span className="text-[11px] text-stone-400">
                      {getAdTypeLabel(alert.ad_type)}
                    </span>
                  </div>

                  <h2 className="font-bold text-sm sm:text-base text-stone-900 truncate">
                    {alert.title}
                  </h2>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-stone-500">
                    <span className="font-bold text-teal-800 font-mono-num">
                      {formatPriceSDG(alert.price, alert.ad_type)}
                    </span>
                    {alert.location && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5 text-stone-400" />
                        <span>{alert.location}</span>
                      </span>
                    )}
                    {alert.owner_name && (
                      <span className="inline-flex items-center gap-1">
                        <UserIcon className="w-3.5 h-3.5 text-stone-400" />
                        <span>{alert.owner_name}</span>
                      </span>
                    )}
                    {alert.created_at && (
                      <span className="text-stone-400">{formatArabicDate(alert.created_at)}</span>
                    )}
                  </div>
                </div>

                <div className="hidden sm:flex items-center gap-1 text-xs font-bold text-teal-700 shrink-0">
                  <span>عرض الإعلان</span>
                  <ArrowLeft className="w-4 h-4" />
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
