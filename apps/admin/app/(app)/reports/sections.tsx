'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import type { ReportPayGateway, ReportSummary } from '@/lib/api';
import { date, money, num } from '@/lib/format';
import { countryName, flagOf } from '@/lib/countries';
import { PAY_LOGOS } from '@/lib/paylogos';
import PayLogo from '@/components/PayLogo';

/** Pieces of the owner's reports page. Money is in dollars (the base currency). */

export const n = (v: string | number | null | undefined) => parseFloat(String(v ?? 0)) || 0;
const waLink = (phone: string) => `https://wa.me/${phone.replace(/\D/g, '')}`;

export function Card({
  title,
  hint,
  aside,
  children,
  className = '',
}: {
  title: string;
  hint?: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`surface min-w-0 rounded-2xl p-4 shadow-card sm:p-5 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <h2 className="text-base font-extrabold">{title}</h2>
          {hint && <p className="mt-0.5 text-xs leading-5 text-muted">{hint}</p>}
        </div>
        {aside}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="surface-2 rounded-xl px-3.5 py-3 text-sm leading-6 text-muted">{children}</p>;
}

/** A share of the whole: one hue for every row, the track a lighter step of it. */
export function Bar({ pct, label }: { pct: number; label: string }) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-teal/12" role="img" aria-label={label}>
      <div
        className="h-full rounded-full bg-teal dark:bg-teal-soft"
        style={{ width: `${w}%`, minWidth: w > 0 ? 3 : 0 }}
      />
    </div>
  );
}

// ─────────────── today's profit ───────────────

export function TodayHero({ today }: { today: ReportSummary['today'] }) {
  const profit = n(today.profit);
  const now = new Date().toLocaleDateString('ar-EG-u-nu-latn', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
  return (
    <section className="relative overflow-hidden rounded-2xl bg-teal-ink p-5 text-white shadow-card sm:p-6">
      {/* a soft glow, no data in it */}
      <div
        aria-hidden
        className="pointer-events-none absolute -end-24 -top-24 h-64 w-64 rounded-full bg-teal-soft/20 blur-3xl"
      />
      <div className="relative grid gap-5 lg:grid-cols-[1fr_1.1fr] lg:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[15px] font-bold text-white/80">ربح اليوم</h2>
            <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white/80">
              {now}
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span
              className={`text-[52px] font-extrabold leading-none tracking-tight sm:text-[64px] ${profit < 0 ? 'text-[#fca5a5]' : ''}`}
            >
              {num(profit, 2)}
            </span>
            <span className="text-2xl font-bold text-gold-soft">$</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-white/75">
            <span>
              المبيعات <b className="tnum text-white">{money(today.revenue)}</b>{' '}
              <span className="text-[11.5px] text-white/55">صافي بعد الاسترجاع</span>
            </span>
            <span>
              التكلفة <b className="tnum text-white">{money(today.cost)}</b>
            </span>
            <span>
              <b className="tnum text-white">{today.orders}</b> طلب مدفوع
            </span>
          </div>
        </div>

        <div className="min-w-0 rounded-xl bg-white/[0.06] p-3 ring-1 ring-white/10">
          <div className="px-1 text-xs font-bold text-white/70">النقد الذي وصلك اليوم، حسب التطبيق</div>
          {today.cashByMethod.length === 0 ? (
            <p className="px-1 pt-2 text-sm text-white/70">لم يصل أي نقد اليوم بعد.</p>
          ) : (
            <ul className="mt-1 divide-y divide-white/10">
              {today.cashByMethod.map((m) => (
                <li key={m.method} className="flex items-center gap-3 px-1 py-2">
                  <MethodLogo gateway={m.gateway} logo={m.logo} name={m.method} size={34} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold">{m.method}</div>
                    <div className="text-[11.5px] text-white/65">
                      <span className="tnum">{m.orders}</span> طلب
                    </div>
                  </div>
                  <div className="tnum text-base font-extrabold">{money(m.amount)}</div>
                </li>
              ))}
            </ul>
          )}
          {/* wallet payments spend a balance topped up earlier: not today's cash */}
          {today.walletUsed.orders > 0 && (
            <p className="mt-1 border-t border-white/10 px-1 pt-2 text-[11.5px] leading-5 text-white/60">
              دُفع من أرصدة المحافظ: <span className="tnum font-bold">{money(today.walletUsed.amount)}</span>{' '}
              في <span className="tnum">{today.walletUsed.orders}</span> طلبات (رصيد سابق، ليس نقدًا جديدًا)
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

// ─────────────── KPIs ───────────────

export function Kpi({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'ok' | 'bad';
}) {
  return (
    <div className="surface min-w-0 rounded-2xl p-3.5 shadow-card sm:p-4">
      <div className="text-[12.5px] font-semibold text-muted">{label}</div>
      <div
        className={`mt-1 text-[1.3rem] font-extrabold leading-tight [overflow-wrap:anywhere] sm:text-2xl ${
          tone === 'ok' ? 'text-ok' : tone === 'bad' ? 'text-bad' : ''
        }`}
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-[11.5px] leading-4 text-muted">{hint}</div>}
    </div>
  );
}

// ─────────────── payment apps ───────────────

function guessLogo(name: string): string | undefined {
  const key = name.toLowerCase().replace(/\s+/g, '');
  if (PAY_LOGOS[key]) return key;
  const first = name.toLowerCase().split(/\s+/)[0];
  return PAY_LOGOS[first] ? first : undefined;
}

function Glyph({ size, children, label }: { size: number; children: ReactNode; label: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      style={{ width: size, height: size }}
      className="grid flex-none place-items-center rounded-xl bg-teal text-white ring-1 ring-black/5"
    >
      <svg
        viewBox="0 0 24 24"
        width={size * 0.56}
        height={size * 0.56}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {children}
      </svg>
    </span>
  );
}

/** The app's logo for a transfer; a drawn mark for the wallet and cards. */
export function MethodLogo({
  gateway,
  logo,
  name,
  size = 40,
}: {
  gateway: ReportPayGateway;
  logo: string | null;
  name: string;
  size?: number;
}) {
  if (gateway === 'WALLET')
    return (
      <Glyph size={size} label={name}>
        <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18v3" />
        <path d="M3 7.5V17a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H5.5A2.5 2.5 0 0 1 3 7.5Z" />
        <path d="M16 13.5h.01" />
      </Glyph>
    );
  if (gateway === 'CARD')
    return (
      <Glyph size={size} label={name}>
        <rect x="3" y="5.5" width="18" height="13" rx="2" />
        <path d="M3 10h18M7 15h3" />
      </Glyph>
    );
  return <PayLogo logo={logo ?? guessLogo(name)} name={name} size={size} />;
}

export function Methods({ rows }: { rows: ReportSummary['byMethod'] }) {
  if (rows.length === 0) return <Empty>لا مدفوعات في هذه الفترة.</Empty>;
  return (
    <ul className="flex flex-col gap-3.5">
      {rows.map((m) => (
        <li key={m.method} className="flex items-center gap-3">
          <MethodLogo gateway={m.gateway} logo={m.logo} name={m.method} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-sm font-bold">{m.method}</span>
              <span className="tnum flex-none text-sm font-extrabold">{money(m.revenue)}</span>
            </div>
            <div className="mt-1.5">
              <Bar pct={m.share} label={`${m.method}: ${num(m.share, 1)}% من المبيعات`} />
            </div>
            <div className="mt-1 flex justify-between gap-2 text-[11.5px] text-muted">
              <span>
                <span className="tnum">{m.orders}</span> طلب
              </span>
              <span className="tnum">{num(m.share, 1)}%</span>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ─────────────── best customers ───────────────

function Rank({ i }: { i: number }) {
  return (
    <span
      className={`grid h-7 w-7 flex-none place-items-center rounded-full text-xs font-extrabold tnum ${
        i === 0 ? 'bg-gold/20 text-gold-deep dark:text-gold-soft' : 'surface-2 text-muted'
      }`}
    >
      {i + 1}
    </span>
  );
}

export function Customers({ rows }: { rows: ReportSummary['topCustomers'] }) {
  if (rows.length === 0) return <Empty>لا زبائن اشتروا في هذه الفترة.</Empty>;
  return (
    <ol className="flex flex-col divide-y divide-[rgb(var(--line))]">
      {rows.map((c, i) => (
        <li key={c.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
          <Rank i={i} />
          <div className="min-w-0 flex-1">
            <Link href={`/customers/${c.id}`} className="flex min-w-0 items-center gap-1.5 hover:text-teal">
              <span aria-label={countryName(c.country)} title={countryName(c.country)} className="flex-none">
                {flagOf(c.country)}
              </span>
              <span className="truncate text-sm font-bold">{c.fullName}</span>
              {/* two customers can share a name: the phone's last digits tell them apart */}
              {c.phone && (
                <span dir="ltr" className="tnum flex-none text-[11.5px] font-normal text-muted">
                  ••{c.phone.replace(/\D/g, '').slice(-4)}
                </span>
              )}
            </Link>
            <div className="mt-0.5 text-[11.5px] text-muted">
              <span className="tnum">{c.orders}</span> طلب · آخر طلب {date(c.lastOrderAt)}
            </div>
          </div>
          <div className="flex-none text-end">
            <div className="tnum text-sm font-extrabold">{money(c.spent)}</div>
            <div className={`tnum text-[11.5px] font-semibold ${n(c.profit) >= 0 ? 'text-ok' : 'text-bad'}`}>
              ربح {money(c.profit)}
            </div>
          </div>
          {c.phone ? (
            <a
              href={waLink(c.phone)}
              target="_blank"
              rel="noreferrer"
              aria-label={`واتساب ${c.fullName}`}
              title="واتساب"
              className="grid h-9 w-9 flex-none place-items-center rounded-xl bg-[#25D366]/12 text-[#128C7E] transition hover:bg-[#25D366]/20 dark:text-[#25D366]"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden>
                <path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.64.07-.3-.15-1.26-.46-2.39-1.48-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.6.13-.14.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.5h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.08c.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.22 1.36.19 1.87.12.57-.09 1.76-.72 2-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35ZM12.04 21.5h-.01a9.4 9.4 0 0 1-4.8-1.32l-.34-.2-3.57.94.95-3.48-.22-.36A9.43 9.43 0 1 1 12.04 21.5Zm8.02-17.45A11.3 11.3 0 0 0 12.04.73C5.8.73.72 5.8.72 12.05c0 2 .52 3.94 1.51 5.65L.62 23.6l6.03-1.58a11.3 11.3 0 0 0 5.4 1.37h.01c6.24 0 11.32-5.08 11.32-11.32 0-3.03-1.18-5.87-3.32-8.01Z" />
              </svg>
            </a>
          ) : (
            <span className="h-9 w-9 flex-none" aria-hidden />
          )}
        </li>
      ))}
    </ol>
  );
}

// ─────────────── best sellers ───────────────

export function Products({ rows }: { rows: ReportSummary['topProducts'] }) {
  if (rows.length === 0) return <Empty>لم يُبع أي منتج في هذه الفترة.</Empty>;
  const max = Math.max(...rows.map((p) => p.units), 1);
  return (
    <ol className="flex flex-col gap-3">
      {rows.map((p, i) => (
        <li key={p.productId} className="flex items-start gap-3">
          <Rank i={i} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <Link
                href={`/products/${p.productId}`}
                className="min-w-0 truncate text-sm font-bold hover:text-teal"
              >
                {p.nameAr}
              </Link>
              <span className="flex-none text-sm">
                <b className="tnum text-base font-extrabold">{p.units}</b>{' '}
                <span className="text-[11.5px] text-muted">مُباع</span>
              </span>
            </div>
            <div className="mt-1.5">
              <Bar pct={(100 * p.units) / max} label={`${p.nameAr}: ${p.units} مُباع`} />
            </div>
            <div className="mt-1 flex flex-wrap justify-between gap-x-3 text-[11.5px] text-muted">
              <span dir="ltr" className="truncate">
                {p.sku}
              </span>
              <span>
                مبيعات <span className="tnum font-semibold text-[rgb(var(--text))]">{money(p.revenue)}</span>{' '}
                · ربح{' '}
                <span className={`tnum font-semibold ${n(p.profit) >= 0 ? 'text-ok' : 'text-bad'}`}>
                  {money(p.profit)}
                </span>
              </span>
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

// ─────────────── losses ───────────────

function LossLine({
  title,
  note,
  value,
  tone = 'bad',
  children,
}: {
  title: string;
  note: string;
  value: string;
  tone?: 'bad' | 'warn';
  children?: ReactNode;
}) {
  const on = n(value) > 0;
  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={`text-sm font-bold ${on && tone === 'warn' ? 'text-warn' : ''}`}>{title}</div>
          <div className="mt-0.5 text-[11.5px] leading-4 text-muted">{note}</div>
        </div>
        <div
          className={`tnum flex-none text-base font-extrabold ${on ? (tone === 'warn' ? 'text-warn' : 'text-bad') : 'text-muted'}`}
        >
          {money(value)}
        </div>
      </div>
      {children}
    </div>
  );
}

/**
 * The only loss is a sale under its cost. Refunds are already off the sales (shown
 * for the record, never added again) and money still owed to customers is a debt to
 * settle, not a loss.
 */
export function Losses({ losses }: { losses: ReportSummary['losses'] }) {
  const owed = losses.owed;
  return (
    <div>
      {n(losses.total) === 0 && (
        <p className="mb-3 rounded-xl bg-ok/10 px-3.5 py-2.5 text-sm font-semibold text-ok">
          لا خسائر في هذه الفترة.
        </p>
      )}
      <div className="flex flex-col divide-y divide-[rgb(var(--line))]">
        <LossLine
          title="بيع بأقل من التكلفة"
          note="منتجات بعتها بسعر أقل مما كلّفتك (محسوبة في الربح أعلاه)"
          value={losses.belowCostTotal}
        >
          {losses.belowCost.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1.5">
              {losses.belowCost.map((p) => (
                <li key={p.productId} className="surface-2 flex items-center gap-2 rounded-xl px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-bold">{p.nameAr}</div>
                    <div className="text-[11.5px] text-muted">
                      <span className="tnum">{p.units}</span> مُباع · خسارة{' '}
                      <span className="tnum font-semibold text-bad">{money(p.loss)}</span>
                    </div>
                  </div>
                  <Link
                    href={`/products/${p.productId}`}
                    className="flex-none rounded-lg bg-teal px-3 py-1.5 text-xs font-bold text-white hover:bg-teal-deep"
                  >
                    عدّل السعر
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </LossLine>
        <LossLine
          title="مستحق للزبائن (لم يُسلَّم ولم يُسترجع)"
          note={owed.count ? `${owed.count} طلب مدفوع فشل أو أُلغي، بعد خصم ما أُعيد منها` : 'لا يوجد'}
          value={owed.value}
          tone="warn"
        >
          {owed.count > 0 && (
            <Link
              href="/orders?status=FAILED"
              className="mt-1.5 inline-block text-xs font-bold text-warn hover:underline"
            >
              سلّمها أو أرجِع المال ←
            </Link>
          )}
        </LossLine>
      </div>
      <p className="surface-2 mt-3 rounded-xl px-3.5 py-2.5 text-[12.5px] leading-5 text-muted">
        {losses.refundCount > 0 ? (
          <>
            أُعيد للزبائن: <span className="tnum font-semibold">{money(losses.refunds)}</span> في{' '}
            <span className="tnum">{losses.refundCount}</span> عملية — مخصوم من المبيعات
          </>
        ) : (
          'لم تُرجِع أي مبلغ للزبائن في هذه الفترة.'
        )}
      </p>
    </div>
  );
}

// ─────────────── by country ───────────────

export function Countries({ rows, total }: { rows: ReportSummary['byCountry']; total: number }) {
  if (rows.length === 0) return <Empty>لا مبيعات في هذه الفترة.</Empty>;
  return (
    <ul className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
      {rows.map((c) => {
        const share = total > 0 ? (100 * n(c.revenue)) / total : 0;
        const name = countryName(c.country);
        return (
          <li key={c.country ?? '—'} className="flex items-center gap-3">
            <span className="flex-none text-2xl leading-none" aria-hidden>
              {flagOf(c.country)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-bold">{name}</span>
                <span className="tnum flex-none text-sm font-extrabold">{money(c.revenue)}</span>
              </div>
              <div className="mt-1.5">
                <Bar pct={share} label={`${name}: ${num(share, 1)}% من المبيعات`} />
              </div>
              <div className="mt-1 flex justify-between gap-2 text-[11.5px] text-muted">
                <span>
                  <span className="tnum">{c.orders}</span> طلب
                </span>
                <span className="tnum">{num(share, 1)}%</span>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
