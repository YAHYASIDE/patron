'use client';

import { useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n';
import BrandMark from './BrandMark';

// what the shop sells, on a ring around the mark (clockwise from the top)
const ICONS = ['g-pubg-mobile', 'gc-apple-us', 'sub-nflx', 'g-free-fire', 'gc-psn-us', 'g-tiktok', 'sub-spotify', 'gc-gplay-us'];

/**
 * The opening screen: the product icons swing in on a ring around the Patron
 * mark, then fly into it, the mark answers with a small pulse and the page
 * shows through (1.8 s in all). It is drawn over the page, never instead of
 * it: the page renders underneath for screen readers and search engines, the
 * whole thing is aria-hidden, and the timing is pure CSS (components/discovery.css),
 * transforms and opacity only, so it clears itself even without JavaScript.
 * It plays once per launch (sessionStorage, see lib/boot-scripts.ts), never on
 * navigation. A tap or Escape skips it; reduced motion gets a still frame.
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
    const fallback = setTimeout(() => setGone(true), 2400);
    return () => {
      el?.removeEventListener('animationend', done);
      clearTimeout(fallback);
    };
  }, []);

  if (gone) return null;
  return (
    <div ref={box} className="splash" aria-hidden>
      <div className="splash-glow" />
      <div className="splash-stage">
        <div className="splash-ring">
          {ICONS.map((key, i) => (
            <div
              key={key}
              className="splash-icon"
              style={{ '--a': `${i * (360 / ICONS.length)}deg`, animationDelay: `${i * 0.025}s` } as React.CSSProperties}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- local vector art, a few KB each */}
              <img src={`/art/brand/${key}.svg`} alt="" decoding="async" />
            </div>
          ))}
          <div className="splash-mark">
            <BrandMark id="splash" />
          </div>
        </div>
        <div dir="ltr" className="splash-word">
          patron
          <b>.</b>
        </div>
        <div className="splash-tag">{t('بطاقات وشحن رقمي موثوق')}</div>
      </div>
    </div>
  );
}
