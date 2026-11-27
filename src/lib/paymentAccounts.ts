import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { PAYMENT_ACCOUNTS } from '../lib/paymentAccounts';

interface PaymentAccountDetailsProps {
  method: string;
}

export function PaymentAccountDetails({ method }: PaymentAccountDetailsProps) {
  const [copied, setCopied] = useState(false);
  const acc = PAYMENT_ACCOUNTS.find((a) => a.value === method);
  if (!acc) return null;

  if (!acc.account) {
    return (
      <div className="bg-white border border-amber-200 rounded-xl p-3 text-xs text-stone-700 leading-relaxed">
        سلّم المبلغ مباشرة لإدارة السوق، ثم اكتب في خانة رقم العملية اسم المستلم أو رقم الإيصال.
      </div>
    );
  }

  const copyAccount = async () => {
    try {
      await navigator.clipboard.writeText(acc.account);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="bg-white border border-amber-200 rounded-xl p-3 space-y-2">
      <p className="text-[11px] font-bold text-stone-500">حوّل المبلغ إلى الحساب التالي:</p>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] text-stone-500">رقم الحساب ({acc.value})</p>
          <p dir="ltr" className="text-lg font-extrabold text-stone-900 tracking-wide text-right">
            {acc.account}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void copyAccount()}
          className="shrink-0 px-3 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-800 text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          <span>{copied ? 'تم النسخ' : 'نسخ'}</span>
        </button>
      </div>
      <div>
        <p className="text-[11px] text-stone-500">اسم صاحب الحساب</p>
        <p className="text-sm font-bold text-stone-900">{acc.holder}</p>
      </div>
    </div>
  );
}
