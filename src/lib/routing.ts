import type { AppRoute } from '../types';

export function routeToUrl(route: AppRoute): string {
  switch (route.page) {
    case 'home':
      return '/';
    case 'search': {
      const params = new URLSearchParams();
      if (route.q) params.set('q', route.q);
      if (route.category) params.set('category', route.category);
      if (route.subcategory) params.set('subcategory', route.subcategory);
      if (route.adType) params.set('adType', route.adType);
      if (route.userId) params.set('userId', route.userId);
      if (route.sellerName) params.set('sellerName', route.sellerName);
      const qs = params.toString();
      return qs ? `/search?${qs}` : '/search';
    }
    case 'ad-detail':
      return `/ad/${encodeURIComponent(route.adId)}`;
    case 'ad-new':
      return '/ads/new';
    case 'ad-edit':
      return `/ad/${encodeURIComponent(route.adId)}/edit`;
    case 'favorites':
      return '/favorites';
    case 'messages': {
      const params = new URLSearchParams();
      if (route.withUserId) params.set('with', route.withUserId);
      if (route.adId) params.set('adId', route.adId);
      const qs = params.toString();
      return qs ? `/messages?${qs}` : '/messages';
    }
    case 'account': {
      const params = new URLSearchParams();
      if (route.tab && route.tab !== 'profile') params.set('tab', route.tab);
      const qs = params.toString();
      return qs ? `/account?${qs}` : '/account';
    }
    case 'auth': {
      const params = new URLSearchParams();
      if (route.mode && route.mode !== 'login') params.set('mode', route.mode);
      const qs = params.toString();
      return qs ? `/auth?${qs}` : '/auth';
    }
    case 'admin': {
      const params = new URLSearchParams();
      if (route.tab && route.tab !== 'overview') params.set('tab', route.tab);
      const qs = params.toString();
      return qs ? `/admin?${qs}` : '/admin';
    }
    default:
      return '/';
  }
}

export function urlToRoute(href?: string): AppRoute {
  try {
    const raw = href ?? `${window.location.pathname}${window.location.search}`;
    const url = new URL(raw, 'https://abujubeiha.local');
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const sp = url.searchParams;

    // Support direct ?ad=... deep link on root too
    const directAdParam = sp.get('ad');
    if (path === '/' && directAdParam) {
      return { page: 'ad-detail', adId: directAdParam };
    }

    if (path === '/' || path === '') {
      return { page: 'home' };
    }

    if (path === '/search') {
      return {
        page: 'search',
        q: sp.get('q') || undefined,
        category: sp.get('category') || undefined,
        subcategory: sp.get('subcategory') || undefined,
        adType: sp.get('adType') || undefined,
        userId: sp.get('userId') || undefined,
        sellerName: sp.get('sellerName') || undefined,
      };
    }

    if (path === '/ads/new') {
      return { page: 'ad-new' };
    }

    const editMatch = path.match(/^\/ad\/([^/]+)\/edit$/);
    if (editMatch?.[1]) {
      return { page: 'ad-edit', adId: decodeURIComponent(editMatch[1]) };
    }

    const detailMatch = path.match(/^\/ad\/([^/]+)$/);
    if (detailMatch?.[1]) {
      return { page: 'ad-detail', adId: decodeURIComponent(detailMatch[1]) };
    }

    if (path === '/favorites') {
      return { page: 'favorites' };
    }

    if (path === '/messages') {
      return {
        page: 'messages',
        withUserId: sp.get('with') || undefined,
        adId: sp.get('adId') || null,
      };
    }

    if (path === '/account') {
      const tab = sp.get('tab') === 'my-ads' ? 'my-ads' : 'profile';
      return { page: 'account', tab };
    }

    if (path === '/auth') {
      const m = sp.get('mode');
      const mode = m === 'register' || m === 'forgot' ? m : 'login';
      return { page: 'auth', mode };
    }

    if (path === '/admin') {
      const t = sp.get('tab');
      const tab =
        t === 'ads' || t === 'hero-ads' || t === 'users' || t === 'reports' || t === 'categories'
          ? t
          : 'overview';
      return { page: 'admin', tab };
    }

    return { page: 'home' };
  } catch {
    return { page: 'home' };
  }
}

export function getRouteTitle(route: AppRoute): string {
  const base = 'سوق أبو جبيهة';
  switch (route.page) {
    case 'home':
      return `${base} | السوق الإلكتروني المحلي`;
    case 'search':
      return route.q ? `بحث: ${route.q} | ${base}` : `تصفح الإعلانات | ${base}`;
    case 'ad-detail':
      return `تفاصيل الإعلان | ${base}`;
    case 'ad-new':
      return `نشر إعلان جديد | ${base}`;
    case 'ad-edit':
      return `تعديل الإعلان | ${base}`;
    case 'favorites':
      return `المفضلة | ${base}`;
    case 'messages':
      return `الرسائل | ${base}`;
    case 'account':
      return `حسابي | ${base}`;
    case 'auth':
      return `تسجيل الدخول | ${base}`;
    case 'admin':
      return `لوحة الإدارة | ${base}`;
    default:
      return base;
  }
}
