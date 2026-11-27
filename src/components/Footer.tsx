import type { AppRoute } from '../types';
import { useAuth } from '../context/AuthContext';

export function Footer({ onNavigate }: { onNavigate: (route: AppRoute) => void }) {
  const { user } = useAuth();
  const isStaff = user?.role === 'admin' || user?.role === 'moderator';

  return (
    <footer className="bg-white border-t border-stone-200 mt-16 pb-20 md:pb-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 pb-8 border-b border-stone-100">
          <div>
            <h2 className="font-display text-lg font-extrabold text-stone-900 mb-2">
              سوق أبو جبيهة
            </h2>
            <p className="text-sm text-stone-600 leading-relaxed max-w-sm">
              منصة محلية متكاملة لأهالي أبو جبيهة والمناطق المجاورة في جنوب كردفان، تجمع البيع
              والشراء والعقارات والأراضي والخدمات والفرص المجتمعية في مكان واحد آمن وسهل الاستخدام.
            </p>
          </div>

          <div>
            <h3 className="text-sm font-bold text-stone-900 mb-3">روابط سريعة</h3>
            <ul className="space-y-2 text-sm text-stone-600">
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate({ page: 'home' })}
                  className="hover:text-teal-800 cursor-pointer"
                >
                  الصفحة الرئيسية
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate({ page: 'search' })}
                  className="hover:text-teal-800 cursor-pointer"
                >
                  البحث والتصفية المتقدمة
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() =>
                    onNavigate(user ? { page: 'ad-new' } : { page: 'auth', mode: 'login' })
                  }
                  className="hover:text-teal-800 cursor-pointer"
                >
                  نشر إعلان جديد
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate({ page: 'new-ads-alerts' })}
                  className="hover:text-teal-800 cursor-pointer"
                >
                  إشعارات الإعلانات الجديدة
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate({ page: 'search', category: 'wanted' })}
                  className="hover:text-teal-800 cursor-pointer"
                >
                  قسم المطلوبات
                </button>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-bold text-stone-900 mb-3">الثقة والأمان والإدارة</h3>
            <ul className="space-y-2 text-sm text-stone-600">
              <li>تخضع جميع الإعلانات الجديدة للمراجعة قبل النشر العام.</li>
              <li>توثيق الحساب يؤكد هوية المعلن، ولا يُغني عن فحص مستندات العقار والأراضي رسمياً.</li>
              {isStaff && (
                <li>
                  <button
                    type="button"
                    onClick={() => onNavigate({ page: 'admin', tab: 'overview' })}
                    className="text-teal-700 font-semibold hover:underline cursor-pointer"
                  >
                    الدخول إلى لوحة الإدارة والإشراف
                  </button>
                </li>
              )}
            </ul>
          </div>
        </div>

        <div className="pt-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-stone-500">
          <p>© {new Date().getFullYear()} سوق أبو جبيهة الإلكتروني — جميع الحقوق محفوظة.</p>
          <p>أبو جبيهة، ولاية جنوب كردفان، السودان</p>
        </div>
      </div>
    </footer>
  );
}
