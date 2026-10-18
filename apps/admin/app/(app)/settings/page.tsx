'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { date } from '@/lib/format';

type Me = {
  id: string;
  email: string;
  fullName?: string;
  locale?: string;
  defaultCurrency?: string;
  createdAt?: string;
  roles?: string[];
  wallets?: Array<{ currencyCode: string; balance: string | number }>;
};

type Account = {
  id?: string;
  method: string;
  country?: string;
  accountName: string;
  accountNumber: string;
  instructions?: string;
};
type Instructions = { accounts: Account[]; note: string | null };

// Common transfer methods, grouped by country. The owner can also type any other name.
const PRESETS: { country: string; label: string; methods: string[] }[] = [
  { country: 'MR', label: 'موريتانيا', methods: ['Bankily', 'Masrvi', 'Sedad', 'Click', 'BimBank'] },
  { country: 'SN', label: 'السنغال', methods: ['Wave', 'Orange Money', 'Free Money'] },
  { country: 'MA', label: 'المغرب', methods: ['CashPlus', 'Wafacash'] },
  { country: 'DZ', label: 'الجزائر', methods: ['BaridiMob', 'CCP'] },
  { country: 'EG', label: 'مصر', methods: ['Vodafone Cash', 'InstaPay'] },
  { country: 'SA', label: 'السعودية', methods: ['STC Pay'] },
  { country: '', label: 'عام', methods: ['تحويل بنكي', 'Western Union'] },
];
const COUNTRY_LABEL: Record<string, string> = Object.fromEntries(PRESETS.map((p) => [p.country, p.label]));

const input =
  'surface-2 hairline w-full rounded-xl border px-3.5 py-2.5 text-[15px] outline-none transition focus:border-teal';

export default function SettingsPage() {
  const { data, error, loading } = useFetch<Me>('/auth/me');

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-extrabold">الإعدادات</h1>
        <p className="mt-1 text-sm text-muted">طرق استلام الدفع، وحسابك.</p>
      </div>

      <PaymentAccounts />

      {error && (
        <div className="rounded-xl border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad">
          {error}
        </div>
      )}

      <section className="surface rounded-2xl p-5 shadow-card">
        <h2 className="text-base font-bold">الحساب</h2>
        {loading ? (
          <p className="mt-3 text-sm text-muted">جارٍ التحميل…</p>
        ) : (
          <dl className="mt-4 flex flex-col divide-y divide-[rgb(var(--line))]">
            <Row k="الاسم" v={data?.fullName ?? '—'} />
            <Row k="البريد" v={data?.email ?? '—'} dir="ltr" />
            <Row k="العملة الافتراضية" v={data?.defaultCurrency ?? '—'} />
            <Row k="اللغة" v={data?.locale ?? '—'} />
            <Row
              k="الصلاحيات"
              v={data?.roles?.length ? data.roles.join('، ') : '—'}
            />
            <Row k="تاريخ الإنشاء" v={date(data?.createdAt)} />
          </dl>
        )}
      </section>
    </div>
  );
}

