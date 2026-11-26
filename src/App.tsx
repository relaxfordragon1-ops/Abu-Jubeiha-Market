import { useState, useEffect, useCallback } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import {
  fetchActiveHeroPromotions,
  fetchAds,
  fetchCategories,
  toggleFavorite,
} from './lib/firestoreApi';
import { Navbar } from './components/Navbar';
import { Footer } from './components/Footer';
import { OfflineIndicator } from './components/OfflineIndicator';
import { SanadHelpWidget } from './components/SanadHelpWidget';
import { getRouteTitle, routeToUrl, urlToRoute } from './lib/routing';
import { HomePage } from './pages/HomePage';
import { SearchPage } from './pages/SearchPage';
import { AdDetailPage } from './pages/AdDetailPage';
import { AdFormPage } from './pages/AdFormPage';
import { AuthPage } from './pages/AuthPage';
import { AccountPage } from './pages/AccountPage';
import { FavoritesPage } from './pages/FavoritesPage';
import { MessagesPage } from './pages/MessagesPage';
import { AdminDashboardPage } from './pages/AdminDashboardPage';
import type { Ad, AppRoute, Category, HeroPromotion } from './types';

function MarketplaceApp() {
  const { user, refreshMe, authSyncError, emailNotVerified, pendingEmail } = useAuth();
  const [route, setRoute] = useState<AppRoute>(() => urlToRoute());
  const [categories, setCategories] = useState<Category[]>([]);
  const [ads, setAds] = useState<Ad[]>([]);
  const [heroPromotions, setHeroPromotions] = useState<HeroPromotion[]>([]);
  const [loading, setLoading] = useState(true);

  const loadMarketplaceData = useCallback(async () => {
    try {
      const [cats, adList, promos] = await Promise.all([
        fetchCategories(false),
        fetchAds({}, user?.id),
        fetchActiveHeroPromotions(),
      ]);
      setCategories(cats);
      setAds(adList);
      setHeroPromotions(promos);
    } catch {
      // ignore initial load error
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    loadMarketplaceData();
  }, [loadMarketplaceData]);

  useEffect(() => {
    document.title = getRouteTitle(route);
  }, [route]);

  useEffect(() => {
    const handlePopState = () => {
      setRoute(urlToRoute());
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigate = useCallback((nextRoute: AppRoute) => {
    const nextUrl = routeToUrl(nextRoute);
    const currentUrl = `${window.location.pathname}${window.location.search}`;
    if (nextUrl !== currentUrl) {
      window.history.pushState(null, '', nextUrl);
    }
    setRoute(nextRoute);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleToggleFavorite = async (adId: string) => {
    if (!user) {
      navigate({ page: 'auth', mode: 'login' });
      return;
    }
    try {
      const favorited = await toggleFavorite(user.id, adId);
      setAds((prev) =>
        prev.map((a) => (a.id === adId ? { ...a, is_favorited: favorited } : a))
      );
      await refreshMe();
    } catch {
      // ignore
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#FAF9F6] text-stone-900">
      {authSyncError && (
        <div className="bg-red-50 border-b border-red-200 px-4 py-2 text-xs text-red-800 text-center" dir="rtl">
          تعذر استعادة جلسة الدخول: {authSyncError}
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mr-2 underline font-bold"
          >
            إعادة المحاولة
          </button>
        </div>
      )}
      {emailNotVerified && route.page !== 'auth' && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-xs text-amber-950 text-center" dir="rtl">
          حسابك ({pendingEmail}) بانتظار تأكيد البريد الإلكتروني لإكمال تسجيل الدخول.
          <button
            type="button"
            onClick={() => navigate({ page: 'auth', mode: 'login' })}
            className="mr-2 underline font-bold cursor-pointer"
          >
            إكمال التحقق
          </button>
        </div>
      )}
      <Navbar route={route} onNavigate={navigate} />

      <main className="flex-1">
        {route.page === 'home' && (
          <HomePage
            categories={categories}
            ads={ads}
            heroPromotions={heroPromotions}
            loading={loading}
            onNavigate={navigate}
            onToggleFavorite={handleToggleFavorite}
          />
        )}

        {route.page === 'search' && (
          <SearchPage
            categories={categories}
            initialCategory={route.category}
            initialSubcategory={route.subcategory}
            initialQuery={route.q}
            initialAdType={route.adType}
            initialUserId={route.userId}
            initialSellerName={route.sellerName}
            onNavigate={navigate}
            onToggleFavorite={handleToggleFavorite}
          />
        )}

        {route.page === 'ad-detail' && (
          <AdDetailPage
            adId={route.adId}
            onNavigate={navigate}
            onFavoriteChanged={loadMarketplaceData}
          />
        )}

        {route.page === 'ad-new' && (
          <AdFormPage
            categories={categories}
            onNavigate={navigate}
            onSaved={loadMarketplaceData}
          />
        )}

        {route.page === 'ad-edit' && (
          <AdFormPage
            categories={categories}
            editAdId={route.adId}
            onNavigate={navigate}
            onSaved={loadMarketplaceData}
          />
        )}

        {route.page === 'auth' && (
          <AuthPage initialMode={route.mode} onNavigate={navigate} />
        )}

        {route.page === 'account' && (
          <AccountPage
            initialTab={route.tab}
            onNavigate={navigate}
            onAdsChanged={loadMarketplaceData}
          />
        )}

        {route.page === 'favorites' && (
          <FavoritesPage
            onNavigate={navigate}
            onFavoriteChanged={loadMarketplaceData}
          />
        )}

        {route.page === 'messages' && (
          <MessagesPage
            initialWithUserId={route.withUserId}
            initialAdId={route.adId}
            onNavigate={navigate}
          />
        )}

        {route.page === 'admin' && (
          <AdminDashboardPage
            initialTab={route.tab}
            onNavigate={navigate}
            onDataMutated={loadMarketplaceData}
          />
        )}
      </main>

      <Footer onNavigate={navigate} />
      <SanadHelpWidget route={route} onNavigate={navigate} />
      <OfflineIndicator />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <MarketplaceApp />
      </AuthProvider>
    </ErrorBoundary>
  );
}
