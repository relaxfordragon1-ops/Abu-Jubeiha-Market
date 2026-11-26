import { useEffect, useState, useCallback } from 'react';
import { Heart } from 'lucide-react';
import { fetchFavoriteAds, toggleFavorite } from '../lib/firestoreApi';
import { useAuth } from '../context/AuthContext';
import { AdCard } from '../components/AdCard';
import type { Ad, AppRoute } from '../types';

interface FavoritesPageProps {
  onNavigate: (route: AppRoute) => void;
  onFavoriteChanged: () => void;
}

export function FavoritesPage({ onNavigate, onFavoriteChanged }: FavoritesPageProps) {
  const { user, loading: authLoading, refreshMe } = useAuth();
  const [ads, setAds] = useState<Ad[]>([]);
  const [loading, setLoading] = useState(true);

  const loadFavorites = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const favAds = await fetchFavoriteAds(user.id);
      setAds(favAds);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    loadFavorites();
  }, [loadFavorites]);

  if (authLoading && !user) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 text-center space-y-3">
        <div className="w-8 h-8 border-2 border-teal-700 border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-sm font-medium text-stone-600">جاري استعادة جلسة الدخول...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="max-w-md mx-auto px-4 py-12 text-center space-y-4">
        <Heart className="w-10 h-10 text-stone-300 mx-auto" />
        <p className="font-bold text-stone-900">سجل الدخول لعرض الإعلانات المحفوظة في المفضلة</p>
        <button
          type="button"
          onClick={() => onNavigate({ page: 'auth', mode: 'login' })}
          className="px-6 py-2.5 bg-teal-700 text-white text-sm font-semibold rounded-lg cursor-pointer"
        >
          تسجيل الدخول
        </button>
      </div>
    );
  }

  const handleToggle = async (adId: string) => {
    try {
      await toggleFavorite(user.id, adId);
      setAds((prev) => prev.filter((a) => a.id !== adId));
      await refreshMe();
      onFavoriteChanged();
    } catch {
      // ignore
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div>
        <h1 className="font-display text-2xl font-extrabold text-stone-900">المفضلة</h1>
        <p className="text-sm text-stone-500 mt-1">
          الإعلانات التي قمت بحفظها للرجوع إليها لاحقاً
        </p>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-72 bg-white border border-stone-200 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : ads.length === 0 ? (
        <div className="bg-white border border-stone-200 rounded-2xl p-12 text-center space-y-3">
          <Heart className="w-10 h-10 text-stone-300 mx-auto" />
          <p className="text-base font-bold text-stone-900">قائمة المفضلة فارغة</p>
          <p className="text-sm text-stone-500">
            اضغط على أيقونة القلب في أي إعلان لحفظه هنا والوصول إليه بسهولة
          </p>
          <button
            type="button"
            onClick={() => onNavigate({ page: 'search' })}
            className="px-5 py-2.5 bg-teal-700 text-white text-sm font-semibold rounded-lg cursor-pointer"
          >
            تصفح الإعلانات
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {ads.map((ad) => (
            <AdCard
              key={ad.id}
              ad={ad}
              onOpen={(id) => onNavigate({ page: 'ad-detail', adId: id })}
              onToggleFavorite={handleToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}
