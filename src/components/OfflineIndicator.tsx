import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export function OfflineIndicator() {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      className="fixed bottom-20 md:bottom-4 left-4 z-50 flex items-center gap-2 rounded-xl bg-amber-600 px-3.5 py-2 text-xs font-bold text-white shadow-lg"
    >
      <WifiOff className="w-4 h-4 shrink-0" />
      <span>أنت غير متصل بالإنترنت — يتم عرض البيانات المحفوظة مؤقتاً</span>
    </div>
  );
}
