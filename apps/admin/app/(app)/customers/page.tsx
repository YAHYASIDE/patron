'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { date, money } from '@/lib/format';
import { countryName, flagOf } from '@/lib/countries';
import ExportButton from '@/components/ExportButton';
import { SegmentChips, SegmentFilter, VipSettings, type Segment } from '@/components/CustomerSegments';

type Customer = {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  phoneVerifiedAt: string | null;
  isBlocked: boolean;
  createdAt: string;
  paidOrders: number;
  totalSpentBase: string;
  lastOrderAt: string | null;
  country?: string | null;
  city?: string | null;
  tags?: string[];
  segments?: Segment[];
};
type Page = { data: Customer[]; meta: { page: number; pages: number; total: number } };

export default function CustomersPage() {
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [segment, setSegment] = useState<Segment | ''>('');
  const [res, setRes] = useState<Page | null>(null);
  const [error, setError] = useState<string | null>(null);

  // search as the owner types, without a request per keystroke
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(q.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const qs = new URLSearchParams({ role: 'customer', limit: '20', page: String(page) });
    if (segment) qs.set('segment', segment);
    // a typed number like "22 12 34 56" matches the stored +22222123456
    if (search) qs.set('search', /^[\d\s+]+$/.test(search) ? search.replace(/\s/g, '') : search);
    api
      .get<Page>(`/users?${qs.toString()}`)
      .then((r) => {
        setRes(r);
        setError(null);
      })
      .catch((e) =>
        setError(
          e instanceof ApiError && e.status === 403 ? 'ليست لديك صلاحية عرض الزبائن.' : 'تعذّر جلب الزبائن.',
        ),
      );
  }, [search, page, segment]);

  async function toggleBlock(c: Customer) {
    const reason = c.isBlocked ? undefined : prompt('سبب الإيقاف (لسجلّك):', 'إساءة استخدام');
    if (!c.isBlocked && reason === null) return;
    try {
      await api.patch(`/users/${c.id}/block`, {
        blocked: !c.isBlocked,
        ...(reason && reason.trim().length >= 3 && { reason: reason.trim() }),
      });
      setRes(
        (r) =>
          r && { ...r, data: r.data.map((x) => (x.id === c.id ? { ...x, isBlocked: !c.isBlocked } : x)) },
      );
    } catch {
      setError('تعذّر تغيير حالة الحساب.');
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">الزبائن</h1>
          <p className="mt-1 text-sm text-muted">
            {res ? `${res.meta.total} زبون` : 'كل من سجّل في المتجر'}، ومجموع ما اشتراه كلٌّ منهم.
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <Link
            href="/locations"
            className="rounded-xl border border-[rgb(var(--line))] px-4 py-2 text-sm font-bold hover:border-teal"
          >
            حسب الدولة والمدينة
          </Link>
          <ExportButton
            path="/admin/export/customers.csv"
            filename={`customers-${new Date().toLocaleDateString('en-CA')}.csv`}
            label="تصدير CSV"
          />
        </div>
      </div>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="ابحث بالاسم أو رقم واتساب"
        className="surface hairline rounded-xl border px-4 py-3 text-[15px] outline-none focus:border-teal"
      />

      <div className="flex flex-col gap-2">
        <SegmentFilter
          value={segment}
          onChange={(v) => {
            setSegment(v);
            setPage(1);
          }}
        />
        <VipSettings />
      </div>

      {error && (
        <div className="rounded-xl border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad">{error}</div>
      )}
      {!res && !error && <p className="text-sm text-muted">جارٍ التحميل…</p>}
      {res?.data.length === 0 && (
        <div className="rounded-2xl border border-dashed border-[rgb(var(--line))] px-5 py-10 text-center text-sm text-muted">
          {segment ? 'لا يوجد زبون في هذه الشريحة.' : 'لا يوجد زبون بهذا الاسم أو الرقم.'}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {res?.data.map((c) => (
          <section key={c.id} className="surface flex flex-col gap-3 rounded-2xl p-4 shadow-card">
            <div className="flex items-start justify-between gap-3">
              <Link href={`/customers/${c.id}`} className="min-w-0 hover:opacity-80">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-teal underline-offset-4 hover:underline">{c.fullName}</span>
                  {c.phoneVerifiedAt ? (
                    <span className="rounded-full bg-ok/12 px-2 py-0.5 text-[11px] font-bold text-ok">
                      موثّق
                    </span>
                  ) : (
                    <span className="rounded-full bg-warn/12 px-2 py-0.5 text-[11px] font-bold text-warn">
                      غير موثّق
                    </span>
                  )}
                  {c.isBlocked && (
                    <span className="rounded-full bg-bad/12 px-2 py-0.5 text-[11px] font-bold text-bad">
                      موقوف
                    </span>
                  )}
                  <SegmentChips segments={c.segments} />
                </div>
                <div dir="ltr" className="mt-0.5 text-right text-sm text-muted">
                  {c.phone ?? c.email}
                </div>
                {(c.country || (c.tags?.length ?? 0) > 0) && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                    {c.country && (
                      <span>
                        {flagOf(c.country)} {countryName(c.country)}
                        {c.city ? ` · ${c.city}` : ''}
                      </span>
                    )}
                    {c.tags?.map((t) => (
                      <span key={t} className="rounded-full bg-gold/15 px-2 py-0.5 font-bold text-gold-deep">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </Link>
              <div className="text-end">
                <div className="tnum text-lg font-extrabold">{money(c.totalSpentBase)}</div>
                <div className="text-xs text-muted">{c.paidOrders} طلب مدفوع</div>
              </div>
            </div>
            <div className="flex items-center justify-between text-xs text-muted">
              <span>انضمّ {date(c.createdAt)}</span>
              <span>{c.lastOrderAt ? `آخر طلب ${date(c.lastOrderAt)}` : 'لم يطلب بعد'}</span>
            </div>
            <div className="flex gap-2">
              {c.phone && (
                <a
                  href={`https://wa.me/${c.phone.replace(/\D/g, '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 rounded-xl bg-[#1FA855] py-2 text-center text-sm font-bold text-white"
                >
                  واتساب
                </a>
              )}
              <Link
                href={`/customers/${c.id}`}
                className="flex-1 rounded-xl border border-[rgb(var(--line))] py-2 text-center text-sm font-bold"
              >
                الملف
              </Link>
              <button
                onClick={() => toggleBlock(c)}
                className={
                  'rounded-xl border px-3 py-2 text-sm font-bold ' +
                  (c.isBlocked ? 'border-ok/40 text-ok' : 'border-bad/40 text-bad')
                }
              >
                {c.isBlocked ? 'إلغاء الإيقاف' : 'إيقاف'}
              </button>
            </div>
          </section>
        ))}
      </div>

      {res && res.meta.pages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="rounded-xl border border-[rgb(var(--line))] px-4 py-2 text-sm font-bold disabled:opacity-40"
          >
            السابق
          </button>
          <span className="tnum text-sm text-muted">
            {page} / {res.meta.pages}
          </span>
          <button
            disabled={page >= res.meta.pages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-xl border border-[rgb(var(--line))] px-4 py-2 text-sm font-bold disabled:opacity-40"
          >
            التالي
          </button>
        </div>
      )}
    </div>
  );
}
