'use client';

import { useCallback, useEffect, useState } from 'react';
import { isAuthed, me } from '@/lib/api';
import { useT } from '@/lib/i18n';
import type { GameInput, SavedInput } from '@/lib/types';
import { HistoryIcon } from './discovery-icons';

/** Only plain values are kept on the account: never a field the game marks sensitive. */
export function savable(schema: GameInput[], inputs: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of schema) {
    const v = (inputs[f.key] ?? '').trim();
    if (v && !f.sensitive) out[f.key] = v;
  }
  return out;
}

const same = (a: Record<string, string>, b: Record<string, string>) => {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
};

/**
 * The signed-in customer's saved account details for one game
 * (GET/POST /me/saved-inputs). `save` puts the latest at the front; the API
 * itself refreshes a row it already has instead of adding a copy.
 */
export function useSavedInputs(gameId: string | null | undefined) {
  const [list, setList] = useState<SavedInput[]>([]);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    const on = isAuthed();
    setAuthed(on);
    if (!on || !gameId) return;
    let alive = true;
    me.savedInputs(gameId)
      .then((rows) => alive && setList(Array.isArray(rows) ? rows : []))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [gameId]);

  const save = useCallback(
    (values: Record<string, string>) => {
      if (!authed || !gameId || Object.keys(values).length === 0) return;
      me.saveInput({ gameId, values })
        .then((row) => setList((l) => [row, ...l.filter((x) => x.id !== row.id && !same(x.values, row.values))]))
        .catch(() => undefined);
    },
    [authed, gameId],
  );

  return { list, authed, save };
}

/** One tap fills the form with details used before. */
export function SavedInputChips({
  list,
  schema,
  current,
  onPick,
}: {
  list: SavedInput[];
  schema: GameInput[];
  current: Record<string, string>;
  onPick: (values: Record<string, string>) => void;
}) {
  const t = useT();
  const keys = new Set(schema.map((f) => f.key));
  // a saved row is offered only if it fills at least one field this game still asks for
  const usable = list.filter((r) => Object.keys(r.values ?? {}).some((k) => keys.has(k))).slice(0, 6);
  if (usable.length === 0) return null;
  const chosen = savable(schema, current);
  return (
    <div className="mb-4">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-muted">
        <HistoryIcon size={14} className="text-teal" /> {t('بياناتك المحفوظة')}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {usable.map((r) => {
          const text =
            r.label ||
            schema
              .map((f) => r.values[f.key])
              .filter(Boolean)
              .join(' · ');
          const on = same(
            Object.fromEntries(Object.entries(r.values).filter(([k]) => keys.has(k))),
            chosen,
          );
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => onPick(r.values)}
              aria-pressed={on}
              className={`max-w-full truncate rounded-full border px-3.5 py-2 text-sm font-bold transition ${
                on ? 'border-teal bg-teal/10 text-teal' : 'border-[rgb(var(--line))] hover:border-teal/60'
              }`}
            >
              <bdi>{text}</bdi>
            </button>
          );
        })}
      </div>
    </div>
  );
}
