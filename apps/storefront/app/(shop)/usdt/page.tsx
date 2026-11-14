'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { isAuthed } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { money, num } from '@/lib/format';
import { useCurrency } from '@/lib/currency';
import { useT, tNow } from '@/lib/i18n';
import VerifyPanel from '@/components/VerifyPanel';
import { ChevronIcon, ShieldIcon } from '@/components/icons';
import {
  checkAddress, checkBinanceId, usdt, usdtError, type AddressCheck, type UsdtDelivery, type UsdtNetwork, type UsdtQuote,
} from '@/lib/usdt';
import { NETWORK_INFO, StatusChip, UsdtOff, field, usdtAmount } from '@/components/usdt/shared';

const newKey = () => {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
};

/**
 * Buying USDT: amount, how to receive it, the network and address checked as
 * the customer types, then rate, fee and total from the server BEFORE they
 * confirm. Payment happens on the order page.
 */
export default function UsdtPage() {
  const t = useT();
  const router = useRouter();
  useEffect(() => {
    if (!isAuthed()) router.replace('/login?next=/usdt');
  }, [router]);

  const cfg = useFetch(() => usdt.config(), []);
  const mine = useFetch(() => (isAuthed() ? usdt.orders() : Promise.resolve([])), []);
  const config = cfg.data?.enabled ? cfg.data : null;
  const shopCurrency = useCurrency();

  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('');
  const [delivery, setDelivery] = useState<UsdtDelivery>('ONCHAIN');
  const [network, setNetwork] = useState<UsdtNetwork | ''>('');
  const [address, setAddress] = useState('');
  const [binanceId, setBinanceId] = useState('');
  const [check, setCheck] = useState<AddressCheck | null>(null);
  const [quote, setQuote] = useState<UsdtQuote | null>(null);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [needVerify, setNeedVerify] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  // defaults once the terms are known: the shop's currency if USDT is sold in it, the first network
  useEffect(() => {
    if (!config) return;
    setCurrency((c) => c || (config.currencies.some((x) => x.code === shopCurrency) ? shopCurrency : (config.currencies[0]?.code ?? '')));
    if (!config.networks.length && config.binanceEnabled) setDelivery('BINANCE');
    setNetwork((n) => n || config.networks[0] || '');
  }, [config, shopCurrency]);

  const amountOk = /^\d{1,9}(\.\d{1,2})?$/.test(amount.trim());
  const inRange = config && amountOk && Number(amount) >= Number(config.minUsdt) && Number(amount) <= Number(config.maxUsdt);

  // live destination check, a moment after typing stops
  useEffect(() => {
    let alive = true;
    const value = delivery === 'ONCHAIN' ? address : binanceId;
    if (!value.trim()) return setCheck(null);
    const timer = setTimeout(async () => {
      const res = delivery === 'ONCHAIN' ? (network ? await checkAddress(network, value) : null) : checkBinanceId(value);
      if (alive) setCheck(res);
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [delivery, network, address, binanceId]);

  // the price always comes from the server
  useEffect(() => {
    setQuote(null);
    setQuoteErr(null);
    if (!config || !inRange || !currency || (delivery === 'ONCHAIN' && !network)) return;
    let alive = true;
    const timer = setTimeout(() => {
      usdt
        .quote({ amountUsdt: amount.trim(), currency, delivery, ...(delivery === 'ONCHAIN' && network ? { network } : {}) })
        .then((q) => alive && setQuote(q))
        .catch((err) => {
          if (!alive) return;
          if ((err as { code?: string }).code === 'PHONE_NOT_VERIFIED') setNeedVerify(true);
          else setQuoteErr(usdtError(err, tNow('تعذّر حساب السعر.')));
        });
    }, 350);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [config, inRange, amount, currency, delivery, network, refresh]);

  const body = useMemo(
    () => ({
      amountUsdt: amount.trim(),
      currency,
      delivery,
      ...(delivery === 'ONCHAIN' ? { network: network || undefined, address: address.trim() } : { binanceId: binanceId.trim() }),
      expectedTotal: quote?.total,
    }),
    [amount, currency, delivery, network, address, binanceId, quote?.total],
  );
  // one key per exact request: a retry of the same confirmation returns the same order
  const keyFor = useRef<{ body: string; key: string } | null>(null);

  async function confirm() {
    if (!quote || !check?.ok || !agreed) return;
    const json = JSON.stringify(body);
    if (keyFor.current?.body !== json) keyFor.current = { body: json, key: newKey() };
    setBusy(true);
    setError(null);
    try {
      const order = await usdt.create(body, keyFor.current.key);
      router.push(`/usdt/${order.id}`);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'USDT_QUOTE_CHANGED') setRefresh((n) => n + 1);
      if (code === 'PHONE_NOT_VERIFIED') setNeedVerify(true);
      setError(usdtError(err, tNow('تعذّر إنشاء الطلب.')));
      setBusy(false);
    }
  }

  if (cfg.loading) return <div className="mx-auto max-w-[620px] px-4 py-16 text-center text-sm text-muted">{t('جارٍ التحميل…')}</div>;
  if (!config) return <UsdtOff />;

  if (needVerify) {
    return (
      <div className="mx-auto max-w-page px-4 py-10">
        <div className="surface mx-auto max-w-[460px] rounded-2xl p-5 shadow-card sm:p-6">
          <VerifyPanel
            onVerified={() =>
              setTimeout(() => {
                setNeedVerify(false);
                setRefresh((n) => n + 1);
              }, 1200)
            }
            onSkip={() => router.push('/')}
            skipLabel={t('ليس الآن')}
          />
        </div>
      </div>
    );
  }

  const rate = config.currencies.find((c) => c.code === currency)?.rate;
  const chips = [10, 20, 50, 100, 200, 500].filter((n) => n >= Number(config.minUsdt) && n <= Number(config.maxUsdt)).slice(0, 4);
  const open = (mine.data ?? []).filter((o) => o.status !== 'CANCELLED').slice(0, 5);

  return (
    <div className="mx-auto max-w-[620px] px-4 py-6 sm:py-10">
      <h1 className="text-2xl font-extrabold">{t('اشترِ USDT')}</h1>
      <p className="mt-1 text-sm text-muted">
        {t('تدفع بالتحويل المعتاد، ونرسل لك USDT يدويًا بعد التحقّق من وصول المبلغ.')}
      </p>

      {/* 1. amount */}
      <section className="surface mt-5 rounded-2xl p-4 shadow-card sm:p-5">
        <label htmlFor="usdt-amount" className="text-sm font-bold">
          1. {t('كم USDT تريد؟')}
        </label>
        <div className="mt-2 flex items-center gap-2">
          <input
            id="usdt-amount"
            className={`${field} tnum text-lg font-bold`}
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(',', '.').replace(/[^\d.]/g, ''))}
            inputMode="decimal"
            dir="ltr"
            placeholder={config.minUsdt}
          />
          <span className="flex-none font-bold text-muted">USDT</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {chips.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setAmount(String(n))}
              className={`rounded-full border px-3 py-1.5 text-sm font-bold tnum ${amount === String(n) ? 'border-teal bg-teal/10 text-teal' : 'border-[rgb(var(--line))] text-muted'}`}
            >
              {n}
            </button>
          ))}
        </div>
        <p className={`mt-2 text-xs ${amount && !inRange ? 'text-bad' : 'text-muted'}`}>
          {t('من {min} إلى {max} USDT.', { min: num(config.minUsdt, 0), max: num(config.maxUsdt, 0) })}
        </p>

        {config.currencies.length > 1 && (
          <div className="mt-3 flex items-center gap-2 text-sm">
            <span className="text-muted">{t('تدفع بـ')}</span>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              aria-label={t('عملة الدفع')}
              className="rounded-lg border border-[rgb(var(--line))] bg-transparent px-2 py-1.5 font-bold"
            >
              {config.currencies.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code}
                </option>
              ))}
            </select>
          </div>
        )}
        {rate && (
          <p className="mt-2 text-sm">
            {t('السعر:')} <b className="tnum">1 USDT = {money(rate, currency, 2)}</b>
          </p>
        )}
      </section>

      {/* 2. how to receive */}
      <section className="surface mt-4 rounded-2xl p-4 shadow-card sm:p-5">
        <div className="text-sm font-bold">2. {t('كيف تستلم USDT؟')}</div>
        <div className="mt-2 grid grid-cols-1 gap-2 min-[400px]:grid-cols-2">
          {config.networks.length > 0 && (
            <DeliveryCard
              active={delivery === 'ONCHAIN'}
              onClick={() => setDelivery('ONCHAIN')}
              title={t('إلى عنوان محفظتك')}
              hint={t('أي محفظة تدعم USDT')}
            />
          )}
          {config.binanceEnabled && (
            <DeliveryCard
              active={delivery === 'BINANCE'}
              onClick={() => setDelivery('BINANCE')}
              title={t('تحويل داخلي في Binance')}
              hint={t('إلى حسابك في Binance، بلا رسوم شبكة')}
            />
          )}
        </div>

        {delivery === 'ONCHAIN' ? (
          <>
            <div className="mt-4 text-sm font-bold">{t('الشبكة')}</div>
            <div className="mt-2 flex flex-col gap-2" role="radiogroup" aria-label={t('الشبكة')}>
              {config.networks.map((n) => (
                <label
                  key={n}
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 transition ${network === n ? 'border-teal bg-teal/5' : 'border-[rgb(var(--line))]'}`}
                >
                  <input type="radio" name="network" checked={network === n} onChange={() => setNetwork(n)} className="mt-1 accent-teal" />
                  <span>
                    <span dir="ltr" className="block text-[15px] font-bold">
                      {t(NETWORK_INFO[n].name)}
                    </span>
                    <span className="block text-xs text-muted">{t(NETWORK_INFO[n].hint)}</span>
                  </span>
                </label>
              ))}
            </div>
            <p className="mt-3 rounded-xl border border-warn/30 bg-warn/10 px-3.5 py-2.5 text-sm leading-relaxed">
              <b>{t('مهم:')}</b>{' '}
              {t('افتح محفظتك، اختر «استلام USDT»، واختر نفس الشبكة التي اخترتها هنا ثم انسخ العنوان. USDT المرسَل على شبكة مختلفة يضيع ولا يمكن استرجاعه.')}
              {network !== 'TRC20' && ' ' + t('عناوين BEP20 وERC20 متشابهة (تبدأ بـ 0x)، فتأكّد من اسم الشبكة في محفظتك.')}
            </p>

            <label htmlFor="usdt-address" className="mt-4 block text-sm font-bold">
              {t('عنوان محفظتك ({network})', { network: network || '—' })}
            </label>
            <input
              id="usdt-address"
              className={`${field} mt-2 font-mono text-sm`}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              dir="ltr"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              maxLength={120}
              placeholder={network === 'TRC20' ? 'T…' : '0x…'}
            />
          </>
        ) : (
          <>
            <label htmlFor="usdt-binance" className="mt-4 block text-sm font-bold">
              {t('معرّف Binance (UID) أو البريد أو الهاتف')}
            </label>
            <input
              id="usdt-binance"
              className={`${field} mt-2`}
              value={binanceId}
              onChange={(e) => setBinanceId(e.target.value)}
              dir="ltr"
              autoComplete="off"
              maxLength={120}
              placeholder="12345678"
            />
            <p className="mt-2 text-xs text-muted">
              {t('تجد UID في تطبيق Binance تحت صورة حسابك. تأكّد منه: التحويل الداخلي لا يُسترجع.')}
            </p>
          </>
        )}
        {check && (
          <p role="status" className={`mt-2 text-sm font-semibold ${check.ok ? 'text-ok' : 'text-bad'}`}>
            {check.ok ? `✓ ${t('العنوان صالح لهذه الشبكة')}` : check.message}
          </p>
        )}
      </section>

      {/* 3. summary before confirming */}
      <section className="surface mt-4 rounded-2xl p-4 shadow-card sm:p-5" aria-live="polite">
        <div className="text-sm font-bold">3. {t('الملخّص قبل التأكيد')}</div>
        {!quote ? (
          <p className="mt-2 text-sm text-muted">{quoteErr ?? (inRange ? t('نحسب السعر…') : t('اكتب الكمية لترى السعر والمجموع.'))}</p>
        ) : (
          <dl className="mt-3 grid grid-cols-[1fr_auto] gap-y-2 text-sm">
            <dt className="text-muted">{t('تستلم')}</dt>
            <dd className="tnum text-end font-bold">{usdtAmount(quote.amountUsdt)}</dd>
            <dt className="text-muted">{t('السعر')}</dt>
            <dd className="tnum text-end">1 USDT = {money(quote.rate, quote.currency, 2)}</dd>
            <dt className="text-muted">{t('قيمة USDT')}</dt>
            <dd className="tnum text-end">{money(quote.subtotal, quote.currency)}</dd>
            <dt className="text-muted">
              {t('رسوم الخدمة')}
              {Number(quote.feePercent) > 0 && <span className="tnum"> ({num(quote.feePercent, 2)}%)</span>}
            </dt>
            <dd className="tnum text-end">{money(quote.fee, quote.currency)}</dd>
            <dt className="border-t border-[rgb(var(--line))] pt-2 font-bold">{t('المجموع الذي تدفعه')}</dt>
            <dd className="tnum border-t border-[rgb(var(--line))] pt-2 text-end text-lg font-extrabold text-teal">
              {money(quote.total, quote.currency)}
            </dd>
            <dt className="text-muted">{t('الاستلام')}</dt>
            <dd dir="ltr" className="text-end text-xs font-bold">
              {delivery === 'BINANCE' ? 'Binance' : quote.network}
            </dd>
          </dl>
        )}

        <label className="mt-4 flex items-start gap-2.5 text-sm">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1 accent-teal" />
          <span>
            {t('راجعت العنوان والشبكة، وأعلم أن USDT المرسَل إلى عنوان أو شبكة خاطئة لا يمكن استرجاعه.')}
          </span>
        </label>

        {error && (
          <p role="alert" className="mt-3 rounded-xl border border-bad/30 bg-bad/10 px-3.5 py-2.5 text-sm text-bad">
            {error}
          </p>
        )}

        <button
          onClick={confirm}
          disabled={busy || !quote || !check?.ok || !agreed}
          className="btn-brand mt-4 w-full rounded-xl py-3 text-[15px] font-bold disabled:opacity-60"
        >
          {busy ? t('جارٍ…') : quote ? t('أكّد الطلب وادفع {total}', { total: money(quote.total, quote.currency) }) : t('أكّد الطلب')}
        </button>
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
          <ShieldIcon size={14} />
          {t('بعد التأكيد لديك {n} دقيقة للدفع. لا يُرسل أي شيء قبل أن نتحقّق من تحويلك.', { n: config.expiryMinutes })}
        </p>
      </section>

      {open.length > 0 && (
        <section className="mt-6">
          <h2 className="text-base font-bold">{t('طلبات USDT السابقة')}</h2>
          <ul className="mt-2 flex flex-col gap-2">
            {open.map((o) => (
              <li key={o.id}>
                <Link href={`/usdt/${o.id}`} className="surface flex items-center gap-3 rounded-xl px-4 py-3 shadow-card">
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold tnum">{usdtAmount(o.amountUsdt)}</span>
                    <span dir="ltr" className="block text-xs text-muted">
                      {o.number}
                    </span>
                  </span>
                  <StatusChip status={o.status} />
                  <ChevronIcon size={16} className="flex-none text-muted ltr:rotate-180" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function DeliveryCard({ active, onClick, title, hint }: { active: boolean; onClick: () => void; title: string; hint: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-xl border px-3.5 py-3 text-start transition ${active ? 'border-teal bg-teal/5 ring-1 ring-teal' : 'border-[rgb(var(--line))]'}`}
    >
      <span className="block text-[15px] font-bold">{title}</span>
      <span className="block text-xs text-muted">{hint}</span>
    </button>
  );
}
