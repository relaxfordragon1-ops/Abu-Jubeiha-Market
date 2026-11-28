import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  Bot,
  CheckCircle2,
  ImagePlus,
  Loader2,
  LogIn,
  MessageCircleQuestion,
  Send,
  Sparkles,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { uploadImages } from '../lib/api';
import { auth } from '../lib/firebase';
import type { AppRoute } from '../types';

interface HelpMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  images?: string[];
  escalated?: boolean;
  escalationFailed?: boolean;
  needsAuth?: boolean;
  submittedAd?: { id: string; title: string };
}

interface SanadHelpWidgetProps {
  route: AppRoute;
  onNavigate: (route: AppRoute) => void;
}

const QUICK_PROMPTS = [
  'عايز أرفع إعلان',
  'ابحث لي عن عقار أو أرض في أبوجبيهة',
  'كيف أشترك في البنر المدفوع؟',
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
  const { user, emailNotVerified } = useAuth();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [attachedImages, setAttachedImages] = useState<string[]>([]);
  const [pendingChatImages, setPendingChatImages] = useState<string[]>([]);
  const [messages, setMessages] = useState<HelpMessage[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [open, messages, sending, attachedImages]);

  // Clear attached images if user signs out
  useEffect(() => {
    if (!user) {
      setAttachedImages([]);
      setPendingChatImages([]);
    }
  }, [user]);

  // Hide on full-screen messaging thread to keep mobile chat input uncluttered
  if (route.page === 'messages') {
    return null;
  }

  const handleAttachButtonClick = () => {
    setErrorMsg('');
    if (!user) {
      setMessages((prev) => [
        ...prev,
        {
          id: `a_${Date.now()}`,
          role: 'assistant',
          content: 'لإرفاق صورة ورفع إعلان عبر المساعد، يرجى تسجيل الدخول إلى حسابك في السوق أولاً.',
          needsAuth: true,
        },
      ]);
      return;
    }
    if (emailNotVerified) {
      setMessages((prev) => [
        ...prev,
        {
          id: `a_${Date.now()}`,
          role: 'assistant',
          content: 'يرجى تأكيد بريدك الإلكتروني أولاً قبل إرفاق الصور أو رفع الإعلانات.',
          needsAuth: true,
        },
      ]);
      return;
    }
    fileInputRef.current?.click();
  };

  const handleImageFilesChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const inputEl = e.currentTarget;
    // Copy FileList before clearing input.value because clearing mutates the live FileList in Chromium/mobile browsers
    const selectedFiles = inputEl.files ? Array.from(inputEl.files) : [];
    inputEl.value = '';
    if (selectedFiles.length === 0) return;
    if (!user || emailNotVerified) return;

    const remainingSlots = Math.max(0, 4 - attachedImages.length);
    if (remainingSlots === 0) {
      setErrorMsg('يمكنك إرفاق 4 صور كحد أقصى عبر المساعد.');
      return;
    }

    setErrorMsg('');
    setUploadingImages(true);
    try {
      const selected = selectedFiles.slice(0, remainingSlots);
      const urls = await uploadImages(selected);
      if (urls.length > 0) {
        setAttachedImages((prev) => [...prev, ...urls].slice(0, 4));
        setPendingChatImages((prev) => [...prev, ...urls].slice(0, 4));
      } else {
        setErrorMsg('تعذر رفع الصورة، يرجى المحاولة بصورة أخرى.');
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر رفع الصورة حالياً، حاول مرة أخرى.');
    } finally {
      setUploadingImages(false);
    }
  };

  const removeAttachedImage = (idx: number) => {
    const targetUrl = attachedImages[idx];
    setAttachedImages((prev) => prev.filter((_, i) => i !== idx));
    if (targetUrl) {
      setPendingChatImages((prev) => prev.filter((u) => u !== targetUrl));
    }
  };

  const sendQuestion = async (rawQuestion: string) => {
    const trimmed = rawQuestion.trim();
    const imagesForThisMessage = [...pendingChatImages];
    const question =
      trimmed ||
      (imagesForThisMessage.length > 0
        ? imagesForThisMessage.length === 1
          ? 'أرفقت صورة للإعلان'
          : `أرفقت ${imagesForThisMessage.length} صور للإعلان`
        : attachedImages.length > 0
        ? 'أرفقت صورة للإعلان'
        : '');
    if (question.length < 1 || sending || uploadingImages) return;

    setErrorMsg('');
    const userMsg: HelpMessage = {
      id: `u_${Date.now()}`,
      role: 'user',
      content: question,
      ...(imagesForThisMessage.length > 0 ? { images: imagesForThisMessage } : {}),
    };
    const nextHistory = messages.slice(-10).map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, userMsg]);
    setPendingChatImages([]);
    setInput('');
    setSending(true);

    try {
      const idToken = await auth.currentUser?.getIdToken().catch(() => null);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (idToken) {
        headers.Authorization = `Bearer ${idToken}`;
      }

      const resp = await fetch('/api/public/help', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          question,
          history: nextHistory,
          context: {
            page: route.page,
            adId: route.page === 'ad-detail' ? route.adId : undefined,
            attachedImages,
          },
        }),
      });
      const data = (await resp.json().catch(() => null)) as {
        reply?: string;
        answer?: string;
        escalated?: boolean;
        escalationFailed?: boolean;
        needsAuth?: boolean;
        submittedAd?: { id: string; title: string };
        detail?: string;
        error?: string;
      } | null;

      if (!resp.ok) {
        setErrorMsg(
          data?.detail || data?.error || 'تعذر الحصول على رد حالياً، يرجى المحاولة بعد قليل.'
        );
        return;
      }

      if (data?.submittedAd?.id) {
        setAttachedImages([]);
        setPendingChatImages([]);
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
          needsAuth: Boolean(data?.needsAuth),
          submittedAd: data?.submittedAd,
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

  const canSend =
    !sending && !uploadingImages && (input.trim().length >= 1 || attachedImages.length > 0);

  return (
    <div className="fixed bottom-20 left-4 md:bottom-6 md:left-6 z-40" dir="rtl">
      {open && (
        <div className="mb-3 w-[calc(100vw-2rem)] sm:w-[380px] max-h-[72vh] flex flex-col rounded-2xl bg-white border border-stone-200 shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-teal-800 text-white">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-white/15 flex items-center justify-center">
                <Bot className="w-4 h-4 text-white" />
              </div>
              <div>
                <h3 className="font-display text-sm font-bold leading-tight">مساعد سوق أبو جبيهة</h3>
                <p className="text-[11px] text-teal-100">
                  {user ? `مرحباً ${user.name.split(' ')[0]} • جاهز لرفع إعلانك أو البحث` : 'مدعوم بذكاء سند للرد الفوري'}
                </p>
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
                  أهلاً بك في <span className="font-bold text-teal-800">سوق أبو جبيهة</span>! أقدر
                  أساعدك في <span className="font-semibold">رفع إعلانك خطوة بخطوة</span>، أو البحث عن
                  أي سلعة أو عقار، أو الإجابة عن استفساراتك.
                </div>
                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold text-stone-500 flex items-center gap-1">
                    <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                    جرّب أن تسألني:
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
                    {msg.images && msg.images.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {msg.images.map((url, idx) => (
                          <img
                            key={`${url}_${idx}`}
                            src={url}
                            alt="صورة مرفقة"
                            referrerPolicy="no-referrer"
                            className="w-20 h-20 rounded-xl object-cover border border-white/30 bg-black/10"
                          />
                        ))}
                      </div>
                    )}
                  </div>
                  {msg.submittedAd && (
                    <div className="mt-1.5 flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-200 px-2.5 py-1.5 text-[11px] text-emerald-900">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                      <span>تم رفع «{msg.submittedAd.title}» للمراجعة.</span>
                      <button
                        type="button"
                        onClick={() => {
                          onNavigate({ page: 'account', tab: 'my-ads' });
                          setOpen(false);
                        }}
                        className="font-bold underline text-emerald-800 hover:text-emerald-950 cursor-pointer shrink-0"
                      >
                        إعلاناتي
                      </button>
                    </div>
                  )}
                  {msg.needsAuth && (!user || emailNotVerified) && (
                    <button
                      type="button"
                      onClick={() => {
                        onNavigate(
                          !user ? { page: 'auth', mode: 'login' } : { page: 'account' }
                        );
                        setOpen(false);
                      }}
                      className="mt-1.5 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-teal-800 hover:bg-teal-900 text-white text-xs font-semibold transition-colors cursor-pointer"
                    >
                      <LogIn className="w-3.5 h-3.5" />
                      {!user ? 'تسجيل الدخول / إنشاء حساب' : 'الذهاب للحساب لتأكيد البريد'}
                    </button>
                  )}
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
                  جاري المعالجة وكتابة الرد...
                </div>
              </div>
            )}

            {errorMsg && (
              <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
                {errorMsg}
              </div>
            )}
          </div>

          {attachedImages.length > 0 && (
            <div className="px-3 py-2 bg-stone-50 border-t border-stone-200 flex items-center gap-2 overflow-x-auto">
              {attachedImages.map((url, idx) => (
                <div key={`${url}_${idx}`} className="relative shrink-0">
                  <img
                    src={url}
                    alt={`صورة الإعلان ${idx + 1}`}
                    referrerPolicy="no-referrer"
                    className="w-11 h-11 rounded-lg object-cover border border-stone-300"
                  />
                  <button
                    type="button"
                    onClick={() => removeAttachedImage(idx)}
                    aria-label="إزالة الصورة"
                    className="absolute -top-1.5 -left-1.5 w-4 h-4 rounded-full bg-stone-800 text-white flex items-center justify-center hover:bg-red-600 cursor-pointer"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              ))}
              <span className="text-[11px] text-stone-600 shrink-0">
                {pendingChatImages.length > 0
                  ? 'جاهزة للإرسال (اضغط إرسال أو أضف رسالة)'
                  : attachedImages.length === 1
                  ? 'صورة مرفقة بالإعلان'
                  : `${attachedImages.length} صور مرفقة بالإعلان`}
              </span>
            </div>
          )}

          <form
            onSubmit={handleSubmit}
            className="flex items-center gap-1.5 p-2.5 bg-white border-t border-stone-200"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              multiple
              onChange={(e) => void handleImageFilesChange(e)}
              className="hidden"
            />
            <button
              type="button"
              onClick={handleAttachButtonClick}
              disabled={sending || uploadingImages}
              title="إرفاق صورة للإعلان (اختياري)"
              aria-label="إرفاق صورة للإعلان"
              className="p-2 rounded-xl bg-stone-100 text-stone-700 hover:bg-stone-200 hover:text-teal-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer shrink-0"
            >
              {uploadingImages ? (
                <Loader2 className="w-4 h-4 animate-spin text-teal-800" />
              ) : (
                <ImagePlus className="w-4 h-4" />
              )}
            </button>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="اكتب استفسارك أو بيانات إعلانك..."
              maxLength={800}
              disabled={sending}
              className="flex-1 text-xs sm:text-sm px-3 py-2 rounded-xl bg-stone-50 border border-stone-200 text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-teal-700"
            />
            <button
              type="submit"
              disabled={!canSend}
              aria-label="إرسال"
              className="p-2.5 rounded-xl bg-teal-800 text-white hover:bg-teal-900 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer shrink-0"
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
