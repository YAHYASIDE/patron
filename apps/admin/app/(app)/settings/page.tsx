'use client';

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
        <p className="mt-1 text-sm text-muted">حسابك الحالي وصلاحياتك.</p>
      </div>

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

      <div className="rounded-2xl border border-[rgb(var(--line))] bg-[rgb(var(--surface-2))] px-5 py-4 text-sm text-muted">
        <strong className="text-[rgb(var(--text))]">إعدادات النظام العامة</strong> (اسم المتجر،
        الضريبة، وضع الصيانة…) لا تملك بعد نقطة API في الـ backend الحالي. عند إضافة
        <span dir="ltr"> SystemSetting </span> endpoint، ستظهر هنا قابلة للتعديل. حالياً تُدار أسعار
        الصرف عبر مسار <span dir="ltr">admin/fx</span>.
      </div>
    </div>
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