function PaymentAccounts() {
  const { data, error, loading } = useFetch<Instructions>('/admin/payments/manual-accounts');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!data) return;
    setAccounts(data.accounts);
    setNote(data.note ?? '');
  }, [data]);

  function update(i: number, patch: Partial<Account>) {
    setAccounts((list) => list.map((a, j) => (j === i ? { ...a, ...patch } : a)));
    setMsg(null);
  }

  function add(method = '', country = 'MR') {
    setAccounts((list) => [...list, { method, country, accountName: '', accountNumber: '' }]);
    setMsg(null);
  }

  async function save() {
    const bad = accounts.findIndex(
      (a) => a.method.trim().length < 2 || a.accountName.trim().length < 2 || a.accountNumber.trim().length < 2,
    );
    if (bad >= 0) {
      setMsg({ ok: false, text: `أكمل الطريقة واسم صاحب الحساب والرقم في الحساب رقم ${bad + 1}.` });
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const saved = await api.put<Instructions>('/admin/payments/manual-accounts', {
        accounts: accounts.map((a) => ({
          ...(a.id && { id: a.id }),
          method: a.method.trim(),
          ...(a.country && { country: a.country }),
          accountName: a.accountName.trim(),
          accountNumber: a.accountNumber.trim(),
          ...(a.instructions?.trim() && { instructions: a.instructions.trim() }),
        })),
        note: note.trim(),
      });
      setAccounts(saved.accounts);
      setNote(saved.note ?? '');
      setMsg({
        ok: true,
        text: saved.accounts.length
          ? 'تم الحفظ. الزبائن يرون هذه الحسابات الآن عند الدفع.'
          : 'تم الحفظ. لا توجد حسابات، فالتحويل اليدوي مخفي عن الزبائن.',
      });
    } catch (e) {
      setMsg({
        ok: false,
        text: e instanceof ApiError && e.status === 403 ? 'ليست لديك صلاحية تعديل الإعدادات.' : e instanceof ApiError ? e.message : 'تعذّر الحفظ.',
      });
    } finally {
      setSaving(false);
    }
  }

  const used = new Set(accounts.map((a) => a.method));

  return (
    <section className="surface rounded-2xl p-5 shadow-card">
      <h2 className="text-base font-bold">حسابات التحويل (الدفع اليدوي)</h2>
      <p className="mt-1 text-sm text-muted">
        يحوّل الزبون المبلغ إلى أحد هذه الحسابات ويكتب رقم العملية، ثم تؤكّد أنت الدفع من صفحة الطلبات.
      </p>

      {loading && !data && <p className="mt-4 text-sm text-muted">جارٍ التحميل…</p>}
      {error && <p className="mt-4 text-sm text-bad">{error}</p>}

      {data && (
        <>
          <div className="mt-4">
            <div className="text-xs font-semibold text-muted">إضافة سريعة</div>
            <div className="mt-2 flex flex-col gap-2">
              {PRESETS.map((p) => (
                <div key={p.country || 'any'} className="flex flex-wrap items-center gap-1.5">
                  <span className="w-20 text-xs text-muted">{p.label}</span>
                  {p.methods.map((m) => (
                    <button
                      key={m}
                      disabled={used.has(m)}
                      onClick={() => add(m, p.country)}
                      className="surface-2 rounded-full px-3 py-1 text-xs font-bold transition hover:text-teal disabled:opacity-40"
                    >
                      + {m}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-3">
            {accounts.length === 0 && (
              <p className="rounded-xl border border-dashed border-[rgb(var(--line))] px-4 py-5 text-center text-sm text-muted">
                لا توجد حسابات بعد. اختر طريقة من الأعلى وأضف رقم حسابك.
              </p>
            )}
            {accounts.map((a, i) => (
              <div key={a.id ?? `new-${i}`} className="surface-2 flex flex-col gap-2.5 rounded-xl p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold">
                    {a.method || 'حساب جديد'}
                    {a.country ? <span className="ms-1.5 text-xs font-semibold text-muted">· {COUNTRY_LABEL[a.country] ?? a.country}</span> : null}
                  </span>
                  <button
                    onClick={() => setAccounts((list) => list.filter((_, j) => j !== i))}
                    className="text-xs font-bold text-bad hover:underline"
                  >
                    حذف
                  </button>
                </div>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  <Field label="الطريقة">
                    <input className={input} value={a.method} maxLength={40} onChange={(e) => update(i, { method: e.target.value })} placeholder="Bankily" />
                  </Field>
                  <Field label="الدولة">
                    <select className={input} value={a.country ?? ''} onChange={(e) => update(i, { country: e.target.value || undefined })}>
                      {PRESETS.map((p) => (
                        <option key={p.country || 'any'} value={p.country}>
                          {p.country ? p.label : 'كل الدول'}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="اسم صاحب الحساب">
                    <input className={input} value={a.accountName} maxLength={80} onChange={(e) => update(i, { accountName: e.target.value })} />
                  </Field>
                  <Field label="رقم الحساب / الهاتف">
                    <input className={input} value={a.accountNumber} maxLength={60} dir="ltr" onChange={(e) => update(i, { accountNumber: e.target.value })} placeholder="22 00 00 00" />
                  </Field>
                </div>
                <Field label="تعليمات إضافية (اختياري)">
                  <input
                    className={input}
                    value={a.instructions ?? ''}
                    maxLength={300}
                    onChange={(e) => update(i, { instructions: e.target.value })}
                    placeholder="مثال: اكتب رقم طلبك في ملاحظة التحويل"
                  />
                </Field>
              </div>
            ))}
            <button
              onClick={() => add()}
              className="rounded-xl border border-dashed border-[rgb(var(--line))] py-2.5 text-sm font-bold text-muted transition hover:text-teal"
            >
              + حساب بطريقة أخرى
            </button>
          </div>

          <div className="mt-4">
            <Field label="ملاحظة تظهر للزبون مع الحسابات (اختياري)">
              <textarea
                className={input}
                rows={2}
                maxLength={500}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="نؤكّد الدفع عادةً خلال 15 دقيقة من 9 صباحًا حتى منتصف الليل."
              />
            </Field>
          </div>

          {msg && <p className={`mt-3 text-sm font-semibold ${msg.ok ? 'text-ok' : 'text-bad'}`}>{msg.text}</p>}

          <button
            onClick={save}
            disabled={saving}
            className="mt-4 w-full rounded-xl bg-teal py-3 text-sm font-bold text-white transition hover:bg-teal-deep disabled:opacity-60"
          >
            {saving ? 'جارٍ الحفظ…' : 'حفظ حسابات التحويل'}
          </button>
        </>
      )}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-muted">{label}</span>
      {children}
    </label>
  );
}

function Row({ k, v, dir }: { k: string; v: string; dir?: 'ltr' | 'rtl' }) {
  return (
    <div className="flex items-center justify-between py-3">
      <dt className="text-sm text-muted">{k}</dt>
      <dd className="text-sm font-semibold" dir={dir}>
        {v}
      </dd>
    </div>
  );
}
