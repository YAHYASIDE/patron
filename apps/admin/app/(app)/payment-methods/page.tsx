'use client';

import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { PAY_LOGOS } from '@/lib/paylogos';
import PayLogo from '@/components/PayLogo';

type Kind = 'mobile' | 'bank' | 'crypto';
type Account = {
  id?: string;
  method: string;
  countries: string[];
  accountName: string;
  accountNumber: string;
  kind: Kind;
  logo?: string;
  enabled: boolean;
  instructions?: string;
};
type Instructions = { accounts: Account[]; note: string | null };

// The countries with their own payment methods; "XX" is every other country.
const REGIONS: { id: string; label: string; flag: string; currency: string }[] = [
  { id: 'MR', label: 'موريتانيا', flag: '🇲🇷', currency: 'أوقية' },
  { id: 'ML', label: 'مالي', flag: '🇲🇱', currency: 'فرنك أو دولار' },
  { id: 'DZ', label: 'الجزائر', flag: '🇩🇿', currency: 'دينار أو دولار' },
  { id: 'NE', label: 'النيجر', flag: '🇳🇪', currency: 'فرنك أو دولار' },
  { id: 'XX', label: 'باقي الدول', flag: '🌍', currency: 'دولار' },
];

const KINDS: { id: Kind; label: string }[] = [
  { id: 'mobile', label: 'محفظة / تطبيق هاتف' },
  { id: 'bank', label: 'بنك' },
  { id: 'crypto', label: 'عملات رقمية' },
];

const LOGO_CHOICES = Object.keys(PAY_LOGOS);

const input =
  'surface-2 hairline w-full rounded-xl border px-3.5 py-2.5 text-[15px] outline-none transition focus:border-teal';

const usable = (a: Account) => a.enabled && a.accountNumber.trim().length > 0;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold text-muted">{label}</span>
      {children}
    </label>
  );
}

