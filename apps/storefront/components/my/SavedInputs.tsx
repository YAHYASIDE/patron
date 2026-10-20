'use client';

import { useEffect, useMemo, useState } from 'react';
import { me } from '@/lib/api';
import { useCatalog } from '@/lib/brands';
import { useCurrency } from '@/lib/currency';
import { useLang, useT } from '@/lib/i18n';
import type { GameInput, SavedInput } from '@/lib/types';
import { TrashIcon } from '@/components/icons';
import { day } from './when';

/**
 * Saved account IDs (#8): the player IDs and usernames the shop remembers per
 * game (filled in on the product page). Here the customer sees and removes them.
 */
export default function SavedInputs() {
  const t = useT();
  const lang = useLang();
  const currency = useCurrency();
  const { products } = useCatalog(currency);
  const [rows, setRows] = useState<SavedInput[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    me.savedInputs()
      .then((r) => alive && setRows(r))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  // game names and field labels from the catalogue already loaded for the shop
  const games = useMemo(() => {
    const m = new Map<string, { name: string; fields: GameInput[] }>();
    for (const p of products ?? []) {
      if (p.gameId && p.game && !m.has(p.gameId)) m.set(p.gameId, { name: p.game.nameAr, fields: p.game.inputSchema ?? [] });
    }
    return m;
  }, [products]);

  async function remove(id: string) {
    setRemoving(id);
    setNote(null);
    try {
      await me.deleteInput(id);
      setRows((r) => (r ?? []).filter((x) => x.id !== id));
    } catch {
      setNote(t('تعذّر الحذف الآن. حاول بعد قليل.'));
    } finally {
      setRemoving(null);
    }
  }

  const label = (f: GameInput | undefined, key: string) => (f ? (lang === 'ar' ? f.labelAr : f.labelEn || f.labelAr) : key);

  return (
    <section className="surface rounded-2xl p-5 shadow-card">
      <h2 className="text-base font-bold">{t('معرّفات الحسابات المحفوظة')}</h2>
      <p className="mt-0.5 text-sm text-muted">{t('نملؤها لك تلقائيًا عند الشراء من نفس اللعبة.')}</p>

      {rows === null && !failed && <p className="mt-4 text-sm text-muted">{t('جارٍ التحميل…')}</p>}
      {failed && <p className="mt-4 text-sm text-muted">{t('تعذّر تحميلها الآن. حاول بعد قليل.')}</p>}
      {rows?.length === 0 && <p className="mt-4 text-sm text-muted">{t('لا توجد معرّفات محفوظة بعد.')}</p>}

      {!!rows?.length && (
        <ul className="mt-4 divide-y divide-[rgb(var(--line))]">
          {rows.map((r) => {
            const g = games.get(r.gameId);
            return (
              <li key={r.id} className="flex items-start gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold">
                    {g?.name ?? t('لعبة')}
                    {r.label && <span className="font-normal text-muted"> · {r.label}</span>}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {Object.entries(r.values).map(([k, v]) => (
                      <span key={k} className="surface-2 inline-flex max-w-full items-center gap-1 rounded-lg px-2 py-1 text-xs">
                        <span className="text-muted">{label(g?.fields.find((f) => f.key === k), k)}:</span>
                        <span dir="ltr" className="break-all font-bold">
                          {v}
                        </span>
                      </span>
                    ))}
                  </div>
                  <div className="mt-1 text-[11px] text-muted">{t('آخر استخدام: {date}', { date: day(r.updatedAt) })}</div>
                </div>
                <button
                  onClick={() => remove(r.id)}
                  disabled={removing === r.id}
                  aria-label={t('حذف')}
                  className="grid h-9 w-9 flex-none place-items-center rounded-lg text-muted transition hover:bg-bad/10 hover:text-bad disabled:opacity-50"
                >
                  <TrashIcon size={17} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {note && <p className="mt-2 text-sm text-bad">{note}</p>}
    </section>
  );
}
