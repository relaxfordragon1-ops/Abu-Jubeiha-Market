import { useEffect, useState, useCallback, useRef, type FormEvent } from 'react';
import { Send, MessageSquare, ShieldCheck, ExternalLink, User as UserIcon } from 'lucide-react';
import { formatArabicDate } from '../lib/api';
import {
  fetchMessageThread,
  sendMessage,
  subscribeToUserMessages,
} from '../lib/firestoreApi';
import { useAuth } from '../context/AuthContext';
import type { AppRoute, ChatMessage, Conversation } from '../types';

interface MessagesPageProps {
  initialWithUserId?: string;
  initialAdId?: string | null;
  onNavigate: (route: AppRoute) => void;
}

export function MessagesPage({
  initialWithUserId,
  initialAdId = null,
  onNavigate,
}: MessagesPageProps) {
  const { user, loading: authLoading, refreshMe } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(
    initialWithUserId ?? null
  );
  const [selectedAdId, setSelectedAdId] = useState<string | null>(initialAdId ?? null);

  const [threadUser, setThreadUser] = useState<{
    id: string;
    name: string;
    avatar_url: string;
    is_verified_account: boolean;
  } | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initialWithUserId) {
      setSelectedUserId(initialWithUserId);
      setSelectedAdId(initialAdId ?? null);
    }
  }, [initialWithUserId, initialAdId]);

  const loadThread = useCallback(async () => {
    if (!user || !selectedUserId) return;
    try {
      const data = await fetchMessageThread(user.id, selectedUserId, selectedAdId);
      setThreadUser(data.otherUser);
      setMessages(data.messages);
      await refreshMe();
    } catch (err: any) {
      setError(err.message);
    }
  }, [user, selectedUserId, selectedAdId, refreshMe]);

  useEffect(() => {
    loadThread();
  }, [loadThread]);

  // Real-time Firestore listener for conversations & active thread
  useEffect(() => {
    if (!user?.id) return;
    const unsub = subscribeToUserMessages(user.id, ({ conversations: convs }) => {
      setConversations(convs);
      if (!selectedUserId && !initialWithUserId && convs.length > 0) {
        setSelectedUserId(convs[0].other_user_id);
        setSelectedAdId(convs[0].ad_id);
      }
      if (selectedUserId) {
        void loadThread();
      }
    });
    return () => unsub();
  }, [user?.id, selectedUserId, initialWithUserId, loadThread]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

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
        <MessageSquare className="w-10 h-10 text-stone-300 mx-auto" />
        <p className="font-bold text-stone-900">سجل الدخول لعرض رسائلك والتواصل مع البائعين</p>
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

  const handleSend = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedUserId || !draft.trim()) return;
    setError('');
    setSending(true);
    try {
      const sent = await sendMessage(user, selectedUserId, selectedAdId, draft.trim());
      setMessages((prev) => [...prev, sent]);
      setDraft('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <div className="mb-5">
        <h1 className="font-display text-2xl font-extrabold text-stone-900">الرسائل الداخلية</h1>
        <p className="text-sm text-stone-500 mt-1">
          تواصل مباشرة مع البائعين والمشترين داخل سوق أبو جبيهة
        </p>
      </div>

      <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden grid grid-cols-1 md:grid-cols-12 min-h-[520px]">
        {/* Conversations List */}
        <aside className="md:col-span-4 border-b md:border-b-0 md:border-l border-stone-200 flex flex-col max-h-[300px] md:max-h-[600px] overflow-y-auto">
          <div className="p-4 border-b border-stone-100 font-bold text-sm text-stone-900">
            المحادثات ({conversations.length})
          </div>
          {conversations.length === 0 && !selectedUserId ? (
            <div className="p-8 text-center text-sm text-stone-500">
              لا توجد محادثات بعد. افتح أي إعلان واضغط "مراسلة داخل التطبيق".
            </div>
          ) : (
            <div className="divide-y divide-stone-100">
              {conversations.map((conv) => {
                const isActive =
                  selectedUserId === conv.other_user_id &&
                  (selectedAdId ?? null) === (conv.ad_id ?? null);
                return (
                  <button
                    key={`${conv.other_user_id}-${conv.ad_id ?? 'g'}`}
                    type="button"
                    onClick={() => {
                      setSelectedUserId(conv.other_user_id);
                      setSelectedAdId(conv.ad_id);
                    }}
                    className={`w-full p-4 text-right flex items-start gap-3 transition-colors cursor-pointer ${
                      isActive ? 'bg-teal-50/70' : 'hover:bg-stone-50'
                    }`}
                  >
                    <div className="w-10 h-10 rounded-full bg-stone-100 border border-stone-200 overflow-hidden flex items-center justify-center shrink-0">
                      {conv.other_user_avatar ? (
                        <img
                          src={conv.other_user_avatar}
                          alt={conv.other_user_name}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <UserIcon className="w-4 h-4 text-stone-400" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-sm text-stone-900 truncate">
                          {conv.other_user_name}
                        </span>
                        {conv.unread_count > 0 && (
                          <span className="text-xs font-mono-num font-bold text-teal-800">
                            {conv.unread_count} جديد
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-teal-800 truncate mt-0.5">{conv.ad_title}</p>
                      <p className="text-xs text-stone-500 truncate mt-1">{conv.last_message}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </aside>

        {/* Active Chat Thread */}
        <section className="md:col-span-8 flex flex-col justify-between max-h-[600px]">
          {selectedUserId ? (
            <>
              <div className="p-4 border-b border-stone-100 flex items-center justify-between gap-3 bg-stone-50/60">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="font-bold text-stone-900 truncate">
                    {threadUser?.name || 'محادثة'}
                  </span>
                  {threadUser?.is_verified_account && (
                    <ShieldCheck className="w-4 h-4 text-teal-700 shrink-0" />
                  )}
                </div>
                {selectedAdId && (
                  <button
                    type="button"
                    onClick={() => onNavigate({ page: 'ad-detail', adId: selectedAdId })}
                    className="text-xs font-semibold text-teal-800 hover:underline flex items-center gap-1 shrink-0 cursor-pointer"
                  >
                    <span>عرض الإعلان</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-[#FAF9F6]">
                {messages.length === 0 ? (
                  <p className="text-center text-sm text-stone-500 py-10">
                    ابدأ المحادثة بكتابة رسالتك أدناه
                  </p>
                ) : (
                  messages.map((m) => {
                    const isMine = m.sender_id === user.id;
                    return (
                      <div
                        key={m.id}
                        className={`flex flex-col ${isMine ? 'items-start' : 'items-end'}`}
                      >
                        <div
                          className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                            isMine
                              ? 'bg-teal-700 text-white'
                              : 'bg-white border border-stone-200 text-stone-900'
                          }`}
                        >
                          {m.body}
                        </div>
                        <span className="text-[11px] text-stone-400 mt-1 px-1">
                          {formatArabicDate(m.created_at)}
                        </span>
                      </div>
                    );
                  })
                )}
                <div ref={endRef} />
              </div>

              <div className="p-3.5 border-t border-stone-200 bg-white">
                {error && <p className="text-xs text-rose-700 mb-2">{error}</p>}
                <form onSubmit={handleSend} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="اكتب رسالتك هنا..."
                    className="flex-1 min-w-0 px-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:outline-none focus:border-teal-700"
                  />
                  <button
                    type="submit"
                    disabled={sending || !draft.trim()}
                    className="shrink-0 px-4 py-2.5 bg-teal-700 hover:bg-teal-800 text-white text-sm font-bold rounded-xl flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                  >
                    <Send className="w-4 h-4" />
                    <span>إرسال</span>
                  </button>
                </form>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-10 text-center text-stone-500">
              <MessageSquare className="w-10 h-10 text-stone-300 mb-3" />
              <p className="font-semibold text-stone-700">اختر محادثة من القائمة لعرض الرسائل</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
