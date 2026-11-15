'use client';

import { useEffect, useState } from 'react';
import { api, ApiError, NOT_READY } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { money, num } from '@/lib/format';
import Notice from '@/components/Notice';

type Category = { id: string; nameAr: string };
type Game = { id: string; nameAr: string; nameEn: string };
type Item = {
  id: string;
  sku: string;
  nameAr: string;
  from: string | number;
  to: string | number;
  costPrice: string | number;
  belowCost: boolean;
};
type Result = { items: Item[]; applied: number };
type Scope = 'category' | 'game' | 'selected';

const field =
  'surface-2 hairline w-full min-w-0 rounded-xl border px-3.5 py-2.5 text-[15px] outline-none focus:border-teal';

function friendly(e: unknown): string {
  if (!(e instanceof ApiError)) return 'تعذّر الاتصال بالخادم.';
  if (e.message === NOT_READY) return NOT_READY;
  if (e.status === 403) return 'ليست لديك صلاحية تعديل الأسعار.';
  return e.message;
}

/**
 * Raise or lower many prices at once (a category, a brand, or ticked products):
 * a preview first, then apply. A new price under cost is never applied.
 */
export default function BulkPrice({
  selected,
  onClose,
  onApplied,
}: {
  selected: { id: string; nameAr: string }[];
  onClose: () => void;
  onApplied: () => void;
}) {
  const cats = useFetch<Category[]>('/admin/catalog/categories');
  const games = useFetch<{ data: Game[] }>('/admin/catalog/games?limit=100');
  const [scope, setScope] = useState<Scope>(selected.length ? 'selected' : 'category');
  const [categoryId, setCategoryId] = useState('');
  const [gameId, setGameId] = useState('');
  const [percent, setPercent] = useState('');
  const [preview, setPreview] = useState<Item[] | null>(null);
  const [busy, setBusy] = useState<'preview' | 'apply' | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // a ticked or unticked row makes the preview stale
  const selKey = selected.map((s) => s.id).join(',');
  useEffect(() => setPreview(null), [selKey]);

  const p = Number(percent);
  const validPct = percent.trim() !== '' && Number.isFinite(p) && p !== 0 && p >= -50 && p <= 100;
  const target = scope === 'category' ? !!categoryId : scope === 'game' ? !!gameId : selected.length > 0;

  function reset() {
    setPreview(null);
    setMsg(null);
  }

  function body(dryRun: boolean) {
    return {
      ...(scope === 'category' && { categoryId }),
      ...(scope === 'game' && { gameId }),
      ...(scope === 'selected' && { productIds: selected.map((s) => s.id) }),
      percent: p,
      dryRun,
    };
  }

  async function run(dryRun: boolean) {
    if (!dryRun) {
      const ok = preview?.filter((i) => !i.belowCost).length ?? 0;
      if (!confirm(`تغيير سعر ${ok} منتج بنسبة ${p > 0 ? '+' : ''}${p}%؟`)) return;
    }
    setBusy(dryRun ? 'preview' : 'apply');
    setMsg(null);
    try {
      const res = await api.post<Result>('/admin/catalog/products/bulk-price', body(dryRun));
      if (dryRun) {
        setPreview(res.items);
        if (res.items.length === 0) setMsg({ ok: false, text: 'لا منتجات في هذا الاختيار.' });
      } else {
        setPreview(null);
        setMsg({ ok: true, text: `طُبّق السعر الجديد على ${num(res.applied)} منتج.` });
        onApplied();
      }
    } catch (e) {
      setMsg({ ok: false, text: friendly(e) });
    } finally {
      setBusy(null);
    }
  }

  const changing = preview?.filter((i) => !i.belowCost).length ?? 0;
  const blocked = preview?.filter((i) => i.belowCost).length ?? 0;

  const scopes: { id: Scope; label: string }[] = [
    { id: 'category', label: 'فئة' },
    { id: 'game', label: 'علامة / لعبة' },
    { id: 'selected', label: `المنتجات المحدّدة (${selected.length})` },
  ];

  return (
    <section className="surface flex flex-col gap-4 rounded-2xl border-teal/40 p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold">تعديل الأسعار جماعيًا</h2>
          <p className="mt-1 text-xs text-muted">
            ارفع أو اخفض سعر البيع بنسبة مئوية. تُعرض المعاينة أولًا، ولا يُطبَّق أي سعر أقل من التكلفة.
          </p>
        </div>
        <button
          onClick={onClose}
          className="flex-none text-sm font-bold text-muted hover:text-[rgb(var(--text))]"
        >
          إغلاق
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {scopes.map((s) => (
          <button
            key={s.id}
            onClick={() => {
              setScope(s.id);
              reset();
            }}
            className={
              'rounded-full px-3.5 py-1.5 text-xs font-bold transition ' +
              (scope === s.id ? 'bg-teal text-white' : 'surface-2 text-muted hover:text-[rgb(var(--text))]')
            }
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {scope === 'category' && (
          <select
            value={categoryId}
            onChange={(e) => {
              setCategoryId(e.target.value);
              reset();
            }}
            className={field}
          >
            <option value="">اختر الفئة…</option>
            {cats.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nameAr}
              </option>
            ))}
          </select>
        )}
        {scope === 'game' && (
          <select
            value={gameId}
            onChange={(e) => {
              setGameId(e.target.value);
              reset();
            }}
            className={field}
          >
            <option value="">اختر العلامة…</option>
            {games.data?.data.map((g) => (
              <option key={g.id} value={g.id}>
                {g.nameAr || g.nameEn}
              </option>
            ))}
          </select>
        )}
        {scope === 'selected' && (
          <p className="surface-2 rounded-xl px-3.5 py-2.5 text-sm text-muted">
            {selected.length
              ? selected
                  .slice(0, 3)
                  .map((s) => s.nameAr)
                  .join('، ') + (selected.length > 3 ? ` و${selected.length - 3} غيرها` : '')
              : 'حدّد المنتجات من الجدول أدناه.'}
          </p>
        )}
        <label className="flex items-center gap-2">
          <input
            type="number"
            inputMode="decimal"
            min={-50}
            max={100}
            step="0.5"
            value={percent}
            onChange={(e) => {
              setPercent(e.target.value);
              reset();
            }}
            placeholder="مثال: 5 أو ‎-10"
            dir="ltr"
            className={field}
          />
          <span className="flex-none text-lg font-extrabold text-muted">%</span>
        </label>
      </div>
      {percent.trim() !== '' && !validPct && (
        <p className="text-xs font-semibold text-bad">النسبة بين ‎-50% و ‎+100%، وليست صفرًا.</p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => run(true)}
          disabled={!target || !validPct || !!busy}
          className="rounded-xl border border-[rgb(var(--line))] px-5 py-2.5 text-sm font-bold hover:border-teal disabled:opacity-50"
        >
          {busy === 'preview' ? 'جارٍ…' : 'معاينة'}
        </button>
        {preview && changing > 0 && (
          <button
            onClick={() => run(false)}
            disabled={!!busy}
            className="rounded-xl bg-teal px-5 py-2.5 text-sm font-bold text-white hover:bg-teal-deep disabled:opacity-50"
          >
            {busy === 'apply' ? 'جارٍ التطبيق…' : `تطبيق على ${num(changing)} منتج`}
          </button>
        )}
      </div>

      {msg && <Notice text={msg.text} tone={msg.ok ? 'ok' : 'bad'} />}

      {preview && preview.length > 0 && (
        <div className="flex flex-col gap-2">
          {blocked > 0 && (
            <Notice
              tone="warn"
              text={`${num(blocked)} منتج سيصبح سعره أقل من التكلفة، فلن يتغيّر (مُعلَّم بالأحمر).`}
            />
          )}
          <div className="hairline overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead>
                <tr className="surface-2 text-muted">
                  {['المنتج', 'الحالي', 'الجديد', 'التكلفة'].map((h) => (
                    <th
                      key={h}
                      className={
                        'whitespace-nowrap px-3 py-2.5 text-start text-xs font-semibold sm:px-4 ' +
                        (h === 'التكلفة' ? 'hidden sm:table-cell' : '')
                      }
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.map((i) => (
                  <tr key={i.id} className={'border-t hairline ' + (i.belowCost ? 'bg-bad/10' : '')}>
                    <td className="px-3 py-2.5 sm:px-4">
                      <div className="font-semibold">{i.nameAr}</div>
                      <div className="break-all text-xs text-muted" dir="ltr">
                        {i.sku}
                      </div>
                      <div className="text-xs text-muted sm:hidden">
                        التكلفة <span className="tnum">{money(i.costPrice)}</span>
                      </div>
                      {i.belowCost && (
                        <div className="text-xs font-bold text-bad">أقل من التكلفة، لن يُطبَّق</div>
                      )}
                    </td>
                    <td className="tnum whitespace-nowrap px-3 py-2.5 text-muted sm:px-4">{money(i.from)}</td>
                    <td
                      className={`tnum whitespace-nowrap px-3 py-2.5 font-bold sm:px-4 ${i.belowCost ? 'text-bad' : ''}`}
                    >
                      {money(i.to)}
                    </td>
                    <td className="tnum hidden whitespace-nowrap px-4 py-2.5 text-muted sm:table-cell">
                      {money(i.costPrice)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