function LogoPicker({ value, name, onChange }: { value?: string; name: string; onChange: (logo?: string) => void }) {
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.upload<{ id: string }>('/admin/uploads/logo', f);
      onChange(`upload:${res.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? 'تعذّر رفع الصورة (JPG أو PNG، أقل من 4 ميغا).' : 'تعذّر رفع الصورة.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold text-muted">الشعار</span>
      <div className="flex flex-wrap items-center gap-2">
        <PayLogo logo={value} name={name || '?'} size={44} />
        <select
          value={value?.startsWith('upload:') ? 'upload' : (value ?? '')}
          onChange={(e) => e.target.value !== 'upload' && onChange(e.target.value || undefined)}
          className={input + ' w-auto flex-1'}
        >
          <option value="">حروف الاسم</option>
          {value?.startsWith('upload:') && <option value="upload">صورة مرفوعة</option>}
          {LOGO_CHOICES.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" onChange={upload} className="hidden" />
        <button
          type="button"
          onClick={() => file.current?.click()}
          disabled={busy}
          className="hairline rounded-xl border px-3 py-2.5 text-sm font-bold text-teal disabled:opacity-50"
        >
          {busy ? 'جارٍ…' : 'ارفع صورة'}
        </button>
      </div>
      {error && <span className="text-xs text-bad">{error}</span>}
    </div>
  );
}

function AccountCard({
  a,
  onChange,
  onRemove,
}: {
  a: Account;
  onChange: (patch: Partial<Account>) => void;
  onRemove: () => void;
}) {
  const toggleCountry = (id: string) =>
    onChange({ countries: a.countries.includes(id) ? a.countries.filter((c) => c !== id) : [...a.countries, id] });
  const missing = a.enabled && !a.accountNumber.trim();

  return (
    <div className={`surface rounded-2xl p-4 shadow-card ${a.enabled ? '' : 'opacity-75'}`}>
      <div className="flex items-center gap-3">
        <PayLogo logo={a.logo} name={a.method || '?'} size={40} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-bold">{a.method || 'وسيلة جديدة'}</div>
          <div className="truncate text-xs text-muted" dir="ltr">
            {a.accountNumber || '—'}
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm font-bold">
          <input
            type="checkbox"
            checked={a.enabled}
            onChange={(e) => onChange({ enabled: e.target.checked })}
            className="h-5 w-5 accent-teal"
          />
          {a.enabled ? 'مفعّلة' : 'متوقّفة'}
        </label>
      </div>

      {!a.accountNumber.trim() && (
        <p className="mt-3 rounded-xl bg-warn/10 px-3 py-2 text-xs font-semibold text-warn">
          أضف الرقم الذي يدفع له الزبون، ثم فعّلها.
        </p>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="اسم الوسيلة">
          <input className={input} value={a.method} maxLength={40} onChange={(e) => onChange({ method: e.target.value })} />
        </Field>
        <Field label={a.kind === 'crypto' ? 'Binance Pay ID أو عنوان المحفظة' : 'الرقم الذي يدفع له الزبون'}>
          <input
            className={input + (missing ? ' border-bad' : '')}
            value={a.accountNumber}
            maxLength={120}
            dir="ltr"
            onChange={(e) => onChange({ accountNumber: e.target.value })}
            placeholder={a.kind === 'crypto' ? '123456789' : '22227268'}
          />
        </Field>
        <Field label="اسم صاحب الحساب (اختياري)">
          <input className={input} value={a.accountName} maxLength={80} onChange={(e) => onChange({ accountName: e.target.value })} />
        </Field>
        <Field label="النوع">
          <select className={input} value={a.kind} onChange={(e) => onChange({ kind: e.target.value as Kind })}>
            {KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="mt-3 flex flex-col gap-1.5">
        <span className="text-xs font-semibold text-muted">تظهر لزبائن</span>
        <div className="flex flex-wrap gap-1.5">
          {REGIONS.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => toggleCountry(r.id)}
              aria-pressed={a.countries.includes(r.id)}
              className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${
                a.countries.includes(r.id) ? 'bg-teal text-white' : 'surface-2 text-muted'
              }`}
            >
              {r.flag} {r.label}
            </button>
          ))}
        </div>
        {a.countries.length === 0 && (
          <p role="note" className="rounded-xl bg-warn/10 px-3 py-2 text-xs font-semibold text-warn">
            هذا الحساب يظهر في كل الدول — حدّد الدول.
          </p>
        )}
      </div>

      <div className="mt-3">
        <LogoPicker value={a.logo} name={a.method} onChange={(logo) => onChange({ logo })} />
      </div>

      <div className="mt-3">
        <Field label="تعليمات للزبون (اختياري)">
          <input
            className={input}
            value={a.instructions ?? ''}
            maxLength={300}
            onChange={(e) => onChange({ instructions: e.target.value })}
            placeholder="مثال: أرسل على شبكة TRC20 فقط"
          />
        </Field>
      </div>

      <div className="mt-3 flex justify-end">
        <button onClick={onRemove} className="text-xs font-bold text-bad hover:underline">
          حذف الوسيلة
        </button>
      </div>
    </div>
  );
}

/**
 * The owner's payment methods, by country: the number the customer pays to,
 * which countries see it, its logo, and whether it is on.
 */
