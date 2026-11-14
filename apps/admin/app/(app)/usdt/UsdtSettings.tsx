'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import Notice from '@/components/Notice';
import { NETWORK_LABEL, type UsdtConfig, type UsdtNetwork } from './shared';

type Currency = { code: string; nameAr: string };

const input = 'surface-2 hairline w-full min-w-0 rounded-xl border px-3 py-2 text-[15px] outline-none focus:border-teal';
const NETWORKS: UsdtNetwork[] = ['TRC20', 'BEP20', 'ERC20'];

/** "41,5" and "41.5" are the same; Arabic digits too. */
const latin = (s: string) => s.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(',', '.').trim();

/**
 * The owner's USDT terms. Switching the service on asks them to confirm the
 * legal approval first (docs/USDT_COMPLIANCE.md); the API refuses otherwise.
 */
export default function UsdtSettings() {
  const cfg = useFetch<UsdtConfig>('/admin/usdt/config');
  const currencies = useFetch<Currency[]>('/catalog/currencies');
  const [form, setForm] = useState<UsdtConfig | null>(null);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'bad' } | null>(null);

  useEffect(() => {
    if (cfg.data) setForm(cfg.data);
  }, [cfg.data]);

  if (cfg.error) return <Notice text={cfg.error} />;
  if (!form) return <div className="surface rounded-2xl p-5 text-sm text-muted shadow-card">جارٍ التحميل…</div>;

  const wasOn = cfg.data?.enabled ?? false;
  const set = (patch: Partial<UsdtConfig>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const codes = [...new Set([...(currencies.data ?? []).map((c) => c.code), ...Object.keys(form.rates)])];

  async function save() {
    if (!form) return;
    if (form.enabled && !wasOn && !ack) {
      setMsg({ text: 'أكّد أولًا أن لديك الموافقة القانونية قبل تشغيل الخدمة.', tone: 'bad' });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const rates = Object.fromEntries(Object.entries(form.rates).map(([k, v]) => [k, latin(v)]).filter(([, v]) => v !== ''));
      const saved = await api.put<UsdtConfig>('/admin/usdt/config', {
        ...form,
        rates,
        feePercent: latin(form.feePercent),
        feeFixedUsdt: latin(form.feeFixedUsdt),
        minUsdt: latin(form.minUsdt),
        maxUsdt: latin(form.maxUsdt),
        expiryMinutes: Number(form.expiryMinutes),
        ...(form.enabled && !wasOn && { legalApproval: true }),
      });
      setForm(saved);
      setAck(false);
      cfg.reload();
      setMsg({ text: 'حُفظت الإعدادات.', tone: 'ok' });
    } catch (e) {
      setMsg({ text: e instanceof ApiError ? e.message : 'تعذّر الحفظ', tone: 'bad' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="surface flex flex-col gap-5 rounded-2xl p-5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold">إعدادات بيع USDT</h2>
          <p className="mt-1 text-xs text-muted">لا يُرسل أي USDT تلقائيًا: أنت ترسله يدويًا ثم تسجّل رقم العملية.</p>
        </div>
        <label className="flex items-center gap-2 text-sm font-bold">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => set({ enabled: e.target.checked })}
            className="h-5 w-5 accent-teal"
          />
          {form.enabled ? 'الخدمة مفعّلة' : 'الخدمة متوقفة'}
        </label>
      </div>

      <div className="rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm leading-relaxed">
        <b>تنبيه قانوني:</b> بيع العملات المشفّرة قد يحتاج ترخيصًا أو يكون محظورًا في موريتانيا أو في بلدان زبائنك، ويخضع لقواعد
        مكافحة غسل الأموال والتحقق من الهوية. لا تشغّل الخدمة قبل موافقة قانونية مكتوبة. التفاصيل في{' '}
        <span dir="ltr" className="font-mono text-xs">
          docs/USDT_COMPLIANCE.md
        </span>
        .
        {form.enabled && !wasOn && (
          <label className="mt-2 flex items-start gap-2 font-bold">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-1 accent-teal" />
            أؤكّد أنني حصلت على الموافقة القانونية لبيع USDT وأتحمّل مسؤولية تشغيل الخدمة.
          </label>
        )}
      </div>

      <div>
        <h3 className="text-sm font-bold">سعر 1 USDT بكل عملة دفع</h3>
        <p className="mt-0.5 text-xs text-muted">اترك الخانة فارغة لعملة لا تبيع بها.</p>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {codes.map((code) => (
            <label key={code} className="flex min-w-0 flex-col gap-1">
              <span className="text-xs font-semibold text-muted">{code}</span>
              <input
                className={`${input} tnum`}
                dir="ltr"
                inputMode="decimal"
                    value={form.rates[code] ?? ''}
                onChange={(e) => set({ rates: { ...form.rates, [code]: e.target.value } })}
                placeholder="—"
              />
            </label>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="الرسوم (%)" value={form.feePercent} onChange={(v) => set({ feePercent: v })} />
        <Field label="رسوم ثابتة (USDT)" value={form.feeFixedUsdt} onChange={(v) => set({ feeFixedUsdt: v })} />
        <Field label="أقل كمية (USDT)" value={form.minUsdt} onChange={(v) => set({ minUsdt: v })} />
        <Field label="أكبر كمية (USDT)" value={form.maxUsdt} onChange={(v) => set({ maxUsdt: v })} />
        <Field
          label="مهلة الدفع (دقيقة)"
          value={String(form.expiryMinutes)}
         
          onChange={(v) => set({ expiryMinutes: Number(latin(v)) || 0 })}
        />
      </div>

      <div>
        <h3 className="text-sm font-bold">طرق الاستلام</h3>
        <div className="mt-2 flex flex-col gap-2">
          {NETWORKS.map((n) => (
            <label key={n} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.networks[n]}
                    onChange={(e) => set({ networks: { ...form.networks, [n]: e.target.checked } })}
                className="h-4 w-4 accent-teal"
              />
              <span dir="ltr">{NETWORK_LABEL[n]}</span>
            </label>
          ))}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.binanceEnabled}
                onChange={(e) => set({ binanceEnabled: e.target.checked })}
              className="h-4 w-4 accent-teal"
            />
            تحويل داخلي في Binance (UID أو بريد أو هاتف)
          </label>
        </div>
      </div>

      {msg && <Notice text={msg.text} tone={msg.tone} />}
      <button
        onClick={save}
        disabled={busy}
        className="self-start rounded-xl bg-teal px-6 py-2.5 text-sm font-bold text-white transition hover:bg-teal-deep disabled:opacity-60"
      >
        {busy ? 'جارٍ الحفظ…' : 'حفظ الإعدادات'}
      </button>
    </section>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-xs font-semibold text-muted">{label}</span>
      <input className={`${input} tnum`} dir="ltr" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
