'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useFetch } from '@/lib/hooks';
import { money, num } from '@/lib/format';
import { countryName, flagOf } from '@/lib/countries';
import Notice from '@/components/Notice';

type Row = {
  country: string | null;
  city: string | null;
  customers: number;
  orders: number;
  revenue: string | number;
};
type Country = {
  country: string | null;
  customers: number;
  orders: number;
  revenue: number;
  cities: { city: string | null; customers: number; orders: number; revenue: number }[];
};

const n = (v: string | number) => parseFloat(String(v)) || 0;

/** Where the customers are: by country, then by city, from what they typed on their profile. */
export default function LocationsPage() {
  const { data, error, loading } = useFetch<Row[]>('/admin/insights/locations');

  const countries = useMemo<Country[]>(() => {
    const by = new Map<string, Country>();
    for (const r of data ?? []) {
      const key = r.country ?? '';
      const c = by.get(key) ?? { country: r.country, customers: 0, orders: 0, revenue: 0, cities: [] };
      c.customers += r.customers;
      c.orders += r.orders;
      c.revenue += n(r.revenue);
      c.cities.push({ city: r.city, customers: r.customers, orders: r.orders, revenue: n(r.revenue) });
      by.set(key, c);
    }
    const list = [...by.values()];
    list.forEach((c) => c.cities.sort((a, b) => b.customers - a.customers));
    // unknown country last, the rest by number of customers
    return list.sort((a, b) => (a.country ? 0 : 1) - (b.country ? 0 : 1) || b.customers - a.customers);
  }, [data]);

  const total = countries.reduce((s, c) => s + c.customers, 0);
  const known = countries.filter((c) => c.country).length;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/customers" className="text-sm font-semibold text-muted hover:text-[rgb(var(--text))]">
          ← الزبائن
        </Link>
        <h1 className="mt-2 text-2xl font-extrabold">مواقع الزبائن</h1>
        <p className="mt-1 text-sm text-muted">
          {data ? `${num(total)} زبون في ${num(known)} دولة` : 'حسب الدولة والمدينة'}، كما كتبها الزبون في
          حسابه.
        </p>
      </div>

      {error && <Notice text={error} />}
      {loading && !data && <p className="text-sm text-muted">جارٍ التحميل…</p>}
      {data && countries.length === 0 && (
        <div className="rounded-2xl border border-dashed border-[rgb(var(--line))] px-5 py-10 text-center text-sm text-muted">
          لا زبائن بعد.
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {countries.map((c) => {
          const share = total ? (100 * c.customers) / total : 0;
          return (
            <section
              key={c.country ?? 'none'}
              className="surface flex flex-col gap-3 rounded-2xl p-5 shadow-card"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="text-3xl leading-none" aria-hidden>
                    {flagOf(c.country)}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate font-extrabold">{countryName(c.country)}</div>
                    <div className="text-xs text-muted">
                      {num(c.orders)} طلب · {money(c.revenue)}
                    </div>
                  </div>
                </div>
                <div className="flex-none text-end">
                  <div className="tnum text-xl font-extrabold">{num(c.customers)}</div>
                  <div className="text-xs text-muted">زبون</div>
                </div>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full surface-2" aria-hidden>
                <div className="h-full rounded-full bg-teal" style={{ width: `${Math.max(2, share)}%` }} />
              </div>
              <ul className="flex flex-col divide-y divide-[rgb(var(--line))] text-sm">
                {c.cities.map((city) => (
                  <li key={city.city ?? 'none'} className="flex items-center justify-between gap-3 py-2">
                    <span className={city.city ? 'font-semibold' : 'text-muted'}>
                      {city.city ?? 'مدينة غير محددة'}
                    </span>
                    <span className="flex items-center gap-3 text-xs text-muted">
                      <span className="tnum">{num(city.orders)} طلب</span>
                      <span className="tnum min-w-12 text-end text-sm font-bold text-[rgb(var(--text))]">
                        {num(city.customers)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