export default function PaymentMethodsPage() {
  const { data, error, loading } = useFetch<Instructions>('/admin/payments/manual-accounts');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [note, setNote] = useState('');
  const [region, setRegion] = useState('MR');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!data) return;
    setAccounts(data.accounts);
    setNote(data.note ?? '');
  }, [data]);

  const shown = accounts
    .map((a, i) => ({ a, i }))
    .filter(({ a }) => a.countries.length === 0 || a.countries.includes(region));

  function update(i: number, patch: Partial<Account>) {
    setAccounts((list) => list.map((a, j) => (j === i ? { ...a, ...patch } : a)));
    setMsg(null);
  }

  function add() {
    setAccounts((list) => [
      ...list,
      { method: '', countries: [region], accountName: '', accountNumber: '', kind: 'mobile', enabled: false },
    ]);
    setMsg(null);
  }

  async function save() {
    const unnamed = accounts.find((a) => a.method.trim().length < 2);
    if (unnamed) return setMsg({ ok: false, text: 'اكتب اسم كل وسيلة دفع.' });
    const missing = accounts.find((a) => a.enabled && !a.accountNumber.trim());
    if (missing) return setMsg({ ok: false, text: `${missing.method}: أضف الرقم أو أوقفها.` });
    setSaving(true);
    setMsg(null);
    try {
      const saved = await api.put<Instructions>('/admin/payments/manual-accounts', {
        accounts: accounts.map((a) => ({
          ...(a.id && { id: a.id }),
          method: a.method.trim(),
          countries: a.countries,
          accountName: a.accountName.trim(),
          accountNumber: a.accountNumber.trim(),
          kind: a.kind,
          ...(a.logo && { logo: a.logo }),
          enabled: a.enabled,
          ...(a.instructions?.trim() && { instructions: a.instructions.trim() }),
        })),
        note: note.trim(),
      });
      setAccounts(saved.accounts);
      setNote(saved.note ?? '');
      setMsg({ ok: true, text: 'تم الحفظ. الزبائن يرون الوسائل المفعّلة الآن عند الدفع.' });
    } catch (e) {
      setMsg({
        ok: false,
        text:
          e instanceof ApiError && e.status === 403
            ? 'ليست لديك صلاحية تعديل الإعدادات.'
            : e instanceof ApiError
              ? e.message
              : 'تعذّر الحفظ.',
      });
    } finally {
      setSaving(false);
    }
  }

  const active = REGIONS.find((r) => r.id === region)!;

  return (
    <div className="flex flex-col gap-5 pb-24">
      <div>
        <h1 className="text-2xl font-extrabold">وسائل الدفع</h1>
        <p className="mt-1 text-sm text-muted">
          لكل دولة وسائلها. يحوّل الزبون إلى الرقم، ثم يرسل الرقم الذي حوّل منه وصورة التحويل، وتؤكّد أنت من صفحة الطلبات.
        </p>
      </div>

      {loading && !data && <p className="text-sm text-muted">جارٍ التحميل…</p>}
      {error && <p className="text-sm text-bad">{error}</p>}

      {data && (
        <>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            {REGIONS.map((r) => {
              const n = accounts.filter((a) => (a.countries.length === 0 || a.countries.includes(r.id)) && usable(a)).length;
              return (
                <button
                  key={r.id}
                  onClick={() => setRegion(r.id)}
                  aria-pressed={region === r.id}
                  className={`flex flex-none items-center gap-1.5 rounded-full px-4 py-2 text-sm font-bold transition ${
                    region === r.id ? 'bg-teal text-white' : 'surface text-muted shadow-card'
                  }`}
                >
                  {r.flag} {r.label}
                  <span className={`rounded-full px-1.5 text-xs ${region === r.id ? 'bg-white/20' : 'surface-2'}`}>{n}</span>
                </button>
              );
            })}
          </div>

          <p className="text-sm text-muted">
            {active.flag} زبائن {active.label} يرون الأسعار بـ<b className="text-[rgb(var(--text))]">{active.currency}</b>،
            ويدفعون بالوسائل المفعّلة هنا.
          </p>

          <div className="grid gap-4 lg:grid-cols-2">
            {shown.map(({ a, i }) => (
              <AccountCard
                key={a.id ?? `new-${i}`}
                a={a}
                onChange={(patch) => update(i, patch)}
                onRemove={() => {
                  if (confirm(`حذف ${a.method || 'هذه الوسيلة'}؟`)) setAccounts((list) => list.filter((_, j) => j !== i));
                }}
              />
            ))}
          </div>
          {shown.length === 0 && (
            <p className="rounded-2xl border border-dashed border-[rgb(var(--line))] p-8 text-center text-sm text-muted">
              لا توجد وسائل لهذه الدولة بعد.
            </p>
          )}

          <button
            onClick={add}
            className="rounded-2xl border border-dashed border-[rgb(var(--line))] py-3 text-sm font-bold text-muted transition hover:text-teal"
          >
            + إضافة وسيلة لـ{active.label}
          </button>

          <Field label="ملاحظة تظهر للزبون مع وسائل الدفع (اختياري)">
            <textarea
              className={input}
              rows={2}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="نؤكّد الدفع عادةً خلال 15 دقيقة من 9 صباحًا حتى منتصف الليل."
            />
          </Field>

          <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[rgb(var(--line))] bg-[rgb(var(--surface))] p-3 lg:static lg:border-0 lg:bg-transparent lg:p-0">
            {msg && <p className={`mb-2 text-center text-sm font-semibold ${msg.ok ? 'text-ok' : 'text-bad'}`}>{msg.text}</p>}
            <button
              onClick={save}
              disabled={saving}
              className="w-full rounded-xl bg-teal py-3 text-sm font-bold text-white transition hover:bg-teal-deep disabled:opacity-60"
            >
              {saving ? 'جارٍ الحفظ…' : 'حفظ وسائل الدفع'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
