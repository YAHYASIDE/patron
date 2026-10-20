'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { date, dateTime } from '@/lib/format';
import ExportButton from '@/components/ExportButton';
import Notice from '@/components/Notice';

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
        <p className="mt-1 text-sm text-muted">طرق استلام الدفع، ردود واتساب، النسخ الاحتياطي، وحسابك.</p>
      </div>

      <ShopWhatsapp />

      <PaymentAccounts />

      <QuickReplies />

      <Backup />

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

type Template = { id: string; title: string; body: string };

const MAX_TEMPLATES = 20;
const PLACEHOLDERS = [
  { k: '{name}', v: 'اسم الزبون', sample: 'محمد' },
  { k: '{order}', v: 'رقم الطلب', sample: 'PTN-20261019-01000015' },
  { k: '{link}', v: 'رابط صفحة الطلب في المتجر', sample: 'https://…/orders/…' },
];
const STARTERS: Omit<Template, 'id'>[] = [
  { title: 'استلمنا طلبك', body: 'مرحبًا {name}، استلمنا طلبك {order} وسنسلّمه لك خلال دقائق.' },
  { title: 'لم يصل التحويل', body: 'مرحبًا {name}، لم يصلنا تحويل الطلب {order} بعد. أرسل لنا صورة الإيصال من فضلك.' },
  { title: 'تم التسليم', body: 'مرحبًا {name}، طلبك {order} جاهز. تجده في صفحة طلبك: {link}' },
];

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const preview = (body: string) => PLACEHOLDERS.reduce((t, p) => t.replaceAll(p.k, p.sample), body);

