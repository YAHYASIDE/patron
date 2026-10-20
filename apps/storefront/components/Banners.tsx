'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { BASE, catalog } from '@/lib/api';
import { useT } from '@/lib/i18n';
import type { Banner as BaseBanner } from '@/lib/types';
import Countdown from './Countdown';

// the end date is shown as a countdown when the public banner payload carries it
type Banner = BaseBanner & { endsAt?: string | null };

const TONE: Record<Banner['tone'], string> = {
  teal: 'bg-gradient-to-br from-teal to-teal-ink text-white',
  gold: 'bg-gradient-to-br from-gold-soft to-gold-deep text-ink-950',
  ink: 'bg-gradient-to-br from-ink-800 to-ink-950 text-white',
  rose: 'bg-gradient-to-br from-[#e5486b] to-[#9f1f45] text-white',
};

function href(b: Banner): string | null {
  if (b.linkType === 'offers') return '/products?offers=1';
  if (b.linkType === 'product' && b.linkValue) return `/products/${encodeURIComponent(b.linkValue)}`;
  if (b.linkType === 'url' && b.linkValue) return b.linkValue;
  return null;
}

function Card({ b, onEnd }: { b: Banner; onEnd: (id: string) => void }) {
  const ended = useCallback(() => onEnd(b.id), [b.id, onEnd]);
  const body = (
    <div
      className={`relative flex h-[132px] flex-col justify-end overflow-hidden rounded-2xl p-4 shadow-card sm:h-[160px] sm:p-5 ${
        b.imageUrl ? 'bg-ink-900 text-white' : TONE[b.tone] ?? TONE.teal
      }`}
    >
      {b.imageUrl && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- owner-supplied link on any host */}
          <img
            src={b.imageUrl.startsWith('/uploads/') ? `${BASE}${b.imageUrl}` : b.imageUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
          <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/25 to-transparent" />
        </>
      )}
      {!b.imageUrl && (
        <span aria-hidden className="absolute -end-10 -top-12 h-40 w-40 rounded-full bg-white/10" />
      )}
      {b.endsAt && <Countdown endsAt={b.endsAt} onEnd={ended} className="absolute start-4 top-3.5 sm:start-5" />}
      <div className="relative">
        <div className="text-lg font-extrabold leading-snug sm:text-xl">{b.titleAr}</div>
        {b.subtitleAr && <div className="mt-0.5 text-sm opacity-90">{b.subtitleAr}</div>}
      </div>
    </div>
  );
  const to = href(b);
  if (!to) return body;
  if (/^https?:\/\//.test(to))
    return (
      <a href={to} target="_blank" rel="noopener noreferrer">
        {body}
      </a>
    );
  return <Link href={to}>{body}</Link>;
}

/** The owner's offers, swipeable, one after another every few seconds. */
export default function Banners() {
  const t = useT();
  const [list, setList] = useState<Banner[]>([]);
  const [at, setAt] = useState(0);
  const track = useRef<HTMLDivElement>(null);
  // an offer whose time runs out while the page is open leaves the row
  const drop = useCallback((id: string) => setList((l) => l.filter((x) => x.id !== id)), []);

  useEffect(() => {
    catalog
      .banners()
      .then(setList)
      .catch(() => setList([]));
  }, []);

  // advance unless the customer is touching it
  useEffect(() => {
    if (list.length < 2) return;
    const t = setInterval(() => {
      const el = track.current;
      if (!el || el.matches(':hover') || el.contains(document.activeElement)) return;
      const next = (at + 1) % list.length;
      (el.children[next] as HTMLElement | undefined)?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
    }, 5000);
    return () => clearInterval(t);
  }, [list.length, at]);

  if (list.length === 0) return null;

  return (
    <section className="mx-auto max-w-page px-4 pt-5" aria-label={t('العروض')}>
      <div
        ref={track}
        onScroll={(e) => {
          const el = e.currentTarget;
          const w = (el.children[0] as HTMLElement | undefined)?.offsetWidth ?? 1;
          setAt(Math.round(Math.abs(el.scrollLeft) / (w + 12)));
        }}
        className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {list.map((b) => (
          <div key={b.id} className={`flex-none snap-start ${list.length > 1 ? 'w-[88%] md:w-[49%]' : 'w-full'}`}>
            <Card b={b} onEnd={drop} />
          </div>
        ))}
      </div>
      {list.length > 1 && (
        <div className="mt-2.5 flex justify-center gap-1.5" aria-hidden>
          {list.map((b, i) => (
            <span
              key={b.id}
              className={`h-1.5 rounded-full transition-all ${i === at ? 'w-5 bg-teal' : 'w-1.5 bg-[rgb(var(--line))]'}`}
            />
          ))}
        </div>
      )}
    </section>
  );
}
