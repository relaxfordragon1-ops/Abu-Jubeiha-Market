import { useState } from 'react';
import { Download, Smartphone, Share, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export function PWAInstallButton() {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        title="تثبيت سوق أبو جبيهة كتطبيق على جهازك"
        className="px-3 py-1.5 rounded-lg border border-teal-700/30 bg-teal-50 hover:bg-teal-100 text-teal-800 text-xs font-bold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
      >
        <Download className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">تثبيت التطبيق</span>
        <span className="sm:hidden">تثبيت</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          title="تثبيت التطبيق على الآيفون"
          className="px-2.5 py-1.5 rounded-lg border border-stone-200 bg-stone-50 hover:bg-stone-100 text-stone-700 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
        >
          <Smartphone className="w-3.5 h-3.5 text-teal-700" />
          <span className="hidden sm:inline">تثبيت التطبيق</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/60 p-4">
            <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl border border-stone-200 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-lg font-extrabold text-stone-900">
                  تثبيت سوق أبو جبيهة على iPhone / iPad
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="text-stone-400 hover:text-stone-800 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <ol className="text-sm text-stone-700 space-y-2.5 leading-relaxed list-decimal list-inside">
                <li>
                  اضغط على زر <strong>المشاركة (Share)</strong> <Share className="inline w-4 h-4 text-teal-700" /> في شريط متصفح Safari.
                </li>
                <li>
                  مرّر للأسفل واختر <strong>إضافة إلى الشاشة الرئيسية (Add to Home Screen)</strong>.
                </li>
                <li>
                  اضغط <strong>إضافة</strong> ليظهر تطبيق سوق أبو جبيهة على شاشتك.
                </li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="w-full rounded-xl bg-teal-700 hover:bg-teal-800 text-white py-2.5 text-sm font-bold cursor-pointer"
              >
                فهمت
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
}
