import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Bot, CheckCircle2, MessageCircleQuestion, Send, Sparkles, X } from 'lucide-react';
import type { AppRoute } from '../types';

interface HelpMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  escalated?: boolean;
  escalationFailed?: boolean;
}

interface SanadHelpWidgetProps {
  route: AppRoute;
  onNavigate: (route: AppRoute) => void;
}

const QUICK_PROMPTS = [
  'كيف أنشر إعلان مجاني؟',
  'كيف أشترك في البنر المدفوع؟',
  'ابحث لي عن عقار أو أرض في أبوجبيهة',
  'أريد التواصل مع إدارة السوق',
];

function extractAdIdFromUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl, window.location.origin);
    const hashMatch = parsed.hash.match(/^#\/ad\/([^/?#]+)/);
    if (hashMatch?.[1]) return decodeURIComponent(hashMatch[1]);
    const pathMatch = parsed.pathname.match(/^\/ad\/([^/?#]+)/);
    if (pathMatch?.[1]) return decodeURIComponent(pathMatch[1]);
  } catch {
    const directMatch = rawUrl.match(/\/ad\/([^/?#\s]+)/);
    if (directMatch?.[1]) return decodeURIComponent(directMatch[1]);
  }
  return null;
}

function renderMessageText(
  text: string,
  onNavigate: (route: AppRoute) => void,
  onCloseDrawer: () => void
) {
  const urlRegex = /(https?:\/\/[^\s<>"')]+|\/ad\/[a-zA-Z0-9_-]+)/g;
  const parts = text.split(urlRegex);
  return parts.map((part, idx) => {
    if (!part) return null;
    if (/^(https?:\/\/|\/ad\/)/.test(part)) {
      const adId = extractAdIdFromUrl(part);
      if (adId) {
        return (
          <button
            key={idx}
            type="button"
            onClick={() => {
              onNavigate({ page: 'ad-detail', adId });
              onCloseDrawer();
            }}
            className="inline-flex items-center gap-1 underline font-semibold text-teal-800 hover:text-teal-950 mx-0.5 cursor-pointer"
          >
            عرض الإعلان
          </button>
        );
      }
      return (
        <a
          key={idx}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="underline font-medium text-teal-800 hover:text-teal-950 break-all"
        >
          {part}
        </a>
      );
    }
    return <span key={idx}>{part}</span>;
  });
}

export function SanadHelpWidget({ route, onNavigate }: SanadHelpWidgetProps) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<HelpMessage[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [open, messages, sending]);

  // Hide on full-screen messaging thread to keep mobile chat input uncluttered
  if (route.page === 'messages') {
    return null;
  }

  const sendQuestion = async (rawQuestion: string) => {
    const question = rawQuestion.trim();
    if (question.length < 2 || sending) return;

    setErrorMsg('');
    const userMsg: HelpMessage = {
      id: `u_${Date.now()}`,
      role: 'user',
      content: question,
    };
    const nextHistory = messages.slice(-6).map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setSending(true);

    try {
      const resp = await fetch('/api/public/help', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          history: nextHistory,
          context: {
            page: route.page,
            adId: route.page === 'ad-detail' ? route.adId : undefined,
          },
        }),
      });
      const data = (await resp.json().catch(() => null)) as {
        reply?: string;
        answer?: string;
        escalated?: boolean;
        escalationFailed?: boolean;
        detail?: string;
        error?: string;
      } | null;

      if (!resp.ok) {
        setErrorMsg(
          data?.detail || data?.error || 'تعذر الحصول على رد حالياً، يرجى المحاولة بعد قليل.'
        );
        return;
      }

      const answer = String(data?.reply ?? data?.answer ?? '').trim();
      setMessages((prev) => [
        ...prev,
        {
          id: `a_${Date.now()}`,
          role: 'assistant',
          content: answer || 'أهلاً بك! كيف أقدر أساعدك في سوق أبو جبيهة؟',
          escalated: Boolean(data?.escalated),
          escalationFailed: Boolean(data?.escalationFailed),
        },
      ]);
    } catch {
      setErrorMsg('تعذر الاتصال بالمساعد الذكي حالياً، تأكد من اتصالك بالإنترنت.');
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void sendQuestion(input);
  };

  return (
    <div className="fixed bottom-20 left-4 md:bottom-6 md:left-6 z-40" dir="rtl">
      {open && (
        <div className="mb-3 w-[calc(100vw-2rem)] sm:w-[370px] max-h-[70vh] flex flex-col rounded-2xl bg-white border border-stone-200 shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-teal-800 text-white">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-white/15 flex items-center justify-center">
                <Bot className="w-4 h-4 text-white" />
              </div>
              <div>
                <h3 className="font-display text-sm font-bold leading-tight">مساعد سوق أبو جبيهة</h3>
                <p className="text-[11px] text-teal-100">مدعوم بذكاء سند للرد الفوري</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="إغلاق نافذة المساعدة"
              className="p-1.5 rounded-lg hover:bg-white/15 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto p-3.5 space-y-3 bg-[#FAF9F6] min-h-[240px] max-h-[420px]"
          >
            {messages.length === 0 ? (
              <div className="space-y-3">
                <div className="rounded-xl bg-white border border-stone-200 p-3 text-xs text-stone-700 leading-relaxed">
                  أهلاً بك في <span className="font-bold text-teal-800">سوق أبو جبيهة</span>! اسألني عن
                  طريقة نشر الإعلان، أو البنر المدفوع، أو ابحث عن أي سلعة أو خدمة متوفرة حالياً.
                </div>
                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold text-stone-500 flex items-center gap-1">
                    <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                    أسئلة شائعة:
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {QUICK_PROMPTS.map((q) => (
                      <button
                        key={q}
                        type="button"
                        onClick={() => void sendQuestion(q)}
                        className="text-right text-xs px-2.5 py-1.5 rounded-lg bg-white border border-stone-200 text-stone-700 hover:border-teal-600 hover:text-teal-800 transition-colors cursor-pointer"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex flex-col ${msg.role === 'user' ? 'items-start' : 'items-end'}`}
                >
                  <div
                    className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-xs sm:text-[13px] leading-relaxed whitespace-pre-wrap ${
                      msg.role === 'user'
                        ? 'bg-teal-800 text-white rounded-br-sm'
                        : 'bg-white border border-stone-200 text-stone-800 rounded-bl-sm shadow-2xs'
                    }`}
                  >
                    {msg.role === 'assistant'
                      ? renderMessageText(msg.content, onNavigate, () => setOpen(false))
                      : msg.content}
                  </div>
                  {msg.escalated && (
                    <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700">
                      <CheckCircle2 className="w-3 h-3" />
                      تم تحويل استفسارك إلى إدارة السوق للمتابعة
                    </span>
                  )}
                  {msg.escalationFailed && (
                    <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-amber-700">
                      تعذر تحويل استفسارك للإدارة حالياً، يرجى التواصل مع الإدارة مباشرة.
                    </span>
                  )}
                </div>
              ))
            )}

            {sending && (
              <div className="flex items-end justify-end">
                <div className="rounded-2xl rounded-bl-sm bg-white border border-stone-200 px-3.5 py-2 text-xs text-stone-500">
                  جاري البحث وكتابة الرد...
                </div>
              </div>
            )}

            {errorMsg && (
              <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
                {errorMsg}
              </div>
            )}
          </div>

          <form
            onSubmit={handleSubmit}
            className="flex items-center gap-2 p-2.5 bg-white border-t border-stone-200"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="اكتب استفسارك هنا..."
              maxLength={800}
              disabled={sending}
              className="flex-1 text-xs sm:text-sm px-3 py-2 rounded-xl bg-stone-50 border border-stone-200 text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-teal-700"
            />
            <button
              type="submit"
              disabled={sending || input.trim().length < 2}
              aria-label="إرسال السؤال"
              className="p-2.5 rounded-xl bg-teal-800 text-white hover:bg-teal-900 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="مساعدة السوق الذكية"
        className="flex items-center gap-2 px-4 py-3 rounded-full bg-teal-800 hover:bg-teal-900 text-white shadow-lg border border-teal-700 transition-all cursor-pointer"
      >
        <MessageCircleQuestion className="w-5 h-5" />
        <span className="text-xs sm:text-sm font-bold">اسأل مساعد السوق</span>
      </button>
    </div>
  );
}
