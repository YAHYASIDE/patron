'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
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


export default function SettingsPage() {
  const { data, error, loading } = useFetch<Me>('/auth/me');

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-extrabold">الإعدادات</h1>
        <p className="mt-1 text-sm text-muted">طرق استلام الدفع، وحسابك.</p>
      </div>

      <ShopWhatsapp />

      <PaymentAccounts />

      {error && (
        <div className="rounded-xl border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad">{error}</div>
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
            <Row k="الصلاحيات" v={data?.roles?.length ? data.roles.join('، ') : '—'} />
            <Row k="تاريخ الإنشاء" v={date(data?.createdAt)} />
          </dl>
        )}
      </section>
    </div>
  );
}

/** The shop's WhatsApp: customers in a hurry message it (with their name and number filled in). */
function ShopWhatsapp() {
  const { data, error } = useFetch<{ supportWhatsapp: string | null }>('/shop/info');
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (data) setValue(data.supportWhatsapp ?? '');
  }, [data]);

  async function save() {
    // "00222 22 22 72 68" and "+222 22227268" both become +22222227268
    const normalized = value.trim() ? '+' + value.replace(/\D/g, '').replace(/^00/, '') : '';
    if (normalized && !/^\+[1-9]\d{7,14}$/.test(normalized)) {
      setMsg({ ok: false, text: 'اكتب الرقم مع رمز الدولة، مثال: 22222227268+' });
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const saved = await api.put<{ supportWhatsapp: string | null }>('/admin/shop/info', {
        supportWhatsapp: normalized,
      });
      setValue(saved.supportWhatsapp ?? '');
      setMsg({
        ok: true,
        text: saved.supportWhatsapp ? 'تم الحفظ. يظهر زر واتساب للزبائن.' : 'تم الحفظ. زر واتساب مخفي.',
      });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'تعذّر الحفظ.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="surface rounded-2xl p-5 shadow-card">
      <h2 className="text-base font-bold">واتساب المتجر</h2>
      <p className="mt-1 text-sm text-muted">
        يظهر للزبون زر «مستعجل؟ راسلنا على واتساب» برسالة جاهزة فيها اسمه ورقمه وحالة حسابه. اتركه فارغًا
        لإخفاء الزر.
      </p>
      {error && <p className="mt-3 text-sm text-bad">{error}</p>}
      <div className="mt-4 flex gap-2">
        <input
          dir="ltr"
          inputMode="tel"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setMsg(null);
          }}
          placeholder="+22222227268"
          className="surface-2 hairline min-w-0 flex-1 rounded-xl border px-3.5 py-2.5 text-[15px] outline-none transition focus:border-teal"
        />
        <button
          onClick={save}
          disabled={saving || !data}
          className="rounded-xl bg-teal px-5 text-sm font-bold text-white transition hover:bg-teal-deep disabled:opacity-60"
        >
          {saving ? 'جارٍ…' : 'حفظ'}
        </button>
      </div>
      {msg && <p className={`mt-3 text-sm font-semibold ${msg.ok ? 'text-ok' : 'text-bad'}`}>{msg.text}</p>}
    </section>
  );
}

/** Payment methods moved to their own page, grouped by country. */
function PaymentAccounts() {
  return (
    <section className="surface flex flex-wrap items-center justify-between gap-3 rounded-2xl p-5 shadow-card">
      <div>
        <h2 className="text-base font-bold">وسائل الدفع</h2>
        <p className="mt-1 text-sm text-muted">أرقام التحويل لكل دولة، وشعار كل تطبيق، وتفعيله أو إيقافه.</p>
      </div>
      <Link href="/payment-methods" className="rounded-xl bg-teal px-5 py-2.5 text-sm font-bold text-white hover:bg-teal-deep">
        إدارة وسائل الدفع
      </Link>
    </section>
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
