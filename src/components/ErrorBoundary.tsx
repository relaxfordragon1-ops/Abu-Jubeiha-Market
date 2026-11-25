import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error.message || 'حدث خطأ غير متوقع في التطبيق',
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Uncaught UI Error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          dir="rtl"
          className="min-h-screen bg-[#FAF9F6] flex items-center justify-center p-6 text-center"
        >
          <div className="bg-white border border-stone-200 rounded-2xl p-8 max-w-md w-full space-y-4">
            <h1 className="font-display text-xl font-extrabold text-stone-900">
              عذراً، حدث خطأ تقني مؤقت
            </h1>
            <p className="text-sm text-stone-600 leading-relaxed">
              يرجى تحديث الصفحة للمتابعة. إذا استمرت المشكلة تواصل مع إدارة سوق أبو جبيهة.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-6 py-2.5 bg-teal-700 hover:bg-teal-800 text-white text-sm font-bold rounded-xl cursor-pointer"
            >
              إعادة تحميل الصفحة
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
