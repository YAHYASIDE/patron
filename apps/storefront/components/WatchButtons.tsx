'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { isAuthed, me } from '@/lib/api';
import { tNow, useT } from '@/lib/i18n';
import type { PriceWatch, Product } from '@/lib/types';
import { BellIcon, TagIcon } from './discovery-icons';
import { CheckIcon } from './icons';

/*
 * The customer's price and stock alerts (GET/POST/DELETE /me/watches),
 * loaded once and shared by the buttons on a brand page.
 */
type Kind = PriceWatch['kind'];
const NONE: PriceWatch[] = [];
let watches: PriceWatch[] = NONE;
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function load() {
  if (loaded || !isAuthed()) return;
  loaded = true;
  me.watches()
    .then((w) => {
      watches = Array.isArray(w) ? w : NONE;
      emit();
    })
    .catch(() => (loaded = false));
}

function useWatches(): PriceWatch[] {
  useEffect(load, []);
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => watches,
    () => NONE,
  );
}

/** One alert toggle: watch → "we'll tell you" (tap again to stop). Guests go to sign-in first. */
function useWatch(productId: string, kind: Kind) {
  const router = useRouter();
  const list = useWatches();
  const row = list.find((w) => w.productId === productId && w.kind === kind && !w.notifiedAt);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function toggle() {
    if (!isAuthed()) {
      const here = window.location.pathname + window.location.search;
      router.push(`/login?next=${encodeURIComponent(here)}`);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      if (row) {
        await me.unwatch(row.id);
        watches = watches.filter((w) => w.id !== row.id);
      } else {
        const w = await me.watch(productId, kind);
        watches = [w, ...watches.filter((x) => x.id !== w.id)];
      }
      emit();
    } catch {
      setErr(tNow('تعذّر حفظ التنبيه. حاول مرة أخرى.'));
    } finally {
      setBusy(false);
    }
  }
  return { on: !!row, busy, err, toggle };
}

/** #11: "tell me when the price drops" for the chosen amount. */
export function PriceWatchButton({ product }: { product: Product }) {
  const t = useT();
  const { on, busy, err, toggle } = useWatch(product.id, 'price');
  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        aria-pressed={on}
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition disabled:opacity-60 ${
          on ? 'bg-teal/10 text-teal' : 'surface-2 text-muted hover:text-[rgb(var(--text))]'
        }`}
      >
        {on ? <CheckIcon size={14} /> : <TagIcon size={14} />}
        {on ? t('سنُعلمك عند انخفاض السعر') : t('أعلمني عند انخفاض السعر')}
      </button>
      {err && <p className="mt-1 text-xs text-bad">{err}</p>}
    </div>
  );
}

function StockChip({ product, label }: { product: Product; label: string }) {
  const t = useT();
  const { on, busy, err, toggle } = useWatch(product.id, 'stock');
  return (
    <li>
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        aria-pressed={on}
        className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-3 py-1.5 text-start text-xs font-bold transition disabled:opacity-60 ${
          on ? 'border-teal/40 bg-teal/10 text-teal' : 'border-[rgb(var(--line))] text-muted hover:border-teal/50'
        }`}
      >
        {on ? <CheckIcon size={14} className="flex-none" /> : <BellIcon size={14} className="flex-none" />}
        <span className="min-w-0 truncate">
          {on ? t('سنُعلمك عند توفّر {name}', { name: label }) : t('أعلمني عند توفّر {name}', { name: label })}
        </span>
      </button>
      {err && <p className="mt-1 text-xs text-bad">{err}</p>}
    </li>
  );
}

/** #12: one "tell me when it is back" per amount that is out of stock. */
export function StockWatchList({ products, labelOf }: { products: Product[]; labelOf: (p: Product) => string }) {
  const t = useT();
  const out = products.filter((p) => p.inStock === false);
  if (out.length === 0) return null;
  return (
    <div className="mt-4 border-t border-[rgb(var(--line))] pt-3">
      <p className="text-xs font-semibold text-muted">{t('فئات غير متوفّرة الآن:')}</p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {out.map((p) => (
          <StockChip key={p.id} product={p} label={labelOf(p)} />
        ))}
      </ul>
    </div>
  );
}
