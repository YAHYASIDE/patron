'use client';

import { useFetch } from '@/lib/hooks';
import { num } from '@/lib/format';

type Currency = {
  code: string;
  nameAr: string;
  nameEn: string;
  symbol: string;
  decimals: number;
  isBase: boolean;
  isActive: boolean;
};

export default function CurrenciesPage() {
  // Public catalog endpoint; the fx controller has no "list all" route.
  const { data, error, loading } = useFetch<Currency[]>('/catalog/currencies');
  const list = Array.isArray(data) ? data : [];

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-extrabold">العملات</h1>
        <p className="mt-1 text-sm text-muted">
          العملات المدعومة في المتجر. الدولار هو العملة الأساس.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad">
          تعذّر جلب العملات: {error}
        </div>
      )}

      <div className="surface overflow-hidden rounded-2xl shadow-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="surface-2 text-muted">
                {['العملة', 'الرمز', 'الكود', 'المنازل العشرية', 'الدور'].map((h) => (
                  <th key={h} className="px-5 py-3 text-start text-xs font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-muted">
                    جارٍ التحميل…
                  </td>
                </tr>
              )}
              {list.map((c) => (
                <tr key={c.code} className="border-t hairline">
                  <td className="px-5 py-3 font-semibold">{c.nameAr}</td>
                  <td className="px-5 py-3 text-lg">{c.symbol}</td>
                  <td className="px-5 py-3 tnum text-muted" dir="ltr">
                    {c.code}
                  </td>
                  <td className="px-5 py-3 tnum">{num(c.decimals)}</td>
                  <td className="px-5 py-3">
                    {c.isBase ? (
                      <span className="rounded-full bg-teal/12 px-2.5 py-1 text-xs font-bold text-teal">
                        الأساس
                      </span>
                    ) : (
                      <span className="rounded-full bg-ink-400/15 px-2.5 py-1 text-xs font-bold text-muted">
                        مُحوّلة
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
