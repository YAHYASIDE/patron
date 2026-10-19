'use client';

import { useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n';
import BrandMark from './BrandMark';

// the cards that fan out behind the mark: position, tilt and size around the centre (in card widths)
const CARDS = [
  { key: 'g-free-fire', x: -1.6, y: 0.05, r: -16, s: 0.86, delay: 0.32 },
  { key: 'gc-apple-us', x: -0.85, y: -0.38, r: -8, s: 0.94, delay: 0.2 },
  { key: 'g-pubg-mobile', x: 0, y: -0.6, r: 0, s: 1, delay: 0.1 },
  { key: 'sub-nflx', x: 0.85, y: -0.38, r: 8, s: 0.94, delay: 0.2 },
  { key: 'gc-psn-us', x: 1.6, y: 0.05, r: 16, s: 0.86, delay: 0.32 },
];

/**
 * The opening screen: the Patron mark and a fan of product cards rise on a
 * deep teal field, then the page shows through (about 1.6 s). It is drawn
 * over the page, never instead of it: the page renders underneath for screen
 * readers and search engines, the whole thing is aria-hidden, and the timing
 * is pure CSS (components/discovery.css), so it clears itself even without
 * JavaScript. A tap or Escape skips it; reduced motion gets a still frame.
 */
export default function Splash() {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    if (document.documentElement.classList.contains('no-splash')) return setGone(true);
    // skipping is wired by SPLASH_INIT (lib/boot-scripts.ts) so a tap works before hydration
    const el = box.current;
    const done = (e: AnimationEvent) => e.target === el && e.animationName === 'splash-out' && setGone(true);
    el?.addEventListener('animationend', done);
    const fallback = setTimeout(() => setGone(true), 2600);
    return () => {
      el?.removeEventListener('animationend', done);
      clearTimeout(fallback);
    };
  }, []);

  if (gone) return null;
  return (
    <div ref={box} className="splash" aria-hidden>
      <div className="splash-grid" />
      <div className="splash-sweep" />
      <div className="splash-stage">
        <div className="splash-cards">
          {CARDS.map((c) => (
            <div
              key={c.key}
              className="splash-card"
              style={
                {
                  '--x': `calc(var(--u) * ${c.x})`,
                  '--y': `calc(var(--u) * ${c.y})`,
                  '--r': `${c.r}deg`,
                  '--s': c.s,
                  animationDelay: `${c.delay}s`,
                  zIndex: c.x === 0 ? 2 : Math.abs(c.x) < 1 ? 1 : 0,
                } as React.CSSProperties
              }
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- local vector art */}
              <img src={`/art/brand/${c.key}.svg`} alt="" decoding="async" fetchPriority="high" />
            </div>
          ))}
        </div>
        <div className="splash-mark">
          <BrandMark id="splash" />
        </div>
        <div dir="ltr" className="splash-word">
          patron
          <b>.</b>
        </div>
        <div className="splash-tag">{t('بطاقات وشحن رقمي فوري')}</div>
      </div>
    </div>
  );
}
