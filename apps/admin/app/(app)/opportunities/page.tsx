'use client';

import { useState } from 'react';
import Link from 'next/link';
import { opportunitiesPath, type OpportunityDays, type Opportunities } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { date, num } from '@/lib/format';
import Notice from '@/components/Notice';
import CopyButton from '@/components/CopyButton';
import PeriodSwitch from '@/components/PeriodSwitch';

const PERIODS = [
  { days: 7, label: 'آخر 7 أيام' },
  { days: 30, label: 'آخر 30 يومًا' },
  { days: 90, label: 'آخر 90 يومًا' },
] as const satisfies readonly { days: OpportunityDays; label: string }[];

const waLink = (phone: string) => `https://wa.me/${phone.replace(/\D/g, '')}`;
// a guest's contact may be a phone number or just a name
const looksLikePhone = (s: string) => /^[+\d\s().-]+$/.test(s) && s.replace(/\D/g, '').length >= 8;

function Section({
  title,
  hint,
  count,
  children,
}: {
  title: string;
  hint: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="surface flex min-w-0 flex-col rounded-2xl p-5 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-bold">{title}</h2>
        {count > 0 && <span className="tnum flex-none text-xs font-bold text-muted">{num(count)}</span>}
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted">{hint}</p>
      {children}
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="mt-4 rounded-xl surface-2 px-4 py-5 text-center text-sm text-muted">{text}</p>;
}

function WhatsApp({ phone }: { phone: string }) {
  return (
    <a
      href={waLink(phone)}
      target="_blank"
      rel="noopener noreferrer"
      className="flex-none whitespace-nowrap rounded-full bg-[#1FA855]/12 px-2.5 py-0.5 text-xs font-bold text-[#1FA855] hover:bg-[#1FA855]/20"
    >
      واتساب
    </a>
  );
}

/** What customers ask for and do not find: searches with no result, suggestions, dropped checkouts, popular brands. */
export default function OpportunitiesPage() {
  const [days, setDays] = useState<OpportunityDays>(30);
  const { data, error, loading } = useFetch<Opportunities>(opportunitiesPath(days));
  const maxViews = Math.max(1, ...(data?.mostViewed ?? []).map((b) => b.views));

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-extrabold">الفرص</h1>
        <p className="mt-1 text-sm text-muted">ما يطلبه زبائنك ولا تجده عندك. كل قسم يقول لك ماذا تفعل به.</p>
      </div>

      <PeriodSwitch options={PERIODS} value={days} onChange={setDays} />

      {error && <Notice text={error} />}
      {loading && !data && <p className="text-sm text-muted">جارٍ التحميل…</p>}

      {data && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Section
            title="بحثوا ولم يجدوا"
            hint="كلمات بحث لم تُظهر أي منتج. إن كان المنتج مطلوبًا فأضفه، وإن كان موجودًا باسم آخر فأضف هذه الكلمة إلى اسمه أو وصفه."
            count={data.searchMisses.length}
          >
            {data.searchMisses.length === 0 ? (
              <Empty text="لا شيء بعد — ستظهر هنا عمليات البحث التي لم تجد نتيجة." />
            ) : (
              <ul className="mt-3 flex flex-col divide-y divide-[rgb(var(--line))]">
                {data.searchMisses.map((m) => (
                  <li key={m.query} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <span className="min-w-0">
                      <span dir="auto" className="block break-words font-semibold [overflow-wrap:anywhere]">
                        {m.query}
                      </span>
                      <span className="block text-xs text-muted">
                        <span className="tnum font-bold">{num(m.count)}</span> مرة · آخر مرة {date(m.lastAt)}
                      </span>
                    </span>
                    {/* the products page has no search link yet: copy the words, then paste them in its search box */}
                    <CopyButton text={m.query} label="نسخ للبحث" />
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section
            title="اقتراحات الزبائن"
            hint="ما كتبه الزبائن أنهم يريدونه. إن أضفته، راسلهم ليعرفوا أنه صار متوفرًا."
            count={data.suggestions.length}
          >
            {data.suggestions.length === 0 ? (
              <Empty text="لا اقتراحات بعد — ستظهر هنا طلبات الزبائن لمنتجات غير موجودة." />
            ) : (
              <ul className="mt-3 flex flex-col divide-y divide-[rgb(var(--line))]">
                {data.suggestions.map((s) => {
                  const phone = s.user?.phone ?? (s.contact && looksLikePhone(s.contact) ? s.contact : null);
                  return (
                    <li key={s.id} className="flex flex-col gap-1.5 py-3 text-sm">
                      <p dir="auto" className="whitespace-pre-line break-words [overflow-wrap:anywhere]">
                        {s.text}
                      </p>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                        {s.user ? (
                          <Link
                            href={`/customers/${s.user.id}`}
                            className="font-bold text-teal hover:underline"
                          >
                            {s.user.fullName}
                          </Link>
                        ) : s.contact ? (
                          <span dir="auto" className="break-all font-semibold text-[rgb(var(--text))]">
                            {s.contact}
                          </span>
                        ) : (
                          <span>زائر بلا اسم</span>
                        )}
                        {phone && <WhatsApp phone={phone} />}
                        <span className="whitespace-nowrap">{date(s.createdAt)}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          <Section
            title="دخلوا الدفع ولم يكملوا"
            hint="زبائن فتحوا صفحة الدفع لهذه المنتجات ثم توقفوا. قد يكون السعر مرتفعًا، أو وسيلة الدفع التي يريدونها غير متوفرة. راجع السعر ووسائل الدفع."
            count={data.abandoned.length}
          >
            {data.abandoned.length === 0 ? (
              <Empty text="لا شيء بعد — ستظهر هنا المنتجات التي بدأ الزبائن دفعها ولم يكملوا." />
            ) : (
              <ul className="mt-3 flex flex-col divide-y divide-[rgb(var(--line))]">
                {data.abandoned.map((a) => (
                  <li key={a.productId}>
                    <Link
                      href={`/products/${a.productId}`}
                      className="flex items-center justify-between gap-3 py-2.5 text-sm hover:opacity-80"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{a.nameAr}</span>
                        <span className="block truncate text-xs text-muted" dir="ltr">
                          {a.sku}
                        </span>
                      </span>
                      <span className="flex-none text-end text-xs text-muted">
                        <span className="block whitespace-nowrap">
                          <span className="tnum font-bold text-warn">{num(a.checkouts)}</span> محاولة ·{' '}
                          <span className="tnum font-bold text-[rgb(var(--text))]">{num(a.customers)}</span>{' '}
                          زبون
                        </span>
                        <span className="block whitespace-nowrap">{date(a.lastAt)}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section
            title="الأكثر مشاهدة"
            hint="صفحات العلامات التي يزورها الناس أكثر. تأكّد أن منتجاتها متوفرة وأسعارها جيدة، وضعها في العروض."
            count={data.mostViewed.length}
          >
            {data.mostViewed.length === 0 ? (
              <Empty text="لا شيء بعد — ستظهر هنا صفحات العلامات الأكثر زيارة." />
            ) : (
              <ul className="mt-3 flex flex-col gap-3">
                {data.mostViewed.map((b) => (
                  <li key={b.brandKey} className="flex flex-col gap-1.5 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate font-semibold">{b.title || b.brandKey}</span>
                      <span className="flex-none whitespace-nowrap text-xs text-muted">
                        <span className="tnum font-bold text-[rgb(var(--text))]">{num(b.views)}</span> مشاهدة
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full surface-2" aria-hidden>
                      <div
                        className="h-full rounded-full bg-teal"
                        style={{ width: `${Math.max(2, (100 * b.views) / maxViews)}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}
