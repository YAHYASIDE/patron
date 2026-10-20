'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { isAuthed, me, shop } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { money } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { dayTime } from '@/components/my/when';

type Txn = {
  id: string;
  type: string;
  amount: string;
  currency?: string;
  currencyCode?: string;
  balanceAfter?: string;
  description?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  createdAt: string;
};

const TYPES: Record<string, string> = {
  TOPUP: 'شحن الرصيد',
  ORDER_PAYMENT: 'دفع طلب',
  REFUND: 'استرجاع مبلغ',
  ADMIN_ADJUSTMENT: 'تعديل من المتجر',
  CASHBACK: 'مكافأة',
};

/** "+500 أوقية" / "−40 MRU": the sign stays glued to the digits in either direction. */
function signed(amount: number, cur: string) {
  const text = money(Math.abs(amount), cur);
  const cut = text.lastIndexOf(' ');
  const sign = amount > 0 ? '+' : amount < 0 ? '−' : '';
  return (
    <>
      <bdi dir="ltr">
        {sign}
        {text.slice(0, cut)}
      </bdi>{' '}
      {text.slice(cut + 1)}
    </>
  );
}

/** The ledger comes back as a list (or a page of one); either way, the rows. */
async function loadHistory(): Promise<Txn[]> {
  const r = (await me.walletTransactions()) as unknown;
  if (Array.isArray(r)) return r as Txn[];
  const data = (r as { data?: unknown } | null)?.data;
  return Array.isArray(data) ? (data as Txn[]) : [];
}

/** The wallet (#18): balance per currency and the latest movements. */
export default function WalletPage() {
  const router = useRouter();
  const t = useT();
  useEffect(() => {
    if (!isAuthed()) router.replace('/login?next=/wallet');
  }, [router]);

  const balances = useFetch(() => shop.wallet(), []);
  const history = useFetch(loadHistory, []);
  // empty wallets are noise; with no money at all, the empty card says so
  const wallets = (balances.data ?? []).filter((w) => parseFloat(w.balance) !== 0);

  return (
    <div className="mx-auto max-w-[760px] px-4 py-8">
      <h1 className="text-2xl font-extrabold">{t('المحفظة')}</h1>

      <section className="mt-5 grid gap-3 sm:grid-cols-2">
        {balances.loading && <p className="text-sm text-muted">{t('جارٍ التحميل…')}</p>}
        {balances.error && (
          <p className="rounded-xl border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad sm:col-span-2">
            {t('تعذّر تحميل رصيدك الآن.')}
          </p>
        )}
        {!balances.loading && !balances.error && wallets.length === 0 && (
          <div className="surface rounded-2xl p-5 shadow-card sm:col-span-2">
            <div className="text-sm text-muted">{t('الرصيد')}</div>
            <div className="tnum mt-1 text-3xl font-extrabold text-teal">0</div>
            <p className="mt-2 text-sm text-muted">{t('لا يوجد رصيد بعد.')}</p>
          </div>
        )}
        {wallets.map((w) => (
          <div key={w.currencyCode} className="surface rounded-2xl p-5 shadow-card">
            <div className="text-sm text-muted">{t('الرصيد')} · {w.currencyCode}</div>
            <div className="tnum mt-1 break-all text-3xl font-extrabold text-teal">{money(w.balance, w.currencyCode)}</div>
          </div>
        ))}
      </section>
      <p className="mt-3 text-xs text-muted">{t('يُستعمل الرصيد للدفع عند إتمام الطلب حين يكفي المبلغ.')}</p>

      <h2 className="mt-8 text-lg font-extrabold">{t('سجلّ الحركات')}</h2>
      {history.loading && <p className="mt-3 text-sm text-muted">{t('جارٍ التحميل…')}</p>}
      {history.error && (
        <p className="mt-3 rounded-xl border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad">
          {t('تعذّر تحميل السجلّ الآن.')}
        </p>
      )}
      {!history.loading && !history.error && (history.data?.length ?? 0) === 0 && (
        <p className="mt-3 rounded-2xl border border-[rgb(var(--line))] p-8 text-center text-sm text-muted">
          {t('لا توجد حركات بعد.')}
        </p>
      )}
      <ul className="surface mt-3 divide-y divide-[rgb(var(--line))] overflow-hidden rounded-2xl shadow-card empty:hidden">
        {history.data?.map((x) => {
          const cur = x.currencyCode ?? x.currency ?? 'USD';
          const amount = parseFloat(x.amount);
          const order = x.referenceType === 'order' && x.referenceId;
          return (
            <li key={x.id} className="flex items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="text-sm font-bold">{t(TYPES[x.type] ?? x.type)}</div>
                {x.description && <div className="break-words text-xs text-muted">{x.description}</div>}
                <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted">
                  <span>{dayTime(x.createdAt)}</span>
                  {order && (
                    <Link href={`/orders/${x.referenceId}`} className="font-semibold text-teal hover:underline">
                      {t('عرض الطلب')}
                    </Link>
                  )}
                </div>
              </div>
              <div className="flex-none text-end">
                <div className={`tnum text-sm font-extrabold ${amount < 0 ? 'text-bad' : 'text-ok'}`}>
                  {signed(amount, cur)}
                </div>
                {x.balanceAfter !== undefined && (
                  <div className="tnum text-[11px] text-muted">
                    {t('الرصيد: {amount}', { amount: money(x.balanceAfter, cur) })}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