/** Ready-made WhatsApp messages the order page fills in and opens in one tap. */
function QuickReplies() {
  const { data, error, loading } = useFetch<Template[]>('/admin/shop/templates');
  const [rows, setRows] = useState<Template[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (data) setRows(data);
  }, [data]);

  const edit = (id: string, patch: Partial<Template>) => {
    setRows((r) => r.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    setMsg(null);
  };

  async function save() {
    const clean = rows
      .map((t) => ({ ...t, title: t.title.trim(), body: t.body.trim() }))
      .filter((t) => t.title || t.body);
    if (clean.some((t) => !t.title || !t.body)) {
      setMsg({ ok: false, text: 'لكل رد عنوان ونص.' });
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const saved = await api.put<Template[]>('/admin/shop/templates', { templates: clean });
      setRows(Array.isArray(saved) ? saved : clean);
      setMsg({ ok: true, text: 'تم الحفظ. تظهر الردود في صفحة كل طلب.' });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'تعذّر الحفظ.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section id="quick-replies" className="surface scroll-mt-20 rounded-2xl p-5 shadow-card">
      <h2 className="text-base font-bold">ردود واتساب السريعة</h2>
      <p className="mt-1 text-sm text-muted">
        رسائل جاهزة تظهر في صفحة الطلب: اضغط على أحدها فيفتح واتساب الزبون والنص مكتوب. تُستبدل هذه الكلمات تلقائيًا:
      </p>
      <ul className="mt-2 flex flex-wrap gap-2 text-xs">
        {PLACEHOLDERS.map((p) => (
          <li key={p.k} className="surface-2 rounded-lg px-2.5 py-1">
            <code dir="ltr" className="font-bold text-teal">
              {p.k}
            </code>{' '}
            {p.v}
          </li>
        ))}
      </ul>

      {loading && <p className="mt-4 text-sm text-muted">جارٍ التحميل…</p>}
      {error && (
        <div className="mt-4">
          <Notice text={error} />
        </div>
      )}

      {!error && !loading && (
        <div className="mt-4 flex flex-col gap-3">
          {rows.length === 0 && (
            <div className="rounded-xl border border-dashed border-[rgb(var(--line))] p-4 text-center text-sm text-muted">
              لا ردود بعد.{' '}
              <button
                onClick={() => setRows(STARTERS.map((t) => ({ ...t, id: newId() })))}
                className="font-bold text-teal hover:underline"
              >
                ابدأ بثلاثة ردود مقترحة
              </button>
            </div>
          )}
          {rows.map((t, i) => (
            <div key={t.id} className="hairline flex flex-col gap-2 rounded-xl border p-3">
              <div className="flex items-center gap-2">
                <span className="tnum text-xs font-bold text-muted">{i + 1}</span>
                <input
                  value={t.title}
                  maxLength={40}
                  onChange={(e) => edit(t.id, { title: e.target.value })}
                  placeholder="العنوان (مثال: لم يصل التحويل)"
                  className="surface-2 hairline min-w-0 flex-1 rounded-xl border px-3 py-2 text-sm font-semibold outline-none focus:border-teal"
                />
                <button
                  onClick={() => setRows((r) => r.filter((x) => x.id !== t.id))}
                  className="rounded-lg px-2 py-1 text-xs font-bold text-bad hover:bg-bad/10"
                >
                  حذف
                </button>
              </div>
              <textarea
                rows={3}
                maxLength={1000}
                value={t.body}
                onChange={(e) => edit(t.id, { body: e.target.value })}
                placeholder="مرحبًا {name}، طلبك {order}…"
                className="surface-2 hairline w-full rounded-xl border px-3 py-2 text-sm outline-none focus:border-teal"
              />
              {t.body && <p className="text-xs text-muted">معاينة: {preview(t.body)}</p>}
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setRows((r) => [...r, { id: newId(), title: '', body: '' }])}
              disabled={rows.length >= MAX_TEMPLATES}
              className="rounded-xl border border-[rgb(var(--line))] px-4 py-2.5 text-sm font-bold hover:border-teal disabled:opacity-40"
            >
              + رد جديد
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="rounded-xl bg-teal px-5 py-2.5 text-sm font-bold text-white transition hover:bg-teal-deep disabled:opacity-60"
            >
              {saving ? 'جارٍ…' : 'حفظ الردود'}
            </button>
          </div>
          {msg && <p className={`text-sm font-semibold ${msg.ok ? 'text-ok' : 'text-bad'}`}>{msg.text}</p>}
        </div>
      )}
    </section>
  );
}

/** Full backup: the free database is deleted after about 30 days, so the owner keeps copies. */
function Backup() {
  const status = useFetch<{ lastBackupAt: string | null }>('/admin/backup/status');
  const last = status.data?.lastBackupAt;
  return (
    <section id="backup" className="surface flex scroll-mt-20 flex-col gap-3 rounded-2xl border-warn/40 p-5 shadow-card">
      <h2 className="text-base font-bold">نسخة احتياطية كاملة</h2>
      <div className="rounded-xl border border-warn/30 bg-warn/10 px-4 py-3 text-sm leading-relaxed text-warn">
        <b>مهم:</b> قاعدة البيانات المجانية على Render تُحذف بعد نحو 30 يومًا من إنشائها، ومعها كل الزبائن
        والطلبات والمنتجات. نزّل نسخة احتياطية بانتظام (مرة في الأسبوع على الأقل) واحفظها في مكان آمن، ورقِّ قاعدة
        البيانات إلى خطة مدفوعة على Render حتى لا تُحذف.
      </div>
      <p className="text-sm text-muted">
        ملف واحد يُعاد منه بناء المتجر كاملًا: الزبائن وأرصدة محافظهم بكل حركاتها، والطلبات والمدفوعات والاسترجاعات،
        والمنتجات والأسعار والعروض والقسائم والإعدادات، ومخزون الأكواد مشفّرًا كما هو محفوظ. لا يحتوي كلمات المرور ولا
        الصور المرفوعة. الأكواد فيه لا تُفتح إلا بمفتاح التشفير (ENCRYPTION_KEY) الذي أنشأته عند النشر: احفظ المفتاح
        في مكان آمن منفصل عن الملف.
      </p>
      <p className="text-sm font-semibold">
        {status.loading && !status.data
          ? '…'
          : last
            ? `آخر نسخة نُزّلت: ${dateTime(last)}`
            : 'لم تنزّل أي نسخة احتياطية بعد.'}
      </p>
      <div>
        <ExportButton
          primary
          path="/admin/backup"
          filename={`patron-backup-${new Date().toLocaleDateString('en-CA')}.json`}
          label="تنزيل نسخة احتياطية"
          onDone={status.reload}
        />
      </div>
    </section>
  );
}
